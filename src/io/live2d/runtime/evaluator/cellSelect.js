/**
 * v2 R2 — Cross-product cell selection for keyform hosts.
 *
 * Every keyform-bearing host (warp deformer, rotation deformer, art mesh)
 * carries `bindings` (one per parameter axis driving it) and `keyforms`
 * (laid out as the cross-product of all bindings' `keys` arrays). At eval
 * time, given the current `paramValues`, this module:
 *
 *   1. For each binding, finds the *segment* containing the current param
 *      value: an adjacent pair `(keys[j], keys[j+1])` and a lerp `t ∈ [0, 1]`.
 *      Out-of-range values are clamped to the nearest endpoint (`t = 0`
 *      or `t = 1`); single-key bindings return `{j: 0, t: 0}` and
 *      contribute only one corner.
 *
 *   2. Generates the cross-product of segment corners and computes their
 *      bilinear-style blend weights (multilinear interpolation in N
 *      dimensions). Corner with binding-pos vector `(c_0, …, c_{N-1})`
 *      has weight ∏_n (c_n ? t_n : 1 − t_n).
 *
 *   3. Maps each corner tuple to a flat index into the host's `keyforms`
 *      array using the **first-binding-fastest** layout convention
 *      (verified against Hiyori .cmo3 / .moc3 — see `cmo3writer.js`
 *      `cornersOrder` array L1257 and the moc3 binding-index packing
 *      in `moc3writer.js`).
 *
 * Returned weights sum to 1 (within FP rounding) for any valid input;
 * caller can use them directly to interpolate keyform.vertexPositions /
 * keyform.opacity / keyform.angle / keyform.originX / etc.
 *
 * Pure function. No side effects. No allocations beyond the result
 * arrays — fine for per-frame use.
 *
 * @module io/live2d/runtime/evaluator/cellSelect
 */

/**
 * @typedef {Object} KeyformBindingSpec
 * @property {string} parameterId
 * @property {number[]} keys                   - sorted ascending; ≥1 element
 * @property {('LINEAR'|'BEZIER')} [interpolation='LINEAR']  (currently only LINEAR is implemented)
 */

/**
 * @typedef {Object} CellInfo
 * @property {number[]} indices  - flat keyform-array indices, length = ∏(per-binding corner count)
 * @property {number[]} weights  - parallel array, sums to 1
 */

/**
 * @param {KeyformBindingSpec[]} bindings
 * @param {Object<string, number>} paramValues   - missing entries default to 0
 * @returns {CellInfo}
 */
export function cellSelect(bindings, paramValues) {
  const N = bindings?.length ?? 0;

  // Zero-binding host (e.g. a deformer with a single rest keyform and no
  // parameters driving it). Contract: 1 corner at index 0, weight 1.
  if (N === 0) return { indices: [0], weights: [1] };

  // Per-binding segment: { j (lower key index), t (lerp 0..1), K (key count),
  // isSingle (true when only 1 key — degenerate 1-corner contribution) }.
  const perBinding = new Array(N);
  for (let n = 0; n < N; n++) {
    const b = bindings[n];
    const keys = b?.keys;
    const K = keys?.length ?? 0;
    if (K <= 1) {
      perBinding[n] = { j: 0, t: 0, K: Math.max(K, 1), isSingle: true };
      continue;
    }
    const v = paramValues?.[b.parameterId] ?? 0;
    if (v <= keys[0]) {
      perBinding[n] = { j: 0, t: 0, K, isSingle: false };
      continue;
    }
    if (v >= keys[K - 1]) {
      perBinding[n] = { j: K - 2, t: 1, K, isSingle: false };
      continue;
    }
    let found = false;
    for (let j = 0; j < K - 1; j++) {
      if (v >= keys[j] && v <= keys[j + 1]) {
        const span = keys[j + 1] - keys[j];
        const t = span > 0 ? (v - keys[j]) / span : 0;
        perBinding[n] = { j, t, K, isSingle: false };
        found = true;
        break;
      }
    }
    if (!found) {
      // Unreachable for monotonic keys; defensive fallback.
      perBinding[n] = { j: K - 2, t: 1, K, isSingle: false };
    }
  }

  // First binding varies fastest in the keyform array — strides[0] = 1.
  const strides = new Array(N);
  strides[0] = 1;
  for (let n = 1; n < N; n++) strides[n] = strides[n - 1] * perBinding[n - 1].K;

  // Per-binding corner-pos count: 1 for single-key, 2 otherwise.
  const cornerCount = new Array(N);
  for (let n = 0; n < N; n++) cornerCount[n] = perBinding[n].isSingle ? 1 : 2;

  let total = 1;
  for (let n = 0; n < N; n++) total *= cornerCount[n];

  const indices = new Array(total);
  const weights = new Array(total);
  for (let c = 0; c < total; c++) {
    // Decode `c` into a corner-pos vector (first binding fastest, mirroring
    // the keyform storage layout).
    let cIdx = 0;
    let cW = 1;
    let cur = c;
    for (let n = 0; n < N; n++) {
      const cc = cornerCount[n];
      const pos = cur % cc;
      cur = (cur - pos) / cc;
      const pb = perBinding[n];
      const keyIdx = pb.isSingle ? pb.j : pb.j + pos;
      cIdx += keyIdx * strides[n];
      if (!pb.isSingle) cW *= pos === 0 ? 1 - pb.t : pb.t;
    }
    indices[c] = cIdx;
    weights[c] = cW;
  }
  return { indices, weights };
}
