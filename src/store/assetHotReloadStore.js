// @ts-check

/**
 * v3 Phase 5 — runtime state for the asset hot-reload watcher.
 *
 * Only one folder may be linked at a time; starting a new watcher stops
 * the previous one. The watcher itself isn't serialisable, so this lives
 * in its own zustand store rather than `projectStore` (and is not
 * persisted to localStorage / disk).
 *
 * @module store/assetHotReloadStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} HotReloadStatus
 * @property {string|null} folderName
 * @property {number} watchedCount     - how many PNGs are paired with a part
 * @property {Array<string>} unmatched - PNG basenames that didn't match any part
 * @property {number} lastEventAt      - last hot-reload event ms timestamp
 * @property {string|null} message     - last status / error text
 * @property {boolean} pending         - true while pickFolderAndWatch is running
 */

export const useAssetHotReloadStore = create((set, get) => ({
  /** @type {import('../io/assetHotReload.js').HotReloadHandle | null} */
  handle: null,

  /** @type {HotReloadStatus} */
  status: {
    folderName: null,
    watchedCount: 0,
    unmatched: [],
    lastEventAt: 0,
    message: null,
    pending: false,
  },

  setHandle(handle) {
    set((s) => ({
      handle,
      status: {
        ...s.status,
        folderName: handle?.folderName ?? null,
        watchedCount: handle?.entries.length ?? 0,
        unmatched: handle?.unmatched ?? [],
        message: handle == null ? null : s.status.message,
      },
    }));
  },

  setPending(pending) {
    set((s) => ({ status: { ...s.status, pending } }));
  },

  setMessage(message) {
    set((s) => ({ status: { ...s.status, message } }));
  },

  bumpLastEvent() {
    set((s) => ({ status: { ...s.status, lastEventAt: Date.now() } }));
  },

  stop() {
    const h = get().handle;
    if (h) h.stop();
    set((s) => ({
      handle: null,
      status: {
        ...s.status,
        folderName: null,
        watchedCount: 0,
        unmatched: [],
        message: null,
      },
    }));
  },
}));
