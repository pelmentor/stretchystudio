// @ts-check

/**
 * Toolset Plan Phase 4 + Phase 6 + Phase 7 — small popover-state store
 * for Edit / Object Mode menus. Currently hosts Merge (Phase 4), Apply
 * (Phase 6), Snap (Phase 7.A.1), Mirror axis-pick (Phase 7.A.2), and
 * Clear-Parent (Phase 7.A.4).
 *
 * Each kind opens a different menu component anchored at `cursor`
 * (client-px). Click on a menu item runs the op + closes. Esc /
 * outside-click closes too. Menus share this single store so the
 * AppShell mounts them behind a discriminated union (`kind`).
 *
 * @module store/editMenuStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} EditMenuState
 * @property {'merge'|'apply'|'snap'|'mirrorAxis'|'clearParent'|'setOrigin'|null} kind
 * @property {{x:number, y:number}|null} cursor      - client-px (popover anchor)
 * @property {{x:number, y:number}|null} canvasCursor - canvas-px (mergeAtCursor target)
 * @property {(args: {cursor:{x:number,y:number}, canvasCursor?:{x:number,y:number}|null}) => void} openMerge
 * @property {(args: {cursor:{x:number,y:number}}) => void} openApply
 * @property {(args: {cursor:{x:number,y:number}}) => void} openSnap
 * @property {(args: {cursor:{x:number,y:number}}) => void} openMirrorAxis
 * @property {(args: {cursor:{x:number,y:number}}) => void} openClearParent
 * @property {(args: {cursor:{x:number,y:number}}) => void} openSetOrigin
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
  openSnap: ({ cursor }) =>
    set({ kind: 'snap', cursor, canvasCursor: null }),
  openMirrorAxis: ({ cursor }) =>
    set({ kind: 'mirrorAxis', cursor, canvasCursor: null }),
  openClearParent: ({ cursor }) =>
    set({ kind: 'clearParent', cursor, canvasCursor: null }),
  openSetOrigin: ({ cursor }) =>
    set({ kind: 'setOrigin', cursor, canvasCursor: null }),
  close: () =>
    set({ kind: null, cursor: null, canvasCursor: null }),
}));
