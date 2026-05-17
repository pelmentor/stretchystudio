// @ts-check

/**
 * Animation Phase 5 Slice 5.F — Channel selection split helper.
 *
 * Pure mutation helpers for the per-FCurve `selected` boolean — Blender's
 * `FCURVE_SELECTED` bit (`DNA_anim_enums.h:303-310`) — kept INDEPENDENT
 * of the "active FCurve" concept (`FCURVE_ACTIVE`).
 *
 * Exports:
 *   - `applyChannelSelect(action, fcurveId, modifier, ctx)` — click-driven
 *     selection (replace / toggle / range). Slices 5.F + 5.J.
 *   - `applyChannelSelectAll(action, mode, ctx)` — bulk select-all
 *     operators (add / clear / invert / toggle). Slice 5.K.
 *   - `applyChannelDeleteSelected(action)` — bulk delete selected
 *     channels (sidebar X/Delete). Slice 5.N (this slice).
 *   - `wouldChannelDeleteSelectedChange(action)` — read-only preflight
 *     for the dispatcher's no-op gate. Slice 5.N.
 *   - `isFCurveSelected(fc)` — read accessor.
 *
 * Pre-Slice 5.F the SS sidebar collapsed channel selection onto the
 * global `selectionStore` — exactly one FCurve was the "active" curve
 * and no notion of multi-selection existed at the channel-list level.
 * That made any modifier-click in the sidebar a no-op (see the prior
 * comment at the click handler: "...would extend (omitted this slice
 * — see the file-top deferral on channel-vs-keyform selection split)").
 *
 * This slice lifts the deferral. `fcurve.selected` joins the per-FCurve
 * record; the sidebar Ctrl-clicks it independently of the active flag,
 * and Slice 5.J shipped Shift-click range-select on the same field.
 *
 * # Blender semantics ported
 *
 * **Modifier mapping** — Blender's animation-channels keymap at
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:3849-3854`
 * (identical mapping in `industry_compatible_data.py:2329-2334`):
 *
 *   - **plain click → `extend=false, extend_range=false`** → SELECT_REPLACE
 *   - **Shift+click → `extend_range=true`** → SELECT_EXTEND_RANGE (range)
 *   - **Ctrl+click → `extend=true`** → SELECT_INVERT (toggle)
 *   - **Shift+Ctrl+click → `children_only=true`** (ActionGroup-only,
 *     SS-deferred — Slice 5.V shipped the FCurveGroup datablock but
 *     not the group-children-select operator. Closure tied to a
 *     future "group-children select" slice that walks
 *     `getFCurvesInGroup(action, groupId)` and dispatches selection
 *     to each.)
 *
 * Audit-fix HIGH-B1 (Slice 5.J dual-audit 2026-05-17): Slice 5.F's
 * original draft inverted Shift and Ctrl (Shift=toggle, Ctrl=nothing).
 * The mapping above is the Blender-faithful one; the FCurveEditor
 * sidebar click handler dispatches accordingly. The earlier wrong
 * comment cited `anim_channels_edit.cc:4636-4641` as the modifier-
 * precedence authority — that range is the operator's RNA-reading
 * order, NOT the keymap mapping. The keymap is the authority.
 *
 * **Dispatch** — `click_select_channel_fcurve` at
 * `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4223-4257`
 * (called from `mouse_anim_channels` at line 4475, which switches on
 * `ale->type` and routes each channel type to its own per-type click
 * handler) dispatches on `selectmode`:
 *
 *   - **SELECT_REPLACE** (plain click) — line 4239-4243:
 *     `ANIM_anim_channels_select_set(ac, ACHANNEL_SETFLAG_CLEAR)` zeroes
 *     every channel's SELECTED bit, then `fcu->flag |= FCURVE_SELECTED`
 *     sets the clicked one. Active is elevated (line 4247-4254) because
 *     the clicked curve is now selected and the mode is not range.
 *   - **SELECT_INVERT** (Ctrl+click) — line 4231-4234:
 *     `fcu->flag ^= FCURVE_SELECTED` xors the clicked curve ONLY; other
 *     curves' selection is untouched. Active elevation gates on
 *     "selected after the xor" — so toggling OFF doesn't disturb active.
 *   - **SELECT_EXTEND_RANGE** (Shift+click) — line 4235-4238: walks the
 *     channel list between last-active and clicked, range-selecting
 *     everything in between. Does NOT elevate active (line 4247 gate).
 *     SHIPPED in Slice 5.J as the `'range'` modifier — the caller passes
 *     `{ activeFCurveId, orderedIds }` in `ctx`; `orderedIds` is the
 *     sidebar-rendered fcurve-id list (i.e. `decoded.map(d => d.fcurve.id)`).
 *     The walker reproduces `animchannel_select_range`
 *     (`anim_channels_edit.cc:3984-4025`): iterate the ordered list,
 *     flip `in_selection_range` at both the active and the clicked
 *     element, select every element while in the range (inclusive of
 *     both bounds), break when both bounds collapse to one element
 *     (`anim_channels_edit.cc:4017-4021`). Pre-walk clears every
 *     visible-list fcurve's `selected` bit — matches Blender's
 *     `ANIM_anim_channels_select_set(EXTEND_RANGE)` at line 4236
 *     which, per the load-bearing comment at lines 662-669, "uses
 *     [EXTEND_RANGE] to deselect *everything* before
 *     `animchannel_select_range()` later does the actual selection".
 *
 *     **Pre-walk wipe scope** — Audit-fix MED-B1 (Slice 5.J dual-audit):
 *     Blender wipes only the FILTERED visible channel list returned by
 *     `anim_channels_for_selection(ac)`. SS now mirrors that by wiping
 *     only `action.fcurves[i]` entries whose id is in `orderedIds`.
 *     The earlier draft wiped EVERY fcurve in the action, which would
 *     have clobbered the `selected` bit on fcurves filtered out of
 *     `decoded` by unresolvable rna_path — invisible-but-selected
 *     curves would silently lose their selection on Shift+click.
 *
 *     **Auto-downgrade** — Blender's `anim_channels_edit.cc:4517-4522`
 *     calls `animchannel_has_active_of_type(ac, eAnim_ChannelType(ale->type))`
 *     and, if no active channel of the matching type exists, silently
 *     rewrites `selectmode` from `SELECT_EXTEND_RANGE` to `SELECT_INVERT`
 *     so Shift+click degrades into a Ctrl+click toggle rather than a
 *     no-op. SS's single-channel-type universe (everything is an FCurve)
 *     collapses "matching type" to "active exists in the visible list".
 *     The helper downgrades whenever (a) `activeFCurveId` is null /
 *     undefined / not in `orderedIds`. Audit-fix MED-B2 (Slice 5.J dual-
 *     audit): the additional guard "clicked id must also be in
 *     `orderedIds`" is an SS-only safety net for the caller passing a
 *     stale id — it has no Blender counterpart (Blender filters `ale`
 *     to a visible channel via `ANIM_animchannel_find_channel` at line
 *     4498 before the downgrade check even runs).
 *
 * The "elevate active only when newly selected" rule (line 4247) is the
 * load-bearing detail that makes channel-selection feel right: Ctrl-
 * clicking a selected curve to deselect it leaves whatever was active
 * still active. Without that rule, deselecting your active curve would
 * silently swap active to nothing-or-something-unexpected.
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `fcurve.selected` is a sparse
 * boolean: missing in v39-and-older saves, treated as `false` by
 * `isFCurveSelected` below. Per Rule №2 (no migration baggage), a
 * v40 migration that walks every action's fcurves to write
 * `selected: false` would be pure noise — the reader collapses the
 * tri-state (`true` / `false` / missing) into a clean boolean already.
 *
 * # SS deviations from Blender
 *
 *   - **Plain-click also wipes keyform selection on other curves.**
 *     This part was wired pre-Slice 5.F as audit-fix MED-B8
 *     (2026-05-16) which mis-cited `graph_select.cc:1741` as the
 *     authority — that line is in `graphkeys_mselect_invoke` (the
 *     graph-AREA keyframe-click path), not the channel-list click.
 *     Blender's `click_select_channel_fcurve` doesn't touch keyform
 *     selection at all. SS keeps the wipe as a UX extension: clicking
 *     a channel in the sidebar reads as "switch context, drop the
 *     previous keyform picks". Ctrl+click (toggle) and Shift+click
 *     (range) both preserve keyform selection. Documented + verified
 *     in Slice 5.F dual-audit (audit-fix MED-B3).
 *
 *   - **Sidebar row backdrop is selection-aware (3-tier accent tint).**
 *     Blender's `acf_generic_channel_color`
 *     (`anim_channels_defines.cc:185-194`) is selection-agnostic —
 *     backdrop varies only by indent level. Selection state surfaces
 *     ONLY through Blender's per-row text color flip (`TH_TEXT_HI` vs
 *     `TH_TEXT`). SS adds a 3-tier backdrop tint
 *     (active=`bg-accent/60`, selected-non-active=`bg-accent/25`,
 *     inactive=muted-foreground) so multi-channel selection is visible
 *     without forcing the user to read text-color shades. Documented +
 *     verified in Slice 5.F dual-audit (audit-fix MED-B2).
 *
 *   - **No "always at least one selected" Blender invariant exists.**
 *     A prior draft of this header claimed Blender forces at least one
 *     channel to remain selected via implicit active-as-selected. That
 *     was unsupported by the source: Ctrl-clicking the sole selected
 *     curve via line 4231-4234 (`fcu->flag ^= FCURVE_SELECTED`)
 *     legitimately reaches zero `FCURVE_SELECTED` curves;
 *     `ANIM_set_active_channel` only writes `FCURVE_ACTIVE`, never
 *     `FCURVE_SELECTED`. SS's "active orthogonal to selected, both can
 *     be empty" matches Blender — no deviation to document. Removed in
 *     Slice 5.F dual-audit (audit-fix MED-B4).
 *
 *   - **Walker early-exit is an SS perf optimization, not a Blender
 *     port.** Audit-fix LOW-B1 (Slice 5.J dual-audit 2026-05-17): the
 *     range walker breaks after the second bound is hit (line ~232
 *     `if (!inRange && (isActive || isCursor)) break;`). Blender's
 *     `animchannel_select_range` at lines 3989-4022 keeps iterating
 *     the rest of the list — `in_selection_range` is false and
 *     `is_active_elem`/`is_cursor_elem` are false for remaining
 *     elements, so no further selection occurs. Final state is
 *     identical, so this is a pure perf win (skips O(n - rangeSize)
 *     comparisons on big channel lists) rather than a behavioral
 *     divergence. Documented here so a future "make it byte-faithful
 *     for diffing against Blender's behavior" sweep can remove the
 *     exit without changing semantics.
 *
 * # Slice 5.K — bulk select-all (A / Alt+A / Ctrl+I)
 *
 * `applyChannelSelectAll(action, mode, ctx)` ports Blender's
 * `ANIM_OT_channels_select_all` operator
 * (`anim_channels_edit.cc:3521-3554`). The keymap binds three actions
 * (`blender_default.py:3864` → `_template_items_select_actions` at
 * `blender_default.py:420-439`):
 *
 *   - **A → TOGGLE** — `anim_channels_selection_flag_for_toggle` at
 *     `anim_channels_edit.cc:536-570`: scan the visible list; if ANY
 *     channel is selected, resolve to CLEAR; else resolve to ADD.
 *   - **Alt+A → CLEAR** (DESELECT) — every visible channel `selected = false`.
 *   - **Ctrl+I → INVERT** — per-channel flip of `selected`.
 *
 * The industry-compatible keymap remaps to **Ctrl+A → ADD**,
 * **Ctrl+Shift+A → CLEAR**, **Ctrl+I → INVERT** (no TOGGLE);
 * `industry_compatible_data.py:2345-2350`. SS implements the helper
 * surface (the four modes); the FCurveEditor binds the default-keymap
 * spelling A / Alt+A / Ctrl+I to match the user-installed Blender 5.1.
 *
 * Active-flag handling — Blender's per-channel rule at
 * `anim_channels_edit.cc:728-732` ("Only erase the ACTIVE flag when
 * deselecting"): after the per-channel `selected` is updated, if the
 * channel ends up NOT selected AND we're in a mode that allows active
 * to change (`change_active = sel != EXTEND_RANGE` at line 683), clear
 * the channel's ACTIVE flag. Bulk select-all is always `change_active`
 * (no EXTEND_RANGE mode), so the rule collapses to: clear active if
 * the active channel ends up deselected.
 *
 * In SS the active id is global state, not a per-FCurve flag. The
 * helper returns `{ clearActive: boolean }` so the caller (FCurveEditor)
 * can clear `selectionStore.activeFCurveId` when appropriate. The
 * decision matches Blender:
 *   - ADD — active stays active (it ends up selected).
 *   - CLEAR — active goes away if it was in the visible scope (line 728
 *     fires unconditionally on CLEAR because FCURVE_SELECTED was just
 *     wiped to 0). Active NOT in visible scope = untouched.
 *   - INVERT — active goes away if it was in scope AND was selected
 *     before the flip (so it's now deselected).
 *
 * Scope — every mode operates ONLY on `ctx.orderedIds` (the rendered
 * sidebar list). FCurves filtered out of `decoded` by unresolvable
 * rna_path keep their `selected` bit, matching Blender's
 * `anim_channels_for_selection` scope at line 823.
 *
 * Region routing — SS uses a hover-tracked region ref in FCurveEditor
 * to disambiguate KeyA: hover='sidebar' → channel select-all;
 * hover='timeline' → existing keyform select-all (Slice 5.B's
 * `operatorSelectAll`). Mirrors Blender's per-area keymap routing
 * where the channels region and the graph region register independent
 * KeyA bindings.
 *
 * # SS deviations from Blender (Slice 5.K)
 *
 *   - **`clearActive` is computed but NOT forwarded today.** Audit-fix
 *     MED-A1 (Slice 5.K dual-audit 2026-05-17): the helper returns
 *     `clearActive: boolean` matching Blender's per-channel rule, but
 *     the FCurveEditor caller does NOT wire it through to
 *     `selectionStore` because `activeFCurveId` is derived from the
 *     param/node selection there — clearing it would deselect the
 *     active param in the param editor and drop the keyform editor's
 *     active-row context (cross-editor side effect). The resulting
 *     visible divergence: after Alt+A or A-resolves-to-clear, the
 *     sidebar's active row STAYS highlighted with `bg-accent/60`
 *     because the derived `activeFCurveId` is unchanged. In Blender
 *     the highlight disappears (FCURVE_ACTIVE bit was cleared).
 *     This is a known UX gap deferred to the day SS grows a per-
 *     fcurve ACTIVE slot independent of the param/node store
 *     (see the `project_ss_is_embryo` memory). An earlier draft of
 *     this note called the SS behavior "functionally identical" —
 *     that was wrong; the divergence is visible.
 *   - **No `OPTYPE_REGISTER | OPTYPE_UNDO` flags ported.** Bulk
 *     select-all skips the undo stack — matches Slice 5.F's
 *     `skipHistory: true` for click-select. Channel-list selection
 *     is UI state, not document state per the audit-fix MED-C2
 *     rationale in Slice 5.F.
 *
 * @module anim/fcurveChannelSelect
 */

