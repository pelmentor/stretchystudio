// @ts-check

/**
 * Animation Phase 5 Slice 5.H — Active keyform helper.
 *
 * Pure mutation helper for the per-FCurve `activeKeyformIndex` integer —
 * Blender's `active_keyframe_index` field on the FCurve struct
 * (`DNA_anim_types.h:362-370`). Sister to Slice 5.F's `selected` and
 * Slice 5.G's `mute` as a per-FCurve sparse field.
 *
 * # Blender semantics ported
 *
 * Blender stores the active-keyframe index ON the FCurve struct:
 *
 *   ```c
 *   // DNA_anim_types.h:370
 *   int active_keyframe_index = 0;
 *   ```
 *
 *   ```c
 *   // DNA_anim_enums.h:299-300
 *   #define FCURVE_ACTIVE_KEYFRAME_NONE -1
 *   ```
 *
 * Access is exclusively through two accessors with sanity checks
 * (`DNA_anim_types.h:367-368` documents the "Do not access directly"
 * contract):
 *
 *   - **`BKE_fcurve_active_keyframe_set(fcu, bezt)`**
 *     (`fcurve.cc:794-813`) — pointer-based setter:
 *       - `nullptr` bezt → `FCURVE_ACTIVE_KEYFRAME_NONE`.
 *       - Out-of-bounds pointer arithmetic → `FCURVE_ACTIVE_KEYFRAME_NONE`.
 *       - `BLI_assert_msg(BEZT_ISSEL_ANY(active_bezt), "active keyframe
 *         must be selected")` — selection invariant enforced at write.
 *
 *   - **`BKE_fcurve_active_keyframe_index(fcu)`** (`fcurve.cc:815-831`)
 *     — getter with bounds + selection sanity:
 *       - Returns `NONE` when `bezt == nullptr`, index >= totvert, or
 *         index < 0.
 *       - Returns `NONE` when the indexed keyframe is not selected
 *         (`(f1|f2|f3) & SELECT == 0`) — comment says "If it's not
 *         selected, it can't be active."
 *
 * The setter's "must-be-selected" rule is the load-bearing invariant:
 * deleting the active keyform (`fcurve.cc:1768-1770`) and sorting bezts
 * (`fcurve.cc:1313-1320`) both rely on it to keep the index consistent
 * with what's actually selected. SS mirrors the invariant where it can:
 *
 *   - **Write-time invariant** — `setActiveKeyform` does NOT enforce a
 *     selection precondition because SS's keyform selection lives at
 *     editor-local-React (the `selectedHandles` Map), not on the
 *     keyform record. Callers (the FCurveEditor click handler) gate
 *     the call on `BEZT_ISSEL_ANY`-equivalent themselves, mirroring
 *     Blender's `graph_select.cc:1790` gate.
 *
 *   - **Read-time bounds** — `getActiveKeyformIndex` enforces only the
 *     bounds half (returns -1 when the index is missing, OOB, or the
 *     keyforms array is missing). The selection half is enforced at
 *     the render site (`drawKeyframes` only highlights when the index
 *     is in the editor's `selectedHandles` Map for that fcurve).
 *
 * The split mirrors Blender's three-condition render gate at
 * `graph_draw.cc:243-262` (`draw_fcurve_active_vertex`):
 *   1. `FCURVE_ACTIVE` (channel-level active),
 *   2. `active_keyframe_index != FCURVE_ACTIVE_KEYFRAME_NONE`,
 *   3. `bezt->f2 & SELECT` (the indexed keyform is selected).
 *
 * # Where the setter fires — Blender's "may_activate" pattern
 *
 * `graph_select.cc:1789-1797` (in `mouse_graph_keys`, the keyform-pick
 * operator) calls the setter exactly once per click, gated by:
 *
 *   ```c
 *   if (!run_modal && BEZT_ISSEL_ANY(bezt)) {
 *     const bool may_activate = !already_selected ||
 *                               BKE_fcurve_active_keyframe_index(nvi->fcu)
 *                                   == FCURVE_ACTIVE_KEYFRAME_NONE;
 *     if (may_activate) {
 *       BKE_fcurve_active_keyframe_set(nvi->fcu, bezt);
 *     }
 *   }
 *   ```
 *
 * The `!already_selected || current == NONE` gate is what makes the
 * Shift+click pattern feel right: clicking an already-selected keyform
 * when something is already active leaves the active pointer alone (a
 * Shift+click on a different keyform extends the selection without
 * stealing focus from whatever the user was numerically editing).
 * Clicking a keyform that was unselected (so `!already_selected`) OR
 * clicking when nothing is currently active (`current == NONE`) sets
 * the new keyform as active.
 *
 * SS mirrors this in the FCurveEditor click handler post-Slice 5.H.
 *
 * # Schema & migration
 *
 * No migration ships. `fcurve.activeKeyformIndex` is a sparse integer:
 * missing in v39-and-older saves, treated as `-1` (NONE) by
 * `getActiveKeyformIndex`. Per Rule №2 (no migration baggage), a v40
 * migration writing `activeKeyformIndex: -1` onto every fcurve would
 * be pure noise — the reader collapses tri-state (`>=0` / `-1` /
 * missing) into a clean integer-or-sentinel already.
 *
 * The field IS in the project undo history (matches Blender — active
 * keyframe survives undo because it's a property of the data, not view
 * state). The sidebar/canvas setter calls `update(recipe)` without
 * `skipHistory:true`. (Sister to mute, opposite of channel selection
 * which IS in skip-history mode.)
 *
 * @module anim/fcurveActiveKeyform
 */

