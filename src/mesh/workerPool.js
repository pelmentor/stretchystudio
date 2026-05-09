// @ts-check

/**
 * Long-lived pool of mesh-generator workers. Replaces the prior
 * `new Worker(...)`-per-call pattern that, on `autoMeshAllParts`,
 * span up N simultaneous workers (one per part) all competing for
 * one CPU and re-parsing the mesh module N times. The pool uses
 * `hardwareConcurrency - 1` long-lived workers (cap 8); `enqueue`
 * returns a Promise that resolves with the worker's result.
 *
 * Stale-result handling lives at the call site: the enqueuer keeps a
 * per-partId sequence counter and drops resolutions whose sequence
 * is older than the latest dispatch for that part.
 *
 * @module mesh/workerPool
 */

const POOL_SIZE = Math.min(
  8,
  Math.max(1, (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4) - 1),
);

/**
 * @typedef {Object} MeshJob
 * @property {string} partId
 * @property {ImageData} imageData
 * @property {object} opts
 * @property {(result: any) => void} resolve
 * @property {(err: any) => void} reject
 */

export function createMeshWorkerPool() {
  /** @type {Worker[]} */
  const workers = [];
  /** @type {Worker[]} */
  const idle = [];
  /** @type {MeshJob[]} */
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
    worker.postMessage({ imageData: job.imageData, opts: job.opts });
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const job = /** @type {any} */ (w)._currentJob;
      /** @type {any} */ (w)._currentJob = null;
      if (!job) return;
      if (e.data?.ok) job.resolve(e.data);
      else job.reject(new Error(e.data?.error ?? 'mesh worker failed'));
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
     * @param {string} partId
     * @param {ImageData} imageData
     * @param {object} opts
     */
    enqueue(partId, imageData, opts) {
      return new Promise((resolve, reject) => {
        if (destroyed) {
          reject(new Error('mesh worker pool destroyed'));
          return;
        }
        /** @type {MeshJob} */
        const job = { partId, imageData, opts, resolve, reject };
        const w = idle.pop();
        if (w) {
          /** @type {any} */ (w)._currentJob = job;
          w.postMessage({ imageData, opts });
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
        job?.reject(new Error('mesh worker pool destroyed'));
      }
      workers.length = 0;
      idle.length = 0;
    },
  };
}
