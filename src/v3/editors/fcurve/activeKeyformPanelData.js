// @ts-check

/**
 * Animation Phase 5 Slice 5.Q — Active Keyframe N-panel data module.
 *
 * Pure data layer backing the FCurveEditor's "Active Keyframe" N-panel
 * section. Mirrors the data half of Blender's `graph_panel_key_properties`
 * (`reference/blender/source/blender/editors/space_graph/graph_buttons.cc:365-610`),
 * with the React rendering layered on top in `ActiveKeyformPanel.jsx`
 * (sister architecture to `fcurveFooterData.js` ↔ `FCurveEditor.FCurveFooter`).
 *
 * # What this slice ships (MVP scope)
 *
 * Three fields editable per active keyform:
 *   1. **Interpolation** type (dropdown — full 13-entry Blender enum)
 *      — Blender: `graph_buttons.cc:410` (`bezt_ptr.prop("interpolation")`)
 *   2. **Key Frame** (X coordinate in ms — SS canonical time unit, see
 *      [feedback_ms_canonical_animation_time]) — Blender:
 *      `graph_buttons.cc:443-457` (`bezt_ptr.prop("co_ui", index=0)`)
 *   3. **Value** (Y coordinate) — Blender:
 *      `graph_buttons.cc:460-475` (`bezt_ptr.prop("co_ui", index=1)`)
 *
 * # What this slice DOES NOT ship (deferred to follow-up Slice 5.R)
 *
 * Blender's panel also shows handle-editing rows CONDITIONALLY:
 *   - **Left handle** (Frame + Value + Type) only when the PREVIOUS
 *     keyform has `BEZT_IPO_BEZ` interpolation — `graph_buttons.cc:479-533`
 *   - **Right handle** (Frame + Value + Type) only when the CURRENT
 *     keyform has `BEZT_IPO_BEZ` interpolation — `graph_buttons.cc:536-591`
 *   - **Easing direction** dropdown when `ipo > BEZT_IPO_BEZ` (one of
 *     the easing-family functions) — `graph_buttons.cc:414-416`
 *   - **Easing extras** — `back` value for BACK easing, `amplitude` +
 *     `period` for ELASTIC — `graph_buttons.cc:418-433`
 *
 * Handle editing is the meaningful complexity (needs `prevbezt`
 * tracking AND the handle-mode coordination from
 * `graphedit_activekey_left_handle_coord_cb` /
 * `graphedit_activekey_right_handle_coord_cb` at
 * `graph_buttons.cc:307-363`). Splitting it out keeps Slice 5.Q
 * Rule-№1-compliant — what ships works end-to-end (the 3 base fields
 * are independently useful and complete), what's deferred has a named
 * follow-up slice. Easing direction + easing extras are smaller and
 * piggyback on the handle slice naturally.
 *
 * # The active-keyform context resolution
 *
 * `resolveActiveKeyformContext(action, fcurveId)` mirrors Blender's
 * `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:245-274`) which
 * resolves `(fcu, bezt, prevbezt)`. SS surfaces only `(fcurve, kf,
 * kfIndex)` for this slice — `prevKf` lookup ships when handles do.
 *
 * The resolution chain:
 *   1. Find the FCurve by id (no match → null context).
 *   2. Read `activeKeyformIndex` via the Slice 5.H accessor
 *      `getActiveKeyformIndex` — handles bounds + missing-field guards.
 *   3. Sentinel `FCURVE_ACTIVE_KEYFORM_NONE` → null context.
 *   4. Otherwise return `{ fcurve, kfIndex, kf: fcurve.keyforms[kfIndex] }`.
 *
 * # Edit recipes — undo-coupled + sort-aware
 *
 * Each edit is a mutator that runs inside `update(recipe)` (no
 * `skipHistory:true` — these are data writes, not view state; sister
 * to Slices 5.G/5.I/5.M/5.N/5.O/5.P which all flow through normal undo).
 *
 *   - **`applyEditKeyformValue`** — direct write to `kf.value`. No
 *     sort needed (time unchanged); no handle recalc needed for the
 *     MVP (handles are NOT auto-recalculated when value changes —
 *     Blender's `graphedit_activekey_update_cb` at `graph_buttons.cc:
 *     277-284` calls `sort_time_fcurve` + `BKE_fcurve_handles_recalc`
 *     unconditionally, but `sort_time_fcurve` is a no-op when time
 *     didn't change AND `handles_recalc` only matters for handles
 *     which this MVP doesn't expose). Future handle slice MUST add
 *     the recalc call back.
 *
 *   - **`applyEditKeyformFrame`** — write to `kf.time` then re-sort
 *     the keyforms array by time AND relocate the active index via
 *     the existing `captureActiveKeyformObject` /
 *     `relocateActiveKeyformByObject` pair (Slice 5.H pattern). If
 *     the edit moves the keyform past a neighbor, the index changes;
 *     the helper handles it transparently. Mirrors Blender's
 *     `sort_time_fcurve` call at `graph_buttons.cc:282`.
 *
 *   - **`applyEditKeyformInterpolation`** — direct write to
 *     `kf.interpolation`. No sort, no handle recalc. The segment-level
 *     visual changes (the curve geometry between this kf and the next)
 *     update on re-render naturally via the `decoded` memo's
 *     `[action?.fcurves]` dep.
 *
 * # Preflight readers — phantom-undo gates
 *
 * Sister to Slices 5.M/5.N/5.O: every edit recipe has a paired
 * `wouldEdit*Change` preflight that mirrors mutation logic without
 * writes. The dispatcher checks BEFORE calling `update()` so a re-
 * commit of the same value (user types the existing value + Enter)
 * doesn't burn an undo slot. `projectStore.js:230-232` pushes the
 * pre-recipe snapshot unconditionally; preflight short-circuit is
 * the only way to avoid it.
 *
 * # SS deviations
 *
 * **Deviation 1 — MVP scope omits handle editing.** Blender's panel
 * exposes 6 conditional sections; SS Slice 5.Q exposes 3 always-on
 * sections. Closure: Slice 5.R adds the handle + easing sections.
 *
 * **Deviation 2 — no per-property unit conversion.** Blender's
 * `RNA_SUBTYPE_UNIT(RNA_property_subtype(fcu_prop))` machinery at
 * `graph_buttons.cc:399` reads the property's unit subtype (angle,
 * length, time, etc.) and applies conversion in the UI (e.g. radians
 * → degrees for rotation params). SS keyform values are raw floats
 * with no unit metadata on the bound parameter — the value field
 * shows whatever's stored, no conversion. Acceptable because SS's
 * parameter range conventions are uniform (0-1 sliders + bone
 * rotation in radians, both displayed as-is). Closure tied to a
 * future parameter-units system.
 *
 * **Deviation 3 — frame field shows milliseconds (not frames).**
 * Blender's "co_ui" property is in frames (FPS-relative); SS's
 * canonical animation time is milliseconds throughout the eval
 * substrate (see [feedback_ms_canonical_animation_time]). The label
 * matches: "Time (ms)" instead of "Key Frame". Closure tied to
 * Phase 5 queued path #7 (SIPO_DRAWTIME seconds-vs-frames toggle).
 *
 * @module v3/editors/fcurve/activeKeyformPanelData
 */