/**
 * Sentinel for "no active keyform" — Blender's
 * `FCURVE_ACTIVE_KEYFRAME_NONE = -1` (`DNA_anim_enums.h:300`).
 *
 * Exported so callers can compare against the symbolic constant
 * instead of the magic number, mirroring Blender's macro.
 */
export const FCURVE_ACTIVE_KEYFORM_NONE = -1;

/**
 * Read accessor for `active_keyframe_index`, with bounds sanity.
 *
 * Mirrors `BKE_fcurve_active_keyframe_index` (`fcurve.cc:815-831`)
 * minus the selection half of the check — that's enforced at the
 * render site since SS's keyform selection lives editor-local. See
 * module header for the split rationale.
 *
 * Returns `FCURVE_ACTIVE_KEYFORM_NONE` (-1) when:
 *   - `fcurve` is null/undefined.
 *   - `fcurve.activeKeyformIndex` is missing or not a number.
 *   - the index is out of bounds against `fcurve.keyforms`.
 *
 * @param {object|null|undefined} fcurve
 * @returns {number}
 */
export function getActiveKeyformIndex(fcurve) {
  if (!fcurve) return FCURVE_ACTIVE_KEYFORM_NONE;
  const idx = fcurve.activeKeyformIndex;
  if (typeof idx !== 'number' || !Number.isInteger(idx)) {
    return FCURVE_ACTIVE_KEYFORM_NONE;
  }
  const kfs = fcurve.keyforms;
  if (!Array.isArray(kfs)) return FCURVE_ACTIVE_KEYFORM_NONE;
  if (idx < 0 || idx >= kfs.length) return FCURVE_ACTIVE_KEYFORM_NONE;
  return idx;
}

/**
 * Set the active keyform on an FCurve.
 *
 * Mirrors `BKE_fcurve_active_keyframe_set` (`fcurve.cc:794-813`):
 *
 *   - `index === null` (or any non-integer) → write the sentinel
 *     (omits the field by deleting it, keeping the schema sparse per
 *     Rule №2 — a stored `-1` would just inflate save files vs. the
 *     reader's missing-collapses-to-NONE invariant).
 *   - Out-of-bounds index → also sentinel (mirrors Blender's
 *     `offset < 0 || offset >= totvert` branch).
 *   - In-bounds index → stored as-is.
 *
 * Note on the "must-be-selected" invariant: Blender asserts the bezt
 * is selected via `BLI_assert_msg(BEZT_ISSEL_ANY(active_bezt))`. SS
 * cannot enforce this at the helper level because keyform selection
 * lives in the editor's local `selectedHandles` Map (not on the
 * keyform record). The caller (FCurveEditor click handler) gates the
 * setter call on its own selection state, matching Blender's
 * `graph_select.cc:1790` gate. See module header for split rationale.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId
 * @param {number|null} index — non-negative integer to set, or null to clear
 * @returns {{ activeNow: number }}
 */
export function setActiveKeyform(action, fcurveId, index) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };

  if (index === null || typeof index !== 'number' || !Number.isInteger(index)) {
    delete fc.activeKeyformIndex;
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }

  const kfs = fc.keyforms;
  if (!Array.isArray(kfs) || index < 0 || index >= kfs.length) {
    delete fc.activeKeyformIndex;
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }

  fc.activeKeyformIndex = index;
  return { activeNow: index };
}

/**
 * Clear the active keyform on an FCurve.
 *
 * Convenience wrapper around `setActiveKeyform(action, fcurveId, null)`
 * for readability at the call site. Mirrors
 * `BKE_fcurve_active_keyframe_set(fcu, nullptr)` (used at
 * `fcurve.cc:1769` when the active keyform is deleted).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @returns {{ activeNow: number }}
 */
