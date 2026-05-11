// @ts-check

/**
 * Toolset Plan Phase 7.B.2 — Blur brush math.
 *
 * On each tick, for every vertex within brush radius, replace its
 * weight with a lerp toward the mean of its triangle-adjacent neighbors'
 * weights. The lerp factor is `falloff(distance) * strength`, matching
 * the cosine-falloff intensity profile that the Draw brush uses.
 *
 * # Why a separate module
 *
 * The Draw brush mutates per-vertex weight independently (each vertex
 * lerps toward `target` based on its own falloff). Blur is intrinsically
 * non-local: vertex `i`'s next weight depends on its neighbors' CURRENT
 * weights. That means a stroke must read the weight array, compute the
 * full update set against that snapshot, then commit. Mixing it into
 * `WeightPaintOverlay.flushPaint`'s per-vertex loop would risk a
 * "smear by current-tick neighbor" hazard.
 *
 * # Blender source reference
 *
 * `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1149`
 * — `do_wpaint_brush_blur`. Iterates per-loop incident faces and accumulates
 * a weighted average of neighbor weights, then writes one `wpd->wpi.brush_alpha_pressure`-
 * scaled lerp per affected vertex. Same shape as `WPAINT_BRUSH_TYPE_BLUR`
 * branch at `paint_weight.cc:1579`.
 *
 * Brush type enum at `paint_weight.cc:1063` (`WPAINT_BRUSH_TYPE_BLUR`)
 * + dispatch at `:1562-1583`.
 *
 * # Math
 *
 * For each vertex `v` in the brush footprint:
 *   - `neighbors[v]` = vertex indices that share a triangle with `v`
 *   - `meanW = mean(currentWeights[n] for n in neighbors[v])`
 *   - `lerpAmount = falloffWeight(v) * strength`
 *   - `nextWeights[v] = currentWeights[v] + (meanW - currentWeights[v]) * lerpAmount`
 *
 * If a vertex has no neighbors (orphan), it skips (Blender does the
 * same — `paint_weight.cc:1252`-ish guards against `loop_count == 0`).
 *
 * # Adjacency caching
 *
 * Adjacency is built once per stroke. The caller (`WeightPaintOverlay`)
 * passes the cached adjacency in; this module never builds it. Reuses
 * `buildVertexAdjacency` from `proportionalEdit.js` so the cache is
 * shared across modes (sculpt + proportional + blur all draw from the
 * same per-mesh adjacency table).
 *
 * @module lib/weightPaint/blur
 */

/**
 * Compute blur-stroke updates for a single tick.
 *
 * @param {{
 *   currentWeights: ArrayLike<number>,
 *   adjacency: Array<Set<number>>,
 *   affected: Array<{vertexIndex: number, falloff: number}>,
 *   strength: number,
 * }} args
 * @returns {Array<{vertexIndex: number, weight: number}>}
 */
export function computeBlurUpdates({ currentWeights, adjacency, affected, strength }) {
  if (!currentWeights || !adjacency || !Array.isArray(affected)) return [];
  if (!Number.isFinite(strength) || strength <= 0) return [];
  const out = [];
  const len = currentWeights.length;
  for (const a of affected) {
    if (!a) continue;
    const i = a.vertexIndex;
    if (typeof i !== 'number' || i < 0 || i >= len) continue;
    const fall = Number(a.falloff);
    if (!Number.isFinite(fall) || fall <= 0) continue;
    const neighborSet = adjacency[i];
    if (!neighborSet || neighborSet.size === 0) continue;
    let sum = 0;
    let n = 0;
    for (const nb of neighborSet) {
      if (nb === i) continue;
      const w = Number(currentWeights[nb]);
      if (!Number.isFinite(w)) continue;
      sum += w;
      n++;
    }
    if (n === 0) continue;
    const mean = sum / n;
    const cur = Number(currentWeights[i]) || 0;
    const t = Math.max(0, Math.min(1, fall * strength));
    let next = cur + (mean - cur) * t;
    if (next < 0) next = 0;
    if (next > 1) next = 1;
    out.push({ vertexIndex: i, weight: next });
  }
  return out;
}
