/**
 * Per-rigSpec typed-array pool for the chainEval hot path.
 *
 * Replaces the per-eval `new Float32Array(...)` / `new Float64Array(...)`
 * pattern that dominated GC pressure during slider drags + animation
 * playback. Buffers are keyed by stable producer-supplied strings;
 * each (key, ctor, length) gets a stable buffer that survives across
 * evalRig calls for the same rigSpec.
 *
 * **Buffer-aliasing contract.** The buffer returned for a given key
 * is REUSED on the next acquire of the same key. Producers that flow
 * the buffer out via `frames[i].vertexPositions` (the cache-held EXTERNAL
 * surface) are still safe IFF the consumer reads the buffer in the same
 * tick as the eval that filled it — the rAF tick in CanvasViewport
 * reads `frames` synchronously after the cache decision (hit or miss),
 * so the buffer state is consistent within a tick. Across ticks, a
 * cache miss writes new content to the same buffer; the cache key is
 * updated to the new paramValues in lockstep, so consistency holds.
 *
 * **rigSpec scope.** The module-level WeakMap keyed by rigSpec means
 * each rigSpec instance gets its own pool. When a new rigSpec is
 * built (Init Rig, project load), the old pool is GC'd along with
 * the old rigSpec. Mesh vertex counts within a single rigSpec are
 * stable (set at Init Rig time), so buffer growth doesn't happen
 * mid-rigSpec.
 *
 * @module io/live2d/runtime/evaluator/typedArrayPool
 */

/** @type {WeakMap<object, BufferPool>} */
const _poolByRigSpec = new WeakMap();

export class BufferPool {
  constructor() {
    /** @type {Map<string, Float32Array>} */
    this._float32 = new Map();
    /** @type {Map<string, Float64Array>} */
    this._float64 = new Map();
  }

  /**
   * Get-or-allocate a Float32Array for `key`, of at least `length`.
   * The same key returns the same buffer across calls; on length
   * growth, a fresh larger buffer is allocated and replaces the
   * cached entry.
   * @param {string} key
   * @param {number} length
   * @returns {Float32Array}
   */
  acquireFloat32(key, length) {
    let buf = this._float32.get(key);
    if (!buf || buf.length < length) {
      buf = new Float32Array(length);
      this._float32.set(key, buf);
    }
    return buf;
  }

  /**
   * @param {string} key
   * @param {number} length
   * @returns {Float64Array}
   */
  acquireFloat64(key, length) {
    let buf = this._float64.get(key);
    if (!buf || buf.length < length) {
      buf = new Float64Array(length);
      this._float64.set(key, buf);
    }
    return buf;
  }

  /** Drop every cached buffer. Used by tests; production code lets
   *  the WeakMap GC the pool when the rigSpec is no longer reachable. */
  clear() {
    this._float32.clear();
    this._float64.clear();
  }
}

/**
 * Get the pool associated with a given rigSpec, lazily creating one
 * on first access. Pool lifetime = rigSpec lifetime (WeakMap-keyed,
 * so a new Init Rig produces a fresh rigSpec and a fresh pool; the
 * old pool is GC'd alongside).
 *
 * @param {object} rigSpec
 * @returns {BufferPool}
 */
export function getPoolForRigSpec(rigSpec) {
  let pool = _poolByRigSpec.get(rigSpec);
  if (!pool) {
    pool = new BufferPool();
    _poolByRigSpec.set(rigSpec, pool);
  }
  return pool;
}