/**
 * Apply a channel-click selection mutation in-place on an action.
 *
 * Mutates `action.fcurves[i].selected` per Blender's
 * `mouse_anim_channels_fcurve` semantics. Returns a decision object so
 * the caller can wire the side-effects that live OUTSIDE the action
 * datablock (elevating the global active-FCurve selection, clearing
 * the local keyform-selection Map on other curves).
 *
 * `modifier` is the SS spelling for Blender's `selectmode` enum:
 *
 *   - 'replace' → SELECT_REPLACE (plain click)
 *   - 'toggle'  → SELECT_INVERT  (Ctrl+click per
 *     `blender_default.py:3851-3852`)
 *   - 'range'   → SELECT_EXTEND_RANGE (Shift+click per
 *     `blender_default.py:3849-3850`) — requires
 *     `ctx.activeFCurveId` + `ctx.orderedIds`. Auto-downgrades to
 *     'toggle' when no eligible active exists (see module header for
 *     the full Blender `anim_channels_edit.cc:4517-4522` provenance).
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId — the id of the clicked FCurve
 * @param {'replace'|'toggle'|'range'} modifier
 * @param {{ activeFCurveId?: string|null, orderedIds?: string[] }} [ctx]
 *   — required for `'range'`; ignored for `'replace'`/`'toggle'`.
 * @returns {{ makeActive: boolean, selectedNow: boolean }}
 */
