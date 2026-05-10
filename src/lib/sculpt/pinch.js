// @ts-check

/**
 * Toolset Plan Phase 3.E — Pinch brush.
 *
 * Each affected vertex moves a fraction of the way toward the brush
 * cursor, weighted by falloff and stroke strength:
 *
 *   move = (cursor − vert) × falloffWeight × strength × PINCH_RATE
 *
 * `PINCH_RATE` is the per-tick fraction of the cursor-distance to
 * close. 0.5 means at full strength + full falloff a vertex moves
 * halfway to the cursor each tick — Blender's `BRUSH_PINCH` has a
 * similar magnitude under default brush settings.
 *
 * **Magnify (Ctrl held).** Sign flips: `move` becomes `(vert − cursor)
 * × …`, pushing the vert AWAY from the cursor. Matches Blender's
 * Pinch/Magnify modal toggle (`SCULPT_TOOL_PINCH` + `BRUSH_DIR_FLAG`).
 *
 * Verts already at the cursor (within EPS) are skipped — moving
 * "0% toward" is a no-op and we don't want a `NaN` from a zero-length
 * direction vector.
 *
 * @module lib/sculpt/pinch
 */

import { brushFalloffWeights } from './index.js';

const PINCH_RATE = 0.5;
const EPS = 1e-6;

/**
 * @param {import('./index.js').BrushTickOpts} opts
 * @returns {Map<number, {x:number, y:number}>}
 */
export function pinchTick(opts) {
  const out = new Map();
  const { verts, cursor, size, strength, falloff, ctrl, adjacency, connectedOnly, originIdx } = opts;

  const weights = brushFalloffWeights({
    verts, cursor, size, falloff,
    adjacency: adjacency ?? null,
    connectedOnly: !!connectedOnly,
    originIdx: originIdx ?? null,
  });

  const s = Math.max(0, Math.min(1, strength));
  const sign = ctrl ? -1 : 1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    const dx = cursor.x - verts[i].x;
    const dy = cursor.y - verts[i].y;
    const d2 = dx * dx + dy * dy;
    if (d2 < EPS) continue;
    const k = w * s * PINCH_RATE * sign;
    out.set(i, {
      x: verts[i].x + dx * k,
      y: verts[i].y + dy * k,
    });
  }
  return out;
}
