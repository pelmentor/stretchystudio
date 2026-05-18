// @ts-check

/**
 * Animation Phase 5 Slice 5.DD — graph-region select-all channel
 * cascade + active-restore.
 *
 * Pure mutation helper that ports two coupled Blender behaviors from
 * the GRAPH-region (timeline) select-all operator:
 *
 *   1. **`do_channels=true` cascade** — `deselect_graph_keys` at
 *      `reference/blender/source/blender/editors/space_graph/graph_select.cc:397-413`
 *      cascades the bulk keyform-selection operation into
 *      per-fcurve `FCURVE_SELECTED` AND unconditionally clears
 *      `FCURVE_ACTIVE` on every visible fcurve.
 *
 *   2. **Active-restore pass** — `graphkeys_deselectall_exec` at
 *      `graph_select.cc:459-470` stashes the previously-active fcurve
 *      BEFORE the cascade and re-elevates it (`FCURVE_SELECTED |
 *      FCURVE_ACTIVE`) AFTER. The comment at `:433-436` explains the
 *      UX: "find active F-Curve, and preserve this for later or else
 *      it becomes annoying with the current active curve keeps fading
 *      out even while you're editing it".
 *
 * Closes Slice 5.X-4 deviation ("No active-restore pass after bulk
 * select-toggle / deselect-all"). Sister to:
 *   - Slice 5.F `applyChannelSelect`  (per-channel click selection)
 *   - Slice 5.K `applyChannelSelectAll` (per-channel bulk; CHANNEL-region,
 *     does NOT have an active-restore — `ANIM_OT_channels_select_all`
 *     at `anim_channels_edit.cc:3521-3554` is deliberately
 *     restore-less)
 *   - Slice 5.X `setActiveFCurve` / `clearActiveFCurves` / `getActiveFCurve`
 *   - Slice 5.Z dispatcher wire-through for CHANNEL-region clearActive
 *
 * # Why a separate helper instead of extending applyChannelSelectAll?
 *
 * Blender's GRAPH-region `GRAPH_OT_select_all` (`graph_select.cc:478-490`)
 * and CHANNEL-region `ANIM_OT_channels_select_all`
 * (`anim_channels_edit.cc:3556-3575`) are DIFFERENT operators with
 * DIFFERENT semantics:
 *
 *   - Channel-region:
 *     - Operates on `fc.selected` directly (via
 *       `ANIM_anim_channels_select_set` → ANIMTYPE_FCURVE case at
 *       `:723-734`)
 *     - DOES clear `fc.active` cascade on deselect (line 728-732,
 *       gated by `change_active = (sel != EXTEND_RANGE)`)
 *     - Does NOT restore the previously-active. Blender's intent:
 *       channel-region select-all clears active when active gets
 *       deselected. Documented in `ANIM_OT_channels_select_all` —
 *       no restore pass in the exec body.
 *
 *   - Graph-region:
 *     - Operates on KEYFORM selection first
 *     - Cascades to `fc.selected` + `fc.active` per `do_channels=true`
 *     - DOES restore the previously-active per `:459-470`
 *
 * Both regions are bound to A / Alt+A / Ctrl+I in their respective
 * keymaps. SS's FCurveEditor handles both: sidebar-hover dispatches to
 * `applyChannelSelectAllOp` (channel-region); timeline-hover
 * dispatches to graph-region keyform ops which now also call this
 * cascade helper.
 *
 * # SS deviations from Blender
 *
 *   1. **Scope = `ctx.orderedIds`.** Blender's `deselect_graph_keys`
 *      filter at `:363-364` is
 *      `ANIMFILTER_DATA_VISIBLE | ANIMFILTER_CURVE_VISIBLE |
 *      ANIMFILTER_FCURVESONLY | ANIMFILTER_NODUPLIS`. SS's
 *      `orderedIds` is the visible-channel scope from FCurveEditor's
 *      `visible` (which respects `isFCurveHidden` + group expanded
 *      state). Out-of-scope (hidden / collapsed-group) fcurves are
 *      not touched. Same Slice 5.Y MED-1 scope convention.
 *
 *   2. **EXCLUSIVE re-elevation via `setActiveFCurve`.** Blender's
 *      `:466` does a direct bit-OR (`fcu->flag |= (FCURVE_SELECTED |
 *      FCURVE_ACTIVE)`) without clearing other fcurves' FCURVE_ACTIVE
 *      first. SS routes through `setActiveFCurve(action, id)` which
 *      enforces the Slice 5.X EXCLUSIVE invariant (at most one
 *      `fc.active === true`). Functionally equivalent given that
 *      Step 2 cleared all in-scope `fc.active` first; the EXCLUSIVE
 *      wrap is defensive against stale out-of-scope `fc.active` that
 *      shouldn't exist per Slice 5.X invariant.
 *
 *   3. **Stash scope match.** Blender's `get_active_fcurve_channel`
 *      at `:437` only returns the active fcurve if it's visible.
 *      SS's helper requires the caller to pass `previouslyActive`
 *      (typically `getActiveFCurve(action)?.id`) AND gates the
 *      restore on `orderedIds.indexOf(previouslyActive) !== -1`. If
 *      the active was hidden, the restore is skipped — matching
 *      Blender's `ale_active = null` skip path at `:460`.
 *
 *   4. **No `OPTYPE_UNDO` snapshot.** Inherited from Slice 5.F/5.K
 *      convention. Channel selection (and the keyform-level mirror)
 *      is view state.
 *
 * # No migration
 *
 * Reuses existing `fc.selected` (Slice 5.F) and `fc.active` (Slice
 * 5.X) sparse-boolean fields. Per Rule №2: no migration baggage.
 *
 * @module anim/graphSelectAllCascade
 */