export function applyChannelSelect(action, fcurveId, modifier, ctx) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { makeActive: false, selectedNow: false };
  }
  // Audit-fix LOW-A1 (Slice 5.F dual-audit): explicit modifier guard.
  // Earlier draft fell through to 'toggle' on unknown values; that
  // would have silently masked a future 'extend' wiring before its
  // helper branch lands.
  if (modifier !== 'replace' && modifier !== 'toggle' && modifier !== 'range') {
    return { makeActive: false, selectedNow: false };
  }
  const clicked = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!clicked) return { makeActive: false, selectedNow: false };

  if (modifier === 'replace') {
    for (const fc of action.fcurves) {
      if (!fc) continue;
      if (fc.selected) fc.selected = false;
    }
    clicked.selected = true;
    return { makeActive: true, selectedNow: true };
  }

  if (modifier === 'range') {
    // Slice 5.J — SELECT_EXTEND_RANGE port. See module header for the
    // full Blender citation chain (walker, pre-walk wipe scope,
    // auto-downgrade gate). The four guard conditions below collectively
    // implement Blender's `animchannel_has_active_of_type` check at
    // `anim_channels_edit.cc:4517-4522` plus an SS-only safety net for
    // the caller passing a stale clicked id.
    const activeFCurveId = ctx && ctx.activeFCurveId;
    const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
    const canRange =
      orderedIds &&
      typeof activeFCurveId === 'string' &&
      activeFCurveId.length > 0 &&
      orderedIds.indexOf(activeFCurveId) !== -1 &&
      orderedIds.indexOf(fcurveId) !== -1;
    if (!canRange) {
      // Auto-downgrade to toggle — recurse with no ctx so the downgrade
      // is single-level (toggle never re-enters this branch).
      return applyChannelSelect(action, fcurveId, 'toggle');
    }

    // Build the id-keyed map up-front so the walker's per-step lookup is
    // O(1). Audit-fix MED-A1 (Slice 5.J dual-audit 2026-05-17): the
    // walker uses `if (fc) ...` to defend against `id` strings that are
    // in `orderedIds` but missing from `action.fcurves` (the active
    // bound's id can be such a ghost if `decoded.map(...)` was computed
    // in a render that saw `action.fcurves` before a delete landed —
    // possible during a React batch). The `clicked` bound can't be a
    // ghost because we already guarded `if (!clicked) return` above.
    const byId = new Map();
    for (const fc of action.fcurves) {
      if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
    }

    // Pre-walk wipe — Blender's `ANIM_anim_channels_select_set(EXTEND_RANGE)`
    // at line 4236 sets `selected=false` on every channel in the
    // FILTERED visible list (`anim_data` from `anim_channels_for_selection`),
    // NOT on every channel in the underlying action. Audit-fix MED-B1
    // (Slice 5.J dual-audit 2026-05-17): SS wipes the same scope by
    // iterating `orderedIds` only — fcurves that `decoded` filtered out
    // (unresolvable rna_path) keep their `selected` bit, matching
    // Blender's behavior of leaving non-visible channels alone.
    for (const id of orderedIds) {
      const fc = byId.get(id);
      if (fc && fc.selected) fc.selected = false;
    }

    // Walk the visible ordered list. Flip `inRange` at each of the two
    // bounds (active + clicked); select every fcurve while inside the
    // range; exit when both bounds collapse to one element. Mirrors
    // `animchannel_select_range` at `anim_channels_edit.cc:3984-4025`.
    let inRange = false;
    for (const id of orderedIds) {
      const isActive = id === activeFCurveId;
      const isCursor = id === fcurveId;
      const fc = byId.get(id);
      if (isActive || isCursor) {
        if (fc) fc.selected = true;
        inRange = !inRange;
      } else if (inRange) {
        if (fc) fc.selected = true;
      }
      if (isActive && isCursor) break; // single-cell range (active===cursor)
      // SS perf optimization (NOT a Blender port — see module header
      // LOW-B1 deviation): break once we've closed the range. Blender's
      // walker keeps iterating but does nothing useful, so final state
      // is identical.
      if (!inRange && (isActive || isCursor)) break;
    }

    // Line 4247 gate: range-select does NOT elevate active. The clicked
    // curve IS selected (it's one bound of the range) but the existing
    // active stays active. Caller reads `makeActive: false` and does
    // not call its onPickActive side-effect.
    return { makeActive: false, selectedNow: true };
  }

  // 'toggle' — SELECT_INVERT per anim_channels_edit.cc:4231-4234.
  // Bound to Ctrl+click in Blender's keymap (`blender_default.py:3851-3852`).
  clicked.selected = !clicked.selected;
  return {
    // Line 4247: elevate active only when newly selected.
    makeActive: clicked.selected === true,
    selectedNow: clicked.selected === true,
  };
}

