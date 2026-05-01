// @ts-check

/**
 * In-memory ring buffer for pipeline / rig debug entries.
 *
 * Backs the v3 Logs panel. Pipeline modules (eyeClosureFit, breath
 * warp synth, opacity bind, etc.) push structured entries via
 * `src/lib/logger.js`; the panel reads the array and renders it.
 *
 * Cap is intentionally small — this is for live debugging, not
 * archival logging. When the buffer is full, oldest entries get
 * dropped (FIFO) so new writes never throw or block.
 *
 * Why a separate store from the project — log entries are ephemeral
 * UI/debug state, must NOT persist into save files, must NOT enter
 * the undo history. Keeping it isolated avoids both.
 *
 * @module store/logsStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} LogEntry
 * @property {number} id        Monotonic counter — stable React key.
 * @property {number} ts        Date.now() at push.
 * @property {'debug'|'info'|'warn'|'error'} level
 * @property {string} source    Module / subsystem name. Free-form.
 * @property {string} message   Short human-readable summary.
 * @property {any} [data]       Optional structured payload — rendered
 *                              as JSON in an expandable block.
 */

const DEFAULT_CAP = 500;

let _nextId = 1;

export const useLogsStore = create((set, get) => ({
  /** @type {LogEntry[]} */
  entries: [],

  /** Capacity (entries beyond this get dropped FIFO). */
  cap: DEFAULT_CAP,

  /**
   * Append a log entry. Consumers should prefer `lib/logger.js` over
   * calling this directly so console + store stay in sync.
   * @param {Omit<LogEntry, 'id' | 'ts'>} entry
   */
  push(entry) {
    const id = _nextId++;
    const next = {
      id,
      ts: Date.now(),
      level: entry.level,
      source: entry.source,
      message: entry.message,
      data: entry.data,
    };
    set((s) => {
      const arr = s.entries.length >= s.cap
        ? s.entries.slice(s.entries.length - s.cap + 1)
        : s.entries;
      return { entries: [...arr, next] };
    });
  },

  /** Drop everything. */
  clear() {
    set({ entries: [] });
  },

  /**
   * Adjust ring-buffer cap. Truncates immediately if `n` is smaller
   * than current length.
   * @param {number} n
   */
  setCap(n) {
    if (!Number.isFinite(n) || n < 1) return;
    set((s) => ({
      cap: n,
      entries: s.entries.length > n
        ? s.entries.slice(s.entries.length - n)
        : s.entries,
    }));
  },
}));
