// @ts-check
/**
 * variantFadeGrid.js — N-dimensional variant base-fade product grid.
 *
 * A base part with N paired variant suffixes (e.g. `.smile` + `.angry`)
 * must hide (opacity → 0) whenever ANY of its variants is active, and stay
 * visible (opacity → 1) only when ALL its variants are at 0. The single
 * source of truth for that is a keyform PRODUCT GRID: one binding axis per
 * suffix (keys `[0, 1]`), 2^N corners, opacity = 1 ONLY at the all-zero
 * corner and 0 at every other corner.
 *
 * Cubism evaluates a keyform grid by multilinear interpolation, so a grid
 * shaped this way yields, at runtime,
 *
 *     opacity(p0, p1, …) = ∏ (1 - pi)
 *
 * — exactly the SS depgraph base-fade override (`anim/depgraph/kernels/
 * artMesh.js`), but BAKED into the export so Cubism (which has no such
 * override) hides the base for every variant, not just the first.
 *
 * Pre-fix, only `baseSuffixes[0]` was baked (a single 1-D fade), so a
 * SECOND variant left the base fully visible in Cubism → "the angry layers
 * overlay the still-visible neutral base". The override masked it in the SS
 * viewport, which is why the bug only showed on export.
 *
 * Corner ordering matches the cmo3/moc3 `keyformsOnGrid` convention:
 * row-major with the FIRST binding varying fastest. For N = 1 the output is
 * structurally identical to the legacy 1-D fade (2 corners: origin opacity
 * 1, then opacity 0), so single-variant models are byte-equivalent.
 *
 * See `feedback_variant_base_fade_multi_suffix`.
 *
 * @module io/live2d/rig/variantFadeGrid
 */

/**
 * @typedef {Object} ProductGridCorner
 * @property {number[]} keyIndices - per-suffix key index (0 or 1), suffix 0 first
 * @property {0|1} opacity         - 1 only when every keyIndex is 0
 * @property {boolean} isOrigin    - true at the all-zero corner
 */

/**
 * Build the 2^N product-grid corners for an N-suffix base-fade.
 *
 * @param {number} suffixCount  number of variant suffixes (N ≥ 1)
 * @returns {ProductGridCorner[]} 2^N corners, first-suffix-fastest row-major.
 */
export function buildVariantProductGridCorners(suffixCount) {
  const n = Math.max(1, suffixCount | 0);
  const total = 1 << n; // 2^N
  /** @type {ProductGridCorner[]} */
  const corners = [];
  for (let i = 0; i < total; i++) {
    const keyIndices = new Array(n);
    let allZero = true;
    for (let p = 0; p < n; p++) {
      const k = (i >> p) & 1; // suffix p varies fastest at p = 0
      keyIndices[p] = k;
      if (k !== 0) allZero = false;
    }
    corners.push({ keyIndices, opacity: allZero ? 1 : 0, isOrigin: allZero });
  }
  return corners;
}

/**
 * @typedef {Object} EyeCompoundBaseCorner
 * @property {0|1} closureKey       - 0 = closed, 1 = open (rest)
 * @property {number[]} keyIndices  - per-variant-suffix key index (0 or 1)
 * @property {0|1} opacity          - variant product (independent of closure)
 * @property {'closed'|'open'} geometry
 */

/**
 * Eye-compound BASE grid: the blink/closure axis (closed/open) crossed with
 * the N-variant product grid. Geometry varies on the closure axis ONLY
 * (closed verts at closureKey 0, rest/open verts at closureKey 1); opacity
 * is the variant product, independent of closure. Closure varies FASTEST,
 * matching the existing 2-D `cornersOrder` in meshLayerKeyform.js, so the
 * N = 1 layout is `(closed,v0) (open,v0) (closed,v1) (open,v1)` — identical
 * to today's base-eye compound.
 *
 * Only BASE eyes use this; a variant eye fades on its OWN single param and
 * keeps the plain 2-D (closure × ownVariant) grid.
 *
 * @param {number} suffixCount  number of variant suffixes paired to the base (N ≥ 1)
 * @returns {EyeCompoundBaseCorner[]} 2^(N+1) corners.
 */
export function buildEyeCompoundBaseGridCorners(suffixCount) {
  const variantCorners = buildVariantProductGridCorners(suffixCount);
  /** @type {EyeCompoundBaseCorner[]} */
  const corners = [];
  for (const vc of variantCorners) {
    // closure fastest: closed (0) then open (1) for each variant combo.
    corners.push({ closureKey: 0, keyIndices: vc.keyIndices, opacity: vc.opacity, geometry: 'closed' });
    corners.push({ closureKey: 1, keyIndices: vc.keyIndices, opacity: vc.opacity, geometry: 'open' });
  }
  return corners;
}