import { setActiveFCurve } from './fcurveActive.js';

/**
 * Apply the GRAPH-region select-all channel cascade + active-restore
 * pass in-place on an action. Mirrors Blender's
 * `graphkeys_deselectall_exec` (`graph_select.cc:423-476`) wrapping
 * `deselect_graph_keys` (`:354-419`).
 *
 * Pure mutator — the caller (FCurveEditor's `graphSelectAllOp`
 * dispatcher) is responsible for the keyform-handle-level mutation
 * (`setSelectedHandles(...)`) that happens FIRST. This helper handles
 * ONLY the cascade-to-channel-selection + active-clear-then-restore
 * pass that mirrors Blender's `do_channels=true` path + the outer
 * restore step.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {'add'|'clear'|'invert'} mode — keyform-side intent:
 *   - 'add'    — bulk select-all (was: SS `operatorSelectAll`).
 *                Cascades `fc.selected = true` on every in-scope
 *                fcurve. Matches Blender's `SELECT_ADD` path at
 *                `:386` + `:408`.
 *   - 'clear'  — bulk deselect-all (was: SS `clearSelection`).
 *                Cascades `fc.selected = false`. Matches Blender's
 *                `SELECT_SUBTRACT` at `:405`.
 *   - 'invert' — per-fcurve flip (was: SS `operatorInvertSelection`).
 *                Cascades `fc.selected` flipped per channel. Matches
 *                Blender's `SELECT_INVERT` at `:386` + `:407-408`
 *                (where the cascade computes the new state from the
 *                CURRENT fc.selected, not from the per-keyform check).
 * @param {{ orderedIds?: string[], previouslyActive?: string|null }} [ctx]
 *   — `orderedIds` is the visible scope (REQUIRED for any meaningful
 *   work). `previouslyActive` is the fcurve id that was active BEFORE
 *   the cascade ran (caller typically passes
 *   `getActiveFCurve(action)?.id` snapshotted inside the same
 *   `update()` closure BEFORE this helper is called).
 * @returns {{
 *   changed: boolean,
 *   restoredActive: boolean,
 *   cascadedSelected: number,
 *   clearedActiveCount: number,
 * }}
 */
