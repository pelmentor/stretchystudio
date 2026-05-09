// PSD finalize worker — composites one PSD layer onto a canvas-sized
// OffscreenCanvas, computes its alpha-mask + opaque-pixel bounds, and
// converts the result to a PNG. Returns only small results + the PNG
// arrayBuffer (transferable) so the canvas-sized RGBA never crosses
// the main-thread boundary.
//
// Pooled (see `psdFinalizeWorkerPool.js`) so N layers process in
// parallel across `hardwareConcurrency-1` workers instead of serially
// on the main thread.

import { computeImageBounds } from '../components/canvas/viewport/helpers.js';
import { downsampleAlphaMask } from '../components/canvas/viewport/alphaMask.js';

self.onmessage = async (e) => {
  const { layerData, layerW, layerH, layerX, layerY, psdW, psdH, layerIndex } = e.data || {};
  try {
    // Reconstruct the layer ImageData inside the worker.
    const layerImageData = new ImageData(new Uint8ClampedArray(layerData), layerW, layerH);

    // Composite on a canvas-sized OffscreenCanvas at (layerX, layerY).
    // Mirrors the main-thread original: a tmp canvas at layer
    // dimensions receives the layer pixels via putImageData; drawImage
    // copies them into the canvas-sized off canvas at the layer's
    // (x, y) origin, padding the rest with transparent.
    const off = new OffscreenCanvas(psdW, psdH);
    const ctx = off.getContext('2d');
    const tmp = new OffscreenCanvas(layerW, layerH);
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.putImageData(layerImageData, 0, 0);
    ctx.drawImage(tmp, layerX, layerY);

    const fullImageData = ctx.getImageData(0, 0, psdW, psdH);

    // Derive both small-result outputs from the canvas-sized RGBA.
    // The full RGBA stays inside the worker — transferring back only
    // the mask (256² × 1 byte) + bounds (4 numbers) + PNG drops main-
    // thread memory pressure dramatically vs the original loop's
    // direct use of the full RGBA.
    const alphaMask = downsampleAlphaMask(fullImageData);
    const imageBounds = computeImageBounds(fullImageData);

    const blob = await off.convertToBlob({ type: 'image/png' });
    const pngBuffer = await blob.arrayBuffer();

    self.postMessage(
      { ok: true, layerIndex, alphaMask, imageBounds, pngBuffer },
      [pngBuffer],
    );
  } catch (err) {
    self.postMessage({
      ok: false,
      layerIndex,
      error: err && err.message ? err.message : String(err),
    });
  }
};
