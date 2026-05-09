// @ts-check

/**
 * Mesh-export-struct extraction — bone binding + joint pivot lookup.
 *
 * Both `exportLive2DProject` and `buildMeshesForRig` in `exporter.js`
 * historically duplicated the bone-binding extraction. This module
 * deduplicates that block.
 *
 * # 2026-05-09 (afternoon) — Cubism Adapter strip removed
 *
 * Pre-revert this module also performed a "rigid-intent" strip: when
 * `mesh.boneWeights` was all-1.0 AND `jointBoneId === structural-
 * parent bone`, both fields were nulled out before being written to
 * the cmo3/moc3 wire format. The strip's purpose was to clean up
 * contamination data written by `seedDefaultRigidWeights` — every
 * meshed part with a bone-group ancestor got rigid-1.0 weights so the
 * renderer could compose through a single LBS path.
 *
 * The Cubism Adapter pattern was reverted toward Blender parity (see
 * `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`). Rigid-follow
 * parts no longer carry vertex groups at all — they render via the
 * reinstated overlay-matrix path. Per-vertex skinning (limb meshes)
 * carries variable weights that aren't rigid-intent. Bone-routing
 * intent (Audit Issue 8 — hand-only sub-meshes whose
 * `computeSkinWeights` clamped to 1.0 with `jointBoneId !== nearest`)
 * has `jointBoneId !== nearest` so a strip-on-rigid-intent rule
 * wouldn't fire on it anyway.
 *
 * Conclusion: post-revert no project carries data the strip would
 * remove, so the strip is dead code. This module simplifies to a
 * basic bone-binding + joint-pivot extractor.
 *
 * @module io/live2d/extractMeshExportStruct
 */

/**
 * @typedef {Object} BoneBindingExtract
 * @property {string|null} jointBoneId
 * @property {number[]|null} boneWeights
 * @property {number|null} jointPivotX
 * @property {number|null} jointPivotY
 */

/**
 * Extract bone-binding fields for a part's export struct.
 *
 * Pure: doesn't mutate input. Resolves the joint bone via the indexed
 * project nodes for O(1) lookup.
 *
 * @param {object} mesh        — the part's mesh datablock (resolved via getMesh)
 * @param {object} _part       — the part node (unused post-revert; kept for caller stability)
 * @param {Map<string, object>} byId — project.nodes indexed by id
 * @param {number} _vertCount  — mesh.vertices.length (unused post-revert; kept for caller stability)
 * @returns {BoneBindingExtract}
 */
export function extractMeshExportStruct(mesh, _part, byId, _vertCount) {
  const boneWeights = mesh?.boneWeights ?? null;
  const jointBoneId = mesh?.jointBoneId ?? null;

  let jointPivotX = null, jointPivotY = null;
  if (jointBoneId && boneWeights) {
    const jointBone = byId.get(jointBoneId);
    if (jointBone?.transform) {
      jointPivotX = jointBone.transform.pivotX ?? 0;
      jointPivotY = jointBone.transform.pivotY ?? 0;
    }
  }

  return { jointBoneId, boneWeights, jointPivotX, jointPivotY };
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
