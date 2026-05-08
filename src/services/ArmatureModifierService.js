// @ts-check

/**
 * Armature modifier operators — Blender-style "Apply" on a per-part
 * Armature modifier.
 *
 * Mirrors `modifier_apply_obdata` in
 * `reference/blender/source/blender/editors/object/object_modifier.cc:1050`,
 * specialised for the deform-only Armature case
 * (`reference/blender/source/blender/modifiers/intern/MOD_armature.cc:115`).
 *
 * **Semantics.** Apply takes whatever the viewport currently shows for
 * the part — i.e. the full eval pipeline output: chainEval(rig,
 * paramValues) producing canvas-px verts, then two-bone LBS on top
 * — and writes the result into `mesh.vertices`. The Armature modifier
 * entry is then removed from `node.modifiers[]`. After Apply, the
 * part is no longer skinned to the armature; its rest geometry IS
 * the previously-deformed geometry. Mirrors Blender's behaviour: the
 * Armature modifier dropdown → Apply bakes the deformation
 * permanently and removes the modifier.
 *
 * **Composes with the SS workflow.** Typical sequence (from the user's
 * own description, 2026-05-08):
 *   1. Pose the bones (Pose Mode arc gestures) — visible deformation
 *      is the two-bone LBS we just shipped.
 *   2. For each rigged mesh, click "Apply" on its Armature modifier
 *      → this function. Mesh now stores the posed geometry as rest.
 *      Modifier disappears.
 *   3. On the armature, "Apply Pose as Rest" → bone pose channels are
 *      zeroed and the rest absorbs the pose. Bones look unchanged.
 *   4. Re-rig: re-add the Armature modifier (currently via re-running
 *      Init Rig; future: a one-click re-bind operator).
 *
 * @module services/ArmatureModifierService
 */

import { useProjectStore } from '../store/projectStore.js';
import { useParamValuesStore } from '../store/paramValuesStore.js';
import { selectRigSpec } from '../io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../io/live2d/runtime/evaluator/chainEval.js';
import {
  computeBoneWorldMatrices,
  computeBoneParentMap,
} from '../renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinningObj } from '../renderer/boneSkinning.js';
import { logger } from '../lib/logger.js';

/**
 * Apply the Armature modifier on a part: bake the current visible
 * deformation into `mesh.vertices` and remove the modifier from
 * `node.modifiers[]`.
 *
 * Idempotent in the absence of the modifier — if the part has no
 * Armature modifier, this is a no-op (mirrors Blender's UI which
 * just hides the dropdown when no Armature is present).
 *
 * @param {string} partId
 * @returns {{ baked: boolean, vertCount: number, reason?: string }}
 */
export function applyArmatureModifier(partId) {
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const part = project?.nodes?.find((n) => n.id === partId) ?? null;
  if (!part || part.type !== 'part') {
    return { baked: false, vertCount: 0, reason: 'not-a-part' };
  }
  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  const armatureIdx = stack.findIndex((m) => m?.type === 'armature');
  if (armatureIdx < 0) {
    return { baked: false, vertCount: 0, reason: 'no-armature-modifier' };
  }
  const mesh = part.mesh ?? null;
  const restVerts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  if (!restVerts || restVerts.length === 0) {
    return { baked: false, vertCount: 0, reason: 'no-mesh-vertices' };
  }
  const armature = stack[armatureIdx];
  const jointBoneId = armature.data?.jointBoneId ?? null;
  if (typeof jointBoneId !== 'string' || jointBoneId.length === 0) {
    return { baked: false, vertCount: 0, reason: 'armature-missing-jointBoneId' };
  }
  const partWeights = Array.isArray(mesh?.boneWeights) ? mesh.boneWeights : null;
  if (!partWeights || partWeights.length < restVerts.length) {
    return { baked: false, vertCount: 0, reason: 'missing-or-short-boneWeights' };
  }

  // Run a one-shot evalRig with current paramValues so the bake
  // captures any baked-keyform deformation under
  // `ParamRotation_<bone>` etc. — not just the rest geometry. For
  // the common case (slider at 0) chainEval's output equals the rest
  // verts and the bake reduces to LBS-of-rest.
  const rigSpec = selectRigSpec(project);
  const paramValues = useParamValuesStore.getState().values ?? {};
  let baseVerts;
  if (rigSpec && Array.isArray(rigSpec.artMeshes) && rigSpec.artMeshes.length > 0) {
    const frames = evalRig(rigSpec, paramValues);
    const frame = frames.find((f) => f.id === partId) ?? null;
    if (frame && Array.isArray(frame.vertexPositions) && frame.vertexPositions.length === restVerts.length * 2) {
      baseVerts = new Array(restVerts.length);
      for (let i = 0; i < restVerts.length; i++) {
        baseVerts[i] = {
          x: frame.vertexPositions[i * 2],
          y: frame.vertexPositions[i * 2 + 1],
        };
      }
    } else {
      // No matching frame — part isn't in the rig spec. Fall back to
      // mesh.vertices (rest). This is correct when the rig hasn't
      // harvested this part yet.
      baseVerts = restVerts.map((v) => ({ x: v.x, y: v.y }));
    }
  } else {
    baseVerts = restVerts.map((v) => ({ x: v.x, y: v.y }));
  }

  // Two-bone LBS using the current bone WORLD matrices. Same math
  // the viewport runs every frame in `CanvasViewport.jsx` so the
  // bake is byte-identical to what the user sees.
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  const boneParents = computeBoneParentMap(project.nodes);
  const childMatrix = boneWorld.get(jointBoneId) ?? null;
  const parentBoneId = armature.data?.parentBoneId ?? boneParents.get(jointBoneId) ?? null;
  const parentMatrix = parentBoneId ? boneWorld.get(parentBoneId) ?? null : null;
  applyTwoBoneSkinningObj(baseVerts, parentMatrix, childMatrix, partWeights);

  // Write the baked verts into mesh.vertices and remove the Armature
  // modifier. Atomically, in a single updateProject so undo captures
  // both halves of the operation.
  projectState.updateProject((proj) => {
    const target = proj.nodes.find((n) => n.id === partId);
    if (!target || target.type !== 'part' || !target.mesh) return;
    if (!Array.isArray(target.mesh.vertices)) return;
    const verts = target.mesh.vertices;
    if (verts.length !== baseVerts.length) return;
    for (let i = 0; i < verts.length; i++) {
      verts[i].x = baseVerts[i].x;
      verts[i].y = baseVerts[i].y;
    }
    if (Array.isArray(target.modifiers)) {
      const idx = target.modifiers.findIndex((m) => m?.type === 'armature');
      if (idx >= 0) target.modifiers.splice(idx, 1);
      if (target.modifiers.length === 0) delete target.modifiers;
    }
    // Vertex group data (`mesh.boneWeights` + `mesh.jointBoneId`)
    // STAYS on the mesh datablock — same as Blender. Apply Modifier
    // removes the binding (the modifier entry above) but keeps the
    // vertex groups so the next modifier add re-binds automatically
    // (`object_modifier.cc` apply path doesn't touch `me->dvert`).
    // Render-loop skinning is gated on the modifier's presence
    // (CanvasViewport: armatureMod check), not on boneWeights — so
    // there's no double-apply concern.
  });

  logger.info(
    'armatureModifierApply',
    `applied Armature modifier on "${part.name ?? partId}" — baked ${baseVerts.length} verts via two-bone LBS`,
    {
      partId,
      partName: part.name,
      jointBoneId,
      parentBoneId,
      vertCount: baseVerts.length,
    },
  );

  return { baked: true, vertCount: baseVerts.length };
}

