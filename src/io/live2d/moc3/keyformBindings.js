// @ts-check

/**
 * Keyform binding system for the .moc3 generator (dedup pool +
 * contiguous-by-param reorder + bands + per-param ranges).
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #37).
 *
 * Cubism uses heavy deduplication: each unique `(paramId, keys)` tuple
 * becomes ONE binding shared across every band that uses it; objects
 * sharing the same binding-set share the same band. Without this our
 * band/binding counts come out 2× cubism's and the moc3 fails to load
 * in the runtime.
 *
 * Pipeline:
 *   1. Collect `(paramId, keys)` from every object → unique binding pool.
 *   2. Reorder the pool so a parameter's bindings are CONTIGUOUS in
 *      `keyform_bindings[]`. The runtime reads
 *      `kfb_begin..kfb_begin + kfb_count` for each param expecting a
 *      single contiguous range. Verified by binary diff vs cubism
 *      native: ParamAngleX@idx0 → kfb_begin=0, …, ParamOpacity@idx29 →
 *      kfb_begin=25.
 *   3. Group objects by their canonical binding profile (sorted index
 *      list) → unique bands. Band 0 is reserved as the "null" band
 *      (count=0) for parts / any future objects without bindings —
 *      matches cubism's band[0].
 *   4. `keyform_binding_index` = expansion of bands' profiles (one slot
 *      per binding-axis).
 *   5. Each param owns a contiguous range over `uniqueBindings[]`
 *      (post-reorder), emitted as
 *      `parameter.keyform_binding_begin_indices` /
 *      `_counts`.
 *
 * Returns the full bundle the caller writes into the section map +
 * count slots:
 *   - `uniqueBindings`: post-reorder pool (paramId / keys per entry)
 *   - `meshBandIndex`, `deformerBandIndex`: object → band index
 *   - `bandBegins`, `bandCounts`: per-band kfbi range
 *   - `keyformBindingIndices`: flat kfbi (band-expanded)
 *   - `bindingKeysBegin`, `bindingKeysCount`, `flatKeys`: per-binding keys
 *   - `paramKfbBegin`, `paramKfbCount`: per-param binding range (-1 means
 *      param is unused; moc3 stores it as 0xFFFFFFFF on the wire).
 *
 * @module io/live2d/moc3/keyformBindings
 */

/**
 * @param {Object} opts
 * @param {Array<{paramId:string, keys:number[]}>} opts.meshBindingPlan
 * @param {Array} opts.allDeformerSpecs
 * @param {Array<{id:string}>} opts.params
 * @returns {{
 *   uniqueBindings: Array<{paramId:string, keys:number[]}>,
 *   meshBandIndex: number[],
 *   deformerBandIndex: number[],
 *   bandBegins: number[],
 *   bandCounts: number[],
 *   keyformBindingIndices: number[],
 *   bindingKeysBegin: number[],
 *   bindingKeysCount: number[],
 *   flatKeys: number[],
 *   paramKfbBegin: number[],
 *   paramKfbCount: number[],
 * }}
 */
