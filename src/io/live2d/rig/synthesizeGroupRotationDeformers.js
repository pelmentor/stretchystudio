// @ts-check

/**
 * RULE №4 (Blender > Cubism) — group-rotation EXPORT/EVAL adapter.
 *
 * In the Blender-faithful authoring model a Cubism "GroupRotation" is an
 * armature BONE: a `{type:'group', boneRole:'groupRotation_<id>'}` node with
 * its pivot in `transform.pivotX/Y` (= the bone head) and its angle in
 * `pose.rotation`. Cubism, however, has no bones — its `.moc3`/`.cmo3` need a
 * `CRotationDeformerSource`. This module is the downstream adapter: it
 * re-synthesises the transient `{type:'deformer', deformerKind:'rotation'}`
 * node from the bone, exactly as `synthesizeDeformerNodesForExport` inflates
 * lattice objects back into transient warp deformers.
 *
 * It reuses the SAME builders the legacy seeder used (`buildGroupRotationSpec`
 * → `rotationSpecToDeformerNode`), so the synthesised node is byte-identical to
 * what `seedAllRig` used to persist directly — which is why the eval
 * characterization oracle (test_groupRotationCharacterization) stays green
 * across the storage flip.
 *
 * @module io/live2d/rig/synthesizeGroupRotationDeformers
 */

import { buildGroupRotationSpec } from './rotationDeformers.js';
import { rotationSpecToDeformerNode } from '../../../store/deformerNodeSync.js';
import {
  isGroupRotationBoneNode,
  isWarpLatticeNode,
  GROUP_ROTATION_BONE_ROLE_PREFIX,
} from '../../../store/warpLatticeAccess.js';
import { sanitisePartName } from '../../../lib/partId.js';

/** Default 1:1 ±30° group-rotation mapping (mirrors buildGroupRotationSpec). */
const DEFAULT_GROUP_ROTATION_KEYS = [-30, 0, 30];
const DEFAULT_GROUP_ROTATION_ANGLES = [-30, 0, 30];

/**
 * Resolve the transient rotation deformer's parent ref by walking the bone's
 * ancestor chain to the first warp/lattice node (else root). Mirrors how the
 * cmo3 emit re-parents group rotations under the innermost body warp.
 *
 * @param {object} boneNode
 * @param {Map<string, object>} byId
 * @returns {{type:string, id:string|null}}
 */
function resolveRotationParent(boneNode, byId) {
  let cur = typeof boneNode.parent === 'string' ? byId.get(boneNode.parent) : null;
  let safety = 64;
  while (cur && safety-- > 0) {
    if (isWarpLatticeNode(cur)) return { type: 'warp', id: cur.id };
    cur = typeof cur.parent === 'string' ? byId.get(cur.parent) : null;
  }
  return { type: 'root', id: null };
}

/**
 * Synthesise transient `deformer/rotation` nodes from every group-rotation
 * bone node in the project. Pure: reads `project.nodes`, returns new nodes
 * (does NOT mutate the project).
 *
 * @param {{nodes?: Array<object>}} project
 * @param {{configByGroupId?: Map<string, {paramKeys:number[], angles:number[]}>}} [opts]
 * @returns {Array<object>} transient `{type:'deformer', deformerKind:'rotation'}` nodes
 */
export function synthesizeGroupRotationDeformers(project, opts = {}) {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const n of nodes) if (n?.id) byId.set(n.id, n);

  const out = [];
  for (const bone of nodes) {
    if (!isGroupRotationBoneNode(bone)) continue;
    const groupId = bone.boneRole.slice(GROUP_ROTATION_BONE_ROLE_PREFIX.length);
    const deformerId = `GroupRotation_${groupId}`;
    const paramId = `ParamRotation_${sanitisePartName(bone.name ?? groupId)}`;
    const pivotCanvas = {
      x: bone.transform?.pivotX ?? 0,
      y: bone.transform?.pivotY ?? 0,
    };
    const cfg = opts.configByGroupId?.get(groupId);
    const paramKeys = cfg?.paramKeys ?? DEFAULT_GROUP_ROTATION_KEYS;
    const angles = cfg?.angles ?? DEFAULT_GROUP_ROTATION_ANGLES;

    const { spec } = buildGroupRotationSpec({
      id: deformerId, name: deformerId, paramId, pivotCanvas, paramKeys, angles,
    });
    const node = rotationSpecToDeformerNode(spec);
    // buildGroupRotationSpec parents to root; the real chain parent (the
    // innermost body warp, or root) is resolved from the bone's hierarchy.
    node.parent = resolveRotationParent(bone, byId).id;
    out.push(node);
  }
  return out;
}
