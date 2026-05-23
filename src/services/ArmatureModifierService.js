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
  // the viewport runs every frame in `CanvasViewport.jsx` so the bake
  // is byte-identical to what the user sees. Applies for both
  // rigid-intent (all-1.0 weights) and true-skinning parts: in the
  // rigid case the LBS reduces to a uniform rotation of every vert
  // by the joint bone's world matrix, which equals the visual at
  // current pose — exactly what we want to bake into mesh.vertices
  // so the post-Apply rest IS the previously-posed geometry.
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  const boneParents = computeBoneParentMap(project.nodes);
  const childMatrix = boneWorld.get(jointBoneId) ?? null;
  const parentBoneId = armature.data?.parentBoneId ?? boneParents.get(jointBoneId) ?? null;
  const parentMatrix = parentBoneId ? boneWorld.get(parentBoneId) ?? null : null;
  applyTwoBoneSkinningObj(baseVerts, parentMatrix, childMatrix, partWeights);

  // NaN guard — degenerate bone matrices (zero scale, infinite values)
  // propagate NaN through `applyTwoBoneSkinningObj` and would corrupt
  // mesh.vertices silently. Refuse to write; surface via logger.
  // Rule №1 fix: never persist NaN through Apply.
  for (let i = 0; i < baseVerts.length; i++) {
    if (!Number.isFinite(baseVerts[i].x) || !Number.isFinite(baseVerts[i].y)) {
      logger.error(
        'armatureModifierApplyNaN',
        `LBS bake produced non-finite vertex on "${part.name ?? partId}" — Apply aborted`,
        { partId, jointBoneId, parentBoneId, vertIndex: i,
          x: baseVerts[i].x, y: baseVerts[i].y },
      );
      return { baked: false, vertCount: 0, reason: 'lbs-bake-nan' };
    }
  }

  // Write the baked verts into mesh.vertices, remove the Armature
  // modifier, and replace `mesh.runtime` with a minimal canvas-px
  // entry. Atomically, in a single updateProject so undo captures
  // the whole operation.
  //
  // # Why we WRITE a minimal runtime instead of deleting it
  //
  // 2026-05-09 (later same day): the prior version of this code
  // deleted `mesh.runtime` to "let `selectRigSpec`'s pre-rig fallback
  // rebuild." But the pre-rig fallback (`selectRigSpec.js:563-638`)
  // was designed for fresh-import projects whose `mesh.vertices` are
  // in REST canvas-px. After Apply, mesh.vertices is in POSED
  // canvas-px (LBS bake output). The fallback reads `part.rigParent`
  // (still pointing at a body warp from synthesizeDeformerParents
  // pre-Apply) and frame-converts the verts into the warp's
  // [0..1] normalised space using the warp's REST bbox — but the
  // posed verts can lie far outside the rest bbox, producing
  // localVerts well above 1.0 or below 0. chainEval bilinearly
  // extrapolates outside the warp grid and the part renders far
  // off-canvas — the user's reported "arm disappeared" symptom.
  //
  // The structurally correct fix: write a runtime entry that
  // declares parent=root + a single rest keyform with the baked
  // canvas-px verts verbatim. selectRigSpec's runtime-cache fast
  // path then sees parent=root (no warp normalization), keyform
  // vertices in canvas-px, and chainEval emits them directly to
  // the renderer. Per-bone-angle keyforms (the 5-keyform multi-
  // angle cache) are intentionally collapsed to 1: Apply means
  // "this part is no longer skinned"; slider effects on this
  // part should stop, exactly mirroring Blender's
  // `modifier_apply_obdata` semantics.
  const flatBaked = new Float32Array(baseVerts.length * 2);
  for (let i = 0; i < baseVerts.length; i++) {
    flatBaked[i * 2]     = baseVerts[i].x;
    flatBaked[i * 2 + 1] = baseVerts[i].y;
  }
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
    // M3.3 (RULE-№4, 2026-05-23): `runtime.parent` is no longer
    // persisted — the chain leaf is derived from `part.modifiers[0]`
    // (selectRigSpec) and project topology (synthesizeModifierStacks
    // via `findInnermostBodyWarpId`). v47 migration strips the field
    // from any pre-M3.3 save on load.
    target.mesh.runtime = {
      bindings: [],
      keyforms: [{
        keyTuple: [],
        vertexPositions: Array.from(flatBaked),
        opacity: 1,
      }],
    };
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
 * Bind (add) an Armature modifier to a part. Inverse of `applyArmatureModifier`.
 * Mirrors Blender's "Properties → Modifiers → Add Modifier → Armature":
 * adding an Armature modifier to a mesh is always legal regardless of
 * whether the mesh has vertex groups yet. With no vertex groups the
 * modifier is render-side a no-op (no per-vertex skinning), but the
 * mesh still rigid-follows its parent bone via the overlay-matrix
 * path. Once the user paints weights via Weight Paint mode the
 * composition decision flips from `'overlay'` to `'lbs'` and LBS
 * activates.
 *
 * Resolves `jointBoneId` in this order:
 *   1. `mesh.jointBoneId` if present (post-Apply re-bind path —
 *      Blender keeps `me->dvert` on Apply so the previous binding
 *      target is reused).
 *   2. Nearest `isBoneGroup` ancestor in `node.parent` chain
 *      (fresh-bind path on a rigid-follow part).
 *
 * If neither resolves (no bone ancestor), the operator fails — there's
 * no armature to bind to.
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

  // Resolve jointBoneId: prefer `mesh.jointBoneId` (post-Apply re-bind
  // path), fall back to nearest bone-group ancestor (fresh-bind path).
  let jointBoneId = typeof mesh?.jointBoneId === 'string' && mesh.jointBoneId.length > 0
    ? mesh.jointBoneId : null;
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  if (!jointBoneId) {
    let cur = part.parent ? byId.get(part.parent) : null;
    while (cur && !(cur.type === 'group' && cur.boneRole)) {
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    if (cur) jointBoneId = cur.id;
  }
  if (!jointBoneId) {
    return { bound: false, reason: 'no-bone-ancestor' };
  }
  const jointBone = byId.get(jointBoneId) ?? null;
  if (!jointBone || jointBone.type !== 'group' || !jointBone.boneRole) {
    return { bound: false, reason: 'jointBoneId-not-a-bone' };
  }
  // Resolve parent bone — walks past plain (non-bone) groups. Same
  // logic as `boneOverlayMatrix.computeBoneParentMap` and the synth in
  // `deformerNodeSync.synthesizeModifierStacks`.
  let parent = jointBone.parent ? byId.get(jointBone.parent) : null;
  while (parent && !(parent.type === 'group' && parent.boneRole)) {
    parent = parent.parent ? byId.get(parent.parent) : null;
  }
  const parentBoneId = parent?.id ?? null;

  projectState.updateProject((proj) => {
    const target = proj.nodes.find((n) => n.id === partId);
    if (!target || target.type !== 'part') return;
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
        jointBoneRole: jointBone.boneRole,
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
