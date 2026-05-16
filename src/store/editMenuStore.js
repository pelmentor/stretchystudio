// @ts-check

/**
 * Toolset Plan Phase 4 + Phase 6 + Phase 7 — small popover-state store
 * for Edit / Object Mode menus. Currently hosts Merge (Phase 4), Apply
 * (Phase 6), Snap (Phase 7.A.1), Mirror axis-pick (Phase 7.A.2),
 * Clear-Parent (Phase 7.A.4), and the per-`editMode` canvas RMB context
 * menu (Audit 4 #2, 2026-05-16).
 *
 * Each kind opens a different menu component anchored at `cursor`
 * (client-px). Click on a menu item runs the op + closes. Esc /
 * outside-click closes too. Menus share this single store so the
 * AppShell mounts them behind a discriminated union (`kind`).
 *
 * The `canvasContextMenu` kind dispatches its visible items off
 * `editorStore.editMode` (Object / Edit / Pose / Weight Paint) like
 * Blender's `VIEW3D_MT_<mode>_context_menu` family
 * (`reference/blender/scripts/startup/bl_ui/space_view3d.py:2943`
 * Object · `:4409` Pose · `:4565` Edit Mesh · `:8836` Paint Weight).
 *
 * @module store/editMenuStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} EditMenuState
 * @property {'merge'|'apply'|'snap'|'mirrorAxis'|'clearParent'|'setOrigin'|'canvasContextMenu'|null} kind
 * @property {{x:number, y:number}|null} cursor      - client-px (popover anchor)
 * @property {{x:number, y:number}|null} canvasCursor - canvas-px (mergeAtCursor target)
 * @property {(args: {cursor:{x:number,y:number}, canvasCursor?:{x:number,y:number}|null}) => void} openMerge
 * @property {(args: {cursor:{x:number,y:number}}) => void} openApply
 * @property {(args: {cursor:{x:number,y:number}}) => void} openSnap
 * @property {(args: {cursor:{x:number,y:number}}) => void} openMirrorAxis
 * @property {(args: {cursor:{x:number,y:number}}) => void} openClearParent
 * @property {(args: {cursor:{x:number,y:number}}) => void} openSetOrigin
 * @property {(args: {cursor:{x:number,y:number}}) => void} openCanvasContextMenu
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
  openCanvasContextMenu: ({ cursor }) =>
    set({ kind: 'canvasContextMenu', cursor, canvasCursor: null }),
  close: () =>
    set({ kind: null, cursor: null, canvasCursor: null }),
}));
