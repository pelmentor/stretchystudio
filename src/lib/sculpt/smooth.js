// @ts-check

/**
 * Toolset Plan Phase 3.D — Smooth brush.
 *
 * Per affected vertex, replace its position with a weighted blend
 * toward the average of its triangle-adjacent neighbours:
 *
 *   newPos = lerp(oldPos, avgOfNeighbours, falloffWeight × strength)
 *
 * This is one Laplacian-smoothing iteration, weighted by the brush's
 * cursor-centered falloff so the smoothing tapers at the rim. Two
 * iterations per tick (configurable via `opts.iterations`) gives a
 * heavier smoothing pass for the same stroke; 1 is faster.
 *
 * The brush READS the current vertex positions and computes the new
 * positions for the affected set in a single pass — neighbours that
 * also fall inside the radius use their CURRENT (un-smoothed) value
 * for the same iteration, then the iteration commits all moves at
 * once. Successive iterations chain through the just-smoothed values.
 * This matches Blender's `SCULPT_brush_strokes` jitter-free behaviour
 * for symmetric Smooth.
 *
 * Vertices with no neighbours (orphan verts not referenced by any
 * triangle) are skipped — there's nothing to average toward.
 *
 * @module lib/sculpt/smooth
 */

import { brushFalloffWeights } from './index.js';

/**
 * @param {import('./index.js').BrushTickOpts} opts
 * @returns {Map<number, {x:number, y:number}>}
 */
export function smoothTick(opts) {
  const out = new Map();
  const { verts, cursor, size, strength, falloff, adjacency, connectedOnly, originIdx } = opts;
  if (!adjacency) return out;        // Smooth requires adjacency
  const iterations = Math.max(1, Math.min(10, opts.iterations ?? 1));

  const weights = brushFalloffWeights({
    verts, cursor, size, falloff,
    adjacency,
    connectedOnly: !!connectedOnly,
    originIdx: originIdx ?? null,
  });

  // Find affected verts up-front so the iteration loop only touches
  // them. Verts with weight 0 are skipped, and orphan verts (no
  // neighbours referenced by any triangle) are also skipped — there's
  // no average-of-neighbours to lerp toward.
  /** @type {number[]} */
  const affected = [];
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    const adj = adjacency[i];
    if (!adj || adj.size === 0) continue;
    affected.push(i);
  }
  if (affected.length === 0) return out;

  // Working buffer mirrors current verts; iterations mutate this so
  // chained smoothing passes through the previous iteration's output.
  const work = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) work[i] = { x: verts[i].x, y: verts[i].y };

  const s = Math.max(0, Math.min(1, strength));
  for (let it = 0; it < iterations; it++) {
    /** @type {Map<number, {x:number, y:number}>} */
    const next = new Map();
    for (const idx of affected) {
      const adj = adjacency[idx];
      // affected[] was pre-filtered to skip orphans, but keep the
      // defensive check for cases where adjacency mutates between
      // construction and use.
      if (!adj || adj.size === 0) continue;
      let ax = 0, ay = 0;
      for (const n of adj) {
        ax += work[n].x;
        ay += work[n].y;
      }
      ax /= adj.size;
      ay /= adj.size;
      const w = weights[idx] * s;
      next.set(idx, {
        x: work[idx].x + (ax - work[idx].x) * w,
        y: work[idx].y + (ay - work[idx].y) * w,
      });
    }
    // Commit this iteration's moves into the working buffer for the
    // next iteration to see.
    for (const [idx, p] of next) {
      work[idx].x = p.x;
      work[idx].y = p.y;
    }
  }

  // Final result: only the affected verts are returned (others are
  // unchanged and need no write).
  for (const idx of affected) {
    out.set(idx, { x: work[idx].x, y: work[idx].y });
  }
  return out;
}
