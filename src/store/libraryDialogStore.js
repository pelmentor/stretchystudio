// @ts-check

/**
 * v3 Phase 1G — Library dialog open-state.
 *
 * Tiny zustand store toggled by `file.save` / `file.saveAs` /
 * `file.load` operators. The actual modals (`SaveModal.jsx` /
 * `LoadModal.jsx`) mount at the AppShell level and subscribe to
 * this store; they own their internal picker / name-field state.
 * Keeping this store dumb means an operator can fire from anywhere
 * (toolbar, file menu, future keymap) without coupling the modal's
 * lifecycle to its trigger.
 *
 * `saveAs` differentiates Save (Ctrl+S — overwrites linked record)
 * from Save As (Ctrl+Shift+S — always creates a fresh record under
 * a typed name). Mirrors Blender's `wm.save_mainfile` vs
 * `wm.save_as_mainfile` (`space_topbar.py:172-180`). Cleared on
 * `close()` so the next openSave() defaults back to overwrite mode.
 *
 * @module store/libraryDialogStore
 */

import { create } from 'zustand';

/** @typedef {('save'|'load'|null)} LibraryDialogMode */

export const useLibraryDialogStore = create((set) => ({
  /** @type {LibraryDialogMode} */
  mode: null,

  /** When true, SaveModal treats the save as Save As: skips the
   *  autofill from `currentLibraryId`'s record name and always passes
   *  `null` as the target id (= create new record). */
  saveAs: false,

  openSave:   () => set({ mode: 'save', saveAs: false }),
  openSaveAs: () => set({ mode: 'save', saveAs: true  }),
  openLoad:   () => set({ mode: 'load', saveAs: false }),
  close:      () => set({ mode: null,   saveAs: false }),
}));
