// PSD-import worker. Receives an ArrayBuffer, runs ag-psd's
// `readPsd` (which decompresses every layer's RLE stream — multiple
// hundred-MB allocations on large PSDs), and posts back the flat
// layer list. Lifts the seconds-long decompression off the main
// thread.
//
// One-shot: the spawning code creates a fresh worker per import and
// terminates it after the result arrives.

import { readPsd, initializeCanvas } from 'ag-psd';

// ag-psd's default `createCanvas` throws unless `document` exists —
// `helpers.js:319` only auto-installs the `document.createElement('canvas')`
// factory in the main thread. Even with `useImageData: true`, ag-psd's
// `createImageDataBitDepth` allocates the per-layer buffer through
// `createImageData → createCanvas(1, 1)`, so the throw fires on the
// very first non-zero-area layer. Wire OffscreenCanvas + the native
// `ImageData` constructor (both worker-global) so ag-psd has the
// allocators it expects.
initializeCanvas(
  (w, h) => /** @type {any} */ (new OffscreenCanvas(w, h)),
  (w, h) => new ImageData(w, h),
);

self.onmessage = (e) => {
  const { buffer } = e.data || {};
  if (!buffer) {
    // WORKER-004 — silent return would leave the main-thread Promise
    // hanging forever (src/io/psd.js resolves only on onmessage). Reply
    // so the awaiter rejects loudly.
    self.postMessage({ ok: false, error: 'PSD worker: missing buffer in message payload' });
    return;
  }
  try {
    const psd = readPsd(buffer, { skipLayerImageData: false, useImageData: true });

    /** @type {Array<any>} */
    const layers = [];
    function walk(children) {
      if (!children) return;
      for (const layer of children) {
        if (layer.children) {
          walk(layer.children);
          continue;
        }
        if (!layer.imageData && !layer.canvas) continue;

        const left   = layer.left   ?? 0;
        const top    = layer.top    ?? 0;
        const right  = layer.right  ?? psd.width;
        const bottom = layer.bottom ?? psd.height;
        const w = right  - left;
        const h = bottom - top;
        if (w <= 0 || h <= 0) continue;

        // With `useImageData: true` ag-psd attaches imageData directly
        // (canvas-free path so this code runs identically inside a
        // worker, where `document.createElement('canvas')` isn't
        // available).
        const imageData = layer.imageData;
        if (!imageData) continue;

        layers.push({
          name:      layer.name || `Layer ${layers.length + 1}`,
          x:         left,
          y:         top,
          width:     w,
          height:    h,
          imageData,
          blendMode: layer.blendMode ?? 'normal',
          opacity:   layer.opacity !== undefined ? layer.opacity : 1,
          visible:   !layer.hidden,
        });
      }
    }
    walk(psd.children);
    layers.reverse();

    self.postMessage({ ok: true, width: psd.width, height: psd.height, layers });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
