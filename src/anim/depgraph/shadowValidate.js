// @ts-check

/**
 * Shadow depgraph validator — production-side parity check.
 *
 * V2 final wire (2026-05-07). When `preferences.evalEngine` is
 * `'depgraph'`, CanvasViewport calls `runShadowDepgraphTick` after
 * each evalRig pass. The depgraph builds + evals against the same
 * project + paramValues snapshot, and per-warp lifted-grid outputs
 * are diffed against chainEval's lifted grids that
 * `evalRig({ out: { liftedGrids } })` already collected.
 *
 * Divergences are logged via the in-app `logger` (Logs panel) the
 * first time they appear in a session — not per-frame, so a
 * persistent gap doesn't drown the panel. Diffs reset their
 * "flared" flag when the user toggles the engine flag, so a clean
 * run after a fix can re-flare a regression later.
 *
 * The visual tick stays on chainEval; this is shadow-only. Flipping
 * the default `evalEngine` to `'depgraph'` is the next-phase change
 * gated on a clean shadow soak.
 *
 * @module anim/depgraph/shadowValidate
 */
import { buildDepGraph } from './build.js';
import { evalDepGraph } from './eval.js';
import { logger } from '../../lib/logger.js';

/**
 * Module-scoped throttle + flare bookkeeping. The validator is called
 * once per CanvasViewport eval-cache miss; this gate caps actual
 * depgraph build+eval work to roughly the configured cadence even
 * under continuous param scrubs.
 */
/** Sentinel — `null` means "no run yet, free-pass the next call". A
 *  zero `_lastRunMs` would otherwise throttle the first call early in
 *  a process lifetime where `performance.now() < intervalMs`. */
let _lastRunMs = /** @type {number | null} */ (null);
let _lastRunSeenProject = null;
let _flared = false;

/**
 * Reset the flare so the next divergence re-logs. CanvasViewport
 * calls this when the user flips `evalEngine` so a clean run after
 * a fix can flare again.
 */
export function resetShadowFlare() {
  _flared = false;
  _lastRunMs = null;
  _lastRunSeenProject = null;
}

/**
 * @typedef {object} ShadowDivergence
 * @property {string}  deformerId
 * @property {('shape'|'value'|'missing-chain'|'missing-dep')} kind
 * @property {number}  [delta]
 * @property {number}  [chainLen]
 * @property {number}  [depLen]
 *
 * @typedef {object} ShadowResult
 * @property {boolean} ran            - false if throttled
 * @property {number}  warpsCompared
 * @property {number}  divergenceCount
 * @property {ShadowDivergence[]} [divergences]
 * @property {number}  [chainEvalSkippedMs]
 * @property {number}  [depgraphMs]
 */

/**
 * Run one shadow depgraph pass and diff its lifted grids against
 * chainEval's. Throttled to `intervalMs` (default 1000 ms); calls
 * within the throttle window return `{ ran: false, ... }`.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {Record<string, number>} paramValues - same snapshot evalRig saw
 * @param {Map<string, Float64Array | Float32Array> | null | undefined} chainLifted
 *   The map evalRig populated this frame (`opts.out.liftedGrids`).
 *   Null/empty disables comparison — we still build+eval the depgraph
 *   so its compile path stays warm, but no divergence count.
 * @param {{ intervalMs?: number, tol?: number }} [opts]
 * @returns {ShadowResult}
 */
export function runShadowDepgraphTick(project, paramValues, chainLifted, opts) {
  const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
  const interval = opts?.intervalMs ?? 1000;
  if (project !== _lastRunSeenProject) {
    // Reset the throttle on project identity change — first frame after
    // load gets a free pass so the user sees any structural divergence
    // without waiting for the throttle window.
    _lastRunMs = null;
    _lastRunSeenProject = project;
  }
  if (_lastRunMs !== null && now - _lastRunMs < interval) {
    return { ran: false, warpsCompared: 0, divergenceCount: 0 };
  }
  _lastRunMs = now;

  const tol = opts?.tol ?? 1e-6;
  const t0 = now;
  const graph = buildDepGraph(project, {});
  const overrides = new Map(Object.entries(paramValues ?? {}));
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: overrides });
  const depMs = ((typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now()) - t0;

  // Pull lifted grids out of the depgraph outputs map.
  /** @type {Map<string, Float64Array | Float32Array>} */
  const depLifted = new Map();
  for (const [name, value] of ctx.outputs) {
    if (typeof name !== 'string') continue;
    if (!name.endsWith('/GEOMETRY/GRID_LIFT_TO_PARENT')) continue;
    if (!value?.lifted) continue;
    depLifted.set(name.split('/')[0], value.lifted);
  }

  if (!chainLifted || chainLifted.size === 0) {
    // No reference to compare against this frame (warp overlay hidden).
    return { ran: true, warpsCompared: 0, divergenceCount: 0, depgraphMs: depMs };
  }

  /** @type {ShadowDivergence[]} */
  const divergences = [];
  const ids = new Set([...chainLifted.keys(), ...depLifted.keys()]);
  for (const id of ids) {
    const a = chainLifted.get(id);
    const b = depLifted.get(id);
    if (!a) {
      divergences.push({ deformerId: id, kind: 'missing-chain', depLen: b?.length ?? 0 });
      continue;
    }
    if (!b) {
      divergences.push({ deformerId: id, kind: 'missing-dep', chainLen: a.length });
      continue;
    }
    if (a.length !== b.length) {
      divergences.push({
        deformerId: id, kind: 'shape',
        chainLen: a.length, depLen: b.length,
      });
      continue;
    }
    let m = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > m) m = d;
    }
    if (m > tol) {
      divergences.push({ deformerId: id, kind: 'value', delta: m });
    }
  }

  if (divergences.length > 0 && !_flared) {
    _flared = true;
    logger.warn(
      'depgraphShadowDivergence',
      `Depgraph diverged from chainEval on ${divergences.length} deformer(s) (warps compared: ${ids.size}). First flag of session.`,
      {
        warpsCompared: ids.size,
        divergenceCount: divergences.length,
        sample: divergences.slice(0, 5),
        depgraphMs: depMs,
      },
    );
  } else if (divergences.length === 0 && _flared) {
    _flared = false;
    logger.info(
      'depgraphShadowClean',
      `Depgraph back in agreement with chainEval (warps compared: ${ids.size}).`,
      { warpsCompared: ids.size, depgraphMs: depMs },
    );
  }

  return {
    ran: true,
    warpsCompared: ids.size,
    divergenceCount: divergences.length,
    divergences: divergences.length > 0 ? divergences : undefined,
    depgraphMs: depMs,
  };
}
