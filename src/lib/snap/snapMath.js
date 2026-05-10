// @ts-check

/**
 * Toolset Plan Phase 2 — pure snap-math helpers.
 *
 * These are extracted from `ModalTransformOverlay` so they can be
 * unit-tested in isolation (jsdom-free). Each function is pure: no
 * stores, no side effects, no DOM.
 *
 *   - `snapDeltaToGrid(deltaCanvas, increment)` — Phase 2.B. Returns a
 *     new `{ x, y }` snapped to the nearest `increment` multiple along
 *     each axis. Increment is canvas-px.
 *   - `snapAngleToIncrement(angleRad, incrementDeg)` — Phase 2.D.
 *     Returns the angle (rad) snapped to the nearest `incrementDeg`
 *     multiple. Tolerates 0/Infinity/NaN by returning the input.
 *   - `snapScaleToIncrement(scale, incrementDeg)` — Phase 2.D scale
 *     companion. `incrementDeg/100` is the scale step (matches
 *     Blender's 1° = 0.01× convention from §2.A jsdoc); scale snaps
 *     to that multiple.
 *   - `computeSelectionAnchor(verts, target, opts?)` — Phase 2.C.
 *     Given a list of selected vertices and a target mode (`'closest'
 *     | 'center' | 'median' | 'active'`), returns the canvas-px point
 *     that should land ON the snap vertex. `closest` uses the cursor
 *     (caller passes `opts.cursor`). `active` uses the active vert
 *     (caller passes `opts.activeVert`). `center` uses the AABB
 *     centre. `median` uses the per-axis median.
 *
 * All inputs are canvas-px; modal callers pre-divide by zoom.
 *
 * @module lib/snap/snapMath
 */

/** Phase 2.B — snap a 2D delta to grid increments along each axis. */
export function snapDeltaToGrid(delta, increment) {
  if (!delta) return { x: 0, y: 0 };
  const inc = Number(increment);
  if (!Number.isFinite(inc) || inc <= 0) return { x: delta.x ?? 0, y: delta.y ?? 0 };
  const dx = Number.isFinite(delta.x) ? delta.x : 0;
  const dy = Number.isFinite(delta.y) ? delta.y : 0;
  return {
    x: Math.round(dx / inc) * inc,
    y: Math.round(dy / inc) * inc,
  };
}

/** Phase 2.D — snap an angle (radians) to nearest `incrementDeg`. */
export function snapAngleToIncrement(angleRad, incrementDeg) {
  if (!Number.isFinite(angleRad)) return angleRad;
  const incDeg = Number(incrementDeg);
  if (!Number.isFinite(incDeg) || incDeg <= 0) return angleRad;
  const stepRad = incDeg * Math.PI / 180;
  return Math.round(angleRad / stepRad) * stepRad;
}

/** Phase 2.D — scale companion. `incrementDeg` is the rotation step
 *  in degrees; scale uses `incrementDeg / 100` per the SNAP_DEFAULT
 *  jsdoc convention (15° → 0.15× step). Falls back to the legacy 0.1
 *  step when `incrementDeg <= 0`. Scale floor is `step` (positive). */
export function snapScaleToIncrement(scale, incrementDeg) {
  if (!Number.isFinite(scale)) return scale;
  const incDeg = Number(incrementDeg);
  if (!Number.isFinite(incDeg) || incDeg <= 0) return scale;
  const step = incDeg / 100;
  if (step <= 0) return scale;
  const snapped = Math.round(scale / step) * step;
  return Math.max(step, snapped);
}

/** Phase 2.C — selection anchor for the four snap-target modes.
 *
 * - `closest`: returns `opts.cursor` (the cursor IS the anchor).
 * - `center`:  AABB centre of `verts` (min/max midpoint).
 * - `median`:  per-axis median of `verts`.
 * - `active`:  returns `opts.activeVert` if present, else falls
 *               through to `closest`. (Object-Mode callers pass the
 *               active node's pivot here.)
 *
 * Empty `verts` falls through to the cursor for every mode except
 * `active` with no active vert (also cursor) — keeping the contract
 * total: this function NEVER returns null when given a cursor.
 *
 * @param {Array<{x:number,y:number}>} verts
 * @param {'closest'|'center'|'median'|'active'} target
 * @param {{ cursor?: {x:number,y:number}, activeVert?: {x:number,y:number}|null }} [opts]
 */
export function computeSelectionAnchor(verts, target, opts) {
  const cursor = opts?.cursor && Number.isFinite(opts.cursor.x) && Number.isFinite(opts.cursor.y)
    ? { x: opts.cursor.x, y: opts.cursor.y }
    : null;
  const fallback = cursor ?? { x: 0, y: 0 };

  if (target === 'active') {
    const a = opts?.activeVert;
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return { x: a.x, y: a.y };
    return fallback;
  }
  if (target === 'closest' || !target) return fallback;

  const list = Array.isArray(verts) ? verts.filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y)) : [];
  if (list.length === 0) return fallback;

  if (target === 'center') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of list) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  if (target === 'median') {
    const xs = list.map((v) => v.x).sort((a, b) => a - b);
    const ys = list.map((v) => v.y).sort((a, b) => a - b);
    return { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
  }
  return fallback;
}
