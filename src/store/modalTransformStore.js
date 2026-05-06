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
 *   - `typedBuffer`       — BVR-005: numeric type-in buffer ('', '-12.5', etc).
 *                            Non-empty → overrides mouse delta. Translate
 *                            interprets as canvas-px on active axis; rotate
 *                            as degrees; scale as multiplier.
 *   - `restFrame`         — BVR-004 follow-up: when true, the modal
 *                            session is editing a bone's REST layout
 *                            (transform fields). Otherwise it edits
 *                            pose. Set by `beginModalTransform` from
 *                            `editorStore.editMode === 'armatureEdit'`.
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
 * @property {string} typedBuffer
 * @property {boolean} restFrame
 * @property {(args: {kind: TransformKind, startMouse:{x:number,y:number}, pivotCanvas:{x:number,y:number}, original:Map<string, any>, restFrame?: boolean}) => void} begin
 * @property {(axis: ('x'|'y'|null)) => void} setAxis
 * @property {(ch: string) => void} appendTyped
 * @property {() => void} popTyped
 * @property {() => void} clearTyped
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
  typedBuffer: '',
  restFrame: false,

  begin: ({ kind, startMouse, pivotCanvas, original, restFrame }) =>
    set({ kind, axis: null, startMouse, pivotCanvas, original, committed: false, typedBuffer: '', restFrame: !!restFrame }),

  setAxis: (axis) => set({ axis }),

  /** Append a digit / sign / decimal-point. Validates so the buffer
   *  always parses cleanly: at most one leading '-', at most one '.'. */
  appendTyped: (ch) => set((state) => {
    if (typeof ch !== 'string' || ch.length !== 1) return state;
    const buf = state.typedBuffer ?? '';
    if (ch === '-') {
      if (buf.length > 0) return state; // sign only as leading char
      return { typedBuffer: '-' };
    }
    if (ch === '.') {
      if (buf.includes('.')) return state;
      return { typedBuffer: buf.length === 0 ? '0.' : buf + '.' };
    }
    if (ch >= '0' && ch <= '9') {
      return { typedBuffer: buf + ch };
    }
    return state;
  }),
  /** Backspace: drop last char. */
  popTyped: () => set((state) => ({
    typedBuffer: (state.typedBuffer ?? '').slice(0, -1),
  })),
  clearTyped: () => set({ typedBuffer: '' }),

  commit: () => set({ committed: true, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map(), typedBuffer: '', restFrame: false }),
  cancel: () => set({ committed: false, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map(), typedBuffer: '', restFrame: false }),
  reset:  () => set({ committed: false, kind: null, axis: null, startMouse: null, pivotCanvas: null, original: new Map(), typedBuffer: '', restFrame: false }),
}));
