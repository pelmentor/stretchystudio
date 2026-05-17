// @ts-check

/**
 * Animation Phase 5 Slice 5.X — Per-FCurve ACTIVE flag.
 *
 * Pure mutation helpers for the per-FCurve `active` boolean — Blender's
 * `FCURVE_ACTIVE` bit (`DNA_anim_enums.h:309` — `FCURVE_ACTIVE = (1 << 2)`).
 * Sister to:
 *   - Slice 5.F `selected` (channel-list selection, view state)
 *   - Slice 5.G `mute`     (per-fcurve mute, data)
 *   - Slice 5.H `activeKeyformIndex` (per-fcurve active KEYFORM, data)
 *   - Slice 5.I `hide`     (per-fcurve visibility, data)
 *   - Slice 5.V `groupId`  (group cascade target, data)
 *
 * # Why this slice exists
 *
 * Slice 5.W's DopesheetEditor row-state styling shipped the active-
 * keyform halo gated on `pickActiveFCurve(action, selection)?.id ===
 * row.fcurveId`. That gate is SS's selection-derived stand-in for
 * Blender's `FCURVE_ACTIVE` per-channel flag — necessary because pre-
 * 5.X, SS had no persisted "active fcurve" bit.
 *
 * Without the persisted flag, the gate is fragile:
 *   - Multi-selection: `pickActiveFCurve` returns the LAST selection
 *     entry's match, but Blender's FCURVE_ACTIVE is set independently
 *     of selection-list length (an active curve can be one of N
 *     selected curves).
 *   - Box-select-all: leaves selection with every fcurve's target; the
 *     "last item wins" rule then arbitrarily picks one fcurve. Blender's
 *     box-select explicitly clears FCURVE_ACTIVE on all curves
 *     (`graph_select.cc:413` — "always deactivate all F-Curves if we
 *     perform batch ops for selection") and only re-sets it on the
 *     post-op active.
 *   - Cross-editor: the selection store is global; navigating to a
 *     non-fcurve editor (Outliner, etc.) breaks the picker's lookup.
 *
 * This slice ports the persisted bit so both FCurveEditor and
 * DopesheetEditor can gate on a stable per-fcurve flag. `pickActiveFCurve`
 * stays as a BOOTSTRAP fallback for legacy saves that don't carry
 * `fc.active` yet (sister-Rule №2 stance: no auto-promote migration; the
 * fallback kicks in until the user explicitly clicks something which
 * then writes `fc.active = true`).
 *
 * # Blender semantics ported
 *
 * **Set** — `ANIM_set_active_channel`
 * (`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:237-339`).
 * EXCLUSIVE flag: clears `FCURVE_ACTIVE` on every same-type channel
 * (`:274` via `ACHANNEL_SETFLAG_CLEAR`), then sets it on the new active
 * (`:352`). At any moment, at most ONE fcurve in an action carries the
 * flag. SS's `setActiveFCurve` mirrors this exactly — walks
 * `action.fcurves`, deletes `active` on every other entry, sets `active:
 * true` on the target.
 *
 * **Read** — `acf_fcurve_setting_get` at
 * `anim_channels_edit.cc:451-454`:
 *
 *   ```c
 *   case ANIMTYPE_FCURVE:
 *   case ANIMTYPE_NLACURVE: {
 *     FCurve *fcu = static_cast<FCurve *>(ale->data);
 *     return fcu->flag & FCURVE_ACTIVE;
 *   }
 *   ```
 *
 * **Implicit clear on deselect** — `anim_channels_edit.cc:723-733`
 * (in `setflag_anim_channels`): when an fcurve's `FCURVE_SELECTED` is
 * cleared with `change_active=true`, the function ALSO clears
 * `FCURVE_ACTIVE`. Inline comment at `:729-730` reads "Only erase the
 * ACTIVE flag when deselecting. This ensures that 'select all curves'
 * retains the currently active curve."
 *
 * SS deviation (deferred): this implicit clear is NOT wired into Slice
 * 5.F's `applyChannelSelect` today. Channel deselection doesn't auto-
 * clear `active`. Documented as Deviation 1 — closure: when a future
 * slice extends `applyChannelSelect` with the `change_active=true`
 * branch (Blender's UI uses this for box-deselect + Alt+A); for the
 * Replace / Toggle / Range paths shipped today, deselection is rare
 * enough that the leakage doesn't surface in normal usage.
 *
 * **Implicit clear on batch select-toggle** — `graph_select.cc:413`:
 * `fcu->flag &= ~FCURVE_ACTIVE` is unconditional inside the batch
 * select-toggle loop. SS deviation (deferred): same as above — gated
 * on a future bulk select-toggle operator. Documented as Deviation 2.
 *
 * **Implicit set on click-select-active** — `graph_select.cc:466`:
 * `fcu->flag |= (FCURVE_SELECTED | FCURVE_ACTIVE)`. This is the
 * `graph.select_active_curve` operator (Alt+click pattern). SS-port
 * lives in `applyChannelSelect`'s `makeActive` decision branch — the
 * FCurveEditor caller wires `setActiveFCurve` when `decision.makeActive
 * === true` in this slice. See FCurveEditor.jsx integration site.
 *
 * # Write semantics — view-state-or-data?
 *
 * Blender registers `OPTYPE_UNDO` on `ANIM_OT_channels_setting_toggle`
 * (`anim_channels_edit.cc:3105`), so the setting writeback (which
 * includes ACTIVE when accessed via the channel-setting toggle) IS
 * tracked in Blender's undo stack.
 *
 * SS deviation (deliberate, sister to Slice 5.F's channel-selection
 * choice): ACTIVE writes use `skipHistory: true` at the dispatcher.
 * The 5.F audit-fix HIGH-A1 documented the trade-off — channel-list UI
 * navigation should not burn the 50-entry undo budget. ACTIVE is
 * sister-UX to selection (toggled by the same click), and applying the
 * same skipHistory choice keeps the two flags coherent. Documented as
 * Deviation 3.
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `fcurve.active` is a sparse
 * boolean: missing in v40-and-older saves, treated as `false` by
 * `isFCurveActive`. Per `feedback_no_migration_baggage_rule_two`, a
 * migration writing `active: false` onto every fcurve would be pure
 * noise — the reader collapses tri-state (`true` / `false` / missing)
 * into a clean boolean already.
 *
 * Legacy saves load with no active fcurve. The first user click then
 * promotes one fcurve to `active: true`. Until that click, the
 * `pickActiveFCurve` fallback (consulted by FCurveEditor /
 * DopesheetEditor when `getActiveFCurve(action) === null`) derives
 * "current focus" from the global selection store — same heuristic
 * Slice 5.W used as the load-bearing gate. Once a click writes
 * `fc.active`, the explicit flag wins and the fallback retires for
 * that action.
 *
 * # SS deviations (cumulative — closes when conditions met)
 *
 * 1. Channel-deselect does NOT auto-clear `active`. Closure: when
 *    `applyChannelSelect` gains the `change_active=true` branch
 *    (Blender's `setflag_anim_channels` at `:728-733`).
 * 2. Batch select-toggle does NOT auto-clear `active`. Closure: when
 *    a bulk select-toggle operator ships (queued path #12 territory).
 * 3. ACTIVE writes use `skipHistory: true` at the dispatcher (sister
 *    to Slice 5.F's channel-selection choice). Closure: same as 5.F —
 *    when the 50-entry undo budget is no longer the binding UX
 *    constraint.
 *
 * @module anim/fcurveActive
 */

