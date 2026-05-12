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

import { logger } from '../lib/logger.js';

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
  // Cover the worker round-trip — RLE decompression for multi-MB PSDs
  // takes seconds and was uninstrumented in the Stage 0 sweep. Without
  // this, the Logs panel shows `psdImport:finalize: 1200ms` but the
  // wall-clock from "select file" → "wizard ready" is dominated by the
  // pre-finalize decode that finishes here.
  logger.time('psdImport', 'workerDecode');
  const bufferBytes = buffer?.byteLength ?? 0;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./psd.worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e) => {
      const data = e.data;
      worker.terminate();
      if (!data?.ok) {
        logger.timeEndIfRunning('psdImport', 'workerDecode', { bufferBytes, error: data?.error ?? 'PSD worker failed' });
        reject(new Error(data?.error ?? 'PSD worker failed'));
        return;
      }
      logger.timeEnd('psdImport', 'workerDecode', {
        bufferBytes,
        psd: { w: data.width, h: data.height },
        layers: Array.isArray(data.layers) ? data.layers.length : 0,
      });
      resolve({ width: data.width, height: data.height, layers: data.layers });
    };
    worker.onerror = (err) => {
      worker.terminate();
      logger.timeEndIfRunning('psdImport', 'workerDecode', { bufferBytes, error: err?.message ?? String(err) });
      reject(err);
    };
    worker.postMessage({ buffer });
  });
}
