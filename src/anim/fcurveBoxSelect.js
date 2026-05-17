// @ts-check

/**
 * Animation Phase 5 Slice 5.Y — Channel-list box (drag-rect) selection.
 *
 * Pure mutation helper for sidebar drag-rect selection — Blender's
 * `ANIM_OT_channels_select_box` operator
 * (`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:3740-3760`).
 * The DOM-side drag-rect / hit-test plumbing lives in the FCurveEditor
 * Sidebar; this module owns the data mutation.
 *
 * Sister to:
 *   - Slice 5.F `applyChannelSelect` (click-driven selection, view state)
 *   - Slice 5.K `applyChannelSelectAll` (bulk select-all, view state)
 *   - Slice 5.X `setActiveFCurve` / `clearActiveFCurves` (persisted
 *     FCURVE_ACTIVE bit, Slice 5.X)
 *
 * # Blender semantics ported
 *
 * **Operator** — `ANIM_OT_channels_select_box` at
 * `anim_channels_edit.cc:3740-3760`. Exec body at
 * `animchannels_box_select_exec` (`:3704-3738`):
 *
 *   1. Read `select = !RNA_boolean_get("deselect")` (`:3709`) and
 *      `extend = RNA_boolean_get("extend")` (`:3710`).
 *   2. If `!extend`, call `ANIM_anim_channels_select_set(ac,
 *      ACHANNEL_SETFLAG_CLEAR)` (`:3720-3722`) — wipes selection on the
 *      VISIBLE channel list. The set walks `anim_channels_for_selection`
 *      (defn at `:523-534`, call-site `:823`), whose filter is
 *      `ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_CHANNELS` —
 *      explicitly NO `ANIMFILTER_LIST_VISIBLE` per the load-bearing
 *      comment at `:528` ("no list visible, otherwise, we get
 *      dangling"). So Blender's pre-clear scope INCLUDES fcurves under
 *      collapsed groups. The pre-clear ALSO clears `FCURVE_ACTIVE` for
 *      every deselected fcurve via the per-channel cascade in
 *      `anim_channels_select_set` ANIMTYPE_FCURVE case at `:728-732`
 *      ("Only erase the ACTIVE flag when deselecting").
 *   3. Compute `selectmode = select ? ACHANNEL_SETFLAG_ADD :
 *      ACHANNEL_SETFLAG_CLEAR` (`:3724-3729`).
 *   4. Call `box_select_anim_channels(&ac, rect, selectmode)` (`:3732`)
 *      which has its OWN filter call at `:3596-3597` with the WIDER set
 *      `ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_VISIBLE |
 *      ANIMFILTER_LIST_CHANNELS` (`:3594`) — note `LIST_VISIBLE` IS
 *      included here, so the in-rect-loop scope EXCLUDES fcurves under
 *      collapsed groups. For each visible channel whose row-Y range
 *      intersects the drag rect (`:3619`), it calls
 *      `ANIM_channel_setting_set(..., ACHANNEL_SETTING_SELECT,
 *      selectmode)` (`:3621-3622`). The in-rect path does NOT trigger
 *      the active-clear cascade — `ANIM_channel_setting_set` only flips
 *      the SELECT bit, no callback into `anim_channels_select_set`.
 *   5. Box-select NEVER calls `ANIM_set_active_channel` — there is no
 *      active-elevation step. The active flag's only path to clear here
 *      is the pre-clear cascade in step 2.
 *
 * **Keymap** — `blender_default.py:3865-3871`:
 *
 *   ```
 *   ("anim.channels_select_box", {"type": 'B', "value": 'PRESS'}, None),
 *   ("anim.channels_select_box", {"type": 'LEFTMOUSE', "value": 'CLICK_DRAG'},
 *    {"properties": [("extend", False)]}),
 *   ("anim.channels_select_box", {"type": 'LEFTMOUSE', "value": 'CLICK_DRAG', "shift": True},
 *    {"properties": [("extend", True)]}),
 *   ("anim.channels_select_box", {"type": 'LEFTMOUSE', "value": 'CLICK_DRAG', "ctrl": True},
 *    {"properties": [("deselect", True)]}),
 *   ```
 *
 * Mapping to this helper's `mode` parameter:
 *
 *   - **plain LMB drag → `'replace'`** (`extend=false, deselect=false`):
 *     pre-clear visible scope; then ADD in-rect ids. Active loses its
 *     flag (pre-clear cascade) and is NOT re-elevated (no operator hook).
 *
 *   - **Shift+LMB drag → `'extend'`** (`extend=true, deselect=false`):
 *     NO pre-clear; ADD in-rect ids. Active preserved.
 *
 *   - **Ctrl+LMB drag → `'deselect'`** (`extend=false, deselect=true`):
 *     pre-clear visible scope; then CLEAR in-rect ids. Note that the
 *     pre-clear has already zeroed every visible channel's `selected`,
 *     so the in-rect CLEAR loop is a no-op. Net effect: every visible
 *     channel is deselected and active is cleared. This is the LITERAL
 *     Blender behavior — Blender's keymap entry sets `deselect=True`
 *     but does NOT pass `extend=True`, so `extend` falls to its default
 *     of False and the pre-clear runs. The visible result feels like
 *     "Ctrl+drag clears the entire channel list", which is consistent
 *     with `anim_channels_edit.cc:3720-3729`. See Deviation 1 below.
 *
 *   - **B-key invocation** — Blender's B key fires the standard
 *     `WM_gesture_box_invoke` modal which lets the user draw a rect with
 *     plain/Shift/Ctrl meaning the same as LMB-drag. SS routes the same
 *     three modifiers through this helper; the B-key entry point is
 *     deferred to the FCurveEditor key handler (out of scope for this
 *     module).
 *
 * **Active-flag cascade** — Slice 5.X's `clearActiveFCurves(action)`
 * sparse-deletes `fc.active` on every fcurve. This helper calls it when
 * the pre-clear path ran AND the previously-active fcurve was in the
 * visible scope. The semantic match with Blender is:
 *
 *   - 'replace' + 'deselect': pre-clear runs → active in scope loses
 *     ACTIVE. Helper calls `clearActiveFCurves`.
 *   - 'extend': pre-clear does NOT run → active preserved. Helper does
 *     NOT touch active.
 *
 * Why call `clearActiveFCurves` (which clears ALL fcurves) rather than
 * targeting just the previously-active one? Because the EXCLUSIVE
 * invariant of `fc.active` (Slice 5.X) guarantees at most ONE fcurve
 * carries `active === true`, so clearing all is equivalent to clearing
 * the previously-active one. Spending a function call on the broader
 * predicate keeps the helper robust to any future relaxation of that
 * invariant.
 *
 * # SS deviations from Blender
 *
 *   1. **`'deselect'` mode net-effect-clears the visible list.** This
 *      matches Blender's keymap-driven exec exactly (`extend` defaults
 *      to False when only `deselect` is set), but reads as "Ctrl+drag
 *      wipes the entire channel list" which is unusual UX. SS faithfully
 *      ports the behavior rather than silently fixing it. If a future
 *      slice decides to remap the SS UX (e.g. "Ctrl+drag deselects
 *      ONLY in-rect, preserves out-of-rect"), it should do so by adding
 *      `extend: true` to the Ctrl+drag invocation, not by patching this
 *      helper. The literal-Blender behavior stays the default per Rule
 *      №1 (no quick fix on top of an upstream-correct port).
 *
 *   2. **No `OPTYPE_UNDO` snapshot.** Blender registers the operator
 *      with `OPTYPE_REGISTER | OPTYPE_UNDO` (`:3756`). SS skips undo for
 *      channel selection — matches Slice 5.F's `skipHistory: true`
 *      rationale (channel-list selection is view state, not document
 *      state) and Slice 5.K's same stance. The caller (FCurveEditor)
 *      must use `update(..., { skipHistory: true })` to invoke this
 *      helper, just like the click-select and select-all paths.
 *
 *   3. **Two distinct Blender scopes folded into one (`ctx.orderedIds`).**
 *      Blender uses TWO different filter sets across the operator:
 *        - **Pre-clear scope** (`anim_channels_for_selection` defn at
 *          `:523-534`, called via `ANIM_anim_channels_select_set` at
 *          `:821-826`): filter `ANIMFILTER_DATA_VISIBLE |
 *          ANIMFILTER_LIST_CHANNELS`. Note the explicit comment at
 *          `:528` ("no list visible, otherwise, we get dangling") —
 *          this scope INCLUDES fcurves under collapsed groups.
 *        - **In-rect-loop scope** (inline filter at `:3594` inside
 *          `box_select_anim_channels`): filter
 *          `ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_VISIBLE |
 *          ANIMFILTER_LIST_CHANNELS`. With `LIST_VISIBLE` included,
 *          this scope EXCLUDES fcurves under collapsed groups.
 *
 *      SS uses a single `ctx.orderedIds` (FCurveEditor's `decoded`
 *      filtered through `isFCurveEffectivelyHidden`, narrowed further
 *      by the Sidebar's `expanded ? ... : null` ternary) for BOTH the
 *      pre-clear and in-rect-loop scopes. That matches the NARROWER
 *      in-rect-loop scope, so SS is faithful to Blender on hit-test
 *      semantics but DIVERGES on pre-clear: collapsed-group fcurves
 *      keep their `selected` (and therefore `active`) in SS where
 *      Blender would clear them.
 *
 *      The divergence is the documented SS UX choice — don't clear
 *      stuff the user can't see in the sidebar. A future slice that
 *      wants byte-faithful pre-clear semantics should split this
 *      helper's `ctx` into `preClearIds` (wider) + `inRectIds` (the
 *      hit-test scope) and have the caller compute both from the same
 *      `decoded` source. Audit-fix MED-A1+A2 (Slice 5.Y fidelity audit
 *      2026-05-17): the original Deviation 3 conflated the two scopes
 *      into one cite and mis-attributed `:3594` to
 *      `anim_channels_for_selection` (that function's defn is at
 *      `:523`; `:3594` is the inline filter inside
 *      `box_select_anim_channels`).
 *
 *   4. **Hit-test lives in the caller, not here.** The helper takes
 *      `idsInRect: string[]` — the hit-test against row bounding boxes
 *      is a DOM concern (`getBoundingClientRect()` on each row, intersect
 *      with the drag rect). Keeping the helper pure means it's testable
 *      without JSDOM and the DOM-side plumbing can iterate independently.
 *
 * # No migration
 *
 * Reuses `fc.selected` (Slice 5.F) and `fc.active` (Slice 5.X) — no new
 * schema fields. Per Rule №2: no migration baggage.
 *
 * @module anim/fcurveBoxSelect
 */