/**
 * Apply a bulk select-all operation in-place on an action.
 *
 * Slice 5.K — ports Blender's `ANIM_OT_channels_select_all` operator
 * (`anim_channels_edit.cc:3521-3554`). See module header for the full
 * keymap / scope / active-flag-handling provenance.
 *
 * `mode`:
 *   - 'toggle' — Blender's SEL_TOGGLE; resolves to 'add' if no channel
 *     in scope is currently selected, else 'clear'. Matches
 *     `anim_channels_selection_flag_for_toggle` at
 *     `anim_channels_edit.cc:536-570`.
 *   - 'add'    — SEL_SELECT / ACHANNEL_SETFLAG_ADD; set every visible
 *     channel `selected = true`.
 *   - 'clear'  — SEL_DESELECT / ACHANNEL_SETFLAG_CLEAR; set every
 *     visible channel `selected = false`.
 *   - 'invert' — SEL_INVERT / ACHANNEL_SETFLAG_INVERT; per-channel flip.
 *
 * `ctx.orderedIds` is the visible scope (sidebar `decoded.map(d => d.fcurve.id)`).
 * `ctx.activeFCurveId` lets the helper compute `clearActive` per
 * Blender's "Only erase the ACTIVE flag when deselecting" rule
 * (`anim_channels_edit.cc:728-732`). Both are optional but required
 * for meaningful work — an empty/missing `orderedIds` returns a no-op
 * decision.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {'toggle'|'add'|'clear'|'invert'} mode
 * @param {{ orderedIds?: string[], activeFCurveId?: string|null }} [ctx]
 * @returns {{
 *   changed: boolean,
 *   clearActive: boolean,
 *   resultMode: 'add'|'clear'|'invert'|null,
 *   selectedAfter: number,
 * }}
 */
