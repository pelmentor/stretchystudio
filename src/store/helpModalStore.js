// @ts-check

/**
 * v3 Phase 4E — Help modal state.
 *
 * Just an open flag. The modal body is static content; future
 * iterations could swap content based on the active editor (real
 * "context help"), but the first cut is a single quick-reference.
 *
 * @module store/helpModalStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} HelpModalState
 * @property {boolean} open
 * @property {() => void} openHelp
 * @property {() => void} close
 * @property {() => void} toggle
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<HelpModalState>>} */
export const useHelpModalStore = create((set) => ({
  open: false,
  openHelp: () => set({ open: true }),
  close:    () => set({ open: false }),
  toggle:   () => set((s) => ({ open: !s.open })),
}));
