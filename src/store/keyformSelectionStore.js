// @ts-check

/**
 * Animation Phase 5 Slice 5.EE — cross-editor keyform-selection
 * publish/subscribe store.
 *
 * **Mirror pattern, not a parallel-state store.** The canonical owner
 * of keyform-handle selection state is FCurveEditor's local
 * `useState(selectedHandles)`. This store is a *publish surface*:
 * FCurveEditor pushes the current Map after every selection change;
 * cross-editor consumers (DopesheetEditor halo gate, future Outliner
 * row indicators, etc.) subscribe to read.
 *
 * Why mirror rather than fully lift the state to the store?
 *
 *   - FCurveEditor's `selectedHandles` has 37+ touch points (drag ops,
 *     modal G/R/S, click/Shift+click/Ctrl+click handlers, A/Alt+A/
 *     Ctrl+I bulk ops, etc.). Lifting all of them to a Zustand setter
 *     is high-risk substrate churn for zero observable benefit at the
 *     FCurveEditor itself.
 *
 *   - The store has ONE writer (FCurveEditor) and N readers
 *     (DopesheetEditor today; possibly more later). One-way data flow
 *     means no two-writer sync hazard.
 *
 *   - Per Rule №2 (no transitional shims): this is NOT a transitional
 *     shim. The publish/subscribe pattern is permanent; "lift state
 *     fully" was never the intended end-state. FCurveEditor remains
 *     the canonical owner because keyform selection is *primarily*
 *     edited there; other editors only ever read it (currently).
 *
 * # Why this slice exists
 *
 * Slice 5.W shipped the DopesheetEditor active-keyform halo with TWO
 * gates: (1) `fc.active === true` (via Slice 5.X) and (2)
 * `activeKfIdx >= 0`. Blender's `draw_fcurve_active_vertex`
 * (`reference/blender/source/blender/editors/space_graph/graph_draw.cc:241-262`)
 * has a THIRD gate at `:254`: `if (!(bezt->f2 & SELECT)) return;` —
 * the active keyform itself must be SELECTED for the halo to draw.
 *
 * Pre-this-slice: SS keyform selection lived only in FCurveEditor's
 * local React state, so DopesheetEditor couldn't see it and the halo
 * lit on every active-keyform regardless of selection. After Alt+A
 * (clear keyform selection), the halo would still show because the
 * `fc.activeKeyformIndex` field (per Slice 5.H) is independent of
 * the selection Map.
 *
 * This slice gives DopesheetEditor read access to the selection Map.
 * Closes Slice 5.W-2 deviation.
 *
 * # Blender semantics ported
 *
 * Blender stores per-BezTriple selection as 3 bits (`f1` / `f2` / `f3`
 * for left handle, center, right handle). SS's selectedHandles Map
 * uses `{center, left, right}` triple per entry — semantically
 * equivalent. The halo gate uses `f2 & SELECT` (center bit) which
 * SS reads as `.center === true`.
 *
 * # Schema and persistence
 *
 * **NOT persisted.** Blender's BezTriple selection bits DO persist
 * across save/load (they're part of the action datablock). SS's
 * selection has always been ephemeral (cleared on remount). That
 * divergence is unchanged by this slice — closing it would require
 * either lifting the canonical state INTO the action draft (which
 * touches 37+ writer call sites in FCurveEditor) or persisting the
 * Map separately (which adds save/load schema). Neither is in scope
 * for the halo-gate fix. Documented as deviation 5.EE-1.
 *
 * @module store/keyformSelectionStore
 */

import { create } from 'zustand';

const EMPTY_MAP = new Map();

/**
 * @typedef {{ center: boolean, left: boolean, right: boolean }} HandleParts
 *
 * @typedef {Map<string, Map<number, HandleParts>>} SelectedHandlesMap
 *   Outer Map keyed by fcurveId; inner Map keyed by keyform index.
 *   Inner value `HandleParts` mirrors Blender's `bezt->f1/f2/f3` bits.
 */

export const useKeyformSelectionStore = create((set) => ({
  /** @type {SelectedHandlesMap} */
  handles: EMPTY_MAP,

  /**
   * FCurveEditor publish entry-point. Replaces the entire selection
   * Map. Identity-stable: skips the `set()` call if the new Map is
   * the same reference as the current one (avoids unnecessary
   * subscriber re-renders when the publishing component re-renders
   * without selection state changing).
   *
   * @param {SelectedHandlesMap} next
   */
  publishHandles(next) {
    set((state) => (state.handles === next ? state : { handles: next }));
  },

  /**
   * Test-only reset. Clears the published Map back to the empty
   * sentinel — useful for unit tests that need a clean slate without
   * mounting a real FCurveEditor.
   */
  __resetForTests() {
    set({ handles: EMPTY_MAP });
  },
}));

/**
 * Read accessor — returns true iff the given fcurve's keyform-index
 * is in the published selection AND its center handle is selected.
 * Mirrors Blender's `bezt->f2 & SELECT` check at
 * `graph_draw.cc:254` (the center bit is what gates the active-vertex
 * halo).
 *
 * Pure helper — does NOT subscribe to the store. Callers that need
 * reactivity should subscribe to `useKeyformSelectionStore` directly
 * and call this helper on the resolved Map.
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {string | null | undefined} fcurveId
 * @param {number | null | undefined} keyformIdx
 * @returns {boolean}
 */
export function isKeyformCenterSelected(handles, fcurveId, keyformIdx) {
  if (!handles || typeof handles.get !== 'function') return false;
  if (typeof fcurveId !== 'string' || fcurveId.length === 0) return false;
  if (typeof keyformIdx !== 'number' || keyformIdx < 0) return false;
  const sub = handles.get(fcurveId);
  if (!sub || typeof sub.get !== 'function') return false;
  const parts = sub.get(keyformIdx);
  return !!(parts && parts.center === true);
}