import {
  getActiveKeyformIndex,
  FCURVE_ACTIVE_KEYFORM_NONE,
  captureActiveKeyformObject,
  relocateActiveKeyformByObject,
} from '../../../anim/fcurveActiveKeyform.js';

/**
 * @typedef {{
 *   time: number,
 *   value: number,
 *   interpolation?: string,
 *   handleLeft?: { time: number, value: number },
 *   handleRight?: { time: number, value: number },
 *   handleType?: { left: string, right: string },
 * }} KeyformLike
 *
 * @typedef {{
 *   id: string,
 *   keyforms: Array<KeyformLike>,
 *   activeKeyformIndex?: number,
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurve: FCurveLike,
 *   kfIndex: number,
 *   kf: KeyformLike,
 * }} ActiveKeyformContext
 */

/**
 * Resolve `(fcurve, kfIndex, kf)` for the active keyform on the named
 * FCurve, or `null` if no active keyform exists.
 *
 * Mirrors `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:245-274`)
 * minus the `prevbezt` field (deferred to Slice 5.R with handle editing).
 *
 * Null-returns when:
 *   - `action` / `action.fcurves` missing
 *   - `fcurveId` doesn't match any fcurve
 *   - active index sentinel (= `FCURVE_ACTIVE_KEYFORM_NONE`)
 *   - the indexed keyform is missing (defensive — `getActiveKeyformIndex`
 *     does the bounds check, but the array slot could be sparse)
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @returns {ActiveKeyformContext|null}
 */
export function resolveActiveKeyformContext(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) return null;
  if (!fcurveId || typeof fcurveId !== 'string') return null;
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return null;
  const idx = getActiveKeyformIndex(fc);
  if (idx === FCURVE_ACTIVE_KEYFORM_NONE) return null;
  const kf = fc.keyforms[idx];
  if (!kf || typeof kf !== 'object') return null;
  return { fcurve: fc, kfIndex: idx, kf };
}

/**
 * Read-only preflight for {@link applyEditKeyformValue}.
 *
 * Returns true iff calling the mutator with `newValue` would change
 * `kf.value`. Strict number-equality compare — if the user re-types
 * the existing value and confirms, the preflight returns false and
 * the dispatcher skips `update()` entirely, preventing a phantom
 * undo entry.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} newValue
 * @returns {boolean}
 */
export function wouldEditKeyformValueChange(action, fcurveId, newValue) {
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  return ctx.kf.value !== newValue;
}

