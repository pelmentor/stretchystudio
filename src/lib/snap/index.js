// @ts-check

/**
 * Toolset Plan Phase 2 — snap module barrel.
 *
 * Re-exports the two pure helpers + the transient `useSnapStore` for
 * the magenta snap-target dot rendered by `BoxSelectOverlay` (or
 * other modal-G overlays).
 *
 * The snap config itself lives in `preferencesStore.snap` (Phase 2.A);
 * this transient store is just for the per-drag UI affordance.
 *
 * @module lib/snap
 */

import { create } from 'zustand';

export {
  snapDeltaToGrid,
  snapAngleToIncrement,
  snapScaleToIncrement,
  applyPrecisionToDelta,
  applyPrecisionToAngle,
  applyPrecisionToScale,
  pickSelectionAnchor,
  enumerateSelectionAnchorVerts,
} from './snapMath.js';

export {
  VertexSnapHash,
  buildSnapHash,
  findNearestVertex,
} from './snapHash.js';

/** Transient store for the per-drag snap-target overlay.
 *
 *   - `target` — `{ x, y, partId, vertIndex } | null`. Set by the
 *     modal each tick when vertex snap engages; cleared on commit /
 *     cancel.
 *   - `setSnapTarget(t)` — write-through.
 *   - `clearSnapTarget()` — explicit clear (sister of cancel/commit).
 */
export const useSnapStore = create((set) => ({
  target: null,
  setSnapTarget: (t) => set({ target: t ?? null }),
  clearSnapTarget: () => set({ target: null }),
}));
