// @ts-check

/**
 * Structured logger. Pushes to `useLogsStore` (the in-app Logs panel)
 * AND mirrors to `console.<level>` so the browser DevTools console
 * still shows everything for downloading / breakpointing.
 *
 * Use at any pipeline boundary where the in-app debugger benefits
 * from seeing structured data. Examples:
 *
 *   logger.info('eyeClosureFit', 'side l fit', { sampleSource, a, b, c });
 *   logger.warn('breathWarp', 'no torso geometry — falling back to head');
 *   logger.error('rigInit', 'mask allocator out of stencil bits');
 *
 * # Timing helpers
 *
 * For loading-time instrumentation, prefer `logger.time(source, label)` +
 * `logger.timeEnd(source, label, data?)` (or the `logger.timed(source,
 * label, fn, data?)` async wrapper) over hand-rolled `performance.now()`.
 * This keeps every timer in the same Logs-panel filter, uses one canonical
 * `{ ms }` data key, and warns loudly on mismatched start/end pairs (per
 * Rule №1 — no silent fallback if a timer is misused).
 *
 *   logger.time('initRig', 'authored-path');
 *   ...do work...
 *   logger.timeEnd('initRig', 'authored-path', { parts: 24 });
 *   // → INFO [initRig] authored-path: 187ms { ms: 187, parts: 24 }
 *
 *   await logger.timed('export', 'cmo3', async () => generateCmo3(...));
 *
 * Source string is free-form but should match a stable
 * subsystem name so the UI's source-filter dropdown is small and
 * stable. Conventional sources today:
 *
 *   'eyeClosureFit'  — parabola fit per side
 *   'eyeContexts'    — Section 3c rig-warp eye contexts
 *   'breathWarp'     — breath warp synth
 *   'rigInit'        — initRig / armatureOrganizer
 *   'rigStageRun'    — Re-Rig per-stage refit
 *   'maskAllocator'  — clip mask allocation
 *   'partRender'     — per-part draw decisions (when debugging)
 *   'boot'           — App boot / mount
 *   'projectLoad'    — `.stretch` deserialize
 *   'projectSave'    — `.stretch` serialize
 *   'psdImport'      — PSD wizard finalize
 *   'export'         — generate{Cmo3,Moc3,Can3,Model3,Cdi3,Physics3,Motion3}
 *   'migrations'     — migrateProject walker
 *   'lazyLoad'       — Phase A2 lazy-import resolution
 *   'depgraph'       — depgraph build / cold-start
 *
 * @module lib/logger
 */

import { useLogsStore } from '../store/logsStore.js';

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

const CONSOLE_FN = {
  debug: 'debug',
  info:  'log',
  warn:  'warn',
  error: 'error',
};

/**
 * Monotonic clock. `performance.now()` in browser; `Date.now()` in Node
 * (test env). Both return ms, both are monotonic-enough for our purposes.
 * @returns {number}
 */
function _now() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

/**
 * Active timer registry. Keyed by `${source}:${label}` so concurrent
 * timers across different sources don't collide. Per Rule №1: explicit
 * warn on overwrite or unmatched end — never silent.
 *
 * @type {Map<string, number>}
 */
const _timers = new Map();

/**
 * @param {LogLevel} level
 * @param {string} source
 * @param {string} message
 * @param {any} [data]
 */
function emit(level, source, message, data) {
  // Push to the in-app store. Wrapped because zustand's setState can
  // throw if called during render — we never want a logger to crash
  // its caller, so swallow.
  try {
    useLogsStore.getState().push({ level, source, message, data });
  } catch (_err) {
    /* never let logging break the pipeline */
  }
  // Mirror to the browser console for DevTools / hard-stop debugging.
  // Tag the source so it's grep-able in console too.
  if (typeof console !== 'undefined') {
    const fn = CONSOLE_FN[level] ?? 'log';
    if (data !== undefined) {
      console[fn](`[${source}] ${message}`, data);
    } else {
      console[fn](`[${source}] ${message}`);
    }
  }
}

/**
 * Start a timer. Pair with `logger.timeEnd(source, label, data?)`.
 * Per Rule №1: warns loudly if a timer with the same key is already
 * running (overwrites the start, but tells you).
 *
 * @param {string} source
 * @param {string} label
 */
function time(source, label) {
  const key = `${source}:${label}`;
  if (_timers.has(key)) {
    emit('warn', source, `time(${label}): timer already running — overwriting start`);
  }
  _timers.set(key, _now());
}

/**
 * End a timer started by `logger.time(source, label)`. Emits an INFO
 * entry with `{ ms, ...data }` and returns the rounded duration in ms.
 *
 * Per Rule №1: if no matching `time()` was called (typo, double-end),
 * emits a WARN and returns `null` rather than silently swallowing.
 *
 * @param {string} source
 * @param {string} label
 * @param {object} [data]            Extra structured payload (counts, sizes, etc.)
 * @param {string} [customMessage]   Override the default `"<label>: <ms>ms"` —
 *                                   use when the panel benefits from rich
 *                                   human-readable text (e.g. "download OK:
 *                                   14p / 8d / 12params"). The `ms` value
 *                                   stays in `data` either way.
 * @returns {number|null}
 */
function timeEnd(source, label, data, customMessage) {
  const key = `${source}:${label}`;
  const t0 = _timers.get(key);
  if (t0 === undefined) {
    emit('warn', source, `timeEnd(${label}): no matching time() call`);
    return null;
  }
  _timers.delete(key);
  const ms = Math.round(_now() - t0);
  const message = customMessage ?? `${label}: ${ms}ms`;
  emit('info', source, message, data ? { ms, ...data } : { ms });
  return ms;
}

/**
 * Run an async (or sync) function and time it. Returns the function's
 * resolved value. The timer ALWAYS ends — even if `fn` throws — and
 * the original error re-throws unchanged.
 *
 * Use when the work is expressible as a single function (export step,
 * lazy-import resolution, etc.). For multi-stage flows where you want
 * intermediate `logger.info` calls between start and end, use the
 * `time` / `timeEnd` pair directly.
 *
 * @template T
 * @param {string} source
 * @param {string} label
 * @param {() => T | Promise<T>} fn
 * @param {object} [data]
 * @returns {Promise<T>}
 */
async function timed(source, label, fn, data) {
  time(source, label);
  try {
    return await fn();
  } finally {
    timeEnd(source, label, data);
  }
}

export const logger = {
  /** @param {string} source @param {string} message @param {any} [data] */
  debug(source, message, data) { emit('debug', source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  info(source, message, data)  { emit('info',  source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  warn(source, message, data)  { emit('warn',  source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  error(source, message, data) { emit('error', source, message, data); },
  time,
  timeEnd,
  timed,
};