export function applyChannelSelectAll(action, mode, ctx) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { changed: false, clearActive: false, resultMode: null, selectedAfter: 0 };
  }
  if (mode !== 'toggle' && mode !== 'add' && mode !== 'clear' && mode !== 'invert') {
    return { changed: false, clearActive: false, resultMode: null, selectedAfter: 0 };
  }
  const orderedIds = ctx && Array.isArray(ctx.orderedIds) ? ctx.orderedIds : null;
  const activeFCurveId = ctx && typeof ctx.activeFCurveId === 'string' && ctx.activeFCurveId.length > 0
    ? ctx.activeFCurveId
    : null;
  if (!orderedIds || orderedIds.length === 0) {
    return { changed: false, clearActive: false, resultMode: null, selectedAfter: 0 };
  }

  // Build the id-keyed map once. The walker skips `id` entries that
  // are in `orderedIds` but missing from `action.fcurves` (ghosts —
  // possible when a delete races a render). Matches the defensive
  // pattern from Slice 5.J's range-select (audit-fix MED-A1).
  const byId = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
  }

  // Toggle resolver — Blender's `anim_channels_selection_flag_for_toggle`
  // at `anim_channels_edit.cc:536-570`: scan visible channels; resolve
  // to CLEAR on first selected found, else ADD. Same short-circuit.
  /** @type {'add'|'clear'|'invert'} */
  let resolved;
  if (mode === 'toggle') {
    let anySelected = false;
    for (const id of orderedIds) {
      const fc = byId.get(id);
      if (fc && fc.selected === true) { anySelected = true; break; }
    }
    resolved = anySelected ? 'clear' : 'add';
  } else {
    resolved = mode;
  }

  // Per-channel mutation. Sparse-field invariant: only write `false`
  // when transitioning from true (matches `applyChannelSelect` line 210).
  let changed = false;
  let selectedAfter = 0;
  for (const id of orderedIds) {
    const fc = byId.get(id);
    if (!fc) continue;
    const before = fc.selected === true;
    let after;
    if (resolved === 'add') after = true;
    else if (resolved === 'clear') after = false;
    else after = !before; // invert
    if (after !== before) {
      if (after) fc.selected = true;
      else fc.selected = false;
      changed = true;
    }
    if (after) selectedAfter++;
  }

  // Active-flag decision — mirror Blender's `if (!(fcu->flag &
  // FCURVE_SELECTED) && change_active)` at `anim_channels_edit.cc:728-732`.
  // Bulk select-all is always `change_active`, so the rule collapses to:
  // "if active is in scope AND ends up deselected, clear it".
  let clearActive = false;
  if (activeFCurveId && orderedIds.indexOf(activeFCurveId) !== -1) {
    const fc = byId.get(activeFCurveId);
    const activeAfter = fc ? fc.selected === true : false;
    if (!activeAfter) clearActive = true;
  }

  return { changed, clearActive, resultMode: resolved, selectedAfter };
}

