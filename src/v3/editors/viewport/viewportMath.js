// @ts-check

/**
 * Toolset Phase 6 audit fix G-8 — shared viewport math helpers.
 *
 * Pre-fix three identical `clientToCanvas` implementations existed in
 * BoxSelectOverlay, CircleSelectOverlay, and (Phase 6) the operator
 * registry's inner function. All three did the same algebra; drift
 * between them would break selection / hit-test consistency in subtle
 * ways. Centralised here so future pan/zoom semantics changes touch
 * one place.
 *
 * The `view` parameter is the editor-store viewport-tab `view` slot:
 * `{ panX, panY, zoom }`. `rect` is the canvas DOM bounding rect.
 *
 * @module v3/editors/viewport/viewportMath
 */

/**
 * Convert a viewport-px point (window-relative `clientX`/`clientY`)
 * to canvas-space coordinates using a canvas bounding rect plus the
 * active edit-viewport's pan + zoom.
 *
 * @param {{left:number, top:number}} rect
 * @param {{panX:number, panY:number, zoom:number}} view
 * @param {number} clientX
 * @param {number} clientY
 * @returns {[number, number]}  - canvas-space `[x, y]`
 */
export function clientToCanvasXY(rect, view, clientX, clientY) {
  const cx = (clientX - rect.left) / view.zoom - view.panX / view.zoom;
  const cy = (clientY - rect.top)  / view.zoom - view.panY / view.zoom;
  return [cx, cy];
}
