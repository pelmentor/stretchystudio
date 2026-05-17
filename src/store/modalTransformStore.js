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
import { transformInputReducer } from '../lib/modal/transformInputReducer.js';

/**
 * # Shared reducer wrapper (Slice 5.E, 2026-05-16)
 *
 * The `axis`, `typedBuffer`, `numericMode` fields and their setters are
 * proxies for the shared state machine in
 * [src/lib/modal/transformInputReducer.js](../lib/modal/transformInputReducer.js).
 * Validation rules (single leading sign, single decimal, popping at empty
 * exits numericMode, etc.) live there — this store only owns the
 * cross-component publication (Footer + overlay subscribe here; the
 * fcurve modal uses `useTransformModalInput()` for its own per-Plot
 * state but routes through the same reducer).
 *
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
 * @property {(ch: string) => void} appendTypedAuto
 * @property {() => void} popTyped
 * @property {() => void} clearTyped
 * @property {() => void} enterNumericMode
 * @property {() => void} exitNumericMode
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

  /** Direct setter (accepts null). Routes through the shared reducer so
   *  no-op writes return the same state object (skips re-renders for
   *  Footer + overlay subscribers when nothing changed). */
  setAxis: (axis) => set((state) => transformInputReducer(state, { type: 'setAxis', axis })),

  /** Append a digit / sign / decimal-point. Validation rules (single
   *  leading '-', single '.', '0.' for leading '.') live in
   *  `transformInputReducer`. */
  appendTyped: (ch) => set((state) => transformInputReducer(state, { type: 'appendTyped', ch })),

  /** Slice 5.U — `appendTyped` + `enterNumericMode` atomic. Used by
   *  callers when the `USER_FLAG_NUMINPUT_ADVANCED` preference is ON.
   *  See `transformInputReducer.js` module JSDoc. */
  appendTypedAuto: (ch) => set((state) => transformInputReducer(state, { type: 'appendTypedAuto', ch })),

  /** Backspace: drop last char. Pop on an empty buffer with numericMode
   *  set ALSO exits numericMode — see reducer's `popTyped` doc-comment
   *  for the SS-vs-Blender rationale. */
  popTyped: () => set((state) => transformInputReducer(state, { type: 'popTyped' })),

  clearTyped: () => set((state) => transformInputReducer(state, { type: 'clearTyped' })),

  /** Audit-fix sweep (FID-B.3) — `=` is ONE-WAY enable, Ctrl+= disables.
   *  Mirrors Blender's `NUM_EDIT_FULL` flag from
   *  `reference/blender/source/blender/editors/util/numinput.cc:369-378`:
   *  pressing `=` with the flag OFF sets it ON; pressing `=` again
   *  while ON does nothing (falls through). Only `Ctrl+=` clears it.
   *  Earlier `toggleNumericMode` flipped the flag on every press —
   *  fidelity gap closed.
   *
   *  With numericMode true and an empty buffer, the transform is held
   *  at the typed value (defaults to 0 / scale 1) instead of following
   *  the mouse; the user types digits to drive the value precisely. */
  enterNumericMode: () => set((state) => transformInputReducer(state, { type: 'enterNumericMode' })),
  exitNumericMode:  () => set((state) => transformInputReducer(state, { type: 'exitNumericMode' })),

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
