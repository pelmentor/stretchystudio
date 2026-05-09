/**
 * Interior point sampling — pure, no DOM.
 */

import { SpatialHash } from './spatialHash.js';

/**
 * Sample interior points using stratified random sampling (jittered grid).
 *
 * @param {Uint8ClampedArray} data
 * @param {number}            width
 * @param {number}            height
 * @param {number}            [alphaThreshold=5]
 * @param {number}            [gridSpacing=30]
 * @returns {Array<[number,number]>}
 */
export function sampleInterior(data, width, height, alphaThreshold = 5, gridSpacing = 30) {
  const points = [];
  const jitter = gridSpacing * 0.4;

  for (let y = gridSpacing; y < height - gridSpacing / 2; y += gridSpacing) {
    for (let x = gridSpacing; x < width - gridSpacing / 2; x += gridSpacing) {
      const jx = x + (Math.random() - 0.5) * jitter * 2;
      const jy = y + (Math.random() - 0.5) * jitter * 2;

      const cx = Math.max(0, Math.min(width - 1, Math.round(jx)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(jy)));
      if (data[(cy * width + cx) * 4 + 3] >= alphaThreshold) {
        points.push([jx, jy]);
      }
    }
  }
  return points;
}

/**
 * Remove interior points that are within `minDistance` of any edge
 * point. Uses a spatial hash (cellSize = minDistance) so each query
 * checks ~9 buckets instead of every edge point — O(interior +
 * edge) total instead of the prior O(interior × edge).
 *
 * @param {Array<[number,number]>} interiorPts
 * @param {Array<[number,number]>} edgePts
 * @param {number}                 minDistance
 * @returns {Array<[number,number]>}
 */
export function filterByEdgePadding(interiorPts, edgePts, minDistance) {
  // minDistance <= 0 means "no padding needed" — return interior points
  // unchanged. The hash requires a positive cellSize, so short-circuit
  // before constructing it.
  if (edgePts.length === 0 || minDistance <= 0) return interiorPts;
  const hash = new SpatialHash(minDistance);
  hash.addAll(edgePts);
  return interiorPts.filter(([x, y]) => !hash.hasWithin(x, y, minDistance));
}
