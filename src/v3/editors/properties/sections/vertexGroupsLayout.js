// @ts-check

/**
 * V4 Phase 4a — Vertex Groups layout helper.
 *
 * Pure function that reads a mesh node + the project's bone groups and
 * returns a normalised list of `VertexGroupSummary` entries for the
 * Properties section to render. Forward-compatible: prefers the future
 * `mesh.weightGroups` map (introduced in Phase 4b) and falls back to
 * the legacy single-bone `mesh.boneWeights` + `mesh.jointBoneId`
 * pairing (auto-rig output today).
 *
 * Phase 4a is read-only — the section renders summary stats. Phase 4b
 * adds the brush + canvas shader + Active radio + add/rename/remove
 * mutators.
 *
 * No JSX in this module — pure data only — so it tests cleanly under
 * node.
 *
 * @module v3/editors/properties/sections/vertexGroupsLayout
 */

/**
 * @typedef {Object} BoneGroupLite
 * @property {string} id
 * @property {string} [name]
 *
 * @typedef {Object} MeshNodeLite
 * @property {{
 *   vertices?: any[],
 *   boneWeights?: number[]|Float32Array|Float64Array|null,
 *   jointBoneId?: string|null,
 *   weightGroups?: Record<string, number[]|Float32Array|Float64Array>,
 *   activeWeightGroup?: string|null,
 * }} [mesh]
 *
 * @typedef {Object} VertexGroupSummary
 * @property {string} name           - user-facing group name (the bone group's
 *                                     name; falls back to "(unnamed bone)" or
 *                                     a legacy fallback).
 * @property {string|null} boneId    - source bone group node id (legacy:
 *                                     `mesh.jointBoneId`; new: the `weightGroups`
 *                                     key resolved against bone groups by name).
 * @property {number} vertexCount    - vertices with non-zero weight.
 * @property {number} totalVertices  - total vertex count on the mesh.
 * @property {number} mean           - arithmetic mean across all weights
 *                                     (including zero-weight vertices).
 * @property {number} min            - minimum non-zero weight (or 0 if all zero).
 * @property {number} max            - maximum weight.
 * @property {boolean} active        - matches `mesh.activeWeightGroup`. False
 *                                     for legacy single-bone meshes since
 *                                     activeWeightGroup is unset.
 * @property {'modern'|'legacy'} source
 *   - 'modern' = read from `mesh.weightGroups[name]`.
 *   - 'legacy' = read from `mesh.boneWeights` + `mesh.jointBoneId`.
 */

/**
 * @param {MeshNodeLite|null|undefined} node
 * @param {BoneGroupLite[]|null|undefined} boneGroups
 * @returns {VertexGroupSummary[]}
 */
export function buildVertexGroupSummaries(node, boneGroups) {
  /** @type {VertexGroupSummary[]} */
  const out = [];
  const mesh = node?.mesh;
  if (!mesh) return out;
  const totalVertices = Array.isArray(mesh.vertices) ? mesh.vertices.length : 0;

  // Modern path: mesh.weightGroups is a `{name: number[]}` map.
  const wg = mesh.weightGroups;
  if (wg && typeof wg === 'object' && !Array.isArray(wg)) {
    const names = Object.keys(wg).filter((n) => Array.isArray(wg[n]) || ArrayBuffer.isView(wg[n]));
    if (names.length > 0) {
      for (const name of names) {
        const weights = wg[name];
        if (!isWeightArray(weights)) continue;
        const stats = computeWeightStats(weights);
        const matched = (boneGroups ?? []).find((g) => g?.name === name);
        out.push({
          name,
          boneId: matched?.id ?? null,
          vertexCount: stats.nonZeroCount,
          totalVertices,
          mean: stats.mean,
          min: stats.min,
          max: stats.max,
          active: mesh.activeWeightGroup === name,
          source: 'modern',
        });
      }
      return out;
    }
  }

  // Legacy path: single bone with mesh.boneWeights + mesh.jointBoneId.
  const bw = mesh.boneWeights;
  if (isWeightArray(bw)) {
    const stats = computeWeightStats(bw);
    const boneId = mesh.jointBoneId ?? null;
    const matched = boneId
      ? (boneGroups ?? []).find((g) => g?.id === boneId)
      : null;
    const name = matched?.name ?? boneId ?? '(unnamed bone)';
    out.push({
      name,
      boneId,
      vertexCount: stats.nonZeroCount,
      totalVertices,
      mean: stats.mean,
      min: stats.min,
      max: stats.max,
      active: false,
      source: 'legacy',
    });
  }

  return out;
}

/**
 * Predicate: should the Vertex Groups section show for this mesh?
 * Matches plan §3 row 5 visibility rule:
 *   `boneWeights || has-bone-ancestor (jointBoneId set) || weightGroups populated`.
 *
 * "Has-bone-ancestor without weights" still shows so the user can see
 * "no weights yet — paint to author them" once Phase 4b lands.
 *
 * @param {MeshNodeLite|null|undefined} node
 * @returns {boolean}
 */
export function meshHasVertexGroups(node) {
  const mesh = node?.mesh;
  if (!mesh) return false;
  if (mesh.weightGroups && Object.keys(mesh.weightGroups).length > 0) return true;
  if (isWeightArray(mesh.boneWeights)) return true;
  if (typeof mesh.jointBoneId === 'string' && mesh.jointBoneId.length > 0) return true;
  return false;
}

/**
 * @param {any} arr
 * @returns {arr is number[]|Float32Array|Float64Array}
 */
function isWeightArray(arr) {
  if (!arr) return false;
  if (Array.isArray(arr)) return arr.length > 0;
  // TypedArrays have a numeric `length`; DataView (the only ArrayBufferView
  // without one) is never used for weight storage. Cast to the typed-array
  // shape we actually accept.
  if (ArrayBuffer.isView(arr)) return /** @type {Float32Array|Float64Array} */ (arr).length > 0;
  return false;
}

/**
 * @param {number[]|Float32Array|Float64Array} weights
 * @returns {{ mean: number, min: number, max: number, nonZeroCount: number }}
 */
function computeWeightStats(weights) {
  const n = weights.length;
  if (n === 0) return { mean: 0, min: 0, max: 0, nonZeroCount: 0 };
  let sum = 0;
  let max = -Infinity;
  let minNonZero = Infinity;
  let nonZero = 0;
  for (let i = 0; i < n; i++) {
    const w = Number(weights[i]);
    if (!Number.isFinite(w)) continue;
    sum += w;
    if (w > max) max = w;
    if (w > 0) {
      nonZero++;
      if (w < minNonZero) minNonZero = w;
    }
  }
  return {
    mean: sum / n,
    min: nonZero > 0 ? minNonZero : 0,
    max: max === -Infinity ? 0 : max,
    nonZeroCount: nonZero,
  };
}
