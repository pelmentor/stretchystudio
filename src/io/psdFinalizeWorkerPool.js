// @ts-check

/**
 * Per-PSD-import worker pool for `finalizePsdImport`. Runs each layer's
 * canvas-composite + PNG-encode pipeline in a worker so the main thread
 * stays responsive on 4K/50-layer imports. Lifetime is per-import:
 * created at the start of `finalizePsdImport`, destroyed once all
 * layers have settled.
 *
 * Pool sized to `hardwareConcurrency - 1` (cap 8). FIFO queue.
 *
 * Built on the same shape as `mesh/workerPool.js`. Separate module
 * because the workers run a different job module (PSD-finalize vs
 * mesh-generate); a unified pool would complicate the per-job-shape
 * dispatch logic for a pair that doesn't actually share workers in
 * practice (mesh build runs after PSD finalize completes).
 *
 * @module io/psdFinalizeWorkerPool
 */

const POOL_SIZE = Math.min(
  8,
  Math.max(1, (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4) - 1),
);

/**
 * @typedef {Object} PsdFinalizeJob
 * @property {object} payload                                          - { layerData, layerW, layerH, layerX, layerY, psdW, psdH, layerIndex }
 * @property {(result: any) => void} resolve
 * @property {(err: any) => void} reject
 */

export function createPsdFinalizeWorkerPool() {
  /** @type {Worker[]} */
  const workers = [];
  /** @type {Worker[]} */
  const idle = [];
  /** @type {PsdFinalizeJob[]} */
  const queue = [];
  let destroyed = false;

  function processNext(worker) {
    if (destroyed) return;
    const job = queue.shift();
    if (!job) {
      idle.push(worker);
      return;
    }
    /** @type {any} */ (worker)._currentJob = job;
    worker.postMessage(job.payload);
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const w = new Worker(new URL('./psdFinalize.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const job = /** @type {any} */ (w)._currentJob;
      /** @type {any} */ (w)._currentJob = null;
      if (!job) return;
      if (e.data?.ok) job.resolve(e.data);
      else job.reject(new Error(e.data?.error ?? 'PSD finalize worker failed'));
      processNext(w);
    };
    w.onerror = (err) => {
      const job = /** @type {any} */ (w)._currentJob;
      /** @type {any} */ (w)._currentJob = null;
      if (job) job.reject(err);
      processNext(w);
    };
    workers.push(w);
    idle.push(w);
  }

  return {
    /**
     * @param {{layerData: ArrayBuffer, layerW: number, layerH: number, layerX: number, layerY: number, psdW: number, psdH: number, layerIndex: number}} payload
     */
    enqueue(payload) {
      return new Promise((resolve, reject) => {
        if (destroyed) {
          reject(new Error('PSD finalize worker pool destroyed'));
          return;
        }
        /** @type {PsdFinalizeJob} */
        const job = { payload, resolve, reject };
        const w = idle.pop();
        if (w) {
          /** @type {any} */ (w)._currentJob = job;
          w.postMessage(payload);
        } else {
          queue.push(job);
        }
      });
    },
    destroy() {
      destroyed = true;
      for (const w of workers) {
        try { w.terminate(); } catch { /* worker already gone */ }
      }
      while (queue.length > 0) {
        const job = queue.shift();
        job?.reject(new Error('PSD finalize worker pool destroyed'));
      }
      workers.length = 0;
      idle.length = 0;
    },
  };
}
