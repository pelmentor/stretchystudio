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
 * R2 (2026-05-09) — the actual `Map<warpId, Float64Array>` lives in
 * a module-scope ref, NOT in the Zustand state. The store carries
 * only `liftedGridsRevision`, a counter that bumps when the grids'
 * contents have materially changed (epsilon-deltaed control points
 * or set-of-warp-ids change). Subscribers use the revision as their
 * trigger and read the live grids via `getLiftedGrids()`. Without
 * this gate, the per-frame `setLiftedGrids(new Map())` from
 * CanvasViewport's eval-cache-miss path was a 60Hz broadcast to
 * every store subscriber even when no control point had moved.
 *
 * Volatile: never persisted. Cleared when the rigSpec invalidates
 * (CanvasViewport calls `setLiftedGrids(null)`).
 *
 * @module store/rigEvalStore
 */

import { create } from 'zustand';

/** @type {Map<string, Float64Array>|null} */
let _liftedGridsRef = null;

const CONTROL_POINT_EPSILON = 1e-3;

function gridsContentEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) {
      if (Math.abs(va[i] - vb[i]) > CONTROL_POINT_EPSILON) return false;
    }
  }
  return true;
}

/**
 * @typedef {Object} RigEvalState
 * @property {number} liftedGridsRevision
 *   Bumps when `setLiftedGrids` receives content that differs from
 *   the prior ref by more than `CONTROL_POINT_EPSILON` on any control
 *   point, or when the set-of-warp-ids changes. Subscribers gate
 *   their re-renders on this counter.
 * @property {(grids: Map<string, Float64Array>|null) => void} setLiftedGrids
 *   Updates the module-scope ref and bumps revision when content
 *   actually changed. No-op when content is materially equal.
 */

export const useRigEvalStore = create(
  (set) => /** @type {RigEvalState} */ ({
    liftedGridsRevision: 0,
    setLiftedGrids: (grids) => {
      if (gridsContentEqual(_liftedGridsRef, grids)) return;
      _liftedGridsRef = grids;
      set((s) => ({ liftedGridsRevision: s.liftedGridsRevision + 1 }));
    },
  }),
);

/**
 * Read the live lifted-grid map. Pair with a subscription to
 * `liftedGridsRevision` so the consumer re-renders when content
 * actually changes.
 *
 * @returns {Map<string, Float64Array>|null}
 */
export function getLiftedGrids() {
  return _liftedGridsRef;
}