/**
 * Read accessor for `FCURVE_ACTIVE`.
 *
 * Strict `=== true` check — defensive against accidental writes of
 * `1`/`"yes"`/non-boolean truthy values that aren't part of the
 * contract. Mirrors `isFCurveSelected`, `isFCurveMuted`, `isFCurveHidden`.
 *
 * @param {object|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveActive(fcurve) {
  return !!(fcurve && fcurve.active === true);
}

/**
 * Return the single fcurve in `action.fcurves` with `active === true`,
 * or null if none. The Blender invariant is that AT MOST ONE fcurve
 * carries the flag; SS enforces this at write time (`setActiveFCurve`
 * clears every other entry before setting the target). If a corrupt
 * project carries multiple `active: true` fcurves, this returns the
 * FIRST one in array order — same as Blender's `acf_fcurve_setting_get`
 * behaviour (the channel-list iteration finds the first match).
 *
 * @param {object|null|undefined} action
 * @returns {object|null}
 */
export function getActiveFCurve(action) {
  if (!action || !Array.isArray(action.fcurves)) return null;
  for (const fc of action.fcurves) {
    if (fc && fc.active === true) return fc;
  }
  return null;
}

/**
 * Set the active fcurve in an action.
 *
 * Mirrors `ANIM_set_active_channel` (`anim_channels_edit.cc:237-339`):
 * clears `FCURVE_ACTIVE` on every same-type channel first (`:274` via
 * `ACHANNEL_SETFLAG_CLEAR` then re-sets the target via `:352`
 * `fcu->flag |= FCURVE_ACTIVE`). EXCLUSIVE: at most one fcurve in the
 * action ends up active.
 *
 * Sparse-write convention: every other fcurve's `active` field is
 * DELETED (not set to false) per Rule №2. The target's field is set
 * to `true`. If `fcurveId` is null/empty/no-match, all active flags
 * are cleared (equivalent to `clearActiveFCurves`).
 *
 * @param {object} action — Action datablock (mutated in place)
 * @param {string|null|undefined} fcurveId — fcurve to activate, or null/missing to clear
 * @returns {{ activeNow: string|null, changed: boolean }}
 *   `activeNow` = id of the newly-active fcurve (or null if cleared).
 *   `changed` = any `active` field was written or deleted (used by
 *   dispatcher for phantom-undo prevention; sister to Slice 5.M's
 *   `wouldHideChangeFCurves` pattern).
 */
