# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.M

**Status:** SHIPPED + dual-audit closed. Zero-fab streak (Blender-fidelity
HIGH-class) holds at 3 (5.K → 5.L → 5.M). Architecture audit caught a real
HIGH-class bug in this slice (no-op undo snapshot) — acknowledged
separately; the streak metric tracks only Blender-fidelity findings per
`feedback_modifier_binding_check_keymap_first`.

## Commits

| SHA       | Subject                                                                            |
|-----------|------------------------------------------------------------------------------------|
| `0852bc1` | feat(anim): Animation Phase 5 Slice 5.M — bulk hide/reveal (H / Shift+H / Alt+H)  |
| `fb0e271` | fix(audit): Animation Phase 5 Slice 5.M dual-audit sweep — 1 HIGH + 1 MED + 2 housekeeping |

## What shipped

Closes Slice 5.K's queued path #2. Wires `_template_items_hide_reveal_actions`'s
three keymap actions (`blender_default.py:461-466`, registered at `:1967`
for the graph editor):

- **H** → `graph.hide` with `unselected=False` (hide selected, deselect them)
- **Shift+H** → `graph.hide` with `unselected=True` (isolate selected)
- **Alt+H** → `graph.reveal` (default `select=true` → un-hide all + select them)

### Files

| File                                              | Lines change | Role |
|---------------------------------------------------|--------------|------|
| `src/anim/fcurveVisible.js`                       | +218 / -27   | 4 new exports: `applyHideFCurves` + `applyRevealFCurves` + preflight `wouldHideChangeFCurves` + `wouldRevealChangeFCurves` |
| `src/v3/editors/fcurve/FCurveEditor.jsx`          | +75 / -9     | Import expansion + `applyHideOp` + `applyRevealOp` callbacks (with preflight gating) + H/Shift+H/Alt+H branches in onKeyDown |
| `scripts/test/test_fcurveVisible.mjs`             | +233 (+95)   | 47 → 142 assertions (+95 covering bulk + preflight) |

## Blender semantics ported

- **`GRAPH_OT_hide`** — `space_graph/graph_ops.cc:226-318`. Two-phase walk:
  - Phase 1 (`:247-282`): visible curves matching `unselected ? UNSEL : SEL`
    are hidden AND deselected via paired `ANIM_channel_setting_set` calls.
  - Phase 2 (`:284-312`, only when `unselected=true`): selected curves
    re-ensured visible+selected (no-op without FCurveGroup flushing today;
    documented + asserted).
- **`GRAPH_OT_reveal`** — `space_graph/graph_ops.cc:341-402`. Walks all
  curves; for those currently hidden, also writes SELECT (gated on
  `select` RNA prop, default `true` per `:418`); always sets visible.
  Selection gate at `:379-383` means already-visible curves keep their
  selection state.
- **Keymap (verified)**:
  - `blender_default.py:1967` registers `_template_items_hide_reveal_actions`
    in `km_graph_editor`. NOT registered in `km_animation_channels`
    (sidebar uses W → `setting_toggle` instead).
  - Template at `:461-466`:
    - `:463` Alt+H → reveal (no props → default `select=true`)
    - `:464` H → hide unselected=False
    - `:465` Shift+H → hide unselected=True
- **Undo coverage**: both operators carry `OPTYPE_REGISTER | OPTYPE_UNDO`
  (`graph_ops.cc:332` + `:416`). SS ports through normal `update(recipe)`
  (no `skipHistory:true`), matching the per-row `toggleFCurveHidden`
  precedent from Slice 5.I.

## Dual-audit findings (closed)

Two agents in parallel, lens-specialized. Findings table:

| Tag      | Severity | Title                                                | Status |
|----------|----------|------------------------------------------------------|--------|
| HIGH-A1  | HIGH (88) | No-op H/Shift+H/Alt+H pushes phantom undo snapshot | FIXED in `fb0e271` — preflight readers + dispatcher short-circuit |
| MED-B1   | MED (85)  | Industry-Compatible keymap divergence undocumented | FIXED in `fb0e271` — Deviation 2 added to module header |
| MED-A2   | MED (85)  | Duplicate comment block in `applyRevealFCurves`    | FIXED in `fb0e271` — merged |
| LOW-B1   | LOW (80)  | Deviation 1 doc attributed FCURVE_ACTIVE clearing to wrong code path | FIXED in `fb0e271` — corrected mechanism |
| MED-A1   | MED (81)  | `result` capture pattern across immer draft boundary fragile | NOT FIXED — established precedent in `applyChannelSelectAllOp`; documented as accepted |

### HIGH-A1 deep dive

`projectStore.js:230-232`:
```js
if (!skipHistory && !isBatching()) {
  pushSnapshot(state.project);
  hasUnsavedChanges = true;
}
return produce(...)(state);
```

The snapshot fires BEFORE the recipe runs. So even when the recipe
mutates nothing, the undo stack records a copy of the current state.
Next Ctrl+Z restores the same state to itself.

**Fix shape:** introduce read-only preflight helpers
(`wouldHideChangeFCurves`, `wouldRevealChangeFCurves`) that mirror the
mutation logic without writes. Dispatcher reads live project state via
`useProjectStore.getState()`, runs the preflight, and only calls
`update()` when `changed === true`.