/**
 * Read accessor. Missing field is treated as `false` — see module
 * header for why no migration ships.
 *
 * @param {object|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveSelected(fcurve) {
  return !!(fcurve && fcurve.selected === true);
}

/**
 * Bulk delete selected channels — port of `ANIM_OT_channels_delete`
 * (`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:2739-2873`).
 *
 * Keymap default (`blender_default.py:3873-3874`):
 *   - **X** → `anim.channels_delete`
 *   - **DEL** → `anim.channels_delete`
 *
 * Industry-Compatible (`industry_compatible_data.py:2357-2358`):
 *   - **Backspace** → `anim.channels_delete`
 *   - **DEL** → `anim.channels_delete`
 *
 * Blender's `animchannels_delete_exec` filters via `ANIMFILTER_SEL |
 * ANIMFILTER_FOREDIT | ANIMFILTER_NODUPLIS | ANIMFILTER_LIST_VISIBLE`
 * (`anim_channels_edit.cc:2767-2768`). For each FCurve in the result,
 * `ED_anim_ale_fcurve_delete` (`:2692-2734`) removes it from its owner.
 * SS's equivalent: walk `action.fcurves` once, drop entries with
 * `selected === true`, in-place via `splice` / filter into a new array.
 *
 * # Driver semantics
 *
 * `ED_anim_ale_fcurve_delete` handles BOTH driver F-Curves and
 * non-driver F-Curves uniformly — drivers ARE deletable at the
 * channel layer. This is DIFFERENT from the keyform-delete path
 * (Slice 5.D's per-curve driver gate in FCurveEditor's
 * `operatorDelete` skips driver curves). The user-mental model is
 * consistent: "delete keyforms of a driven curve" is meaningless
 * (driver overrides keys); "delete the entire driven curve" is a
 * valid destructive op. SS port matches: bulk channel delete drops
 * every selected curve regardless of driver presence.
 *
 * # Side-effects the caller must handle
 *
 * The helper mutates `action.fcurves` only. The caller (FCurveEditor)
 * MUST also:
 *
 *   - Drop `selectedHandles` Map entries keyed by deleted fcurve.id
 *     (otherwise stale keyform-selection state lingers).
 *   - Re-derive `activeFCurveId` if the active curve was deleted
 *     (Blender re-resolves active per-render from the list; SS's
 *     active is stored in `selectStore` and may now point at a
 *     param whose underlying fcurve no longer exists).
 *
 * The helper returns the list of deleted ids so the caller can do
 * both cleanups in one pass.
 *
 * # Last-curve guard?
 *
 * Blender allows deleting ALL fcurves — `action.fcurves` may end up
 * empty; the Action itself survives. SS port matches: no minimum-
 * curve guard. The keyform delete path has a per-curve "keep ≥1
 * keyform" guard (Slice 5.C HIGH-A4) because an fcurve with zero
 * keyforms is invalid; that doesn't apply here.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @returns {{ changed: boolean, deletedCount: number, deletedIds: string[] }}
 */