import { clearActiveFCurves } from './fcurveActive.js';

/**
 * Apply a box (drag-rect) selection mutation in-place on an action.
 *
 * Mutates `action.fcurves[i].selected` per Blender's
 * `ANIM_OT_channels_select_box` semantics. When the pre-clear path ran
 * AND the previously-active fcurve was in the visible scope, also
 * sparse-clears `fc.active` on every fcurve (via `clearActiveFCurves`).
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string[]} idsInRect — fcurve ids whose row rect intersected the
 *   drag rect (computed by the caller's DOM hit-test)
 * @param {'replace'|'extend'|'deselect'} mode — see module header for
 *   the modifier-to-mode mapping
 * @param {{ orderedIds?: string[], activeFCurveId?: string|null }} [ctx]
 *   — `orderedIds` is the visible-channel scope (required for any
 *   meaningful work; missing/empty returns a no-op decision).
 *   `activeFCurveId` is the previously-active fcurve id (used for the
 *   `clearActive` decision).
 * @returns {{
 *   changed: boolean,
 *   clearedActive: boolean,
 *   resultMode: 'replace'|'extend'|'deselect'|null,
 *   selectedAfter: number,
 *   touchedCount: number,
 * }}
 */
export function applyChannelBoxSelect(action, idsInRect, mode, ctx) {
  const empty = {
    changed: false,
    clearedActive: false,
    resultMode: /** @type {'replace'|'extend'|'deselect'|null} */ (null),
    selectedAfter: 0,
    touchedCount: 0,
  };
  if (!action || !Array.isArray(action.fcurves)) return empty;
  if (mode !== 'replace' && mode !== 'extend' && mode !== 'deselect') return empty;

  const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
  if (!orderedIds || orderedIds.length === 0) return empty;

  const activeFCurveId = ctx
    && typeof ctx.activeFCurveId === 'string'
    && ctx.activeFCurveId.length > 0
    ? ctx.activeFCurveId
    : null;

  // Build id-keyed map ONCE so per-id lookups are O(1). Defensive against
  // `orderedIds` entries that are not in `action.fcurves` (ghost ids
  // from a stale render, same pattern as Slice 5.J range-select MED-A1
  // and Slice 5.K MED-A1).
  const byId = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
  }

  // `idsInRect` is a list (not a set) from the caller; convert once.
  // Defensive against duplicate or out-of-scope ids — only ids that are
  // ALSO in `orderedIds` count (matches Blender's scope of
  // `anim_channels_for_selection`).
  const inRectSet = new Set();
  if (Array.isArray(idsInRect)) {
    for (const id of idsInRect) {
      if (typeof id === 'string' && id.length > 0) inRectSet.add(id);
    }
  }

  let changed = false;
  let touchedCount = 0;

  // Step 2 — pre-clear visible scope when `!extend`. Sister to Blender's
  // `if (!extend) ANIM_anim_channels_select_set(CLEAR)` at
  // `anim_channels_edit.cc:3720-3722`. Scope is the visible channel
  // list (`anim_channels_for_selection` at `:823`).
  const preClear = (mode === 'replace' || mode === 'deselect');
  if (preClear) {
    for (const id of orderedIds) {
      const fc = byId.get(id);
      if (fc && fc.selected === true) {
        fc.selected = false;
        changed = true;
      }
    }
  }

  // Step 4 — in-rect mutation. Blender computes
  // `selectmode = select ? ADD : CLEAR` (`:3724-3729`) once, then loops
  // visible channels and applies `selectmode` to each whose row Y range
  // intersects the rect. The Y-range intersection is the caller's job
  // (DOM hit-test); we just iterate `idsInRect`.
  const targetSelected = (mode !== 'deselect');
  for (const id of orderedIds) {
    if (!inRectSet.has(id)) continue;
    const fc = byId.get(id);
    if (!fc) continue;
    touchedCount++;
    if (targetSelected && fc.selected !== true) {
      fc.selected = true;
      changed = true;
    } else if (!targetSelected && fc.selected === true) {
      fc.selected = false;
      changed = true;
    }
  }

  // Step 5 — active-flag cascade. Blender's pre-clear at step 2 routes
  // through `anim_channels_select_set` ANIMTYPE_FCURVE case at
  // `anim_channels_edit.cc:723-734`: when an fcurve transitions to
  // !FCURVE_SELECTED AND `change_active` is true, the cascade also
  // clears FCURVE_ACTIVE on that fcurve. For box select,
  // `change_active = (sel != EXTEND_RANGE) = true` (`:683`), so any
  // fcurve that lost SELECTED via pre-clear also loses ACTIVE.
  //
  // Box-select NEVER re-elevates active (no `ANIM_set_active_channel`
  // call in the exec body). So even when 'replace' mode happens to
  // include the active fcurve in the rect (re-selecting it), the
  // ACTIVE flag stays cleared.
  //
  // We call the exclusive `clearActiveFCurves(action)` when both:
  //   - pre-clear ran (mode 'replace' or 'deselect'), AND
  //   - the previously-active fcurve is in the visible scope.
  // Per the EXCLUSIVE invariant of `fc.active` (Slice 5.X), at most one
  // fcurve carries `active === true`, so clearing all is equivalent to
  // clearing the previously-active one.
  let clearedActive = false;
  if (preClear && activeFCurveId && orderedIds.indexOf(activeFCurveId) !== -1) {
    const result = clearActiveFCurves(action);
    if (result.cleared > 0) clearedActive = true;
  }

  // Final selectedAfter count — walk visible scope only (matches the
  // scope of the operator and avoids counting unrelated invisible
  // fcurves that retained their selection from a prior session).
  let selectedAfter = 0;
  for (const id of orderedIds) {
    const fc = byId.get(id);
    if (fc && fc.selected === true) selectedAfter++;
  }

  return { changed, clearedActive, resultMode: mode, selectedAfter, touchedCount };
}

