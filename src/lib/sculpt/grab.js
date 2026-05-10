// @ts-check

/**
 * Toolset Plan Phase 3.C — Grab brush (Blender-faithful anchored
 * semantics, audit-revised D-1).
 *
 * **Anchored radius.** The brush footprint is anchored at the stroke's
 * START cursor (`anchorCursor`); it does NOT follow the live cursor.
 * Verts within `size` of the anchor at stroke begin form the affected
 * patch; verts the user drags the cursor over later are NOT picked up
 * mid-stroke.
 *
 * **Total-delta vs ORIG positions.** Each tick reads each vert's
 * STROKE-BEGIN position (`origVerts[i]`) and applies the cumulative
 * delta `(cursor - anchorCursor) * falloffWeight * strength`. The
 * `prevCursor`-based per-tick incremental delta of pre-D-1 SS Grab
 * (which behaved like Blender's NUDGE) is gone — verts are repositioned
 * to `orig + totalDelta * weight`, NOT incrementally mutated.
 *
 * Blender source: `editors/sculpt_paint/mesh/sculpt.cc:4163-4307`
 * (`need_delta_from_anchored_origin` → true for `SCULPT_BRUSH_TYPE_GRAB`,
 * `cache->grab_delta` accumulated, `cache->location =
 * cache->orig_grab_location`) + `editors/sculpt_paint/mesh/brushes/grab.cc:70-92`
 * (`OrigPositionData orig_data = orig_position_data_get_mesh(...)`).
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
  const { origVerts, anchorCursor, cursor, size, strength, falloff,
          adjacency, connectedOnly, originIdx } = opts;
  // Anchored Grab requires the stroke-begin snapshot AND the anchor
  // cursor. Without these, fall back to no-op rather than silently
  // degrading to the pre-fix continuous-Drag semantics.
  if (!origVerts || !anchorCursor) return out;
  const totalDx = cursor.x - anchorCursor.x;
  const totalDy = cursor.y - anchorCursor.y;
  // No cumulative cursor movement = no displacement. Equivalent to
  // first-tick (cursor still on anchor).
  if (totalDx === 0 && totalDy === 0) return out;

  const s = Math.max(0, Math.min(1, strength));
  if (s === 0) return out;

  // Weights anchored at the START position — this is the key Blender
  // semantic. Once a vert's weight is computed at stroke begin, it
  // doesn't change for the rest of the stroke (cursor wandering off
  // the anchor doesn't re-evaluate which verts are in range).
  const weights = brushFalloffWeights({
    verts:         origVerts,
    cursor:        anchorCursor,
    size,
    falloff,
    adjacency:     adjacency ?? null,
    connectedOnly: !!connectedOnly,
    originIdx:     originIdx ?? null,
  });

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    out.set(i, {
      x: origVerts[i].x + totalDx * w * s,
      y: origVerts[i].y + totalDy * w * s,
    });
  }
  return out;
}