export function applyChannelDeleteSelected(action) {
  const result = { changed: false, deletedCount: 0, deletedIds: /** @type {string[]} */ ([]) };
  if (!action || !Array.isArray(action.fcurves)) return result;
  const keep = [];
  for (const fc of action.fcurves) {
    // Audit-fix MED-A1 (Slice 5.N dual-audit 2026-05-17): drop ANY
    // `selected:true` entry, including malformed ones without a
    // string id. The original draft kept malformed `{selected:true}`
    // entries in `keep` — a defensive footgun: if any future write
    // path ever produces an idless selected entry, it would be
    // perpetually undeletable. The user-intent gate is "selected
    // means delete"; the id is just for reporting back to the
    // caller. Idless drops happen silently (not pushed to
    // deletedIds since there's no id to report — the caller's
    // selection-store cleanup logic keys on ids).
    if (fc && fc.selected === true) {
      if (typeof fc.id === 'string') result.deletedIds.push(fc.id);
      result.deletedCount++;
      result.changed = true;
      continue;
    }
    keep.push(fc);
  }
  if (result.changed) {
    // In-place replacement — keep the same array reference so other
    // memoised consumers that depend on `action.fcurves` identity see
    // the same wrapper but the new contents. (Immer normally rewraps,
    // but in-place splice keeps semantics consistent with Slice 5.C's
    // `operatorDelete` path.)
    action.fcurves.length = 0;
    for (const fc of keep) action.fcurves.push(fc);
  }
  return result;
}

/**
 * Read-only preflight for {@link applyChannelDeleteSelected}.
 *
 * Returns true iff calling `applyChannelDeleteSelected(action)` would
 * mutate anything. Same undo-budget rationale as Slice 5.M's
 * `wouldHideChangeFCurves`: dispatcher checks this before `update()`
 * so a no-op X press doesn't burn a phantom undo slot
 * (`projectStore.js:230-232` pushes the snapshot before the recipe).
 *
 * @param {object | null | undefined} action
 * @returns {boolean}
 */
export function wouldChannelDeleteSelectedChange(action) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) return true;
  }
  return false;
}
