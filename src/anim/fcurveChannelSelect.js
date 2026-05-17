// @ts-check

/**
 * Animation Phase 5 Slice 5.F — Channel selection split helper.
 *
 * Pure mutation helper for the per-FCurve `selected` boolean — Blender's
 * `FCURVE_SELECTED` bit (`DNA_anim_enums.h:303-310`) — kept INDEPENDENT
 * of the "active FCurve" concept (`FCURVE_ACTIVE`).
 *
 * Pre-Slice 5.F the SS sidebar collapsed channel selection onto the
 * global `selectionStore` — exactly one FCurve was the "active" curve
 * and no notion of multi-selection existed at the channel-list level.
 * That made Shift-click in the sidebar a no-op (see the prior comment
 * at the click handler: "Shift-click would extend (omitted this slice
 * — see the file-top deferral on channel-vs-keyform selection split)").
 *
 * This slice lifts the deferral. `fcurve.selected` joins the per-FCurve
 * record; the sidebar Shift-clicks it independently of the active flag.
 *
 * # Blender semantics ported
 *
 * `click_select_channel_fcurve` at
 * `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4223-4257`
 * (dispatched from `mouse_anim_channels` at line 4475, which switches
 * on `ale->type` and routes each channel type to its own per-type click
 * handler) dispatches on `selectmode`:
 *
 *   - **SELECT_REPLACE** (plain click) — line 4239-4243:
 *     `ANIM_anim_channels_select_set(ac, ACHANNEL_SETFLAG_CLEAR)` zeroes
 *     every channel's SELECTED bit, then `fcu->flag |= FCURVE_SELECTED`
 *     sets the clicked one. Active is elevated (line 4247-4254) because
 *     the clicked curve is now selected and the mode is not range.
 *   - **SELECT_INVERT** (Shift+click) — line 4231-4234:
 *     `fcu->flag ^= FCURVE_SELECTED` xors the clicked curve ONLY; other
 *     curves' selection is untouched. Active elevation gates on
 *     "selected after the xor" — so toggling OFF doesn't disturb active.
 *   - **SELECT_EXTEND_RANGE** (Ctrl+click) — line 4235-4238: walks the
 *     channel list between last-active and clicked, range-selecting
 *     everything in between. Does NOT elevate active (line 4247 gate).
 *     SHIPPED in Slice 5.J as the `'range'` modifier — the caller passes
 *     `{ activeFCurveId, orderedIds }` in `ctx`; `orderedIds` is the
 *     sidebar-rendered fcurve-id list (i.e. `decoded.map(d => d.fcurve.id)`).
 *     The walker reproduces `animchannel_select_range`
 *     (`anim_channels_edit.cc:3984-4025`) byte-for-byte: iterate the
 *     ordered list, flip `in_selection_range` at both the active and the
 *     clicked element, select every element while in the range
 *     (inclusive of both bounds), early-exit once both bounds have been
 *     hit. Pre-walk clears every fcurve's `selected` bit — matches
 *     Blender's `ANIM_anim_channels_select_set(EXTEND_RANGE)` call at
 *     line 4236 which, per the load-bearing comment at
 *     `anim_channels_edit.cc:662-669`, "uses [EXTEND_RANGE] to deselect
 *     *everything* before `animchannel_select_range()` later does the
 *     actual selection of the channels in the range".
 *
 *     **Auto-downgrade** (Blender's `anim_channels_edit.cc:4517-4522`):
 *     if no active channel of the same type exists, Blender silently
 *     rewrites `selectmode` from `SELECT_EXTEND_RANGE` to `SELECT_INVERT`
 *     so Ctrl+click degrades into a Shift+click toggle rather than a
 *     no-op. SS mirrors this whenever (a) `activeFCurveId` is null /
 *     undefined / missing in `orderedIds`, OR (b) the clicked fcurve
 *     itself isn't in `orderedIds` (decoded filtered it out). The
 *     helper short-circuits to the 'toggle' branch when downgraded.
 *
 * The "elevate active only when newly selected" rule (line 4247) is the
 * load-bearing detail that makes channel-selection feel right: Shift-
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
 *     previous keyform picks". Shift-click preserves keyform selection.
 *     Documented + verified in Slice 5.F dual-audit (audit-fix MED-B3).
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
 *     was unsupported by the source: Shift-clicking the sole selected
 *     curve via line 4231-4234 (`fcu->flag ^= FCURVE_SELECTED`)
 *     legitimately reaches zero `FCURVE_SELECTED` curves;
 *     `ANIM_set_active_channel` only writes `FCURVE_ACTIVE`, never
 *     `FCURVE_SELECTED`. SS's "active orthogonal to selected, both can
 *     be empty" matches Blender — no deviation to document. Removed in
 *     Slice 5.F dual-audit (audit-fix MED-B4).
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
 *   - 'toggle'  → SELECT_INVERT  (Shift+click)
 *   - 'range'   → SELECT_EXTEND_RANGE (Ctrl+click) — requires
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
    // Slice 5.J — SELECT_EXTEND_RANGE port. Blender's auto-downgrade at
    // `anim_channels_edit.cc:4517-4522`: when no active channel of the
    // matching type exists, rewrite selectmode → SELECT_INVERT. SS's
    // single-channel-type universe simplifies "matching type" to
    // "active id is in the visible ordered list". The clicked id must
    // also be in the list (decoded may have filtered it out for an
    // unresolvable rna_path; falling through to a single-cell range
    // walk would silently no-op).
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

    // Pre-walk wipe — Blender's `ANIM_anim_channels_select_set(EXTEND_RANGE)`
    // at line 4236 sets every channel's `selected` to false (see the
    // comment at lines 662-669 explaining the deliberate misnomer).
    for (const fc of action.fcurves) {
      if (!fc) continue;
      if (fc.selected) fc.selected = false;
    }

    // Walk the visible ordered list. Flip `inRange` at each of the two
    // bounds (active + clicked); select every fcurve while inside the
    // range; exit once both bounds have been hit. Mirrors
    // `animchannel_select_range` at `anim_channels_edit.cc:3984-4025`.
    let inRange = false;
    const byId = new Map();
    for (const fc of action.fcurves) {
      if (fc && typeof fc.id === 'string') byId.set(fc.id, fc);
    }
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
      if (!inRange && (isActive || isCursor)) break; // closed the range
    }

    // Line 4247 gate: range-select does NOT elevate active. The clicked
    // curve IS selected (it's one bound of the range) but the existing
    // active stays active. Caller reads `makeActive: false` and does
    // not call its onPickActive side-effect.
    return { makeActive: false, selectedNow: true };
  }

  // 'toggle' — SELECT_INVERT per anim_channels_edit.cc:4231-4234.
  clicked.selected = !clicked.selected;
  return {
    // Line 4247: elevate active only when newly selected.
    makeActive: clicked.selected === true,
    selectedNow: clicked.selected === true,
  };
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
