// @ts-check

/**
 * Toolset Plan Phase 3.C — Grab brush.
 *
 * Each tick translates every vertex within `size` of the cursor by
 * `(cursor − prevCursor) × falloff(d/size) × strength`. Verts outside
 * the radius don't move; the rim is feathered by the falloff curve.
 *
 * Identical math to a proportional-edit drag — but with the anchor at
 * the cursor (not at an origin vertex), so verts can be picked up
 * from anywhere in the radius rather than only being dragged through
 * one specific picked vertex.
 *
 * On the very first tick `prevCursor` is null (the stroke just began
 * and there's no delta to apply). The brush returns an empty map —
 * verts stay put. From the second tick onwards the cursor delta drives
 * the displacement.
 *
 * @module lib/sculpt/grab
 */

import { brushFalloffWeights } from './index.js';

/**
 * @param {import('./index.js').BrushTickOpts} opts
 * @returns {Map<number, {x:number, y:number}>}
 */
export function grabTick(opts) {
  const out = new Map();
  const { verts, cursor, prevCursor, size, strength, falloff, adjacency, connectedOnly, originIdx } = opts;
  if (!prevCursor) return out;
  const dx = cursor.x - prevCursor.x;
  const dy = cursor.y - prevCursor.y;
  if (dx === 0 && dy === 0) return out;

  const s = Math.max(0, Math.min(1, strength));
  // Strength of 0 = brush has no effect; don't bother weighting
  // (and don't return zero-delta entries that would still cost the
  // caller a per-vert mutation).
  if (s === 0) return out;

  const weights = brushFalloffWeights({
    verts, cursor, size, falloff,
    adjacency: adjacency ?? null,
    connectedOnly: !!connectedOnly,
    originIdx: originIdx ?? null,
  });

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    out.set(i, {
      x: verts[i].x + dx * w * s,
      y: verts[i].y + dy * w * s,
    });
  }
  return out;
}
