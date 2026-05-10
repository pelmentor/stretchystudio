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
 * cursor-centered falloff so the smoothing tapers at the rim. The
 * `iterations` slider (1–10) chains additional Laplacian passes per
 * tick.
 *
 * **Audit-flagged SS deviation (D-5).** Blender's standard Smooth
 * brush has NO iteration slider — it derives iteration count from
 * `strength`: `int(strength * 4)` full passes plus one partial
 * (`editors/sculpt_paint/mesh/brushes/smooth.cc:34-48`). SS exposes
 * iterations directly because that's more discoverable for character
 * rigging users (no need to internalise "strength × 4 = iters" math).
 * Documented as INTENTIONAL deviation, not a Blender port.
 *
 * **Reading current positions vs ORIG.** The brush reads
 * `mesh.vertices` (the current store state) and writes new positions
 * for the affected set in a single pass — neighbours that also fall
 * inside the radius use their CURRENT (un-smoothed-this-iter) value
 * for the same iteration, then the iteration commits all moves at
 * once. Successive iterations chain through the just-smoothed values.
 * Matches Blender's `do_smooth_brush` per-PBVH-node behaviour.
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
