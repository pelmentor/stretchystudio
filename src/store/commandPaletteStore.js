// @ts-check

/**
 * v3 Phase 3E — Command palette (F3) state.
 *
 * Just an open/close flag. The dialog itself owns the search input,
 * filtered operator list and last-used recents. Recents persist via
 * localStorage so they survive a reload — there is no per-project
 * meaning to a "recently used operator" so a single global key is
 * fine.
 *
 * @module store/commandPaletteStore
 */

import { create } from 'zustand';

const RECENTS_KEY = 'v3.commandPalette.recents';
const RECENTS_CAP = 5;

function loadRecents() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => typeof s === 'string').slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

function saveRecents(arr) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(arr));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

/**
 * @typedef {Object} CommandPaletteState
 * @property {boolean} open
 * @property {string[]} recents       - operator ids, most-recent first
 * @property {() => void} openPalette
 * @property {() => void} close
 * @property {() => void} toggle
 * @property {(opId: string) => void} markUsed
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<CommandPaletteState>>} */
export const useCommandPaletteStore = create((set) => ({
  open: false,
  recents: loadRecents(),
  openPalette: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  markUsed: (opId) => set((s) => {
    if (!opId) return s;
    const next = [opId, ...s.recents.filter((id) => id !== opId)].slice(0, RECENTS_CAP);
    saveRecents(next);
    return { recents: next };
  }),
}));
