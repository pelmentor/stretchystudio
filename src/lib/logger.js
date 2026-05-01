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
 * Source string is free-form but should match a stable
 * subsystem name so the UI's source-filter dropdown is small and
 * stable. Conventional sources today:
 *
 *   'eyeClosureFit'  — parabola fit per side
 *   'eyeContexts'    — Section 3c rig-warp eye contexts
 *   'breathWarp'     — breath warp synth
 *   'rigInit'        — initRig / armatureOrganizer
 *   'maskAllocator'  — clip mask allocation
 *   'partRender'     — per-part draw decisions (when debugging)
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

export const logger = {
  /** @param {string} source @param {string} message @param {any} [data] */
  debug(source, message, data) { emit('debug', source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  info(source, message, data)  { emit('info',  source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  warn(source, message, data)  { emit('warn',  source, message, data); },
  /** @param {string} source @param {string} message @param {any} [data] */
  error(source, message, data) { emit('error', source, message, data); },
};
