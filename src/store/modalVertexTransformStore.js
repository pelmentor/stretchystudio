// @ts-check

/**
 * Toolset Plan Phase 5.B — Modal G vertex-translate state.
 *
 * Sister to `modalTransformStore` (which is node-level; writes
 * `node.transform` / `node.pose`). This store is vertex-level: it
 * captures the pre-drag positions of a Set of vertex indices on a
 * single part, then the overlay translates them in lockstep until the
 * user commits or cancels.
 *
 * The store is intentionally narrower than its node-level sister:
 *
 *   - Translate ONLY in v1. Blender's E + R/S mid-modal switch (rotate
 *     / scale of the freshly-extruded ring) is Phase 6+ — needs an
 *     anchor / pivot model that only makes sense once a real pivot
 *     mode (median / individual / cursor) lands per-edit-mode.
 *     Audit D-3: Blender's `TRANSFORM_OT_translate` accepts
 *     `TFM_MODAL_ROTATE` / `TFM_MODAL_RESIZE` mid-modal switches (see
 *     `editors/transform/transform.cc:693-742` for the modal-key
 *     dispatcher). Documented as deferred deviation.
 *   - One part at a time. Multi-part vertex selections aren't a thing
 *     today (editorStore.selectedVertexIndices is per-part); when they
 *     become one, this store generalises to `Map<partId, Set<vertIdx>>`.
 *
 * **rollbackOnCancel.** When set, `cancel()` calls `discardBatch` on
 * `undoHistory` instead of `endBatch`. The pre-batch snapshot pops
 * + restores the pre-modal project state in one swoop — covers BOTH
 * the live drag delta AND any topology change the caller batched
 * before the modal began (Phase 5: extrude opens the batch, runs
 * `applyTopologyOp`, then opens the modal — Esc has to roll back BOTH
 * the topology and the drag). The overlay drives the discardBatch
 * call so this store stays free of cross-module imports.
 *
 * **Audit D-1 — Esc-cancel rolls back the topology too. Blender
 * differs.** Blender's `MESH_OT_extrude_region_move` is a macro
 * operator: extrude exec finishes BEFORE translate begins, then
 * `wm_macro_end` (`windowmanager/intern/wm_operator_type.cc:308-328`)
 * converts the macro return CANCELLED → FINISHED whenever any prior
 * sub-op finished. Result: in Blender, Esc-mid-translate leaves the
 * extruded geometry on top of the source verts (a "doubled-vert"
 * state recoverable via M-menu). SS deliberately diverges so the
 * gesture is atomic (one Esc = "abort the whole thing"). Blender
 * users need to be aware that SS Esc is more aggressive.
 *
 * @module store/modalVertexTransformStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} ModalVertexTransformState
 * @property {('translate')|null} kind
 * @property {string|null} partId
 * @property {('x'|'y'|null)} axis
 * @property {{x:number, y:number}|null} startMouse
 * @property {{x:number, y:number}|null} pivotCanvas
 * @property {Map<number, {x:number, y:number, restX:number, restY:number}>} original
 * @property {Set<number>} vertIndices
 * @property {boolean} committed
 * @property {boolean} rollbackOnCancel
 * @property {string} typedBuffer
 * @property {(args: {kind:'translate', partId:string, startMouse:{x:number,y:number}, pivotCanvas:{x:number,y:number}, original:Map<number, {x:number,y:number,restX:number,restY:number}>, vertIndices:Set<number>, rollbackOnCancel?:boolean}) => void} begin
 * @property {(axis: ('x'|'y'|null)) => void} setAxis
 * @property {(ch: string) => void} appendTyped
 * @property {() => void} popTyped
 * @property {() => void} clearTyped
 * @property {() => void} commit
 * @property {() => void} cancel
 * @property {() => void} reset
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<ModalVertexTransformState>>} */
export const useModalVertexTransformStore = create((set) => ({
  kind: null,
  partId: null,
  axis: null,
  startMouse: null,
  pivotCanvas: null,
  original: new Map(),
  vertIndices: new Set(),
  committed: false,
  rollbackOnCancel: false,
  typedBuffer: '',

  begin: ({ kind, partId, startMouse, pivotCanvas, original, vertIndices, rollbackOnCancel = false }) =>
    set({
      kind, partId, axis: null, startMouse, pivotCanvas,
      original, vertIndices,
      committed: false, rollbackOnCancel, typedBuffer: '',
    }),

  setAxis: (axis) => set({ axis }),

  appendTyped: (ch) => set((state) => {
    if (typeof ch !== 'string' || ch.length !== 1) return state;
    const buf = state.typedBuffer ?? '';
    if (ch === '-') {
      if (buf.length > 0) return state;
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
  popTyped: () => set((state) => ({
    typedBuffer: (state.typedBuffer ?? '').slice(0, -1),
  })),
  clearTyped: () => set({ typedBuffer: '' }),

  commit: () => set({
    committed: true,
    kind: null, partId: null, axis: null, startMouse: null, pivotCanvas: null,
    original: new Map(), vertIndices: new Set(),
    rollbackOnCancel: false, typedBuffer: '',
  }),
  cancel: () => set({
    committed: false,
    kind: null, partId: null, axis: null, startMouse: null, pivotCanvas: null,
    original: new Map(), vertIndices: new Set(),
    rollbackOnCancel: false, typedBuffer: '',
  }),
  reset: () => set({
    committed: false,
    kind: null, partId: null, axis: null, startMouse: null, pivotCanvas: null,
    original: new Map(), vertIndices: new Set(),
    rollbackOnCancel: false, typedBuffer: '',
  }),
}));
