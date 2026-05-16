# Session Close-out — Animation Phase 5 Slice 5.F SHIPPED

**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `a690f44` — feat(anim): Animation Phase 5 Slice 5.F — channel-vs-keyform selection split
- `4e780c6` — fix(audit): Animation Phase 5 Slice 5.F dual-audit sweep — 1 HIGH-A + 1 MED-A + 4 MED-B + 2 LOW
- *(this doc)* — close-out documentation

Seventh Phase 5 close-out of the day, on top of `bd1e68b` + `feb4bde` + `c880fad` (5.A+5.B), `0d78ad3` + `213c748` + `278003d` (5.C), `7589952` + `4f51bd8` + `ffa1da8` (5.C+), `75a357e` + `12f9e17` + `ef4e077` (5.D), and `5bfb551` + `9ff69d5` + `b80a525` (5.E). Closes the top queued resume path from Slice 5.E's close-out (Channel-vs-keyform selection split).

---

## What shipped

Per Slice 5.E close-out doc resume path #1:

> "Channel-vs-keyform selection split — Blender's `FCURVE_SELECTED` independent of `FCURVE_ACTIVE`. Schema field + sidebar Shift-click extends channel selection + multi-channel 'highlighted' state in sidebar. Cited deferral from Slice 5.C+."

Concretely:

