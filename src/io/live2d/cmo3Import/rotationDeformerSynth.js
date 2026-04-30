// @ts-check
/**
 * Mirror cmo3 rotation deformers onto SS group nodes.
 *
 * Two channels:
 *   1. **boneRole.** When a group's name matches a known role, set
 *      `boneRole = name` so the writer recognises it (and its skip set
 *      filters out torso/eyes/neck → those go through warps instead).
 *   2. **Pivot.** When a rotation deformer's parent is canvas-normalised
 *      (ROOT or a top-level body warp), translate the rest keyform's
 *      `originX/Y` (0..1) into canvas-px and stash it on
 *      `group.transform.pivotX/Y`. The writer's `deformerWorldOrigins`
 *      pass picks this up — `worldMatrix × [pivotX, pivotY, 1]` falls
 *      through identity when the group has no other transform set, so
 *      world pivot equals the stored canvas-px value.
 *
 * For rotation deformers chained under another rotation (e.g.
 * FaceRotation under Rotation_head), the cmo3 stores `originY` in
 * pixel-OFFSET form relative to the parent rotation's pivot, not
 * canvas-normalised. We skip pivot translation in that case and let
 * the writer fall back to its bbox-of-descendant-meshes heuristic.
 *
 * @module io/live2d/cmo3Import/rotationDeformerSynth
 */

import { uid } from '../../../lib/ids.js';

/**
 * Default node transform used for both group + part synthesis.
 * Exported so the importer entry point shares one source of truth.
 */
export const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

/**
 * The boneRoles the auto-rig writer recognises. Mirror of `CREATE_ORDER`
 * in `armatureOrganizer.js` — kept in sync so the importer doesn't drift
 * behind new role additions on the auto-rig side.
 *
 * Group names that match one of these (case-sensitive, exact) are mapped
 * straight onto `node.boneRole`. Names that don't match leave `boneRole`
 * unset — the writer's fallback (rotate-everything-not-skipped) takes over
 * there, which is no worse than the pre-import baseline.
 */
export const KNOWN_BONE_ROLES = new Set([
  'root', 'torso', 'neck', 'head', 'face', 'eyes',
  'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'bothArms',
  'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'bothLegs',
]);

/**
 * Map every `ExtractedGroup.guidRef` to a freshly-generated SS node id.
 * Parts use guid xs.refs to point at their parent group, so we need the
 * intermediary index to translate those into SS node parent links.
 *
 * @param {import('../cmo3PartExtract.js').ExtractedGroup[]} groups
 * @returns {Map<string, string>}
 */
export function buildGuidToNodeIdMap(groups) {
  const map = new Map();
  for (const g of groups) {
    if (g.guidRef) map.set(g.guidRef, uid());
  }
  return map;
}

/**
 * @param {import('../cmo3PartExtract.js').ExtractedScene} scene
 * @param {any[]} nodes               mutated in-place — group nodes get
 *                                    `boneRole` + `transform.pivotX/Y`
 * @param {Map<string, string>} guidToNodeId  group.guidRef → SS node id
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {string[]}                warnings
 */
export function applyRotationDeformersToGroups(scene, nodes, guidToNodeId, canvasW, canvasH) {
  /** @type {string[]} */
  const warnings = [];

  // Pass 1: set boneRole on every group whose name matches a known role.
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    if (KNOWN_BONE_ROLES.has(node.name)) {
      node.boneRole = node.name;
    }
  }

  // Pass 2: rotation deformer → group pivot translation.
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedDeformer>} */
  const deformerByGuid = new Map();
  for (const d of scene.deformers) {
    if (d.ownGuidRef) deformerByGuid.set(d.ownGuidRef, d);
  }

  for (const def of scene.deformers) {
    if (def.kind !== 'rotation') continue;
    if (!def.parentPartGuidRef) {
      warnings.push(`rotation ${def.idStr} has no parentPartGuidRef — owner group can't be resolved`);
      continue;
    }
    const ownerGroup = scene.groups.find((g) => g.guidRef === def.parentPartGuidRef);
    if (!ownerGroup) {
      warnings.push(`rotation ${def.idStr}: no group with guidRef=${def.parentPartGuidRef}`);
      continue;
    }
    const nodeId = ownerGroup.guidRef ? guidToNodeId.get(ownerGroup.guidRef) : null;
    if (!nodeId) {
      warnings.push(`rotation ${def.idStr}: group ${ownerGroup.name} has no node id assignment`);
      continue;
    }
    const node = nodes.find((n) => n.id === nodeId && n.type === 'group');
    if (!node) {
      warnings.push(`rotation ${def.idStr}: SS node ${nodeId} not found`);
      continue;
    }

    if (KNOWN_BONE_ROLES.has(def.name) && !node.boneRole) {
      node.boneRole = def.name;
    }

    let parentIsRotation = false;
    if (def.parentDeformerGuidRef) {
      const parent = deformerByGuid.get(def.parentDeformerGuidRef);
      if (parent && parent.kind === 'rotation') parentIsRotation = true;
    }
    if (parentIsRotation) {
      continue;
    }

    let restIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < def.keyforms.length; i++) {
      const a = Math.abs(def.keyforms[i].angle ?? 0);
      if (a < bestDist) { bestDist = a; restIdx = i; }
    }
    const kf = def.keyforms[restIdx];
    if (!kf || kf.originX == null || kf.originY == null) {
      warnings.push(`rotation ${def.idStr}: rest keyform ${restIdx} has no origin`);
      continue;
    }

    if (kf.originX === 0 && kf.originY === 0) {
      warnings.push(`rotation ${def.idStr}: keyform origin (0, 0) treated as unset — bbox fallback will engage`);
      continue;
    }

    if (!node.transform) node.transform = DEFAULT_TRANSFORM();
    node.transform.pivotX = kf.originX * canvasW;
    node.transform.pivotY = kf.originY * canvasH;
  }

  return warnings;
}
