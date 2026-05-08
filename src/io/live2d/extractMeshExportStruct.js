// @ts-check

/**
 * Mesh-export-struct extraction with the Cubism Adapter Pattern.
 *
 * Both `exportLive2DProject` and `buildMeshesForRig` in `exporter.js`
 * historically duplicated the bone-binding extraction:
 *
 *   const boneWeights = mesh.boneWeights ?? null;
 *   const jointBoneId = mesh.jointBoneId ?? null;
 *   let jointPivotX = null, jointPivotY = null;
 *   if (jointBoneId && boneWeights) {
 *     const jointBone = project.nodes.find(n => n.id === jointBoneId);
 *     if (jointBone?.transform) {
 *       jointPivotX = jointBone.transform.pivotX ?? 0;
 *       jointPivotY = jointBone.transform.pivotY ?? 0;
 *     }
 *   }
 *
 * This module deduplicates that block AND adds the Cubism-export
 * adapter step inline: when `mesh.boneWeights` is **rigid intent**
 * (all-1.0 to the part's structural-parent bone), strip
 * `boneWeights` + `jointBoneId` from the export-bound copy. The cmo3 /
 * moc3 wire format then emits the legacy non-weighted shape, keeping
 * the byte output identical to pre-rigid-weight authoring.
 *
 * # Why this lives here, not in a separate "adapter" module
 *
 * The mesh-struct construction in `exporter.js` is itself the
 * project-tree → flat-export-struct translator. The Cubism adapter is
 * a 3-line conditional inside that translator, not a second pure-
 * function pass over the whole project. Extracting the shared block
 * here gives both extraction sites the same behaviour without a
 * separate module hierarchy.
 *
 * # The adapter rule
 *
 * `isRigidVertexGroup(boneWeights, vertCount, jointBoneId,
 * nearestBoneAncestorId)` returns `true` only when the weights are
 * indistinguishable from "no weights, structurally parented to
 * `jointBoneId`." See `src/lib/vertexGroupVariance.js` for the full
 * decision matrix (including the bone-routing-intent guard for
 * hand-only sub-meshes).
 *
 * @module io/live2d/extractMeshExportStruct
 */

import { isBoneGroup } from '../../store/objectDataAccess.js';
import {
  isRigidVertexGroup,
  nearestBoneAncestorId,
} from '../../lib/vertexGroupVariance.js';

/**
 * @typedef {Object} BoneBindingExtract
 * @property {string|null} jointBoneId   — null when stripped (rigid-intent) or absent
 * @property {number[]|null} boneWeights — null when stripped or absent
 * @property {number|null} jointPivotX
 * @property {number|null} jointPivotY
 * @property {boolean} stripped          — true if rigid-intent weights were stripped (debugging / logging)
 */

/**
 * Extract bone-binding fields for a part's export struct, applying the
 * Cubism Adapter rigid-strip rule.
 *
 * Pure: doesn't mutate input. Resolves the joint bone via the indexed
 * project nodes for O(1) lookup. The `vertCount` argument is the part's
 * mesh.vertices.length — passed in by the caller because we don't need
 * to re-iterate.
 *
 * @param {object} mesh        — the part's mesh datablock (resolved via getMesh)
 * @param {object} part        — the part node
 * @param {Map<string, object>} byId — project.nodes indexed by id
 * @param {number} vertCount   — mesh.vertices.length
 * @returns {BoneBindingExtract}
 */
export function extractMeshExportStruct(mesh, part, byId, vertCount) {
  const rawBoneWeights = mesh?.boneWeights ?? null;
  const rawJointBoneId = mesh?.jointBoneId ?? null;

  // Compute structural-parent bone once for the rigid-intent guard.
  // nearestBoneAncestorId walks node.parent → first isBoneGroup ancestor.
  const nearestBoneId = nearestBoneAncestorId(part, byId, isBoneGroup);

  let stripped = false;
  let boneWeights = rawBoneWeights;
  let jointBoneId = rawJointBoneId;

  // Cubism Adapter rule: strip if rigid-intent (all weights ≈ 1.0 AND
  // jointBoneId === structural-parent bone). Mismatch (e.g. hand-only
  // sub-mesh under leftArm with jointBoneId='leftElbow') is bone-routing
  // intent and MUST be preserved.
  if (
    Array.isArray(rawBoneWeights)
    && rawBoneWeights.length > 0
    && isRigidVertexGroup(rawBoneWeights, vertCount, rawJointBoneId, nearestBoneId)
  ) {
    boneWeights = null;
    jointBoneId = null;
    stripped = true;
  }

  // Joint pivot is only meaningful when boneWeights are present and
  // active. Post-strip, jointBoneId is null → no pivot lookup.
  let jointPivotX = null, jointPivotY = null;
  if (jointBoneId && boneWeights) {
    const jointBone = byId.get(jointBoneId);
    if (jointBone?.transform) {
      jointPivotX = jointBone.transform.pivotX ?? 0;
      jointPivotY = jointBone.transform.pivotY ?? 0;
    }
  }

  return { jointBoneId, boneWeights, jointPivotX, jointPivotY, stripped };
}

/**
 * Build a Map<id, node> index for `project.nodes`. Caller-cached so
 * the per-part `extractMeshExportStruct` calls don't pay the
 * `Array.find` cost N times.
 *
 * @param {object} project
 * @returns {Map<string, object>}
 */
export function indexProjectNodesById(project) {
  const byId = new Map();
  if (!project || !Array.isArray(project.nodes)) return byId;
  for (const n of project.nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }
  return byId;
}
