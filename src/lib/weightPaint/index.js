// @ts-check

/**
 * Toolset Plan Phase 7.B — Weight Paint brush registry.
 *
 * Sister to `src/lib/sculpt/index.js` (Phase 3 sculpt brushes) and
 * structured the same way: `WEIGHT_BRUSHES` is a const array of
 * `{id, label}` brush definitions consumed by:
 *
 *   - `ToolSettingsPanel.jsx` weight-paint section — brush dropdown
 *   - `WeightPaintOverlay.jsx` flushPaint dispatch — switches on
 *     `editorStore.weightPaintBrush`
 *
 * # Brush types
 *
 *   - `'draw'` — lerp toward `editorStore.brushWeight` (Shift inverts
 *     toward 0). The pre-Phase-7.B default; original WeightPaintOverlay
 *     stroke shape.
 *   - `'blur'` — neighbor-mean lerp via `computeBlurUpdates` (this dir).
 *     Smooths weight discontinuities.
 *
 * # Future brushes (NOT in v1)
 *
 * Per `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1562-1583`
 * Blender ships four brush types:
 *
 *   - `WPAINT_BRUSH_TYPE_DRAW`   — implemented as 'draw'
 *   - `WPAINT_BRUSH_TYPE_BLUR`   — implemented as 'blur'
 *   - `WPAINT_BRUSH_TYPE_AVERAGE` — averages all affected vertices to a
 *     single value (different from blur which is per-vertex local). Not
 *     in v1.
 *   - `WPAINT_BRUSH_TYPE_SMEAR`  — drags weight values along stroke
 *     direction. Not in v1.
 *
 * Per Phase 7.B plan §7.B.2 we ship Blur only as the second brush.
 *
 * @module lib/weightPaint/index
 */

/** @type {ReadonlyArray<{id: string, label: string}>} */
export const WEIGHT_BRUSHES = Object.freeze([
  { id: 'draw', label: 'Draw' },
  { id: 'blur', label: 'Blur' },
]);

export { computeBlurUpdates } from './blur.js';
