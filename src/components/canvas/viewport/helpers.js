// @ts-check

/**
 * v3 Phase 0F - Viewport pure helpers (extracted from CanvasViewport.jsx).
 *
 * Eight unit-testable utility functions previously buried inside the
 * 2243-LOC CanvasViewport component. None of them touch React, refs,
 * stores, or WebGL - they're parameterised by the data they need.
 *
 * Plan §3 calls for a `src/components/canvas/viewport/` subdirectory
 * that the rest of the god-class split lands under (Shell.jsx,
 * tick.js, operators/, …). This file is the first inhabitant.
 *
 * @module components/canvas/viewport/helpers
 */

/* ── Coordinate conversions ──────────────────────────────────────────── */

/**
 * Convert client coords → canvas-element-relative world coords
 * (image / mesh pixel space).
 *
 * @param {{getBoundingClientRect: () => {left: number, top: number}}} canvas
 * @param {number} clientX
 * @param {number} clientY
 * @param {{zoom: number, panX: number, panY: number}} view
 * @returns {[number, number]}
 */
export function clientToCanvasSpace(canvas, clientX, clientY, view) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left) / view.zoom - view.panX / view.zoom;
  const cy = (clientY - rect.top) / view.zoom - view.panY / view.zoom;
  return [cx, cy];
}

/**
 * Convert a world-space point to a part's local object space using
 * its inverse world matrix. Ensures vertex picking works correctly
 * for rotated / scaled / translated parts.
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {Float32Array|number[]} inverseWorldMatrix - column-major 3×3
 * @returns {[number, number]}
 */
export function worldToLocal(worldX, worldY, inverseWorldMatrix) {
  const m = inverseWorldMatrix;
  return [
    m[0] * worldX + m[3] * worldY + m[6],
    m[1] * worldX + m[4] * worldY + m[7],
  ];
}

/* ── Vertex picking ──────────────────────────────────────────────────── */

/**
 * Find the index of the vertex closest to (x, y) within `radius`.
 * Returns -1 when nothing is within range.
 *
 * @param {Array<{x: number, y: number}>} vertices
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {number}
 */
export function findNearestVertex(vertices, x, y, radius) {
  const r2 = radius * radius;
  let best = -1;
  let bestD = r2;
  for (let i = 0; i < vertices.length; i++) {
    const dx = vertices[i].x - x;
    const dy = vertices[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/* ── Brush math ──────────────────────────────────────────────────────── */

/**
 * Brush falloff weight. `t = dist / radius` (0 = center, 1 = edge).
 *   - hardness=1 → uniform weight=1 inside the brush, 0 outside.
 *   - hardness=0 → smooth cosine falloff from 1 at center → 0 at edge.
 *   - intermediate values blend linearly between hard and soft.
 *
 * @param {number} dist
 * @param {number} radius
 * @param {number} hardness - 0..1
 * @returns {number} 0..1
 */
export function brushWeight(dist, radius, hardness) {
  const t = dist / radius;
  if (t >= 1) return 0;
  const soft = 0.5 * (1 + Math.cos(Math.PI * t));
  return hardness + (1 - hardness) * soft;
}

/* ── ImageData scanning ──────────────────────────────────────────────── */

/**
 * Sample alpha (0-255) at integer pixel coords from an ImageData.
 * Returns 0 for out-of-bounds reads (rather than throwing).
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @param {number} lx
 * @param {number} ly
 * @returns {number}
 */
export function sampleAlpha(imageData, lx, ly) {
  const ix = Math.floor(lx);
  const iy = Math.floor(ly);
  if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) return 0;
  return imageData.data[(iy * imageData.width + ix) * 4 + 3];
}

/**
 * Compute the bounding box of opaque pixels in an ImageData.
 * Returns `{minX, minY, maxX, maxY}` or `null` when no pixel passes
 * the alpha threshold (fully transparent image).
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @param {number} [alphaThreshold=10]
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
 */
export function computeImageBounds(imageData, alphaThreshold = 10) {
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/* ── Filename / mesh defaults ────────────────────────────────────────── */

/**
 * Strip extension from a filename. `"foo.psd"` → `"foo"`. No-op when
 * the input has no extension.
 *
 * @param {string} filename
 * @returns {string}
 */
export function basename(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Compute a zoom-around-cursor view update from a wheel event.
 *
 *   - deltaY < 0 -> zoom in by 1.1x
 *   - deltaY > 0 -> zoom out by 1/1.1
 *   - clamped to [0.05, 20]
 *   - the world point under the cursor stays under the cursor
 *
 * Pure: same inputs always produce the same view.
 *
 * @param {{zoom: number, panX: number, panY: number}} view
 * @param {number} deltaY            - wheel scroll delta
 * @param {number} cursorX           - canvas-relative cursor X
 * @param {number} cursorY           - canvas-relative cursor Y
 * @returns {{zoom: number, panX: number, panY: number}}
 */
export function zoomAroundCursor(view, deltaY, cursorX, cursorY) {
  const factor = deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.max(0.05, Math.min(20, view.zoom * factor));
  const ratio = newZoom / view.zoom;
  const newPanX = cursorX - (cursorX - view.panX) * ratio;
  const newPanY = cursorY - (cursorY - view.panY) * ratio;
  return { zoom: newZoom, panX: newPanX, panY: newPanY };
}

/**
 * Pick reasonable mesh-generation defaults for a part based on its
 * pixel-space bounding box. Larger surfaces get coarser grids and
 * more edge points; transparent parts get a fixed fallback.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} imageBounds
 * @returns {{alphaThreshold: number, smoothPasses: number, gridSpacing: number, edgePadding: number, numEdgePoints: number}}
 */
export function computeSmartMeshOpts(imageBounds) {
  if (!imageBounds) {
    return { alphaThreshold: 5, smoothPasses: 0, gridSpacing: 30, edgePadding: 8, numEdgePoints: 80 };
  }
  const w = imageBounds.maxX - imageBounds.minX;
  const h = imageBounds.maxY - imageBounds.minY;
  const sqrtArea = Math.sqrt(w * h);
  return {
    alphaThreshold: 5,
    smoothPasses: 0,
    gridSpacing: Math.max(6, Math.min(80, Math.round(sqrtArea * 0.08))),
    edgePadding: 8,
    numEdgePoints: Math.max(12, Math.min(300, Math.round(sqrtArea * 0.4))),
  };
}