- **Per-FCurve `selected` boolean.** New sparse schema field on the `FCurve` record (`{ id, rnaPath, keyforms, driver?, selected? }`). Mirrors Blender's `FCURVE_SELECTED` bit at `reference/blender/source/blender/makesdna/DNA_anim_enums.h:307` — distinct from `FCURVE_ACTIVE` (line 309), the single-curve concept already carried by the global `selectionStore`. Missing field is treated as `false` by `isFCurveSelected(fc)`, so v39 saves load without a migration.
- **Sidebar Shift-click toggles channel selection** without changing the active row (unless the toggle elevates a previously-unselected curve to selected, in which case it also becomes active — per Blender's gate at `anim_channels_edit.cc:4247`). Plain click clears all other curves' `selected`, sets the clicked one, and elevates to active.
- **Multi-channel row highlight in the sidebar.** Active row: existing `bg-accent/60` (strongest); selected-non-active: new `bg-accent/25` (medium); inactive: existing `text-muted-foreground` (muted). 3-tier visual is an SS UX extension, not a Blender port (Blender's row backdrop is selection-agnostic — see audit-fix MED-B2 below).
- **Pure helper at [src/anim/fcurveChannelSelect.js](../../src/anim/fcurveChannelSelect.js)** — `applyChannelSelect(action, fcurveId, modifier)` mutates `action.fcurves[i].selected` in place and returns a `{ makeActive, selectedNow }` decision object so the click handler can wire the out-of-action side-effects (set active, conditionally clear keyform selection). `isFCurveSelected(fc)` is the canonical reader.
- **Channel selection is view state (not data).** Audit-fix HIGH-A1 switched the channel-click `updateProject` to `{ skipHistory: true }` so sidebar clicks don't burn the 50-entry undo budget on UI navigation noise. Matches Blender — channel selection isn't undoable there either.

---

## Pure helpers added

`src/anim/fcurveChannelSelect.js` (NEW, ~140 LOC with audit-fix jsdoc):

| Export | What | Blender ref |
|---|---|---|
| `applyChannelSelect(action, fcurveId, modifier)` | In-place mutation; returns `{ makeActive, selectedNow }`. Unknown modifiers no-op (LOW-A1 guard). | `anim_channels_edit.cc:4223-4257` |
| `isFCurveSelected(fcurve)` | Reader; missing/false/non-true → false | — |

50 new headless assertions in `scripts/test/test_fcurveChannelSelect.mjs` cover: sparse-field invariant (7 cases incl. truthy-but-not-`true`), SELECT_REPLACE 3 scenarios, SELECT_INVERT ON/OFF + sparse-field toggle, active-elevation gate (toggle-OFF does NOT elevate per line 4247), guards (null action / null fcurves / unknown id / null entries / unknown modifier / empty-string / null modifier), Blender-style multi-step user flows (chain Shift-clicks, collapse-via-replace, double-toggle).

Registered as `test:fcurveChannelSelect` + added to aggregate `test` chain in `package.json`.

---

## Sidebar wire-up

`src/v3/editors/fcurve/FCurveEditor.jsx`:

- New `applyChannelClick` callback on `Plot` calls the helper inside `updateProject(..., { skipHistory: true })`, returning the decision out-of-band.
- New `onApplyChannelClick` prop on `Sidebar` (additive; replaces nothing).
- Click handler refactored: plain click → `replace` modifier; Shift+click → `toggle` modifier. `onPickActiveByTarget(t)` and `onClearKeyformSelection()` both gated on the decision (MED-A1 fix prevents wiping keyform selection when the helper bails out, e.g. action lookup race).
- Render tint switched to a 3-tier ternary off `(isActive, isChannelSelected, default)` instead of the prior binary.
- File-header "channel-vs-keyform selection split — omitted this slice" deferral lifted; replaced with a "Slice 5.F (2026-05-16) lifted this" pointer to the helper module.

---

## Schema decision: no migration

`fcurve.selected` is a SPARSE field. `CURRENT_SCHEMA_VERSION` stays at 39.

Per `feedback_no_migration_baggage_rule_two` (Rule №2), a v40 walker that iterates every `action.fcurves[i]` to write `selected: false` would be pure noise — the reader collapses the tri-state (`true` / `false` / missing) into a clean boolean already, and the writers only ever set `true` (and only clear an existing `true` back to `false`). Cross-cutting consumers (motion3 export, can3 export, save serialization, selectRigSpec, projectRoundTrip) iterate fcurves but ignore unknown fields, so no consumer is impacted by the new boolean.

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Two parallel agents (architecture code-reviewer + Blender-fidelity general-purpose) on feature commit `a690f44`. **8 fixes applied** in audit-fix `4e780c6`.

| # | Severity | Source | Finding |
|---|---|---|---|
| HIGH-A1 | HIGH | arch | **Undo-history pollution.** Channel-click wrapped in `beginBatch`/`endBatch` always pushed a snapshot at depth 0. Selection is view state, not data; Blender doesn't undo channel selection either. Sidebar clicks would burn the 50-entry undo budget on UI noise + evict real edit history. **Fix:** switched to `update(recipe, { skipHistory: true })`. |
| MED-A1 | MED | arch | **Spurious keyform-selection wipe.** `onClearKeyformSelection()` fired on every plain-click even when the helper bailed (action lookup race). **Fix:** gated on `decision.selectedNow`. |
| LOW-A1 | LOW | arch | **Silent fall-through on unknown modifier.** Helper fell through to `'toggle'` semantics on any modifier other than `'replace'`. Would silently mask a future `'extend'` wiring before its branch ships. **Fix:** explicit guard returning no-op + 3 new assertions for `'extend'` / empty-string / null. |
| MED-B1 | MED | Blender | **Wrong function name.** Cited `mouse_anim_channels_fcurve` in 8 places; actual symbol is `click_select_channel_fcurve` at `anim_channels_edit.cc:4223`. `mouse_anim_channels` is the dispatcher one level up (line 4475). **Fix:** renamed all references; added the dispatcher in the provenance trace. |
| MED-B2 | MED | Blender | **Fake `acf_generic_channel_color` tint citation.** Comment claimed the sidebar tint mirrored Blender's "selected-non-active rows in a lighter shade of the active highlight". Read `acf_generic_channel_color` at `anim_channels_defines.cc:185-194` — it's `colorOffset = 10 - 10 * indent` only, selection-agnostic. Blender's selection state surfaces via the text-color flip (TH_TEXT_HI vs TH_TEXT), not the backdrop. **Fix:** replaced the fake citation with a documented divergence ("SS extends Blender — Blender's row backdrop is selection-agnostic; we add a lighter accent so multi-select is visible without forcing the user to read text-color shades"). |
| MED-B3 | MED | Blender | **Mis-cited context for `graph_select.cc:1741`.** Cited (carried from pre-Slice MED-B8) as Blender's authority for plain-channel-click wiping keyform selection. Read the actual line: inside `graphkeys_mselect_invoke` — the graph-AREA keyframe-click path. `click_select_channel_fcurve` doesn't touch keyform selection. **Fix:** reframed the SS wipe as a UX extension ("clicking a channel reads as 'switch context, drop the previous keyform picks'") rather than a Blender port. |
| MED-B4 | MED | Blender | **Fabricated "always at least one selected" Blender claim.** Helper header asserted Blender never lets you reach zero `FCURVE_SELECTED`. Verified against source: line 4231-4234's XOR can legitimately reach zero; `ANIM_set_active_channel` only writes `FCURVE_ACTIVE`. SS's "active orthogonal to selected, both can be empty" matches Blender — no SS deviation. **Fix:** removed the section. |
| LOW-B1 | LOW | Blender | **Off-by-7 line range.** `acf_generic_channel_color` cited at `178-210`; actual is `185-194` (178-184 is the unrelated `acf_show_channel_colors`). **Fix:** absorbed into MED-B2 (whole citation removed). |
| LOW-B2 | LOW | Blender | **Silent omission for deferred slice.** Blender's `anim_channels_edit.cc:4517-4522` auto-downgrades `SELECT_EXTEND_RANGE` to `SELECT_INVERT` when no channel of the same type is active. **Fix:** noted in the EXTEND_RANGE deferral paragraph so the future port doesn't miss it. |

**Cross-verification step** (every Blender citation grepped + Read on disk before applying any audit fix, per `feedback_blender_reference_strict`):

- `anim_channels_edit.cc:4223` `click_select_channel_fcurve` definition — Read confirmed
- `anim_channels_edit.cc:4231-4234` SELECT_INVERT XOR — Read confirmed
- `anim_channels_edit.cc:4239-4243` SELECT_REPLACE clear+set — Read confirmed
- `anim_channels_edit.cc:4247` active-elevation gate — Read confirmed
- `anim_channels_edit.cc:4475` `mouse_anim_channels` dispatcher — Read confirmed
- `anim_channels_edit.cc:4517-4522` SELECT_EXTEND_RANGE auto-downgrade — Read confirmed
- `anim_channels_defines.cc:185-194` `acf_generic_channel_color` indent-only body — Read confirmed (debunks the prior "tint by selection" claim)
- `graph_select.cc:1741` actual context (`graphkeys_mselect_invoke` graph-area click path) — Read confirmed (debunks the prior MED-B8 citation)
- `DNA_anim_enums.h:303-310` FCURVE_VISIBLE / SELECTED / ACTIVE enum — Grep confirmed

All 9 cited line ranges accurate AFTER the audit-fix. **Pre-audit: 3 outright citation fabrications + 1 attribution error caught (function name MED-B1, tint MED-B2, graph-area-vs-channel-list MED-B3, UX-invariant MED-B4).** Same level of audit-discipline payoff as Slice 5.D's 3 fabrications and Slice 5.E's zero — the pattern is now established: never trust a citation that hasn't been Read on disk.

**Dismissed audit findings** (cross-verification telemetry):

- **arch CRITICAL-1 ("decoded memo lag")**: The reviewer worried that mutating `fcurve.selected` inside an immer draft wouldn't propagate a new `action?.fcurves` array reference to `decoded`'s `useMemo`. Re-analysed: immer's structural sharing through `project.actions[i].fcurves[j]` correctly creates new array references all the way up, so `decoded` re-memoizes and the Sidebar re-renders. The reviewer also withdrew this on closer inspection. **False positive (withdrawn).**
- **arch IMPORTANT-2 ("replace truthy-clear inconsistency")**: Claim that `if (fc.selected) fc.selected = false` is inconsistent with `isFCurveSelected`'s `=== true` check. Verified: the clear loop is broader (truthy) than the reader (strict-true), which is the safe direction — a curve with `selected: 1` gets cleared by the loop AND read as not-selected. The reviewer withdrew. **False positive.**
- **Blender LOW-B3 (ACHANNEL_SETFLAG_CLEAR is global, not fcurve-only)**: True but non-actionable today. SS has no groups/slots/NLA in the sidebar; the observable behavior matches. **Deferred until those land.**

---

## SS-deferred (documented in file-headers, not shipped this slice)

- **`SELECT_EXTEND_RANGE` (Ctrl+click range select).** Needs a stable channel-list index that `decodeAllFCurves` doesn't provide today (it filters unresolvable targets, so its array index can't be the source of truth). Documented in the helper module header. When this ships, also port the `anim_channels_edit.cc:4517-4522` auto-downgrade to `SELECT_INVERT` when no active channel of the same type exists (LOW-B2 placeholder).
- **Bulk channel-select operators.** Blender has `ANIM_OT_channels_select_all` (A / Alt+A in the channel-list scope) that select-all / deselect-all the currently visible channels. SS's existing `A` keymap is bound to the canvas (select-all keyforms). Distinct keymap scope — separate slice.
- **Channel-selection consumers.** No operator in SS today applies to "every selected channel" (today's bulk handle-type / interp / extrapolation menus operate on every fcurve that has selected keyforms — a different criterion). A natural follow-on slice would let "set extrapolation for selected channels" operate on the channel-selection set directly. The schema field is in place; the menu ops are the user-facing piece that still needs wiring.
- **Footer wiring for fcurve channel selection.** Footer subscribes to viewport modal store. A "5 selected channels" badge in the editor footer would be useful but is sister to the deferred footer-wiring for the fcurve modal state (already noted in Slice 5.E close-out).

---

## Owed manual browser verification

Cannot be assertion-tested headlessly:

1. **Plain-click on an unselected sidebar row.** Row tints to active (strong accent); all other rows lose selection (none medium-tinted); active is the clicked row.
2. **Shift-click on an unselected row.** Row tints to selected (medium accent); active row stays whatever it was; clicked row also becomes active (per line 4247 gate).
3. **Shift-click on an already-selected (non-active) row.** Row deselects (drops to muted); active stays unchanged; clicked row does NOT become active.
4. **Shift-click on the active row.** Row deselects but tint stays as active (because the active concept is orthogonal); active stays.
5. **Chain Shift-clicks** across 3 rows. All 3 end up medium-tinted; whichever was clicked LAST is also active (strong-tinted).
6. **Plain-click a different row after a chain.** Other rows lose selection; clicked row becomes the sole selected + active.
7. **Plain-click vs Shift-click keyform-selection behavior.** Plain-click: keyform selection on OTHER curves is wiped. Shift-click: keyform selection on other curves is preserved.
8. **Undo (Ctrl+Z) after a channel-click.** Verify that the channel-click is NOT in the undo stack — pressing Ctrl+Z should step back to the LAST DATA edit (keyform drag, value change, etc.), not the channel selection.
9. **Save + load** a project with multiple `fcurve.selected: true` entries. After reload the same channels should be tinted as selected.
10. **Load a pre-Slice-5.F save** (v39 with no `selected` field). All rows render as muted/inactive (default-false reader) without errors.
11. **Driver-locked channel ("(D)" badge) Shift-click.** Tint still applies (driver lock doesn't gate selection); modal G is still blocked by driver gate on those curves (existing behavior).
12. **Action with 0 fcurves.** Sidebar shows "F-Curves (0)" and renders no rows; no clicks possible; no crashes.

---

## Tests passing (final state at `4e780c6`)

| Test | Pass/Fail |
|------|-----------|
| test:fcurveChannelSelect | 50/50 (new; 45 + 5 audit-fix LOW-A1) |
| test:graphEditOps | 115/115 |
| test:fcurveDriverGate | 21/21 |
| test:fcurveEval | 35/35 |
| test:fcurveHandles | 35/35 |
| test:animFCurveBridge | 52/52 |
| test:modalTransformTyped | 26/26 |
| test:transformInputReducer | 71/71 |
| `tsc --noEmit` | clean |

405 headless assertions covered by slice-affected suites, all green.

---

## Resume paths (priority order post this session)

1. **`fcurve.mute` schema field + muted-grey render** — Blender's `FCURVE_MUTED`. Schema field + grey render branch at the same time (per `feedback_no_migration_baggage_rule_two`). Sister to Slice 5.F (both are channel-list metadata).

2. **Active-keyform field + highlight** — `BKE_fcurve_active_keyframe_index` parity, `TH_VERTEX_ACTIVE` highlight. Per-FCurve `activeKeyformIdx?: number` schema field + render-side highlight. Needs careful interaction with the existing per-keyform `selectedHandles` Map.

3. **Persistent `fcurve.visible` schema field** — replace the local-React `hidden` Set with the persisted flag. Sister field to `fcurve.selected` (this slice) + `fcurve.mute` (#1 above). All three are channel-list metadata that Blender carries on `FCurve` itself.

4. **Driver variable list / expression editor** — Slice 5.D's biggest deferral. Both the banner UI to author variables AND the `evaluateDriver` extension to support multi-target compound types (`DVAR_TYPE_ROT_DIFF` / `DVAR_TYPE_LOC_DIFF` / `DVAR_TYPE_TRANSFORM_CHAN`).

5. **Footer wiring for fcurve channel + modal status** — Combine the deferred footer-wiring for the fcurve modal state (Slice 5.E) with a "N selected channels" badge for Slice 5.F. One parallel store, two consumers.

6. **`SELECT_EXTEND_RANGE` (Ctrl+click range select) for sidebar** — needs a stable channel-list index. Port the auto-downgrade gate at `anim_channels_edit.cc:4517-4522` alongside.

7. **Bulk channel-select operators** — `ANIM_OT_channels_select_all` (A / Alt+A in channel-list scope). Separate keymap scope from the existing canvas A.

8. **Operators-on-selected-channels** — let Set Extrapolation / Set Interpolation / Set Handle Type apply to the channel-selection set (not just curves with selected keyforms). Natural consumer for the new `fcurve.selected` field.

9. **`SIPO_DRAWTIME` seconds-vs-frames display toggle** — when shipped, ModalHUD's `unit` derivation needs to read the same flag (audit-fix MED-B2 left a documented placeholder in Slice 5.E).

10. **`USER_FLAG_NUMINPUT_ADVANCED` preference + auto-enable** — port the digit-implicit `NUM_EDIT_FULL` path (audit-fix MED-B1 left a documented placeholder in Slice 5.E).

11. **Phase 2 owed-manual verification** — from prior close-outs: live recording bezier handle export, Hiyori round-trip in Cubism Editor, visual auto-handle smoothness, named-easing bake reload.

12. **Phase 3 — F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5](./ANIMATION_BLENDER_PARITY_PLAN.md)
- Prior close-outs (same day):
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) — Slices 5.A+5.B
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md) — Slice 5.C operator pass
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md) — Slice 5.C+ multi-curve display
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_D.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_D.md) — Slice 5.D driver banner
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_E.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_E.md) — Slice 5.E modal axis-lock + typed numeric
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) — Phase 2 (auto-handle calculator)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
