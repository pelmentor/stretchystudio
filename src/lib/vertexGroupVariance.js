// @ts-check

/**
 * Vertex-group variance predicate for the Cubism export adapter.
 *
 * Decides whether a part's `mesh.boneWeights` represent **rigid intent**
 * (every vertex weighted at exactly 1.0 to the same bone the part would
 * structurally follow without weights) — in which case the cmo3/moc3
 * exporter strips them so wire-format output stays byte-identical to
 * pre-rigid-weight projects. Anything else is real skinning data and
 * must be preserved.
 *
 * # Why FOUR arguments
 *
 * A naive variance check (`all weights ≈ 1.0?`) misclassifies a real
 * geometric corner case shipped by some PSD imports:
 *
 *   - "Hand-only" sub-meshes parented to `leftArm` with
 *     `jointBoneId='leftElbow'`. Every vertex sits past the elbow blend
 *     zone, so `computeSkinWeights` clamps every weight to **exactly
 *     1.0** (`clamp(projection / blend + 0.5, 0, 1)` saturates).
 *
 *   - The weights ARE all-1.0 numerically, but they encode bone-routing
 *     intent: "follow leftElbow specifically, not the structural parent
 *     leftArm." Stripping them ships the hand parented to leftArm's
 *     parent (torso) in cmo3 — visible as "hand detaches from elbow"
 *     when posing.
 *
 * Therefore the predicate also takes the part's **structural parent
 * walk**: `nearestBoneAncestorId` is the nearest `isBoneGroup` ancestor
 * of the part walked via `node.parent`. If `jointBoneId !==
 * nearestBoneAncestorId`, the weights encode routing intent that the
 * legacy non-weighted wire format cannot express. Predicate returns
 * `false` → adapter preserves data → cmo3 emits with weights → Cubism
 * renders correctly.
 *
 * # When predicate returns true
 *
 * - `boneWeights` is a non-empty array of length `vertCount`.
 * - Every entry is within `1e-6` of `1.0`.
 * - `jointBoneId === nearestBoneAncestorId`.
 *
 * In that case the weights are equivalent (geometrically AND for
 * Cubism's wire format) to "no weights, parented to the same bone via
 * the rotation deformer chain" — which IS the legacy non-weighted shape
 * SS shipped before rigid-weight authoring.
 *
 * # When predicate returns false (preserve data)
 *
 * - Empty / null / non-array weights.
 * - Length mismatch with `vertCount`.
 * - Any weight outside `1.0 ± 1e-6`.
 * - `jointBoneId` differs from `nearestBoneAncestorId` (bone-routing
 *   intent — must preserve).
 * - `nearestBoneAncestorId` is null but `jointBoneId` is set (bound
 *   to a bone outside the structural parent chain — preserve).
 *
 * @module lib/vertexGroupVariance
 */

/** Variance epsilon. Tighter than any meaningful per-vertex skin weight
 *  variation (`computeSkinWeights` produces values with much larger
 *  variance for real limbs) but loose enough to absorb float32 round-trip
 *  drift on stored weights. */
const RIGID_EPS = 1e-6;

/**
 * @param {ReadonlyArray<number>|null|undefined} boneWeights
 * @param {number|null} vertCount  expected length; null disables the check
 * @param {string|null|undefined} jointBoneId  the part's mesh.jointBoneId
 * @param {string|null|undefined} nearestBoneAncestorId  nearest `isBoneGroup` ancestor's id
 * @returns {boolean}
 */
export function isRigidVertexGroup(
  boneWeights,
  vertCount,
  jointBoneId,
  nearestBoneAncestorId,
) {
  if (!Array.isArray(boneWeights)) return false;
  if (boneWeights.length === 0) return false;
  if (vertCount !== null && boneWeights.length !== vertCount) return false;

  // Bone-routing-intent guard. The weights can only be stripped when
  // they're equivalent to "no weights, follow structural parent bone."
  // Any divergence between jointBoneId and the structural parent walk
  // means the user/auto-rig deliberately routed the part to a different
  // bone than its structural parent.
  if (typeof jointBoneId !== 'string' || jointBoneId.length === 0) return false;
  if (typeof nearestBoneAncestorId !== 'string' || nearestBoneAncestorId.length === 0) {
    return false;
  }
  if (jointBoneId !== nearestBoneAncestorId) return false;

  // All weights ≈ 1.0.
  for (let i = 0; i < boneWeights.length; i++) {
    if (Math.abs(boneWeights[i] - 1) > RIGID_EPS) return false;
  }
  return true;
}

/**
 * Walk a part's `node.parent` chain to the nearest ancestor where
 * `isBoneGroupPredicate(ancestor) === true`. Returns the ancestor's id,
 * or `null` if the part has no bone-group ancestor.
 *
 * Pure utility used by the export-adapter to compute the
 * `nearestBoneAncestorId` argument for `isRigidVertexGroup`. Caller
 * passes `isBoneGroup` from `objectDataAccess` as the predicate so this
 * module stays import-light.
 *
 * @param {object} part
 * @param {Map<string, object>} byId  index of project.nodes by id
 * @param {(node: any) => boolean} isBoneGroupPredicate
 * @returns {string|null}
 */
export function nearestBoneAncestorId(part, byId, isBoneGroupPredicate) {
  if (!part || typeof part !== 'object') return null;
  let cursor = part.parent ? byId.get(part.parent) : null;
  // Cycle guard — malformed projects with self-parent references would
  // otherwise loop forever.
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    if (isBoneGroupPredicate(cursor)) return cursor.id ?? null;
    cursor = cursor.parent ? byId.get(cursor.parent) : null;
  }
  return null;
}