export function applyGraphSelectAllChannelCascade(action, mode, ctx) {
  const result = {
    changed: false,
    restoredActive: false,
    cascadedSelected: 0,
    clearedActiveCount: 0,
  };
  if (!action || !Array.isArray(action.fcurves)) return result;
  if (mode !== 'add' && mode !== 'clear' && mode !== 'invert') return result;
  const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
  if (!orderedIds || orderedIds.length === 0) return result;
  const previouslyActive = ctx
    && typeof ctx.previouslyActive === 'string'
    && ctx.previouslyActive.length > 0
    ? ctx.previouslyActive
    : null;

  const byId = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
  }

  // Step 1 — cascade `fc.selected` per `deselect_graph_keys`
  // `do_channels=true` path at `:397-410`.
  //
  // Blender's logic at `:404-409`:
  //   if (sel == SELECT_SUBTRACT) fcu->flag &= ~FCURVE_SELECTED;
  //   else                        fcu->flag |= FCURVE_SELECTED;
  //
  // For INVERT, Blender's `:386` already computed `sel = SELECT_INVERT`
  // and the per-channel SELECT bit was flipped via `:407-408` based on
  // the new (post-keyform-invert) state. SS approximates by flipping
  // `fc.selected` directly here — the keyform-level flip is the
  // caller's responsibility (setSelectedHandles) and the channel-level
  // flip is independent of the per-keyform state. This is a SS
  // deviation from Blender's exact code path; net observable behavior
  // matches for the typical use case (toggle/select/deselect/invert
  // bulk ops where keyform and channel selection track together).
  for (const id of orderedIds) {
    const fc = byId.get(id);
    if (!fc) continue;
    if (mode === 'add') {
      if (fc.selected !== true) {
        fc.selected = true;
        result.changed = true;
        result.cascadedSelected++;
      }
    } else if (mode === 'clear') {
      if (fc.selected === true) {
        fc.selected = false;
        result.changed = true;
        result.cascadedSelected++;
      }
    } else { // invert
      const was = fc.selected === true;
      fc.selected = !was;
      // sparse-clear false-to-missing? Slice 5.F convention writes
      // false explicitly when transitioning from true, so we follow.
      result.changed = true;
      result.cascadedSelected++;
    }
  }

  // Step 2 — "always deactivate all F-Curves if we perform batch ops
  // for selection" at `:412-413`. SS optimization: skip
  // `previouslyActive` because Step 3 would re-set it anyway —
  // avoiding the transient flip keeps the setter's `changed` flag
  // honest with the preflight's net-change prediction (sister pattern
  // to Slice 5.BB's pre-clear in-group skip + Slice 5.Y's pre-clear
  // optimization). Net state matches Blender's unconditional-clear +
  // restore exactly; only the intermediate state differs (and it
  // isn't observable across the immer draft's recipe boundary).
  for (const id of orderedIds) {
    if (id === previouslyActive) continue;
    const fc = byId.get(id);
    if (fc && fc.active === true) {
      delete fc.active;
      result.changed = true;
      result.clearedActiveCount++;
    }
  }

  // Step 3 — restore previously-active at `:459-470`. Two gates:
  //   (a) `previouslyActive` was provided by the caller (non-null id)
  //   (b) the previously-active is in `orderedIds` (matches Blender's
  //       `get_active_fcurve_channel` visibility gate at `:437`)
  // If both pass, re-elevate via EXCLUSIVE `setActiveFCurve` which
  // also ensures any stale out-of-scope `fc.active` gets cleared
  // (defensive against Slice 5.X invariant breach).
  if (previouslyActive && orderedIds.indexOf(previouslyActive) !== -1) {
    const fc = byId.get(previouslyActive);
    if (fc) {
      if (fc.selected !== true) {
        fc.selected = true;
        result.changed = true;
      }
      const setResult = setActiveFCurve(action, previouslyActive);
      if (setResult.changed) {
        result.changed = true;
      }
      // `restoredActive` signals "the restore path executed", NOT
      // "a transition occurred". Step 2's previouslyActive-skip
      // optimization may have left the active flag intact, so the
      // setActiveFCurve call ends up a no-op — but the restore
      // SEMANTIC ("this fcurve is now guaranteed to be selected +
      // active at the end") still holds. Sister to Slice 5.K's
      // `resultMode` return field convention (decision describes
      // what was attempted, not just what mutated).
      result.restoredActive = true;
    }
  }

  return result;
}

