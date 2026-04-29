// @ts-check

/**
 * v3 Phase 5 — `.cmo3` inspector modal state.
 *
 * Holds the open flag plus the latest inspection snapshot so the modal
 * can show "drop a file" and "here's what was in the last one" without
 * re-parsing the file every render. Fully ephemeral — not persisted.
 *
 * @module store/cmo3InspectStore
 */

import { create } from 'zustand';

/**
 * @typedef {import('../io/live2d/cmo3Inspect.js').Cmo3Metadata} Cmo3Metadata
 */

/**
 * @typedef {Object} Cmo3InspectState
 * @property {boolean} open
 * @property {Cmo3Metadata|null} result
 * @property {string|null} fileName
 * @property {string|null} error
 * @property {boolean} pending
 * @property {() => void} openInspect
 * @property {() => void} close
 * @property {(name: string) => void} setPending
 * @property {(name: string, result: Cmo3Metadata) => void} setResult
 * @property {(name: string|null, msg: string) => void} setError
 * @property {() => void} reset
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<Cmo3InspectState>>} */
export const useCmo3InspectStore = create((set) => ({
  open: false,
  result: null,
  fileName: null,
  error: null,
  pending: false,
  openInspect: () => set({ open: true }),
  close: () => set({ open: false }),
  setPending: (fileName) => set({ pending: true, fileName, error: null }),
  setResult: (fileName, result) => set({
    pending: false,
    fileName,
    result,
    error: null,
  }),
  setError: (fileName, msg) => set({
    pending: false,
    fileName,
    error: msg,
  }),
  reset: () => set({ result: null, fileName: null, error: null, pending: false }),
}));
