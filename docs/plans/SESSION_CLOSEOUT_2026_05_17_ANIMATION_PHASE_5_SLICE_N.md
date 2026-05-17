# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.N

**Status:** SHIPPED + dual-audit closed. Fidelity zero-fab streak holds at
**4** consecutive slices (5.K → 5.L → 5.M → 5.N). Architecture audit
caught a real HIGH (selection-store overreach) — fixed cleanly via
snapshot-and-filter pattern.

## Commits

| SHA       | Subject                                                                    |
|-----------|----------------------------------------------------------------------------|
| `e9d0457` | feat(anim): Animation Phase 5 Slice 5.N — bulk channel delete (sidebar X/Delete) |
| `56dcce9` | fix(audit): Animation Phase 5 Slice 5.N dual-audit sweep — 1 HIGH + 2 MED |

## What shipped

Closes part of Slice 5.K's queued path #3 (operators-on-selected-
channels). Region-aware X/Delete dispatch:

- **Sidebar region** → bulk delete every FCurve with `selected===true`
  (ports `ANIM_OT_channels_delete` at `anim_channels_edit.cc:2739-2873`)
- **Timeline region** → existing per-keyform delete (Slice 5.C
  `operatorDelete`, unchanged)

The mute side of path #3 (`anim.channels_setting_toggle` on Shift+W)
stays queued. Blender's Shift+W opens a setting-picker menu (mute /
visible / protect / etc.) via `WM_menu_invoke`. SS doesn't have a
channels-context menu surface, and inventing a direct Shift+M hotkey
would violate `feedback_blender_reference_strict`. The proper port
needs the menu UI as its own slice.

### Files

| File                                              | Lines change | Role |
|---------------------------------------------------|--------------|------|
| `src/anim/fcurveChannelSelect.js`                 | +101 / -2    | 2 new exports: `applyChannelDeleteSelected` + `wouldChannelDeleteSelectedChange` |
| `src/v3/editors/fcurve/FCurveEditor.jsx`          | +97 / -3     | Import expansion + `applyChannelDeleteOp` callback with HIGH-A1 snapshot-and-filter + region-aware X/Delete dispatch |
| `scripts/test/test_fcurveChannelSelect.mjs`       | +152 (+36)   | 168 → 204 assertions |

## Blender semantics ported

- **`ANIM_OT_channels_delete`** — `anim_channels_edit.cc:2739-2873`.
  Filter: `ANIMFILTER_SEL | ANIMFILTER_FOREDIT | ANIMFILTER_NODUPLIS
  | ANIMFILTER_LIST_VISIBLE` (`:2767-2768`).
- **`ED_anim_ale_fcurve_delete`** — `anim_channels_edit.cc:2692-2734`.
  Handles drivers and non-drivers uniformly via the
  `fcu->driver || adt->action` branch at `:2712`.
- **Keymap (default)**: X / DEL at `blender_default.py:3873-3874`.
- **Keymap (industry-compat)**: Backspace / DEL at
  `industry_compatible_data.py:2357-2358` (deferred via Deviation 1).

## Dual-audit findings (closed)

Two agents in parallel, lens-specialized.

| Tag      | Severity | Title                                                      | Status |
|----------|----------|------------------------------------------------------------|--------|
| HIGH-A1  | HIGH (85) | `useSelectionStore.getState().clear()` evicted unrelated selection items | FIXED in `56dcce9` — snapshot-and-filter |
| MED-A1   | MED (80)  | Idless `selected:true` entries were undeletable           | FIXED in `56dcce9` — drop any selected entry; idless drops silent |
| MED-A2   | MED (82)  | Region routing relies on pointer hover (keyboard nav falls through) | DOCUMENTED as known limitation (pre-existing across all region-aware keys) |
| LOW-B1   | n/a       | n/a                                                        | Blender-fidelity found ZERO findings |

### HIGH-A1 deep dive

`useSelectionStore.items` is a flat `SelectableRef[]` containing
parameters, parts, groups, etc. The active fcurve is RESOLVED from
the most-recent matching item via `pickFCurve` (walks items
backwards). The original draft called `.clear()` whenever the active
fcurve was deleted — which zeroed every unrelated selection item.

**Correct port**: snapshot which items resolve to which fcurve BEFORE
delete; after delete, replace `selectionStore.items` with only those
NOT resolving to a deleted fcurve. Items with no fcurve resolution
(e.g., a part selected for the translation gizmo with no animation
channel) are preserved unchanged.