/**
 * Apply a value edit to the active keyform.
 *
 * Direct write to `kf.value`. No sort needed (time unchanged), no
 * handle recalc needed (MVP doesn't expose handles; future handle
 * slice will add the recalc call per `graphedit_activekey_update_cb`
 * at `graph_buttons.cc:277-284`).
 *
 * @param {object} action — Action datablock (mutated)
 * @param {string} fcurveId
 * @param {number} newValue
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformValue(action, fcurveId, newValue) {
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (ctx.kf.value === newValue) return { changed: false };
  ctx.kf.value = newValue;
  return { changed: true };
}

/**
 * Read-only preflight for {@link applyEditKeyformFrame}.
 *
 * Returns true iff calling the mutator with `newTimeMs` would change
 * `kf.time`. Same rationale as value preflight.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} newTimeMs
 * @returns {boolean}
 */
export function wouldEditKeyformFrameChange(action, fcurveId, newTimeMs) {
  if (typeof newTimeMs !== 'number' || !Number.isFinite(newTimeMs)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  return ctx.kf.time !== newTimeMs;
}

/**
 * Apply a frame (time) edit to the active keyform.
 *
 * Mirrors `graphedit_activekey_update_cb` (`graph_buttons.cc:277-284`)
 * which sorts after every coord change:
 *
 *   ```c
 *   sort_time_fcurve(*fcu);
 *   BKE_fcurve_handles_recalc(*fcu);
 *   ```
 *
 * SS:
 *   1. Capture the active kf object reference (Slice 5.H pattern) so
 *      we can relocate the index after sort.
 *   2. Write `kf.time = newTimeMs`.
 *   3. Re-sort `fcurve.keyforms` by ascending time.
 *   4. Re-find the active index via object identity.
 *
 * The capture-and-relocate pattern is more robust than index
 * arithmetic when the moved keyform crosses multiple neighbors — see
 * `captureActiveKeyformObject` JSDoc in `fcurveActiveKeyform.js` for
 * the full rationale.
 *
 * Returns the post-sort index so the caller can update editor-local
 * state (e.g. the panel reads the new index back via context refresh
 * on next render, but a tight numeric-edit loop benefits from the
 * synchronous return).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {number} newTimeMs
 * @returns {{ changed: boolean, newIndex: number }}
 */
export function applyEditKeyformFrame(action, fcurveId, newTimeMs) {
  if (typeof newTimeMs !== 'number' || !Number.isFinite(newTimeMs)) {
    return { changed: false, newIndex: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false, newIndex: FCURVE_ACTIVE_KEYFORM_NONE };
  if (ctx.kf.time === newTimeMs) {
    return { changed: false, newIndex: ctx.kfIndex };
  }

  const captured = captureActiveKeyformObject(ctx.fcurve);
  ctx.kf.time = newTimeMs;
  // Inline sort — matches the TimelineEditor convention (see
  // src/v3/editors/timeline/TimelineEditor.jsx:841, :1042, :1069 for
  // the same `keyforms.sort((a, b) => a.time - b.time)` pattern).
  // No centralized helper exists today; keyforms.sort in place is the
  // established pattern.
  ctx.fcurve.keyforms.sort((a, b) => a.time - b.time);
  const { activeNow } = relocateActiveKeyformByObject(action, fcurveId, captured);
  return { changed: true, newIndex: activeNow };
}

/**
 * Read-only preflight for {@link applyEditKeyformInterpolation}.
 *
 * Returns true iff calling the mutator with `newInterp` would change
 * `kf.interpolation`. Sparse-field tolerance: missing field collapses
 * to `'linear'` (SS default) for the comparison — typing 'linear'
 * onto a sparse field is a no-op.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {string} newInterp
 * @returns {boolean}
 */
export function wouldEditKeyformInterpolationChange(action, fcurveId, newInterp) {
  if (typeof newInterp !== 'string' || newInterp.length === 0) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const current = ctx.kf.interpolation ?? 'linear';
  return current !== newInterp;
}

/**
 * Apply an interpolation type edit to the active keyform.
 *
 * Direct write to `kf.interpolation`. The segment-level visual
 * changes (curve geometry between this kf and the next) update on
 * re-render naturally via the `decoded` memo's `[action?.fcurves]`
 * dep — no explicit invalidation needed at this layer.
 *
 * Sparse-field discipline: if the new value matches the sparse-default
 * 'linear', we DELETE the field rather than writing 'linear' (keeps
 * the schema sparse per Rule №2 — no migration baggage). Future
 * sparse-default changes would need to update this same branch.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {string} newInterp — one of the 13 interpolation enum keys
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformInterpolation(action, fcurveId, newInterp) {
  if (typeof newInterp !== 'string' || newInterp.length === 0) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = ctx.kf.interpolation ?? 'linear';
  if (current === newInterp) return { changed: false };
  if (newInterp === 'linear') {
    delete ctx.kf.interpolation;
  } else {
    ctx.kf.interpolation = newInterp;
  }
  return { changed: true };
}
