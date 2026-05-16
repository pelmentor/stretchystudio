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
 * `mouse_anim_channels_fcurve` at
 * `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4223-4257`
 * dispatches on `selectmode`:
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
 *     SS-deferred this slice (would need a stable channel-list index;
 *     `decodeAllFCurves` filters unresolvable targets so its index
 *     can't be the source of truth).
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
 *   - **No "always at least one selected" implicit-selection.** Blender's
 *     UX never lets you reach zero selected channels; the active channel
 *     is rendered as selected even when nothing else is. SS treats the
 *     active concept as orthogonal: a fresh v39 save loads with every
 *     `selected:false`, and the active row is highlighted via a
 *     SEPARATE class (the existing `bg-accent/60`). The "selected non-
 *     active" row gets a weaker `bg-accent/30` so multi-select is
 *     visible. Equivalent UX outcome — different storage representation.
 *
 *   - **Plain-click also wipes keyform selection on other curves.**
 *     This part was already wired pre-Slice 5.F (audit-fix MED-B8,
 *     `2026-05-16`) to mirror Blender's `deselect_graph_keys(ac, false,
 *     SELECT_SUBTRACT, true)` at `graph_select.cc:1741`. Shift-click
 *     preserves keyform selection — Blender does the same.
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
 *
 * SELECT_EXTEND_RANGE (Ctrl+click) is deferred — see module header.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId — the id of the clicked FCurve
 * @param {'replace'|'toggle'} modifier
 * @returns {{ makeActive: boolean, selectedNow: boolean }}
 */
export function applyChannelSelect(action, fcurveId, modifier) {
  if (!action || !Array.isArray(action.fcurves)) {
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
