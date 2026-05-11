// @ts-check

/**
 * Toolset Plan Phase 7.B.2 — Blur brush math (audit-fix D-1: face-loop port).
 *
 * On each tick, for every vertex within brush radius, replace its
 * weight with a lerp toward the **face-loop weighted mean** of the
 * vertices on every triangle incident to it. The lerp factor is
 * `falloff(distance) * strength`.
 *
 * # Algorithm — Blender face-loop port (audit-fix D-1)
 *
 * Pre-fix the SS impl computed `mean(currentWeights[n] for n in
 * unique-neighbours[v])` with the vertex's own weight excluded. That
 * differs from Blender's `do_wpaint_brush_blur`
 * (`reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1214-1249`):
 *
 * ```c
 * int total_hit_loops = 0;
 * float weight_final = 0.0f;
 * for (const int face : vert_to_face[vert]) {
 *   total_hit_loops += faces[face].size();          // += 3 per triangle
 *   for (const int corner_vert : corner_verts.slice(faces[face])) {
 *     weight_final += wpd.precomputed_weight[corner_vert];  // includes vert itself
 *   }
 * }
 * weight_final /= total_hit_loops;                  // denominator = 3 × valence on tri mesh
 * ```
 *
 * For a vertex `v` with valence `k` on a pure-triangle mesh:
 * - `v`'s own weight is summed `k` times (once per incident face)
 * - each unique neighbour appears once across the incident faces (each
 *   neighbour shares exactly one face with `v`)
 * - denominator = `3k`
 *
 * Blender's target: `(k * w[v] + sum(w[n] for n in neighbours)) / (3k)`
 *                 = `w[v]/3 + sum(w[n]) / (3k)`
 *
 * SS pre-fix: `mean(w[n] for n in neighbours)` — converges to neighbour
 * mean, dropping the 1/3 self-preservation. Boundaries collapsed too
 * fast (a `w=1` vertex surrounded by `w=0` reached `0.0` in one tick;
 * Blender reaches `0.333`).
 *
 * Now we accept the `triangles` flat-array directly and replicate the
 * face-loop accumulation. Cost: one pass over `triangles` per tick to
 * sum each face's weights, then per-affected-vertex lookup. The caller
 * (WeightPaintOverlay) passes the same `triangles` ref each tick so a
 * future cache (per-stroke `vert_to_face` table) can be slotted in
 * without changing this signature.
 *
 * # Brush type registry reference
 *
 * `reference/blender/source/blender/makesdna/DNA_brush_enums.h:507-510`
 * — actual `eBrushWeightPaintType` enum (audit fix D-2: pre-fix the
 * cite was `paint_weight.cc:1063`, which is a runtime `if(ELEM(...))`
 * guard, not the enum definition):
 *
 * ```c
 * WPAINT_BRUSH_TYPE_DRAW    = 0,
 * WPAINT_BRUSH_TYPE_BLUR    = 1,
 * WPAINT_BRUSH_TYPE_AVERAGE = 2,
 * WPAINT_BRUSH_TYPE_SMEAR   = 3,
 * ```
 *
 * Brush dispatch at `paint_weight.cc:1562-1583` (BLUR case at `:1579`).
 *
 * # Adjacency caching
 *
 * The legacy `adjacency` arg is preserved on the call signature for
 * one release window so existing tests don't trip; it's no longer
 * read. New tests (and the overlay) pass `triangles` instead.
 *
 * @module lib/weightPaint/blur
 */

/**
 * Compute blur-stroke updates for a single tick using Blender's
 * face-loop accumulation (audit-fix D-1).
 *
 * @param {{
 *   currentWeights: ArrayLike<number>,
 *   triangles: ArrayLike<number>,
 *   affected: Array<{vertexIndex: number, falloff: number}>,
 *   strength: number,
 *   adjacency?: Array<Set<number>>,
 * }} args
 * @returns {Array<{vertexIndex: number, weight: number}>}
 */
export function computeBlurUpdates({ currentWeights, triangles, affected, strength }) {
  if (!currentWeights || !triangles || !Array.isArray(affected)) return [];
  if (!Number.isFinite(strength) || strength <= 0) return [];
  const len = currentWeights.length;
  const triLen = triangles.length;
  if (len === 0 || triLen < 3) return [];

  // Build a per-vertex `[weightSum, loopCount]` accumulator by walking
  // the triangle list once. For a vertex `v` on `k` incident triangles,
  // `loopCount = 3k` and `weightSum = k*w[v] + sum(neighbour weights
  // across those triangles)`.
  const sums = new Float64Array(len);
  const loops = new Uint32Array(len);
  for (let t = 0; t + 2 < triLen; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (a == null || b == null || c == null) continue;
    if (a < 0 || a >= len || b < 0 || b >= len || c < 0 || c >= len) continue;
    const wa = Number(currentWeights[a]);
    const wb = Number(currentWeights[b]);
    const wc = Number(currentWeights[c]);
    const faceSum = (Number.isFinite(wa) ? wa : 0)
                  + (Number.isFinite(wb) ? wb : 0)
                  + (Number.isFinite(wc) ? wc : 0);
    sums[a] += faceSum; loops[a] += 3;
    sums[b] += faceSum; loops[b] += 3;
    sums[c] += faceSum; loops[c] += 3;
  }

  /** @type {Array<{vertexIndex: number, weight: number}>} */
  const out = [];
  for (const a of affected) {
    if (!a) continue;
    const i = a.vertexIndex;
    if (typeof i !== 'number' || i < 0 || i >= len) continue;
    const fall = Number(a.falloff);
    if (!Number.isFinite(fall) || fall <= 0) continue;
    const k = loops[i];
    if (k === 0) continue;  // orphan vertex — no incident face
    const target = sums[i] / k;
    const cur = Number(currentWeights[i]) || 0;
    const t = Math.max(0, Math.min(1, fall * strength));
    let next = cur + (target - cur) * t;
    if (next < 0) next = 0;
    if (next > 1) next = 1;
    out.push({ vertexIndex: i, weight: next });
  }
  return out;
}