/**
 * Bind (re-add) an Armature modifier to a part. Inverse of `applyArmatureModifier`.
 * Mirrors Blender's "Add Modifier → Armature" dropdown — appends an
 * Armature entry to `node.modifiers[]` using the part's existing
 * vertex group data (`mesh.jointBoneId` + `mesh.boneWeights`). If
 * those are missing the operator fails (Blender behaves the same:
 * adding an Armature modifier to a mesh without vertex groups is
 * legal but produces no deformation; we return an error so the user
 * gets immediate feedback rather than a silent no-op).
 *
 * Idempotent: returns `{bound: false, reason: 'already-bound'}` when
 * an Armature modifier is already on the stack.
 *
 * @param {string} partId
 * @returns {{ bound: boolean, jointBoneId?: string, parentBoneId?: string|null, reason?: string }}
 */
export function bindArmatureModifier(partId) {
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const part = project?.nodes?.find((n) => n.id === partId) ?? null;
  if (!part || part.type !== 'part') {
    return { bound: false, reason: 'not-a-part' };
  }
  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  if (stack.some((m) => m?.type === 'armature')) {
    return { bound: false, reason: 'already-bound' };
  }
  const mesh = part.mesh ?? null;
  const jointBoneId = typeof mesh?.jointBoneId === 'string' && mesh.jointBoneId.length > 0
    ? mesh.jointBoneId : null;
  const boneWeights = Array.isArray(mesh?.boneWeights) ? mesh.boneWeights : null;
  if (!jointBoneId || !boneWeights || boneWeights.length === 0) {
    return { bound: false, reason: 'missing-vertex-groups' };
  }
  const jointBone = project.nodes.find((n) => n.id === jointBoneId) ?? null;
  if (!jointBone || jointBone.type !== 'group' || !jointBone.boneRole) {
    return { bound: false, reason: 'jointBoneId-not-a-bone' };
  }
  // Walk to nearest bone-group ancestor — same logic as
  // `boneOverlayMatrix.computeBoneParentMap` and the synth in
  // `deformerNodeSync.synthesizeModifierStacks`.
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  let parent = jointBone.parent ? byId.get(jointBone.parent) : null;
  while (parent && !(parent.type === 'group' && parent.boneRole)) {
    parent = parent.parent ? byId.get(parent.parent) : null;
  }
  const parentBoneId = parent?.id ?? null;

  projectState.updateProject((proj) => {
    const target = proj.nodes.find((n) => n.id === partId);
    if (!target || target.type !== 'part') return;
    const targetMesh = target.mesh;
    const targetJoint = byId.get(targetMesh?.jointBoneId);
    if (!targetJoint) return;
    if (!Array.isArray(target.modifiers)) target.modifiers = [];
    // Place AFTER any existing deformer chain (same convention as
    // `synthesizeModifierStacks`). Mirrors Blender's "Add Modifier"
    // appending to the end of the stack.
    target.modifiers.push({
      type: 'armature',
      deformerId: jointBoneId,
      enabled: true,
      // DEFAULT_MIGRATED_MODE = REALTIME | RENDER (same as fresh
      // modifiers in `v21_modifier_mode_flags.DEFAULT_MIGRATED_MODE`).
      mode: 3,
      showInEditor: true,
      data: {
        jointBoneId,
        jointBoneRole: targetJoint.boneRole,
        parentBoneId,
        parentBoneRole: parent?.boneRole ?? null,
        deformFlag: 1,
        vertexGroupName: '',
      },
    });
  });

  logger.info(
    'armatureModifierBind',
    `bound Armature modifier on "${part.name ?? partId}" → joint=${jointBone.boneRole}${parent?.boneRole ? ` (parent ${parent.boneRole})` : ''}`,
    { partId, partName: part.name, jointBoneId, parentBoneId },
  );

  return { bound: true, jointBoneId, parentBoneId };
}
