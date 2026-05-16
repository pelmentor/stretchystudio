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
 *
 * Modal G/R/S always writes pose-shape values for bones (rest editing
 * was a separate Armature Edit Mode in earlier versions; that mode
 * was collapsed into Pose Mode 2026-05-06).
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
 * @typedef {Object} LiveDelta
 * @property {number} dx     - canvas-px translate X
 * @property {number} dy     - canvas-px translate Y
 * @property {number} dRot   - radians rotation
 * @property {number} scale  - multiplier (1 = no change)
 *
 * @typedef {Object} ModalTransformState
 * @property {TransformKind|null} kind
 * @property {('x'|'y'|null)} axis
 * @property {{x:number, y:number}|null} startMouse
 * @property {{x:number, y:number}|null} pivotCanvas
 * @property {Map<string, any>} original           - nodeId → original transform clone
 * @property {boolean} committed
 * @property {string} typedBuffer
 * @property {boolean} numericMode  - Audit 4 #4: `=` toggles explicit
 *                                    numeric input mode; mouse delta is
 *                                    suppressed (typed value drives the
 *                                    transform, defaults to 0 if buffer
 *                                    empty). Mirrors Blender's
 *                                    `NUM_EDIT_FULL` flag toggled by `=`
 *                                    in `numinput.cc:367-380`.
 * @property {LiveDelta} liveDelta  - Audit 4 #4: HUD always-visible
 *                                    delta. Updated per mousemove by the
 *                                    overlay's applyDelta so the user
 *                                    sees the live numeric value even
 *                                    without typing.
 * @property {(args: {kind: TransformKind, startMouse:{x:number,y:number}, pivotCanvas:{x:number,y:number}, original:Map<string, any>}) => void} begin
 * @property {(axis: ('x'|'y'|null)) => void} setAxis
 * @property {(ch: string) => void} appendTyped
 * @property {() => void} popTyped
 * @property {() => void} clearTyped
 * @property {() => void} toggleNumericMode
 * @property {(d: LiveDelta) => void} setLiveDelta
 * @property {() => void} commit
 * @property {() => void} cancel
 * @property {() => void} reset
 */

/** Frozen empty state for liveDelta — same instance reused so the
 *  `useStore((s) => s.liveDelta)` selector returns a stable ref when
 *  nothing is dragging. */
const ZERO_DELTA = Object.freeze({ dx: 0, dy: 0, dRot: 0, scale: 1 });

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<ModalTransformState>>} */
export const useModalTransformStore = create((set) => ({
  kind: null,
  axis: null,
  startMouse: null,
  pivotCanvas: null,
  original: new Map(),
  committed: false,
  typedBuffer: '',
  numericMode: false,
  liveDelta: ZERO_DELTA,

  begin: ({ kind, startMouse, pivotCanvas, original }) =>
    set({
      kind, axis: null, startMouse, pivotCanvas, original,
      committed: false, typedBuffer: '', numericMode: false,
      liveDelta: ZERO_DELTA,
    }),

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
  /** Backspace: drop last char. If buffer becomes empty AND numericMode
   *  was set explicitly via `=`, also turn numericMode off so the modal
   *  releases back to mouse-driven (one extra Backspace exits numeric
   *  mode rather than leaving the user stuck with a 0-locked transform). */
  popTyped: () => set((state) => {
    const next = (state.typedBuffer ?? '').slice(0, -1);
    if (next.length === 0 && state.numericMode) {
      return { typedBuffer: '', numericMode: false };
    }
    return { typedBuffer: next };
  }),
  clearTyped: () => set({ typedBuffer: '' }),

  /** Audit 4 #4 — `=` toggles explicit numeric-input mode. Mirrors
   *  Blender's `NUM_EDIT_FULL` flag from `numinput.cc:367-380`. With
   *  numericMode true and an empty buffer, the transform is held at
   *  the typed value (defaults to 0) instead of following the mouse;
   *  the user types digits to drive the value precisely. */
  toggleNumericMode: () => set((state) => ({ numericMode: !state.numericMode })),

  /** Audit 4 #4 — applyDelta publishes the post-snap, post-precision
   *  delta here so the HUD can render it always-visible (not just when
   *  the user is typing). Called per mousemove tick. */
  setLiveDelta: (d) => set({ liveDelta: d }),

  commit: () => set({
    committed: true, kind: null, axis: null, startMouse: null,
    pivotCanvas: null, original: new Map(), typedBuffer: '',
    numericMode: false, liveDelta: ZERO_DELTA,
  }),
  cancel: () => set({
    committed: false, kind: null, axis: null, startMouse: null,
    pivotCanvas: null, original: new Map(), typedBuffer: '',
    numericMode: false, liveDelta: ZERO_DELTA,
  }),
  reset: () => set({
    committed: false, kind: null, axis: null, startMouse: null,
    pivotCanvas: null, original: new Map(), typedBuffer: '',
    numericMode: false, liveDelta: ZERO_DELTA,
  }),
}));