export function clearActiveKeyform(action, fcurveId) {
  return setActiveKeyform(action, fcurveId, null);
}

/**
 * Capture the active keyform's BezTriple object reference for tracking
 * through a multi-step operator (sort + merge, drag + sort + merge).
 *
 * Blender tracks the active keyform by INDEX arithmetic
 * (`fcurve.cc:1313-1320` for sort swaps, `fcurve.cc:1768-1770` for
 * delete) because C structs are value types — there's no object
 * identity to track. SS keyforms are JS objects with stable identity
 * through immer drafts (immer preserves object identity when a node
 * isn't mutated), so we can capture the object reference pre-op and
 * `indexOf` it post-op. The pattern is more robust than chained
 * `Map<oldIdx, newIdx>` remaps because:
 *
 *   - A sort + merge sequence would otherwise need TWO remaps to chain.
 *   - A drag that moves the kf past a neighbor's time changes its
 *     post-sort position by an amount that depends on the move
 *     distance — index arithmetic gets fiddly.
 *   - `indexOf` returning `-1` cleanly signals "object was deleted /
 *     merged into a different survivor" → caller clears active.
 *
 * Pair with `relocateActiveKeyformByObject` AFTER the operation.
 *
 * @param {object|null|undefined} fcurve
 * @returns {object|null} the BezTriple object, or null if no active set
 */
export function captureActiveKeyformObject(fcurve) {
  const idx = getActiveKeyformIndex(fcurve);
  if (idx === FCURVE_ACTIVE_KEYFORM_NONE) return null;
  return fcurve.keyforms[idx];
}

/**
 * Re-find the active keyform's index by object identity AFTER a
 * sort/merge/delete pass; write the result back to `fc.activeKeyformIndex`.
 *
 * Companion to `captureActiveKeyformObject`. Mirrors Blender's
 * fcurve.cc tracking — Blender uses index arithmetic, SS uses object
 * identity (see capture helper for rationale).
 *
 *   - `capturedObj === null` → no-op (nothing was active pre-op).
 *   - `indexOf(capturedObj) >= 0` → write the new index.
 *   - `indexOf(capturedObj) < 0` (object was deleted or merged-into-a-
 *     different-survivor) → clear active.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {object|null} capturedObj — return value of `captureActiveKeyformObject`
 * @returns {{ activeNow: number }}
 */
export function relocateActiveKeyformByObject(action, fcurveId, capturedObj) {
  if (capturedObj === null || capturedObj === undefined) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  if (!action || !Array.isArray(action.fcurves)) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc || !Array.isArray(fc.keyforms)) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const newIdx = fc.keyforms.indexOf(capturedObj);
  if (newIdx < 0) {
    delete fc.activeKeyformIndex;
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  fc.activeKeyformIndex = newIdx;
  return { activeNow: newIdx };
}

/**
 * Remap the active keyform index through a delete/merge index remap.
 *
 * Mirrors Blender's per-deletion update at `fcurve.cc:1768-1770`:
 *
 *   ```c
 *   if (i == fcu.active_keyframe_index) {
 *     BKE_fcurve_active_keyframe_set(&fcu, nullptr);
 *   }
 *   ```
 *
 * Blender does this inline during the delete loop. SS performs the
 * delete as a bulk pass (`deleteKeyforms` returns a
 * `Map<oldIdx, newIdx | -1>` index remap), so this helper applies the
 * remap to the active keyform field in a single post-pass:
 *
 *   - Index missing on the FCurve → no-op (sparse field, already NONE).
 *   - Remap entry says `-1` (deleted) → clear the active field.
 *   - Remap shifts the index → write the new index in place.
 *   - Remap leaves the index unchanged → no-op.
 *
 * Same shape works for `mergeDuplicateTimeKeys` since that operator
 * returns the same remap shape (entries point at the surviving
 * cluster representative, or -1 if the entry was the survivor's
 * duplicate that got dropped).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {Map<number, number>} remap — old-idx → new-idx (or -1 for deleted)
 * @returns {{ activeNow: number }}
 */
export function remapActiveKeyform(action, fcurveId, remap) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  const oldIdx = fc.activeKeyformIndex;
  if (typeof oldIdx !== 'number' || !Number.isInteger(oldIdx)) {
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const newIdx = remap.get(oldIdx);
  if (typeof newIdx !== 'number' || newIdx < 0) {
    delete fc.activeKeyformIndex;
    return { activeNow: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  if (newIdx !== oldIdx) {
    fc.activeKeyformIndex = newIdx;
  }
  return { activeNow: newIdx };
}
