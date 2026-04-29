// @ts-check

/**
 * v3 Phase 5 — Export modal open-state.
 *
 * Tiny zustand store toggled by `file.export` operator. The actual
 * modal (`ExportModal.jsx`) is mounted at AppShell level and
 * subscribes to this store, mirroring the libraryDialogStore pattern.
 *
 * @module store/exportModalStore
 */

import { create } from 'zustand';

export const useExportModalStore = create((set) => ({
  open: false,
  openExport: () => set({ open: true }),
  close:      () => set({ open: false }),
}));
