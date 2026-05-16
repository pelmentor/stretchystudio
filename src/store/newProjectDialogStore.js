// @ts-check

/**
 * v3 — New Project dialog open-state.
 *
 * Tiny zustand store toggled by `file.new` operator. The dialog
 * (`NewProjectDialog.jsx`) mounts at the AppShell level (Topbar
 * actually, since Topbar already lazy-mounts it) and subscribes here.
 * Mirrors the libraryDialogStore / exportModalStore pattern so the
 * menu, keymap chord (Ctrl+N), and command palette all share the
 * same UX (template picker + dirty warning) instead of branching
 * between silent-reset and dialog-open paths.
 *
 * Before this store, the operator silently called `resetProject()`
 * while the topbar strip button opened the dialog directly via local
 * `useState` — a pre-existing inconsistency that hid the unsaved-
 * changes warning from chord users.
 *
 * @module store/newProjectDialogStore
 */

import { create } from 'zustand';

export const useNewProjectDialogStore = create((set) => ({
  /** @type {boolean} */
  open: false,

  openDialog: () => set({ open: true  }),
  close:      () => set({ open: false }),
}));