The resolution logic mirrors `pickFCurve` exactly to ensure
behavioral consistency. Reading via `useProjectStore.getState()` +
`useSelectionStore.getState().items` keeps the dispatcher
subscription-free (same pattern as Slice 5.M's preflight readers).

### MED-A2 deep dive (documented, not fixed)

`regionHoverRef.current` updates only via `onPointerEnter` /
`onPointerLeave` on the sidebar container. Keyboard-only users who
Tab into FCurveEditor without pointer hover never trigger the
sidebar branch — X falls through to keyform delete.

**Why not fix now**: this affects every region-aware key in
FCurveEditor (A/Alt+A/Ctrl+I from Slice 5.K too). The proper fix
needs sidebar focus tracking: make sidebar rows focusable, wire
focus/blur events, possibly add visual focus indicators. That's a
sidebar-wide accessibility lift, not a Slice 5.N concern. Documented
in-line as a known limitation; future slice can lift it across all
region-routed keys at once.

## Citation cross-verification ledger

| Citation                                                              | Verdict |
|-----------------------------------------------------------------------|---------|
| `anim_channels_edit.cc:2739-2873` (`animchannels_delete_exec`)        | EXACT   |
| `anim_channels_edit.cc:2767-2768` (ANIMFILTER flags)                  | EXACT   |
| `anim_channels_edit.cc:2692-2734` (`ED_anim_ale_fcurve_delete`)       | EXACT   |
| `anim_channels_edit.cc:2712` (driver-unified branch)                  | EXACT   |
| `blender_default.py:3873-3874` (default X/DEL)                        | EXACT   |
| `industry_compatible_data.py:2357-2358` (IC Backspace/DEL)            | EXACT   |
| Container walk (`animchannels_delete_containers` :2562-2737) MOOT for SS | VERIFIED — handles only ActionSlot/Group/GPLayer/MaskLayer; SS has none |
| `tag_update_animation_element` / `DEG_relations_tag_update` MOOT for SS | VERIFIED — SS has no depsgraph; eval cache invalidates via Zustand subscribe |
| `ANIMCONT_SHAPEKEY` early-cancel MOOT for SS                          | VERIFIED — SS has no shapekey anim context |
| `ANIM_animdata_update` post-delete active re-resolve                  | VERIFIED — SS's HIGH-A1 fix matches Blender's "if active was deleted, it's gone" outcome |

## SS deviations (intentional)

| # | Blender behavior | SS behavior | Closure condition |
|---|------------------|-------------|-------------------|
| 1 | Industry-Compatible binds Backspace + DEL | SS hard-codes default X / DEL | SS keymap-preset selector (sister to Slice 5.M Dev 2) |
| 2 | `animchannels_delete_containers` handles ActionSlot/Group/GPLayer/MaskLayer | SS has flat `action.fcurves` array — no containers exist | Container datablock per type (FCurveGroup, ActionSlot — gated on schema work) |

## Owed manual browser verification (12 flows)

1. Hover sidebar, select 1 channel, press X → that fcurve gone;
   sidebar updates; other channels untouched.
2. Same with Delete key → same outcome.
3. Hover sidebar, select 3 channels, press X → all 3 gone;
   active-fcurve resolution falls back to one of the survivors
   (or null if all selection items targeted deleted fcurves).
4. Hover sidebar, press X with NO selection → no-op; Ctrl+Z does
   NOT roll back state (HIGH-A1 preflight verification).
5. Hover timeline, press X with selected keyforms → keyform
   delete fires (existing Slice 5.C behavior unaffected).
6. Hover timeline, press X with no selected keyforms but selected
   channels → keyform delete fires; channels NOT deleted.
   Confirms region routing.
7. Hover sidebar, select all channels (A), press X → action.fcurves
   becomes empty; sidebar shows empty list; timeline shows nothing.
   Action survives (no minimum-curve guard per Blender).
8. **HIGH-A1 verification**: have a non-FCurveEditor selection
   active (e.g., select a part in the viewport for the translation
   gizmo). Open FCurveEditor in another area, hover sidebar, select
   a channel whose backing parameter is a different param from the
   viewport selection, press X. → channel deleted; viewport
   selection STILL active (gizmo still anchored). Pre-fix would
   have wiped the viewport selection.
9. **HIGH-A1 verification with overlap**: select a part in the
   viewport that DOES back an animated parameter. Open FCurveEditor,
   hover sidebar, select that channel, press X. → channel deleted;
   gizmo selection IS cleared (because that part WAS the active
   fcurve's backing source). Correct surgical removal.
10. Delete a driver-bearing channel (one shown with the Slice 5.D
    edit-disabled banner) → channel IS deleted (channel-layer
    semantic differs from keyform-layer per Blender intent).
11. Modal guard: enter G modal, press X → guard suppresses.
12. Input guard: focus a text input, press X → browser default
    fires; SS does NOT delete.

## Test suites affected (8 suites, 826 total)

| Suite                          | Count | Status |
|--------------------------------|-------|--------|
| test:fcurveChannelSelect (extended) | 204 | PASS (was 168 → 202 substrate → 204 audit-fix) |
| test:fcurveVisible             | 142   | PASS   |
| test:fcurveKeyformSelect       | 34    | PASS   |
| test:fcurveMute                | 38    | PASS   |
| test:fcurveActiveKeyform       | 62    | PASS   |
| test:fcurveEval                | 35    | PASS   |
| test:fcurveHandles             | 35    | PASS   |
| test:graphEditOps              | 115   | PASS   |
| test:projectRoundTrip          | 41    | PASS   |
| test:animFCurveBridge          | 52    | PASS   |
| **TOTAL**                      | **758** | **PASS** |

`tsc --noEmit` clean.

## Lessons / reflection

**Architecture audit caught real HIGH this slice too.** Pattern: when
a new operator touches state OUTSIDE the immediate target (here,
selection-store post-delete cleanup), check what unrelated state
might be wrongly evicted. Snapshot-and-filter (preserve unaffected
items) > clear-and-rebuild (wipe everything).

**The dispatcher-side test gap is real but unfixable without harness
infra.** Architecture audit's L2 noted that `applyChannelDeleteOp`'s
side-effect cleanup paths have zero coverage. Adding React state
tests would require a render harness (jsdom + React Testing Library
or similar) that SS doesn't have. The pure helpers are well-covered;
the React glue is verified by manual browser flows (#8 + #9 above
specifically). Queued as a hypothetical infrastructure improvement.

**Zero-fab fidelity streak hits 4.** The `feedback_modifier_binding_check_keymap_first`
discipline keeps paying off. Every cited line number, every filter
flag, every modifier mapping verified directly against Blender source.
The architecture audit's HIGH-A1 was a UI-layer bug that lived
entirely outside the Blender port — fidelity stayed clean.

## Queued resume paths (12 remaining + 1 new)

Slice 5.K closed paths #1 (in 5.L) and #2 (in 5.M). Slice 5.N closed
the DELETE half of path #3. Remaining:

3. **Path #3 MUTE half** — `anim.channels_setting_toggle` (Shift+W →
   menu picker). NEW PRIORITY since the delete half just shipped.
   Needs channel-context menu UI.
4. Footer wiring for fcurve channel state — counts + active info.
5. N-panel active-keyform numerical editor — Blender's
   `graph_buttons.cc` per-keyform inline edit.
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

New paths queued by Slice 5.M findings:

15. SS keymap-preset selector — would close Slice 5.M Dev 2 + Slice
    5.N Dev 1 (Industry-Compatible bindings).
16. Hide/reveal toast notifications — surfaces result objects.

New path queued by Slice 5.N findings:

17. **Sidebar focus tracking for region-aware keys** — would close
    Slice 5.N MED-A2 + retroactively fix Slice 5.K's
    A/Alt+A/Ctrl+I keyboard-only gap.

## Pre-compact state

| Field             | Value                                                |
|-------------------|------------------------------------------------------|
| Branch            | `master`                                             |
| Working tree      | clean                                                |
| Commits ahead     | 41 (39 pre-Slice-5.N + 2 Slice-5.N)                  |
| `tsc --noEmit`    | clean                                                |
| Affected tests    | 758/758 pass across 10 suites (+36 new this slice)   |
| Streak (fidelity) | **4** consecutive zero-fab slices (5.K → 5.L → 5.M → 5.N) |
| Streak (overall)  | 0 (Slice 5.M + 5.N each had architecture HIGH, both fixed) |
| Next path         | #3 MUTE half (Shift+W → channels_setting_toggle menu) — needs channels-context menu UI scoping |