/**
 * Read-only preflight for {@link applyGraphSelectAllChannelCascade}.
 * Same undo-budget / phantom-render rationale as Slice 5.M / 5.Y
 * preflights.
 *
 * @param {object|null|undefined} action
 * @param {'add'|'clear'|'invert'} mode
 * @param {{ orderedIds?: string[], previouslyActive?: string|null }} [ctx]
 * @returns {boolean}
 */
export function wouldGraphSelectAllChannelCascadeChange(action, mode, ctx) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (mode !== 'add' && mode !== 'clear' && mode !== 'invert') return false;
  const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
  if (!orderedIds || orderedIds.length === 0) return false;
  const previouslyActive = ctx
    && typeof ctx.previouslyActive === 'string'
    && ctx.previouslyActive.length > 0
    ? ctx.previouslyActive
    : null;

  const byId = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
  }

  // Step 1 — would cascade flip any `fc.selected`?
  for (const id of orderedIds) {
    const fc = byId.get(id);
    if (!fc) continue;
    if (mode === 'add' && fc.selected !== true) return true;
    if (mode === 'clear' && fc.selected === true) return true;
    if (mode === 'invert') return true;  // invert always flips at least the field's value
  }

  // Step 2 — would cascade clear any `fc.active`?
  for (const id of orderedIds) {
    const fc = byId.get(id);
    if (fc && fc.active === true) {
      // If this fc is the one to be restored, Step 3 will re-set it →
      // net no change for THIS field. Continue checking others.
      if (id === previouslyActive) continue;
      return true;
    }
  }

  // Step 3 — would restore mutate anything?
  if (previouslyActive && orderedIds.indexOf(previouslyActive) !== -1) {
    const fc = byId.get(previouslyActive);
    if (fc) {
      // After step 1+2, restore sets fc.selected=true (was: anything)
      // and fc.active=true (was: false/missing after step 2 clear).
      // If pre-step-1 fc.selected was true AND mode was 'add', no flip;
      // step 2 would have cleared fc.active; step 3 re-sets it.
      // Need: did step 2 actually clear something we'd re-set, OR did
      // step 1 transitions leave the previously-active in a state that
      // step 3 mutates?
      const wasSelected = fc.selected === true;
      let postCascadeSelected;
      if (mode === 'add') postCascadeSelected = true;
      else if (mode === 'clear') postCascadeSelected = false;
      else postCascadeSelected = !wasSelected;  // invert
      // Step 3 sets selected=true regardless of postCascadeSelected.
      // If postCascadeSelected !== true, step 3 mutates.
      if (postCascadeSelected !== true) return true;
      // Step 3 ALSO calls setActiveFCurve which sets fc.active=true if
      // it isn't already true (and was just cleared in step 2 IF
      // wasActive). Or if some OTHER fc had active=true that would be
      // cleared by EXCLUSIVE. Both scenarios = change.
      if (fc.active !== true) return true;  // would transition to true
      // Also: any OTHER fcurve with active=true would be cleared by
      // setActiveFCurve EXCLUSIVE.
      for (const other of action.fcurves) {
        if (other && other !== fc && other.active === true) return true;
      }
    }
  }

  return false;
}
