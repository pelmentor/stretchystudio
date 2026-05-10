// @ts-check

/**
 * Toolset Plan Phase 4 + Phase 6 — small popover-state store for Edit
 * Mode menus. Currently hosts Merge (Phase 4) and Apply (Phase 6).
 *
 * Each kind opens a different menu component anchored at `cursor`
 * (client-px). Click on a menu item runs the op + closes. Esc /
 * outside-click closes too. Both menus share this single store so the
 * AppShell mounts them behind a discriminated union (`kind`).
 *
 * @module store/editMenuStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} EditMenuState
 * @property {'merge'|'apply'|null} kind
 * @property {{x:number, y:number}|null} cursor      - client-px (popover anchor)
 * @property {{x:number, y:number}|null} canvasCursor - canvas-px (mergeAtCursor target)
 * @property {(args: {cursor:{x:number,y:number}, canvasCursor?:{x:number,y:number}|null}) => void} openMerge
 * @property {(args: {cursor:{x:number,y:number}}) => void} openApply
 * @property {() => void} close
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<EditMenuState>>} */
export const useEditMenuStore = create((set) => ({
  kind: null,
  cursor: null,
  canvasCursor: null,
  openMerge: ({ cursor, canvasCursor }) =>
    set({ kind: 'merge', cursor, canvasCursor: canvasCursor ?? null }),
  openApply: ({ cursor }) =>
    set({ kind: 'apply', cursor, canvasCursor: null }),
  close: () =>
    set({ kind: null, cursor: null, canvasCursor: null }),
}));
