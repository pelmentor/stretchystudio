// @ts-check

/**
 * v3 Phase 2H — Modal G/R/S transform operator state.
 *
 * Blender-style modal transform: press G/R/S, drag the mouse, click
 * to confirm, Esc to cancel. While modal is active:
 *   - X/Y constrain the axis (toggle).
 *   - Shift snaps to coarse increments.
 *   - Numeric typed input is deferred — the first cut just supports
 *     mouse-only.
 *
 * The store carries:
 *   - `kind`              — 'translate' | 'rotate' | 'scale' | null
 *   - `axis`              — null | 'x' | 'y'
 *   - `startMouse`        — viewport-space pixel coords at activation
 *   - `pivotCanvas`       — canvas-space anchor (mean of selected nodes)
 *   - `original`          — Map<nodeId, originalTransform> for revert
 *   - `committed`         — once true, leaving the modal does not revert
 *
 * The actual mousemove + keydown handling is done by the
 * `ModalTransformOverlay` component mounted at the AppShell level.
 *
 * @module store/modalTransformStore
 */

import { create } from 'zustand';

/**
 * @typedef {('translate'|'rotate'|'scale')} TransformKind
 *
 * @typedef {Object} ModalTransformState
 * @property {TransformKind|null} kind
 * @property {('x'|'y'|null)} axis
 * @property {{x:number, y:number}|null} startMouse
 * @property {{x:number, y:number}|null} pivotCanvas
 * @property {Map<string, any>} original           - nodeId → original transform clone
 * @property {boolean} committed
 * @property {(args: {kind: TransformKind, startMouse:{x:number,y:number}, pivotCanvas:{x:number,y:number}, original:Map<string, any>}) => void} begin
 * @property {(axis: ('x'|'y'|null)) => void} setAxis
 * @property {() => void} commit
 * @property {() => void} cancel
 * @property {() => void} reset
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<ModalTransformState>>} */
export const useModalTransformStore = create((set) => ({
  kind: null,
  axis: null,
  startMouse: null,
  pivotCanvas: null,
  original: new Map(),
  committed: false,

  begin: ({ kind, startMouse, pivotCanvas, original }) =>
    set({ kind, axis: null, startMouse, pivotCanvas, original, committed: false }),

  setAxis: (axis) => set({ axis }),

  commit: () => set({ committed: true, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map() }),
  cancel: () => set({ committed: false, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map() }),
  reset:  () => set({ committed: false, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map() }),
}));
