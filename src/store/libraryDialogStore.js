// @ts-check

/**
 * v3 Phase 1G — Library dialog open-state.
 *
 * Tiny zustand store toggled by `file.saveToLibrary` /
 * `file.loadFromLibrary` operators. The actual modal
 * (`LibraryDialog.jsx`) is mounted at the AppShell level and
 * subscribes to this store; the dialog itself owns its internal
 * picker / name-field state. Keeping this store dumb means the
 * operator can fire from anywhere (toolbar, future menu, future
 * keymap) without coupling the modal's lifecycle to its trigger.
 *
 * @module store/libraryDialogStore
 */

import { create } from 'zustand';

/** @typedef {('save'|'load'|null)} LibraryDialogMode */

export const useLibraryDialogStore = create((set) => ({
  /** @type {LibraryDialogMode} */
  mode: null,

  openSave: () => set({ mode: 'save' }),
  openLoad: () => set({ mode: 'load' }),
  close:    () => set({ mode: null }),
}));
