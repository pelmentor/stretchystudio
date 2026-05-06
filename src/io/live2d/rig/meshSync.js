// @ts-check

/**
 * V4 Phase 4b — mesh weight-group sync helpers.
 *
 * Bridges the legacy single-bone weights model (`mesh.boneWeights` +
 * `mesh.jointBoneId`, today's auto-rig output) and the multi-group
 * model (`mesh.weightGroups: { name → number[] }` + `mesh.activeWeightGroup`,
 * Phase 4b authoring shape).
 *
 * **Why both shapes coexist:** the cmo3 export pipeline reads `mesh.boneWeights`
 * directly. Multi-bone export is explicitly deferred per plan §6 Risks. So
 * for v1 we keep `boneWeights` as the export-side source of truth and
 * mirror the active group's weights into it on every commit. The
 * `weightGroups` map exists to support the painting UI + future multi-bone
 * export without breaking today's pipeline.
 *
 * **Migration is lazy and idempotent.** Helpers are called on weight-paint
 * mode entry + every paint commit. They never destroy existing data;
 * legacy fields stay alongside the new ones until a future schema cleanup.
 *
 * @module io/live2d/rig/meshSync
 */

/**
 * @typedef {Object} BoneGroupLite
 * @property {string} id
 * @property {string} [name]
 *
 * @typedef {Object} MeshLike
 * @property {any[]} [vertices]
 * @property {number[]|null} [boneWeights]
 * @property {string|null} [jointBoneId]
 * @property {Record<string, number[]>} [weightGroups]
 * @property {string|null} [activeWeightGroup]
 */

/**
 * Ensure a mesh has the modern `weightGroups` shape. If only legacy
 * `boneWeights` + `jointBoneId` exist, migrate them into a single
 * weightGroups entry keyed by the bone group's name (or the boneId if
 * the bone group can't be resolved). If neither exists but a
 * `jointBoneId` is set, seed an empty zero-weight array of the right
 * length so the brush has something to paint into.
 *
 * Idempotent: calling on an already-migrated mesh is a no-op.
 *
 * Mutates the mesh in place. Returns true if the mesh was changed.
 *
 * @param {MeshLike|null|undefined} mesh
 * @param {BoneGroupLite[]|null|undefined} boneGroups
 * @returns {boolean}
 */
export function ensureWeightGroups(mesh, boneGroups) {
  if (!mesh) return false;
  const haveModern = mesh.weightGroups
    && typeof mesh.weightGroups === 'object'
    && !Array.isArray(mesh.weightGroups)
    && Object.keys(mesh.weightGroups).length > 0;
  if (haveModern) return false;

  const vCount = Array.isArray(mesh.vertices) ? mesh.vertices.length : 0;
  if (vCount === 0) return false;

  // Decide the migrated group's name: bone group's display name first,
  // bone id second, generic fallback last.
  const boneId = typeof mesh.jointBoneId === 'string' ? mesh.jointBoneId : null;
  const boneName = boneId
    ? (boneGroups ?? []).find((g) => g?.id === boneId)?.name ?? boneId
    : null;
  const groupName = boneName ?? 'group';

  // Source weights: legacy boneWeights if present + same length as
  // vertices, otherwise zero-fill.
  let sourceWeights;
  if (Array.isArray(mesh.boneWeights) && mesh.boneWeights.length === vCount) {
    sourceWeights = mesh.boneWeights.slice();
  } else {
    sourceWeights = new Array(vCount).fill(0);
  }

  mesh.weightGroups = { [groupName]: sourceWeights };
  if (typeof mesh.activeWeightGroup !== 'string'
      || mesh.activeWeightGroup.length === 0
      || !(mesh.activeWeightGroup in mesh.weightGroups)) {
    mesh.activeWeightGroup = groupName;
  }
  // Don't strip legacy fields — exporter still reads them and we sync
  // them via syncBoneWeightsFromActive.
  return true;
}

/**
 * Mirror the active weight group's weights into `mesh.boneWeights` and
 * (optionally) into `mesh.jointBoneId`. Call after every paint commit
 * so the export pipeline picks up the new weights.
 *
 * @param {MeshLike|null|undefined} mesh
 * @param {BoneGroupLite[]|null|undefined} boneGroups
 * @returns {boolean} true if mesh.boneWeights was rewritten
 */
export function syncBoneWeightsFromActive(mesh, boneGroups) {
  if (!mesh || !mesh.weightGroups) return false;
  const activeName = mesh.activeWeightGroup;
  if (typeof activeName !== 'string' || activeName.length === 0) return false;
  const w = mesh.weightGroups[activeName];
  if (!Array.isArray(w)) return false;
  mesh.boneWeights = w.slice();
  // jointBoneId points at the bone group whose name matches the active
  // group. If we can resolve it, update the legacy pointer so cmo3
  // emission targets the right bone.
  const matched = (boneGroups ?? []).find((g) => g?.name === activeName);
  if (matched?.id) mesh.jointBoneId = matched.id;
  return true;
}

/**
 * Apply a brush stroke's per-vertex updates to the active weight
 * group, then sync legacy fields. Each update is `{ vertexIndex, weight }`
 * and is clamped to [0, 1].
 *
 * @param {MeshLike|null|undefined} mesh
 * @param {Array<{vertexIndex:number, weight:number}>} updates
 * @param {BoneGroupLite[]|null|undefined} boneGroups
 * @returns {number} count of vertices actually changed (epsilon-equal updates skipped)
 */
export function applyWeightStroke(mesh, updates, boneGroups) {
  if (!mesh || !mesh.weightGroups || !Array.isArray(updates)) return 0;
  const activeName = mesh.activeWeightGroup;
  if (typeof activeName !== 'string') return 0;
  const w = mesh.weightGroups[activeName];
  if (!Array.isArray(w)) return 0;

  const EPS = 1e-6;
  let changed = 0;
  for (const u of updates) {
    if (!u || typeof u.vertexIndex !== 'number') continue;
    const i = u.vertexIndex;
    if (i < 0 || i >= w.length) continue;
    let next = Number(u.weight);
    if (!Number.isFinite(next)) continue;
    if (next < 0) next = 0;
    if (next > 1) next = 1;
    if (Math.abs((w[i] ?? 0) - next) < EPS) continue;
    w[i] = next;
    changed++;
  }
  if (changed > 0) syncBoneWeightsFromActive(mesh, boneGroups);
  return changed;
}