/**
 * Read-only preflight for {@link applyChannelBoxSelect}.
 *
 * Returns true iff calling the setter with the same arguments would
 * mutate `action.fcurves[i].selected` OR `action.fcurves[i].active`.
 * Used by the FCurveEditor dispatcher to skip the no-op update() call
 * (same undo-budget rationale as Slice 5.M's `wouldHideChangeFCurves` —
 * `projectStore.js:230-232` pushes a snapshot unconditionally before
 * the recipe, and channel selection uses `skipHistory:true` so the
 * snapshot is harmless, but skipping the recipe also avoids spurious
 * React re-renders driven by `update()` triggering store notify).
 *
 * @param {object|null|undefined} action
 * @param {string[]} idsInRect
 * @param {'replace'|'extend'|'deselect'} mode
 * @param {{ orderedIds?: string[], activeFCurveId?: string|null }} [ctx]
 * @returns {boolean}
 */
export function wouldChannelBoxSelectChange(action, idsInRect, mode, ctx) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (mode !== 'replace' && mode !== 'extend' && mode !== 'deselect') return false;
  const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
  if (!orderedIds || orderedIds.length === 0) return false;
  const activeFCurveId = ctx
    && typeof ctx.activeFCurveId === 'string'
    && ctx.activeFCurveId.length > 0
    ? ctx.activeFCurveId
    : null;

  const byId = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
  }
  const inRectSet = new Set();
  if (Array.isArray(idsInRect)) {
    for (const id of idsInRect) {
      if (typeof id === 'string' && id.length > 0) inRectSet.add(id);
    }
  }

  const preClear = (mode === 'replace' || mode === 'deselect');

  // Pre-clear would change something? Any visible-scope fcurve currently
  // selected that isn't going to be re-selected in the in-rect step.
  if (preClear) {
    const targetSelected = (mode !== 'deselect');
    for (const id of orderedIds) {
      const fc = byId.get(id);
      if (!fc || fc.selected !== true) continue;
      // Pre-clear flips this to false. If the in-rect step would
      // re-flip it back to true, no net change for this id; otherwise
      // there IS a change.
      const inRect = inRectSet.has(id);
      if (!(targetSelected && inRect)) return true;
    }
  }

  // In-rect step would change something? Any in-rect id whose current
  // state differs from the target (after pre-clear).
  const targetSelected = (mode !== 'deselect');
  for (const id of orderedIds) {
    if (!inRectSet.has(id)) continue;
    const fc = byId.get(id);
    if (!fc) continue;
    const currentAfterPreClear = preClear ? false : (fc.selected === true);
    if (currentAfterPreClear !== targetSelected) return true;
  }

  // Active-clear would change something? Only when pre-clear runs AND
  // active is in scope AND any fcurve currently carries `active === true`.
  if (preClear && activeFCurveId && orderedIds.indexOf(activeFCurveId) !== -1) {
    for (const fc of action.fcurves) {
      if (fc && fc.active === true) return true;
    }
  }

  return false;
}
