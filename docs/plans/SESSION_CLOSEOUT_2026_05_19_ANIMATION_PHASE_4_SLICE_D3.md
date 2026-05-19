# Session Closeout — Animation Phase 4 Slice 4.D.3 (NLAEditor affordances)

**Date:** 2026-05-19
**Branch:** master (155 commits ahead of origin/master, +2 this slice)
**Schema:** v42 (no bump — UI-only slice)
**Status:** SHIPPED — substrate `f551079` + audit-fix `13f0f12`
**Phase 4:** 6/7 sub-slices complete (4.A + 4.B + 4.C + 4.D.1 + 4.D.2 + 4.D.3;
remaining 4.D.4 + 4.E + 4.F + 4.G)

---

## What 4.D.3 ships

Plan §4.D affordance scope items:

1. ✅ Per-track Mute toggle — clickable Lucide IconToggle
   (Eye/EyeOff). Replaces 4.D.1 read-only `M` letter badge.
2. ✅ Per-track Solo toggle — clickable Star icon. Byte-faithful
   port of `BKE_nlatrack_solo_toggle` (`nla.cc:1262-1292`):
   exclusive (clears SOLO on others) + syncs ADT_FLAG.NLA_SOLO_TRACK.
3. ✅ Per-track Protected toggle — clickable Lock/Unlock icon.
4. ✅ Per-track Disabled indicator — read-only Ban icon (runtime
   tweak-mode state, not user-toggleable).
5. ✅ Per-strip blend-mode dropdown (Replace / Add / Subtract /
   Multiply) — labels from `BLENDMODE_LABELS`
   (`rna_nla.cc:32-61 rna_enum_nla_mode_blend_items`).
6. ✅ Per-strip extend-mode dropdown (Hold / Hold Forward / Nothing)
   — labels from new `EXTENDMODE_LABELS`
   (`rna_nla.cc:63-72 rna_enum_nla_mode_extend_items`).
7. ✅ Per-strip influence slider (0..1) — clamped per `PROP_FACTOR`
   range (`rna_nla.cc:1069-1072`).
8. ✅ Per-strip Mute toggle button in footer panel.
9. ✅ Edit Action button → calls Slice 4.C `enterTweakMode`. Disabled
   when track is PROTECTED or animData already in tweak mode on a
   different strip (matches 4.C HIGH-A2 contract).
10. ✅ Exit Tweak button in GroupHeader → calls Slice 4.C
    `exitTweakMode` (with `project` arg so SYNC_LENGTH bounds
    re-derive per 4.C HIGH-F5).
11. ✅ Click-to-select strip (4px movement threshold) — editor-local
    selection state drives the footer panel + Edit Action gating.
12. ✅ Strip-properties footer panel (88px) — composite of items 5-9
    above. Mirrors Blender `nla_panel_properties`
    (`nla_buttons.cc:397-459`) but as bottom strip vs side panel.

Deferred per plan:
- Push Action Down → 4.D.4
- "+ Track" / "+ Strip" CRUD → 4.D.4
- blend-in / blend-out ramps + use_auto_blend → later (Blender gates
  these behind `use_auto_blend == false` at `nla_buttons.cc:441`)
- USR_INFLUENCE / USR_TIME driven-prop UI — SS doesn't model F-curve
  editing at that level yet
- BakeNLA → 4.E

Concretely:

- **EDITED [src/v3/editors/nla/nlaEditorOps.js](../../src/v3/editors/nla/nlaEditorOps.js)** (~620 LOC after audit-fix)
  — +7 pure-function ops + 5 wouldChange predicates + 2 helpers
  (locateTrack, patchTrack). Solo toggle is byte-faithful port of
  `BKE_nlatrack_solo_toggle`.

- **EDITED [src/v3/editors/nla/NLAEditor.jsx](../../src/v3/editors/nla/NLAEditor.jsx)** (~1130 LOC after audit-fix)
  — IconToggle + StripPropertiesPanel + resolveSelectedStrip
  components; selection state via setSelectedStripRef; click-vs-drag
  detection via maxMovePxRef; 8 new affordance handler callbacks.

- **EDITED [src/v3/editors/nla/nlaEditorData.js](../../src/v3/editors/nla/nlaEditorData.js)** (~320 LOC)
  — EXTENDMODE_LABELS export added.

- **EDITED [scripts/test/test_nlaEditorOps.mjs](../../scripts/test/test_nlaEditorOps.mjs)** (~510 LOC, 122 asserts total, +58 this slice in sections 18-30)

## Cite-discipline arc

