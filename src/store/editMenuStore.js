// @ts-check

/**
 * Toolset Plan Phase 4 — small popover-state store for Edit Mode menus
 * (currently Merge; Dissolve / Subdivide get their own stores when /
 * if they grow popover surfaces).
 *
 * `kind === 'merge'` opens MergeMenu at `cursor` (client-px). Click on
 * a menu item runs the op + closes. Esc / outside-click closes too.
 *
 * @module store/editMenuStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} EditMenuState
 * @property {'merge'|null} kind
 * @property {{x:number, y:number}|null} cursor      - client-px (popover anchor)
 * @property {{x:number, y:number}|null} canvasCursor - canvas-px (mergeAtCursor target)
 * @property {(args: {cursor:{x:number,y:number}, canvasCursor?:{x:number,y:number}|null}) => void} openMerge
 * @property {() => void} close
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<EditMenuState>>} */
export const useEditMenuStore = create((set) => ({
  kind: null,
  cursor: null,
  canvasCursor: null,
  openMerge: ({ cursor, canvasCursor }) =>
    set({ kind: 'merge', cursor, canvasCursor: canvasCursor ?? null }),
  close: () =>
    set({ kind: null, cursor: null, canvasCursor: null }),
}));
