// @ts-check

/**
 * M7b — downsampled alpha mask for wizard pre-mesh hit-test.
 *
 * Replaces the 200 MB-class `Map<partId, ImageData>` with canvas-sized
 * RGBA pixels (50 parts × 1024² × 4 bytes) by storing alpha-only
 * `Uint8Array` masks at fixed 256×256 resolution. Each mask is 64 KB;
 * 50 parts × 64 KB = 3.2 MB JS heap, a 60× ceiling drop.
 *
 * Resolution choice. The pre-mesh hit-test runs only during the wizard's
 * Reorder/Adjust steps — coarse positional operations (click a layer to
 * reorder, drag a joint widget) where the user clicks broad regions, not
 * individual pixels. 256² samples each ~16 px on a 4K canvas; well within
 * the user's mouse-target tolerance. Once auto-mesh runs, hit-test takes
 * the triangle path (priority 2 in `hitTestParts`) and the mask is pruned
 * by M7a.
 *
 * Sampler. Nearest-neighbour. Bilinear smoothing of an alpha mask
 * trades sharp edges for ambiguous mid-values around layer borders;
 * the discrete cell index is a clean threshold by design. Boundary
 * misclassification at sub-cell precision is tolerable here — adjacent
 * cells contain the same content for any layer larger than ~32 px on
 * the source canvas.
 *
 * @module components/canvas/viewport/alphaMask
 */

const TARGET_SIZE = 256;

/**
 * @typedef {Object} AlphaMaskRecord
 * @property {Uint8Array} mask        - alpha-only, length = w * h
 * @property {number} w               - downsampled width (≤ TARGET_SIZE)
 * @property {number} h               - downsampled height (≤ TARGET_SIZE)
 * @property {number} srcW            - source canvas width (px)
 * @property {number} srcH            - source canvas height (px)
 */

/**
 * Downsample an `ImageData`-shaped object's alpha channel to a fixed
 * 256×256 (or smaller, preserving aspect) `Uint8Array`. Source must be
 * RGBA-packed at `data[(y*srcW + x)*4 + 3]` per spec.
 *
 * For non-square sources, the larger dimension scales to TARGET_SIZE,
 * the smaller dimension keeps proportional resolution. This avoids the
 * stretch artifacts a fixed 256×256 introduces when the source is
 * landscape/portrait.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @returns {AlphaMaskRecord}
 */
export function downsampleAlphaMask(imageData) {
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data;
  if (srcW <= 0 || srcH <= 0 || !src) {
    return { mask: new Uint8Array(0), w: 0, h: 0, srcW: 0, srcH: 0 };
  }
  // Preserve aspect: larger dim → TARGET_SIZE, smaller dim → proportional.
  const longer = Math.max(srcW, srcH);
  const scale = longer <= TARGET_SIZE ? 1 : TARGET_SIZE / longer;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const mask = new Uint8Array(w * h);
  // Nearest-neighbour: each (mx, my) cell samples the source pixel
  // closest to its center. fx/fy step from src/(w*1) to handle all
  // source resolutions uniformly.
  const fx = srcW / w;
  const fy = srcH / h;
  for (let my = 0; my < h; my++) {
    const sy = Math.min(srcH - 1, Math.floor((my + 0.5) * fy));
    for (let mx = 0; mx < w; mx++) {
      const sx = Math.min(srcW - 1, Math.floor((mx + 0.5) * fx));
      mask[my * w + mx] = src[(sy * srcW + sx) * 4 + 3];
    }
  }
  return { mask, w, h, srcW, srcH };
}

/**
 * Sample a downsampled alpha mask at a source-canvas coordinate.
 * Returns 0..255. Returns 0 when the coordinate is outside the source
 * canvas — caller treats 0 as "no hit" same as the full-resolution path.
 *
 * @param {AlphaMaskRecord} record
 * @param {number} srcX           - canvas-space x in source resolution
 * @param {number} srcY           - canvas-space y in source resolution
 * @returns {number}
 */
export function sampleAlphaMask(record, srcX, srcY) {
  if (!record || record.w <= 0 || record.h <= 0) return 0;
  if (srcX < 0 || srcY < 0 || srcX >= record.srcW || srcY >= record.srcH) return 0;
  const mx = Math.min(record.w - 1, Math.floor((srcX / record.srcW) * record.w));
  const my = Math.min(record.h - 1, Math.floor((srcY / record.srcH) * record.h));
  return record.mask[my * record.w + mx];
}
