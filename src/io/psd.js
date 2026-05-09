/**
 * PSD import — wraps ag-psd's `readPsd` to produce a flat list of
 * layers. Returns only rasterised layers (those with pixel data);
 * group/folder nodes are walked but not emitted as parts.
 *
 * Decompression runs in a dedicated one-shot worker
 * ([src/io/psd.worker.js](./psd.worker.js)) so the seconds-long RLE
 * decode for big PSDs stays off the main thread.
 *
 * @module io/psd
 */

/**
 * @typedef {Object} PsdLayer
 * @property {string}    name
 * @property {number}    x         - left offset in PSD canvas space
 * @property {number}    y         - top offset in PSD canvas space
 * @property {number}    width
 * @property {number}    height
 * @property {ImageData} imageData - layer-local pixel data
 * @property {string}    blendMode
 * @property {number}    opacity   - 0-1
 * @property {boolean}   visible
 */

/**
 * Parse a PSD ArrayBuffer in a worker.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ width: number, height: number, layers: PsdLayer[] }>}
 */
export function importPsd(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./psd.worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e) => {
      const data = e.data;
      worker.terminate();
      if (!data?.ok) {
        reject(new Error(data?.error ?? 'PSD worker failed'));
        return;
      }
      resolve({ width: data.width, height: data.height, layers: data.layers });
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ buffer });
  });
}
