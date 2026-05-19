// @ts-check

/**
 * Animation Phase 5 Slice 5.EE — cross-editor keyform-selection store.
 *
 * **Canonical owner of keyform-handle selection state across editors.**
 * Both FCurveEditor (sole writer pre-Phase-6) and DopesheetEditor
 * (writer-since-Phase-6 Slice 6.A) read + write the selection through
 * this store. Any future editor that needs to read or modify keyform
 * selection joins on the same store.
 *
 * # History note
 *
 * Pre-Phase-6 this was a one-way mirror — FCurveEditor's local
 * `useState(selectedHandles)` was the canonical state, and the store
 * just `publishHandles`-mirrored it for cross-editor READ. Phase 6
 * (Dopesheet write-mode) made the Dopesheet a SECOND writer of keyform
 * selection (tick clicks). Two writers + a one-way mirror is a sync
 * hazard (last writer to ship clobbers the other's stale local state)
 * — Rule №1 prohibits silent state desync — so Slice 6.A lifted the
 * canonical state INTO this store. FCurveEditor now reads + writes
 * through `useKeyformSelectionState` (the `[handles, setHandles]`
 * tuple hook) which has the same shape as its prior `useState`. Zero
 * behavioral change for the FCurveEditor; new write-path for the
 * Dopesheet.
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
 * Blender stores per-BezTriple selection in 3 `eBezTriple_Flag` fields
 * (`f1` / `f2` / `f3` for left handle, center, right handle —
 * defined in `reference/blender/source/blender/makesdna/DNA_curve_types.h`).
 * Each is a bit-mask enum (BEZT_FLAG_SELECT | BEZT_FLAG_TEMP_TAG |
 * others); the halo gate at `graph_draw.cc:254` reads
 * `(bezt->f2 & SELECT)` — isolating the SELECT bit only.
 *
 * SS collapses each field to a single boolean — equivalent for
 * halo-gate purposes because SS doesn't model the transient
 * sub-bits (TEMP_TAG etc.). The Map uses `{center, left, right}`
 * triple per entry; the halo gate reads `.center === true` which
 * mirrors Blender's `bezt->f2 & SELECT` semantic. Audit-fix LOW-1
 * fidelity (Slice 5.EE audit 2026-05-18): refined the "3 bits"
 * framing — each Blender field is multi-bit, not single-bit; SS's
 * boolean collapse is correct in the SELECT-bit scope.
 *
 * # Schema and persistence
 *
 * **NOT persisted.** Blender's BezTriple selection bits DO persist
 * across save/load — they're part of the action datablock, written
 * via `BKE_fcurve_blend_write_data` at
 * `reference/blender/source/blender/blenkernel/intern/fcurve.cc:2581-2586`
 * which serializes the `fcu->bezt` struct-array including
 * `eBezTriple_Flag f1/f2/f3` (load path at `:2625-2629`). SS's
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
import { useCallback } from 'react';

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
   * Canonical setter for the keyform-selection Map. Replaces the
   * entire selection Map. Identity-stable: skips the `set()` call if
   * the new Map is the same reference as the current one (avoids
   * unnecessary subscriber re-renders when a writer re-runs without
   * actual selection state changing).
   *
   * Callers should prefer the `useKeyformSelectionState()` hook for
   * `[handles, setHandles]` ergonomics matching React's useState — see
   * helper export below.
   *
   * @param {SelectedHandlesMap} next
   */
  setHandles(next) {
    set((state) => (state.handles === next ? state : { handles: next }));
  },

  /**
   * Test-only reset. Clears the Map back to the empty sentinel —
   * useful for unit tests that need a clean slate without mounting
   * a real editor.
   */
  __resetForTests() {
    set({ handles: EMPTY_MAP });
  },
}));

/**
 * useState-shaped hook: `[handles, setHandles]` reading + writing
 * through `useKeyformSelectionStore`. Drop-in replacement for the
 * prior `useState(new Map())` pattern in FCurveEditor, with the
 * added benefit that the state is now shared across editors.
 *
 * `setHandles` accepts either a Map directly OR an updater function
 * `(prev) => next` (matching `useState`'s functional setter shape).
 * The functional form always reads the LATEST published state via
 * `getState()` to avoid stale-closure hazards in event handlers that
 * batch multiple set calls.
 *
 * **Identity-stable** (audit-fix Slice 6.A CRITICAL): the returned
 * `setHandles` callback is wrapped in `useCallback` with the Zustand
 * action (itself construction-time stable) as the only dep, so the
 * callback identity is stable across re-renders. Callers can include
 * it in `useCallback`/`useEffect` deps without triggering re-runs.
 * Pre-fix the adapter was a bare inline arrow that returned a fresh
 * closure each call — invalidating downstream useCallback identities
 * (handleTickClick in DopesheetEditor) on every render.
 *
 * @returns {[SelectedHandlesMap, (next: SelectedHandlesMap | ((prev: SelectedHandlesMap) => SelectedHandlesMap)) => void]}
 */
export function useKeyformSelectionState() {
  const handles = useKeyformSelectionStore((s) => s.handles);
  // Zustand actions defined inside `create()` are identity-stable at
  // construction time, so this selector returns the same ref every
  // render. The `useCallback` below then has a stable dep → stable
  // returned setter identity.
  const storeSetHandles = useKeyformSelectionStore((s) => s.setHandles);
  const setHandles = useCallback(
    (
      /** @type {SelectedHandlesMap | ((prev: SelectedHandlesMap) => SelectedHandlesMap)} */
      next,
    ) => {
      if (typeof next === 'function') {
        const prev = useKeyformSelectionStore.getState().handles;
        storeSetHandles(next(prev));
      } else {
        storeSetHandles(next);
      }
    },
    [storeSetHandles],
  );
  return [handles, setHandles];
}

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