export function buildKeyformBindings(opts) {
  const { meshBindingPlan, allDeformerSpecs, params } = opts;

  /** @type {{paramId:string, keys:number[]}[]} */
  const uniqueBindings = [];
  /** @type {Map<string, number>} */
  const bindingHashToIdx = new Map();
  const bindHash = (pid, keys) => `${pid}|${keys.join(',')}`;
  const internBinding = (paramId, keys) => {
    const h = bindHash(paramId, keys);
    const existing = bindingHashToIdx.get(h);
    if (existing !== undefined) return existing;
    const idx = uniqueBindings.length;
    uniqueBindings.push({ paramId, keys: keys.slice() });
    bindingHashToIdx.set(h, idx);
    return idx;
  };

  // Collect each object's binding indices.
  // Objects: art_meshes (in meshParts order), then deformers (in unified
  // topo-sorted order — same as the deformer.* sections).
  /** @type {number[][]} */
  const meshObjectBindings = meshBindingPlan.map(plan =>
    [internBinding(plan.paramId, plan.keys)],
  );
  /** @type {number[][]} */
  const deformerObjectBindings = allDeformerSpecs.map(spec =>
    spec.bindings.map(b => internBinding(b.parameterId, b.keys)),
  );

  // ── Reorder uniqueBindings to be contiguous-by-param ──
  // `parameter.keyform_binding_begin_indices` is a BINDING index (into
  // keyform_bindings[]); the runtime reads `kfb_begin..kfb_begin+kfb_count`
  // expecting all bindings for the same param to be consecutive.
  /** @type {Map<string, number>} */
  const paramOrder = new Map();
  params.forEach((p, i) => paramOrder.set(p.id, i));
  const sortedBindings = uniqueBindings
    .map((b, oldIdx) => ({
      b, oldIdx,
      // Inactive params (no binding entry uses them) sort to the end —
      // shouldn't happen in practice but keeps things deterministic.
      pOrder: paramOrder.get(b.paramId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.pOrder - b.pOrder || a.oldIdx - b.oldIdx);
  const oldToNewBinding = new Array(uniqueBindings.length);
  for (let newIdx = 0; newIdx < sortedBindings.length; newIdx++) {
    oldToNewBinding[sortedBindings[newIdx].oldIdx] = newIdx;
  }
  uniqueBindings.length = 0;
  for (const s of sortedBindings) uniqueBindings.push(s.b);
  for (const arr of meshObjectBindings) {
    for (let i = 0; i < arr.length; i++) arr[i] = oldToNewBinding[arr[i]];
  }
  for (const arr of deformerObjectBindings) {
    for (let i = 0; i < arr.length; i++) arr[i] = oldToNewBinding[arr[i]];
  }

  // Group objects by canonical binding profile → unique bands.
  /** @type {{bindingIndices:number[]}[]} */
  const bandPool = [{ bindingIndices: [] }]; // band 0 = null
  /** @type {Map<string, number>} */
  const bandHashToIdx = new Map([['', 0]]);
  const profileHash = (idxs) => idxs.slice().sort((a, b) => a - b).join(',');
  const internBand = (bindingIndices) => {
    if (bindingIndices.length === 0) return 0;
    const h = profileHash(bindingIndices);
    const existing = bandHashToIdx.get(h);
    if (existing !== undefined) return existing;
    const idx = bandPool.length;
    bandPool.push({ bindingIndices: bindingIndices.slice() });
    bandHashToIdx.set(h, idx);
    return idx;
  };
  const meshBandIndex = meshObjectBindings.map(b => internBand(b));
  const deformerBandIndex = deformerObjectBindings.map(b => internBand(b));

  // Per-binding key range — emit ONCE per unique binding.
  const bindingKeysBegin = [];
  const bindingKeysCount = [];
  const flatKeys = [];
  for (const b of uniqueBindings) {
    bindingKeysBegin.push(flatKeys.length);
    bindingKeysCount.push(b.keys.length);
    for (const k of b.keys) flatKeys.push(k);
  }

  // Build keyform_binding_index by walking each band's binding indices.
  const keyformBindingIndices = [];
  const bandBegins = [];
  const bandCounts = [];
  for (const band of bandPool) {
    bandBegins.push(keyformBindingIndices.length);
    bandCounts.push(band.bindingIndices.length);
    for (const bi of band.bindingIndices) keyformBindingIndices.push(bi);
  }

  // Per-parameter binding range — index INTO uniqueBindings[], not kfbi.
  const paramKfbBegin = [];
  const paramKfbCount = [];
  for (const p of params) {
    let begin = -1;
    let count = 0;
    for (let bi = 0; bi < uniqueBindings.length; bi++) {
      if (uniqueBindings[bi].paramId === p.id) {
        if (begin === -1) begin = bi;
        count++;
      }
    }
    if (begin >= 0) {
      paramKfbBegin.push(begin);
      paramKfbCount.push(count);
    } else {
      paramKfbBegin.push(-1); // 0xFFFFFFFF on the wire
      paramKfbCount.push(0);
    }
  }

  return {
    uniqueBindings,
    meshBandIndex,
    deformerBandIndex,
    bandBegins,
    bandCounts,
    keyformBindingIndices,
    bindingKeysBegin,
    bindingKeysCount,
    flatKeys,
    paramKfbBegin,
    paramKfbCount,
  };
}