**HOLDS at 2 post-reset** ✅. Fidelity audit verified **16/17 Blender
citations BYTE-EXACT** against `reference/blender/`. The 17th cite
(`nla_buttons.cc:357` claimed as "always-live baseline influence
slider") was CORRECTED to "AnimData-level `action_influence`, NOT
per-strip `influence`" — but the per-strip slider IS gated on
`use_animated_influence` (`:550`), which means SS has a deviation
(always-editable baseline) that was being incorrectly justified as
fidelity. See HIGH-F1 below. **NO fabricated citations.**

Fab streak (Blender citations only): 5.P broke at 0 → 3.F HOLDS at 1
→ 3.G HOLDS at 2 → 4.A HOLDS at 3 → 4.B HOLDS at 4 → 4.C HOLDS at 5
→ **4.D.1 BROKE** → reset → **4.D.2 HOLDS at 1** → **4.D.3 HOLDS at
2 post-reset** ✅.

## Dual-audit findings (commit `13f0f12`)

### Architecture (2 HIGH + 3 MED addressed)

- **HIGH-A1 (Rule №1)**: `enterTweakMode` had ZERO `NLATRACK_FLAG.PROTECTED`
  check. UI gate in `StripPropertiesPanel` was the only protection
  barrier; substrate would silently succeed on PROTECTED tracks for
  any non-UI caller. **Fix**: Added PROTECTED gate inside
  `enterTweakMode` (returns `false` immediately, before TWEAKUSER
  tagging / DISABLED cascade / action swap). SS-original layer
  placement: Blender's BKE layer also doesn't gate; SS folds editor-
  layer filter into BKE-equivalent to make it bypass-proof. Test §17
  added (+10 asserts).

- **HIGH-A2 (state lifecycle)**: `selectedStripRef` wasn't cleared on
  PROJECT IDENTITY change. A freshly-loaded project with a strip
  carrying the same id (UUID collision OR same `.stretch` reload)
  would silently resolve to a different strip object — footer panel
  would show stale data. **Fix**: Added `useEffect([project?.id])`
  reset.

- **MED-A1 (Rule №1 consistency)**: `applySetStripInfluence` silently
  returned same-ref on NaN/Infinity. `applySetStripBlendMode` /
  `applySetStripExtendMode` throw on invalid input — asymmetry.
  **Fix**: Throw on `!Number.isFinite(influence)`. Tests 24e/24f/24g
  updated to assert throw.

- **MED-A2 (Rule №1 silent-fallback)**: `makeNodeRecipe` used
  `if (newAd && newAd !== ad)` — truthiness check would silently
  swallow a future op returning falsy. **Fix**: Strict `!==` matching
  the 4.D.2 drag-commit pattern in the same file.

- **MED-A3 (perf future-proofing)**: Inline arrow callbacks in
  `visibleGroups.map` create fresh function refs per render. Not a
  bug today (TrackRow not `React.memo`-wrapped); will become real
  re-render storm if memoized. **Fix**: Documented trade-off +
  refactor path. No code change.

### Fidelity (1 HIGH + 3 MED + 2 LOW; 1 LOW non-actionable + 1 fixed)

- **HIGH-F1 (content accuracy)**: `applySetStripInfluence` JSDoc
  cited `nla_buttons.cc:357` as proof "Blender's UI lets you set the
  baseline anytime". WRONG: `:357` is `action_influence` on
  `&adt_ptr` (AnimData-level), NOT per-strip `&strip_ptr` `influence`.
  The actual per-strip slider at `:551` IS gated at `:550` by
  `enabled_set(use_animated_influence)` — Blender DISABLES the per-
  strip baseline unless USR_INFLUENCE is set. SS deviates by allowing
  always-editable baseline. **Fix**: Rewrote JSDoc to honestly own
  the deviation + corrected cite + added SS DEVIATION 12.

- **MED-F1**: PROTECTED gate at the UI layer (`StripPropertiesPanel`)
  is SS-original — Blender's `nlaop_poll_tweakmode_off`
  (`nla_edit.cc:195`) does NOT gate on track-PROTECTED. **Fix**:
  Comment expanded to call out SS-original status + reference both
  enforcement layers (UI gate + HIGH-A1 substrate gate).

- **MED-F2**: `exitTweakMode` doesn't accept Blender's
  `isolate_action` boolean (clears `ADT_NLA_SOLO_TRACK` on exit when
  set; exposed in `space_nla.py:281` as Alt-Tab). **Fix**: Module
  JSDoc deferred-list documents the gap. Future keyboard-shortcut
  slice can add "Exit + Clear Solo".

- **MED-F3**: Click-to-select comment underspecified — only noted
  Blender's modal G/S transform, missed `NLA_OT_click_select`.
  **Fix**: Rewrote `CLICK_DRAG_THRESHOLD_PX` comment to enumerate
  all 3 Blender operators SS unifies (click_select + translate +
  transform) + cross-reference editor-local-selection deviation.

- **LOW-F1**: `BLENDMODE_LABELS` cite-correction comment block could
  be condensed (polish, not content). **Not addressed** — comment is
  retained verbatim because it documents the 4.D.1 broken-streak
  history per the cite-discipline accounting convention.

- **LOW-F2**: `applyToggleStripMuted` JSDoc was missing line number
  for the Blender mute property. **Fix**: Added precise cite
  (`rna_nla.cc:1126-1129` for the RNA prop +`nla_buttons.cc:392`
  for the panel checkbox surface — both verified before pasting).

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_nlaEditorOps.mjs (extended this slice) | 64 | 123 | +59 |
| test_nlaTweakMode.mjs (§17 added audit-fix) | 75 | 85 | +10 |

**New Phase 4 cumulative assertions: 185 (v42) + 86 (nlaEval) +
85 (nlaTweakMode) + 56 (nlaEditorData) + 123 (nlaEditorOps) = 535.**

## Files touched (commits `f551079` + `13f0f12`)

| File | Purpose |
|------|---------|
| src/anim/nlaTweakMode.js | audit-fix HIGH-A1: PROTECTED gate in `enterTweakMode` |
| src/v3/editors/nla/nlaEditorOps.js | +7 ops + 5 predicates + 2 helpers; audit-fix HIGH-F1 + MED-A1 + LOW-F2 |
| src/v3/editors/nla/NLAEditor.jsx | IconToggle + StripPropertiesPanel + selection + click-vs-drag + affordance wiring; audit-fix HIGH-A2 + MED-A2 + MED-A3 + MED-F1 + MED-F2 + MED-F3 |
| src/v3/editors/nla/nlaEditorData.js | EXTENDMODE_LABELS export |
| scripts/test/test_nlaEditorOps.mjs | +14 test sections (18-30 + audit-fix split) |
| scripts/test/test_nlaTweakMode.mjs | +§17 PROTECTED refusal coverage |

## SS deviations (Phase 4 cumulative now 12; +2 this slice)

This slice introduces **2 new** documented SS deviations:

11. **Click-vs-drag 4px threshold + click-to-select on left-button**
    (NLAEditor.jsx). Blender uses THREE separate operators where SS
    has one composite pointerdown: `NLA_OT_click_select` for
    selection (right-click default), `NLA_OT_translate` (G key
    modal) for drag, `NLA_OT_transform` (S key modal) for resize.
    SS unifies on left-button pointerdown + 4px threshold to gate
    click vs drag. SS also doesn't write `NLASTRIP_FLAG.SELECT` to
    animData (editor-local selection state instead). SS-original UX
    for mouse-first flows.

12. **Always-editable strip influence baseline** (nlaEditorOps.js
    `applySetStripInfluence`). Blender DISABLES the per-strip
    influence slider unless `NLASTRIP_FLAG.USR_INFLUENCE` is set
    (`nla_buttons.cc:550` `enabled_set(use_animated_influence)`).
    SS doesn't gate writes — the data field IS the source of truth;
    Blender's UI gating is treated as an affordance choice, not a
    data invariant. (Audit-fix Slice 4.D.3 HIGH-F1 corrected a
    pre-fix JSDoc that incorrectly justified this deviation as
    Blender parity.)

**Plus 1 SS-original layer placement (not a new deviation per se,
but a re-architecture)**:

- `enterTweakMode` PROTECTED gate at the BKE-equivalent substrate
  layer (audit-fix HIGH-A1). Blender enforces PROTECTED in the
  editor-layer channel filter, not BKE. SS folds the editor filter
  into the BKE-equivalent so any caller (test, automated path,
  accessibility bypass) gets consistent refusal. Rule №1.

Inherited from 4.A/4.B/4.C/4.D.1/4.D.2 unchanged: 10 deviations.

## Plan-doc + MEMORY updates

- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4 ship-status
  banner: "6/7 sub-slices SHIPPED"; cite-discipline updated.
- `MEMORY.md` `project_blender_parity_plans_in_flight` index entry
  updated with 4.D.3 details.

## Top queued path next

**Slice 4.D.4 — CRUD + Push Action Down** (~2 days projected):

- "+ Track" affordance per Object (creates fresh NlaTrack via Slice
  4.A `makeNlaTrack`)
- "+ Strip" affordance per track (creates fresh NlaStrip referencing
  a project Action via Slice 4.A `makeNlaStrip`)
- Delete track + Delete strip operators (with confirmation if track
  has strips)
- Track/strip CRUD right-click context menus
- Push Action Down operator — ports Blender's `NLA_OT_action_pushdown`
  (`nla_tracks.cc:461`): converts `animData.actionId` into a new strip
  on a new top-of-stack track, then clears the active action.

After 4.D.4, the NLAEditor surface is feature-complete for the
"create from scratch + manage existing" user workflow. Slice 4.E
ships BakeNLA (the runtime → ground-truth-Action collapse).

---

**Commits this slice (2):**
- `f551079` — feat(anim): Phase 4 Slice 4.D.3 — NLAEditor affordances
  (toggles + footer panel)
- `13f0f12` — fix(audit): Phase 4 Slice 4.D.3 audit-fix — 3 HIGH +
  5 MED + 1 LOW; cite-discipline HOLDS at 2

**Phase 4 progress: 6/7 sub-slices.**

**Closes:** 0 grievances (UI-only; full Phase 4 closes 1 grievance
— "no NLA stack"). With 4.D.3 the NLA tweak-mode workflow is
end-to-end user-driven (select strip → Edit Action enters tweak →
edits flow to the bound action → Exit Tweak restores). Ready for
4.D.4 CRUD + Push Action Down.
