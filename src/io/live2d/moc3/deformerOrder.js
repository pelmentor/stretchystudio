// @ts-check

/**
 * Topo-sorted unified deformer order for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #36).
 *
 * Cubism's runtime processes the deformer list in array order; an
 * out-of-order parent leaves a child's transformation un-anchored
 * the first time it's encountered. This pass merges warp + rotation
 * specs into one stream and topo-sorts so every deformer's parent
 * (when of `type === 'warp' | 'rotation'`) appears earlier.
 *
 * Each entry remembers its origin `kind` (`'warp' | 'rotation'`) and
 * `srcIndex` (position in the original warpSpecs / rotationSpecs
 * array). The sibling sections — `warp_deformer.*` and
 * `rotation_deformer.*` — stay in their natural creation order; the
 * umbrella `deformer.*` section uses the topo-sorted order. The
 * `srcIndex` becomes `deformer.specific_indices` so the runtime can
 * dereference into the correct sibling slot.
 *
 * Returns:
 *   - `allDeformerSpecs`: topo-sorted spec[]
 *   - `allDeformerKinds`: 'warp' | 'rotation' per entry
 *   - `allDeformerSrcIndices`: original index (for `specific_indices`)
 *   - `deformerIdToIndex`: id → topo-sorted unified index (Map)
 *   - `meshDefaultDeformerIdx`: deepest body warp (BodyXWarp →
 *     Breath → BodyWarpY → BodyWarpZ; -1 if none). Meshes lacking
 *     a dedicated rig warp parent target this index.
 *
 * @module io/live2d/moc3/deformerOrder
 */

/**
 * @param {Object} opts
 * @param {Array} opts.warpSpecs
 * @param {Array} opts.rotationSpecs
 * @returns {{
 *   allDeformerSpecs: Array,
 *   allDeformerKinds: Array<'warp'|'rotation'>,
 *   allDeformerSrcIndices: number[],
 *   deformerIdToIndex: Map<string, number>,
 *   meshDefaultDeformerIdx: number,
 * }}
 */
export function topoSortDeformers(opts) {
  const { warpSpecs, rotationSpecs } = opts;

  const unsorted = [
    ...warpSpecs.map((s, i) => ({ kind: /** @type {'warp'} */('warp'), srcIndex: i, spec: s })),
    ...rotationSpecs.map((s, i) => ({ kind: /** @type {'rotation'} */('rotation'), srcIndex: i, spec: s })),
  ];
  const byId = new Map();
  for (const e of unsorted) byId.set(e.spec.id, e);

  const ordered = [];
  const placed = new Set();
  const visit = (e) => {
    if (placed.has(e.spec.id)) return;
    const p = e.spec.parent;
    if (p && (p.type === 'warp' || p.type === 'rotation')) {
      const parentEntry = byId.get(p.id);
      if (parentEntry) visit(parentEntry);
    }
    placed.add(e.spec.id);
    ordered.push(e);
  };
  for (const e of unsorted) visit(e);

  const allDeformerSpecs = ordered.map(e => e.spec);
  const allDeformerKinds = ordered.map(e => e.kind);
  const allDeformerSrcIndices = ordered.map(e => e.srcIndex);
  /** @type {Map<string, number>} */
  const deformerIdToIndex = new Map();
  for (let di = 0; di < allDeformerSpecs.length; di++) {
    deformerIdToIndex.set(allDeformerSpecs[di].id, di);
  }

  // The deepest body warp — meshes parent to it when no per-mesh deformer
  // (face parallax / rig warp) supersedes. Falls back through the chain.
  const meshDefaultDeformerIdx = (
    deformerIdToIndex.get('BodyXWarp') ??
    deformerIdToIndex.get('BreathWarp') ??
    deformerIdToIndex.get('BodyWarpY') ??
    deformerIdToIndex.get('BodyWarpZ') ??
    -1
  );

  return {
    allDeformerSpecs,
    allDeformerKinds,
    allDeformerSrcIndices,
    deformerIdToIndex,
    meshDefaultDeformerIdx,
  };
}