export function setActiveFCurve(action, fcurveId) {
  const result = { activeNow: /** @type {string|null} */ (null), changed: false };
  if (!action || !Array.isArray(action.fcurves)) return result;

  let target = null;
  if (typeof fcurveId === 'string' && fcurveId.length > 0) {
    target = action.fcurves.find((f) => f && f.id === fcurveId) ?? null;
  }

  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (fc === target) {
      if (fc.active !== true) {
        fc.active = true;
        result.changed = true;
      }
    } else if (fc.active === true) {
      delete fc.active;
      result.changed = true;
    } else if (Object.prototype.hasOwnProperty.call(fc, 'active')) {
      // Sparse-write convention: a sibling carrying `active: false`
      // explicitly is also normalized to missing. Pre-slice JSON files
      // never wrote this shape, but defensive normalisation keeps the
      // schema clean.
      delete fc.active;
      result.changed = true;
    }
  }

  if (target) result.activeNow = target.id;
  return result;
}

/**
 * Clear every fcurve's `active` flag in an action.
 *
 * Sparse-write convention: deletes the field rather than setting to
 * false. Returns the count of cleared entries so the dispatcher can
 * skip the undo write when the action was already clean (sister to
 * Slice 5.M's `wouldHideChangeFCurves`).
 *
 * @param {object} action — Action datablock (mutated in place)
 * @returns {{ cleared: number }}
 */
export function clearActiveFCurves(action) {
  let cleared = 0;
  if (!action || !Array.isArray(action.fcurves)) return { cleared: 0 };
  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (Object.prototype.hasOwnProperty.call(fc, 'active')) {
      delete fc.active;
      cleared++;
    }
  }
  return { cleared };
}

/**
 * Preflight for {@link setActiveFCurve}: returns true iff calling the
 * setter would mutate any field. Mirrors Slice 5.M's
 * `wouldHideChangeFCurves` pattern for phantom-undo prevention at the
 * dispatcher (`updateProject` at `projectStore.js:230-232` pushes the
 * snapshot unconditionally before the recipe runs, so a no-op call
 * still burns an undo slot unless the caller short-circuits via this
 * preflight).
 *
 * Per Deviation 3, ACTIVE writes use `skipHistory: true` today, so the
 * phantom-undo concern is muted — but the preflight is kept for sister
 * symmetry with the other channel-flag helpers + to insulate against
 * a future flip back to undo-tracked writes.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @returns {boolean}
 */
export function wouldSetActiveFCurveChange(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) return false;

  let target = null;
  if (typeof fcurveId === 'string' && fcurveId.length > 0) {
    target = action.fcurves.find((f) => f && f.id === fcurveId) ?? null;
  }

  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (fc === target) {
      if (fc.active !== true) return true;
    } else if (Object.prototype.hasOwnProperty.call(fc, 'active')) {
      // Either explicit `true` (needs clearing) or stale `false`
      // (sparse-write normalisation).
      return true;
    }
  }
  return false;
}
