// @ts-check

/**
 * PP2-010 — live rig-evaluation cache.
 *
 * Sister store to `rigSpecStore` (which holds the static build-time
 * spec). This one carries the *live* outputs of `evalRig` that any
 * non-rendering consumer needs to read — currently just the canvas-px
 * lifted grids that `WarpDeformerOverlay` paints to show the user the
 * full network of warp lattices animated under current params.
 *
 * Distinct from rigSpec because:
 *   - rigSpec changes only on Init Rig / Refit / project load.
 *   - liftedGrids change on every paramValues mutation (60Hz).
 *
 * Volatile: never persisted. Cleared when the rigSpec invalidates.
 *
 * @module store/rigEvalStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} RigEvalState
 * @property {Map<string, Float64Array>|null} liftedGrids
 *   warpId → canvas-px control points (count = (rows+1)*(cols+1) pairs,
 *   stride 2 floats). Null when no eval has run yet, or when the master
 *   `viewLayers.warpGrids` flag is off (CanvasViewport skips collection
 *   to avoid the per-frame Map allocation when the overlay isn't shown).
 * @property {(grids: Map<string, Float64Array>|null) => void} setLiftedGrids
 */

export const useRigEvalStore = create((set) => /** @type {RigEvalState} */ ({
  liftedGrids: null,
  setLiftedGrids: (grids) => set({ liftedGrids: grids }),
}));