Why this is Rule-№1-compliant: the preflight isn't a "fix later"
crutch — it's a real read primitive that's symmetric with the
mutation helper. Both are pure functions; both are tested directly
against each other (11 new assertions confirm `wouldHide* === apply*().changed`
on no-op and positive cases). No fallback, no shim, no future cleanup
owed.

Why this isn't migration baggage (Rule №2): the preflight helpers
aren't introduced "for the day SS grows a different undo system." They
solve a real problem with the current `pushSnapshot`-before-recipe
behavior, and they'd remain useful even if `updateProject` ever
acquired a `noopGuard` parameter.

### MED-B1 deep dive

Industry-Compatible binds hide to Ctrl+H (`industry_compatible_data.py:919`),
not bare H. SS has no keymap-preset selector today. Wiring both
variants would force SS to either:
- Hard-code both H AND Ctrl+H as aliases (breaks bare H semantics on
  Blender-default users who type Ctrl+H expecting browser back), OR
- Ship a keymap-preset detection + dispatch logic (out of scope).

Per Rule №2 (no migration baggage), neither is acceptable. The fix is
honest documentation: Deviation 2 in the module header spells out the
divergence and the closure condition (SS keymap-preset feature).

## Citation cross-verification ledger

| Citation                                                              | Verdict   |
|-----------------------------------------------------------------------|-----------|
| `graph_ops.cc:226-318` (`graphview_curves_hide_exec`)                 | EXACT     |
| `graph_ops.cc:272-273` (paired VISIBLE+SELECT CLEAR)                  | EXACT     |
| `graph_ops.cc:285` (`if (unselected)` Phase 2 gate)                   | EXACT     |
| `graph_ops.cc:341-402` (`graphview_curves_reveal_exec`)               | EXACT     |
| `graph_ops.cc:379-383` (`wasHidden` gate on SELECT write in reveal)   | EXACT     |
| `graph_ops.cc:418` (`select` RNA default = true)                      | EXACT     |
| `graph_ops.cc:332` + `:416` (OPTYPE_UNDO on both)                     | EXACT     |
| `blender_default.py:461-466` (template definition)                    | EXACT     |
| `blender_default.py:1967` (graph editor registration)                 | EXACT     |
| `blender_default.py:3838-3897` (sidebar keymap — no H bindings)       | EXACT (no false positive — sidebar absence confirmed) |
| `industry_compatible_data.py:919-923` (IC divergence)                 | NEW — added as Deviation 2 |
| `anim_channels_defines.cc:4993-5041` (`ANIM_channel_setting_set` is pure bit-flip) | EXACT — corrected Deviation 1 wording |

## SS deviations (intentional, documented)

| # | Blender behavior | SS behavior | Closure condition |
|---|------------------|-------------|-------------------|
| 1 | `FCURVE_ACTIVE` cleared by `ANIM_set_active_channel` + `deselect_all_fcurves(hide=true)` | SS has no per-FCurve ACTIVE slot; operational gap only manifests when those higher-level paths ship | Per-fcurve ACTIVE slot (`project_ss_is_embryo`) |
| 2 | Industry-Compatible binds hide to Ctrl+H (not bare H) | SS hard-codes Blender-default keymap only | SS keymap-preset selector |
| 3 | `ANIM_flush_setting_anim_channels` walks FCurveGroup hierarchy | SS has no FCurveGroup datablock; Phase 2 re-ensure is a no-op today | FCurveGroup datablock (sister to `AGRP_MUTED` deferral) |

## Owed manual browser verification (Slice 5.M flows)

1. With cursor over the graph (timeline) region, select 2 of 5 curves
   via sidebar Ctrl+click; press H → those 2 disappear from the plot;
   their `fcurve.selected` flips false; sidebar may show them with
   dimmed color or as hidden depending on existing eye-glyph styling.
