// @ts-check

/**
 * v3 Phase 0F.12 - PSD merged-part split applier.
 *
 * The wizard's "split merged parts" step replaces a single PSD
 * layer with its left/right halves, generating fresh part ids for
 * each new layer. The logic is pure splice-replace; only `uid`
 * generation is impure (random) and gets parameterised so the
 * function stays unit-testable.
 *
 * Sorting splits by `mergedIdx` descending matters: we mutate the
 * arrays in place, so processing high indices first prevents
 * earlier splices from invalidating later ones.
 *
 * @module components/canvas/viewport/applySplits
 */

/**
 * @typedef {Object} SplitInstruction
 * @property {number} mergedIdx                   - index in the layers / partIds arrays
 * @property {object|null} rightLayer             - replacement for the right half (null = drop)
 * @property {object|null} leftLayer              - replacement for the left half  (null = drop)
 *
 * @typedef {Object} SplitResult
 * @property {object[]} layers
 * @property {string[]} partIds
 */

/**
 * Replace each `splits[i].mergedIdx` entry in `(layers, partIds)`
 * with [rightLayer, leftLayer] (each kept only if non-null).
 *
 * Returns a NEW pair of arrays - inputs are not mutated.
 *
 * @param {object[]} layers
 * @param {string[]} partIds
 * @param {SplitInstruction[]} splits
 * @param {() => string} uidFn      - injected so tests can be deterministic
 * @returns {SplitResult}
 */
export function applySplits(layers, partIds, splits, uidFn) {
  const newLayers = [...layers];
  const newPartIds = [...partIds];

  // Mutate from highest index down so earlier splices don't shift
  // the targets of later ones.
  const sorted = [...splits].sort((a, b) => b.mergedIdx - a.mergedIdx);

  for (const { mergedIdx, rightLayer, leftLayer } of sorted) {
    const replLayers = [];
    const replPartIds = [];
    if (rightLayer) {
      replLayers.push(rightLayer);
      replPartIds.push(uidFn());
    }
    if (leftLayer) {
      replLayers.push(leftLayer);
      replPartIds.push(uidFn());
    }
    newLayers.splice(mergedIdx, 1, ...replLayers);
    newPartIds.splice(mergedIdx, 1, ...replPartIds);
  }

  return { layers: newLayers, partIds: newPartIds };
}
