// @ts-check

/**
 * Toolset Plan Phase 3.E — Pinch brush (Blender-faithful stroke-aligned
 * squeeze, audit-revised D-2 + D-3).
 *
 * **Stroke-aligned squeeze, not radial pull.** Blender's Pinch
 * (`editors/sculpt_paint/mesh/brushes/pinch.cc:39-60`) projects the
 * vert→cursor displacement onto the stroke matrix (X = perpendicular
 * to grab_delta, Z = surface normal, Y dropped). For a 2D mesh in the
 * canvas plane, the surface normal is constant Z = (0,0,1) so the
 * Z-axis projection is zero in-plane — the resulting translation is
 * along the X-axis (perpendicular to stroke direction).
 *
 * **Behavioural consequence.** Stroking ALONG a hairline pinches verts
 * on either side TOWARD the line (sharpens the line). Stationary
 * cursor → no pinch (no stroke direction). This is a different
 * primitive from the pre-fix radial-pull SS Pinch.
 *
 * **Asymmetric Magnify (D-3).** Blender's `brush_strength`
 * (`editors/sculpt_paint/mesh/sculpt.cc:2433-2439`) returns
 * `0.25 * alpha * pressure * overlap * feather` for the Magnify
 * direction (Ctrl held), vs full magnitude for Pinch. Magnify is
 * intentionally 4× weaker — Pinch is constructive (sharpens) and
 * Magnify is destructive (smooths/spreads).
 *
 * **Ctrl locked at stroke begin.** The `ctrl` field is captured at
 * pointerdown via `dragRef.ctrlAtStart` (audit-fix D-4); per-tick
 * keyboard reads no longer flip Pinch ↔ Magnify mid-drag. Matches
 * Blender's `paint_stroke.cc:868` (`stroke_mode_` read once from
 * operator's mode enum).
 *
 * @module lib/sculpt/pinch
 */

import { brushFalloffWeights } from './index.js';

const EPS = 1e-6;
// Per-tick scale on the stroke-aligned displacement. SS-tuned (Blender
// uses brush.alpha * pressure * overlap * feather; 0.5 here gives a
// roughly comparable visual weight at default size/strength on a 2D
// canvas mesh without pen pressure or stroke spacing).
const PINCH_RATE = 0.5;
// Magnify direction: 4× weaker than Pinch direction. Mirrors Blender's
// asymmetric coefficient at sculpt.cc:2436.
const MAGNIFY_RATIO = 0.25;

/**
 * @param {import('./index.js').BrushTickOpts} opts
 * @returns {Map<number, {x:number, y:number}>}
 */
export function pinchTick(opts) {
  const out = new Map();
  const { verts, cursor, prevCursor, size, strength, falloff, ctrl,
          adjacency, connectedOnly, originIdx } = opts;

  // Stationary cursor → no pinch (Blender early-returns at pinch.cc:191
  // when `grab_delta_symm` is the zero vector). The stroke matrix can't
  // be built without a direction.
  if (!prevCursor) return out;
  const gdx = cursor.x - prevCursor.x;
  const gdy = cursor.y - prevCursor.y;
  const gdLen = Math.sqrt(gdx * gdx + gdy * gdy);
  if (gdLen < EPS) return out;

  const s = Math.max(0, Math.min(1, strength));
  if (s === 0) return out;

  // Stroke matrix X-axis (canvas plane perpendicular to grab_delta).
  // For 2D mesh: cross((0,0,1), (gdx, gdy, 0)) = (-gdy, gdx, 0). Normalize.
  // Z-axis projection (surface normal) is zero in-plane, so the final
  // displacement = xAxis * proj only.
  const xAxisX = -gdy / gdLen;
  const xAxisY =  gdx / gdLen;

  const weights = brushFalloffWeights({
    verts, cursor, size, falloff,
    adjacency:     adjacency ?? null,
    connectedOnly: !!connectedOnly,
    originIdx:     originIdx ?? null,
  });

  // Magnify scales magnitude by 0.25 AND flips the sign (verts pushed
  // away from stroke axis instead of toward). Pinch direction = +1,
  // Magnify direction = -0.25 (asymmetric per Blender D-3).
  const direction = ctrl ? -MAGNIFY_RATIO : 1;
  const stepK = s * PINCH_RATE * direction;

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    // disp_center = cursor − vert (vector from vert to cursor)
    const dcX = cursor.x - verts[i].x;
    const dcY = cursor.y - verts[i].y;
    // Scalar projection of disp_center onto xAxis. Sign carries the
    // "which side of the stroke" information; verts on opposite sides
    // are pulled toward / pushed away from the stroke line.
    const proj = xAxisX * dcX + xAxisY * dcY;
    const translateX = xAxisX * proj * w * stepK;
    const translateY = xAxisY * proj * w * stepK;
    out.set(i, {
      x: verts[i].x + translateX,
      y: verts[i].y + translateY,
    });
  }
  return out;
}