2. Press Alt+H → all 5 reappear; the 3 that were originally visible
   are unaffected; the 2 that were hidden are now selected (per
   Blender's reveal-select gate).
3. Press H with NO selection → nothing happens; Ctrl+Z should NOT
   roll back any state (HIGH-A1 fix verification).
4. Press Alt+H when nothing is hidden → same no-op; Ctrl+Z does
   NOT roll back state.
5. Shift+H with 3 of 5 selected → the 2 unselected ones hide; the 3
   selected remain visible+selected. (Phase 2 no-op asserted.)
6. Shift+H, then Alt+H → all 5 visible again; the 2 previously-
   hidden are now selected (added to the existing 3).
7. Modal guard: enter G modal, press H → guard suppresses.
8. Menu guard: open V handle-type menu, press H → guard suppresses.
9. Input element guard: focus text input, press H → browser default
   (insert "h" in input) fires; SS does not hijack.
10. Mute + hide interaction: mute curve A via sidebar W-equivalent;
    select A; press H → A is hidden AND deselected; mute flag is
    preserved (sister-field test asserts this).
11. Active keyform interaction: set an active keyform on curve A,
    select A, press H → A is hidden; active keyform index persists
    on the now-hidden curve (sister-field test asserts).
12. Sidebar region hover: with cursor over sidebar, press H → fires
    the same dispatcher (H isn't region-gated). Verify the timeline
    response. (Blender doesn't bind H in sidebar; SS port deviates by
    firing universally — documented as benign because the only
    competing sidebar key is W for per-row toggle.)

## Test suites affected (10 suites, 655 total)

| Suite                          | Count | Status |
|--------------------------------|-------|--------|
| test:fcurveVisible (extended)  | 142   | PASS (was 47) |
| test:fcurveKeyformSelect       | 34    | PASS   |
| test:fcurveChannelSelect       | 168   | PASS   |
| test:fcurveMute                | 38    | PASS   |
| test:fcurveActiveKeyform       | 62    | PASS   |
| test:fcurveEval                | 35    | PASS   |
| test:fcurveHandles             | 35    | PASS   |
| test:graphEditOps              | 115   | PASS   |
| test:projectRoundTrip          | 41    | PASS   |
| test:animFCurveBridge          | 52    | PASS   |
| **TOTAL**                      | **762** | **PASS** |

`tsc --noEmit` clean.

## Lessons / reflection

**Architecture audit caught a real HIGH this slice.** Slices 5.K and
5.L had only clarity/citation nits — the dual-audit pattern's signal
varies. This slice's HIGH (empty undo snapshot from
`pushSnapshot`-before-recipe) was a latent bug across the codebase,
not a Slice 5.M regression specifically. But it surfaced HERE because
hide/reveal is the first new operator to use `update()` without
`skipHistory:true` since the undo-snapshot pattern became a default.
Pattern: **every time a new operator goes through normal undo, check
that no-op presses don't burn an undo slot.**

The fix shape (preflight readers + dispatcher short-circuit) is now a
template for future undo-bearing operators. The next slice that adds
one (e.g., DopesheetEditor row-state styling, or bulk mute/delete on
selected channels) should mirror the same pattern.

**Industry-Compatible keymap divergences are a recurring theme.** SS
has been hard-coding Blender-default bindings throughout Phase 5. This
is the first slice where the audit explicitly flagged the IC
divergence. Future modifier-bound slices should at minimum check both
keymap files (already mandated by
`feedback_modifier_binding_check_keymap_first`) and document any
divergence — even when SS won't wire both.

## Queued resume paths (12 remaining)

Slice 5.K's path #1 closed in 5.L; path #2 closed in 5.M. Remaining:

3. **Operators-on-selected-channels** — bulk mute/unmute/delete/hide
   leveraging multi-channel selection from Slices 5.F/5.J/5.K. Now
   doubly relevant since Slice 5.M's hide-selected already touches
   the pattern.
4. Footer wiring for fcurve channel state — selected/muted/hidden
   counts + active-keyform-info.
5. N-panel active-keyform numerical editor — Blender's `graph_buttons.cc`
   per-keyform inline edit.
6. Driver variable list / expression editor — Slice 5.D's biggest
   deferral.
7. `SIPO_DRAWTIME` seconds-vs-frames toggle — MED-B2 from Slice 5.E.
8. `USER_FLAG_NUMINPUT_ADVANCED` — MED-B1 from Slice 5.E.
9. Group-level mute (`AGRP_MUTED`) + group-level hide — gated on
   FCurveGroup datablock.
10. DopesheetEditor row-state styling — mute-row + active-keyform-row
    + hide-row.
11. Per-fcurve ACTIVE slot — would close Slices 5.K MED-A1, 5.L Dev 2,
    5.M Dev 1. See `project_ss_is_embryo`.
12. `ANIM_OT_channels_select_box` drag-rect on sidebar — needs sidebar
    hit-test infra.
13. Phase 2 owed-manual verification — bezier export, Hiyori round-trip.
14. Phase 3 — F-Curve modifiers — Cycles/Noise/Generator/Envelope.

New paths added by Slice 5.M's findings:

15. **SS keymap-preset selector** — would close Slice 5.M Deviation 2
    (IC Ctrl+H binding). Sister to a general "user preferences" surface.
16. **Hide/reveal toast notifications** — surfaces the `result` object
    that's currently discarded ("Hidden 3 curves" / "Revealed 2 curves").
    Architecture audit flagged the unused return as a UX gap but didn't
    rate it actionable; queued for future polish.

## Pre-compact state

| Field             | Value                                          |
|-------------------|------------------------------------------------|
| Branch            | `master`                                       |
| Working tree      | clean                                          |
| Commits ahead     | 38 (36 pre-Slice-5.M + 2 Slice-5.M)            |
| `tsc --noEmit`    | clean                                          |
| Affected tests    | 762/762 pass across 10 suites                  |
| Streak (fidelity) | 3 consecutive zero-fab slices (5.K → 5.L → 5.M)|
| Streak (overall)  | 0 (Slice 5.M had architecture HIGH-A1, fixed)  |
| Next path         | #3 (operators-on-selected-channels — bulk mute/unmute/delete/hide for the multi-channel selection from Slices 5.F/5.J/5.K) |
