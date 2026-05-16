# Session Close-out — Animation Phase 5 Slice 5.C SHIPPED
**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `0d78ad3` — feat(anim): Animation Phase 5 Slice 5.C — Graph Editor operator pass
- `213c748` — fix(audit): Animation Phase 5 Slice 5.C dual-audit sweep — 6 HIGH + 2 MED + 4 doc findings
- *(this doc)* — close-out documentation

Third Phase 5 close-out of the day, on top of `bd1e68b` + `feb4bde` + `c880fad` (Slices 5.A+5.B earlier today). Sister of [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) — Slice 5.C lifts the rest of plan §5.B's operator table now that the editor scaffold + drag write-mode is in.

---

## What shipped

The F-Curve Graph Editor now supports the full Blender-faithful operator surface for editing keyforms:

- **B** — box-select via local rubber-band rect (replace / Shift-add / Ctrl-subtract).
- **G** — modal grab over selected keyforms. Per-part-aware: center-selected entries translate the whole BezTriple (handles ride along); handle-only entries translate just the dragged handle. Ctrl-hold snaps `dTime` to whole frames; Shift = 0.1× precision multiplier. LMB / Enter confirm; Esc / RMB revert.
- **S** — modal scale around the selection's median (time, value) pivot. Same modifiers as G.
- **V** — handle-type menu (Free / Aligned / Vector / Auto / Auto Clamped). 1-9 shortcuts. Sets type on selected keyforms + runs `recalcKeyformHandles` to re-position auto/aligned handles.
- **T** — interpolation menu (Constant / Linear / Bezier + 10 named easings). Per-keyform write (Blender's segment-start convention).
- **Shift+E** — extrapolation menu (Constant / Linear). Per-FCurve write. MAKE_CYCLIC / CLEAR_CYCLIC F-Modifier shortcuts deferred to Phase 3 per plan.
- **Delete / X** — delete selected keyforms (handle-only entries left intact; matches Blender's GRAPH_OT_delete). Guard prevents leaving a curve with zero keyforms.
- **Home** — clear the view-lock + re-fit to FCurve range.
- **Ctrl+G** — snap selected keyforms' centres to the nearest whole frame; handles ride along; post-snap re-sort + duplicate-time merge + handle recalc.
- **A** — toggle-all (Blender's `ACTION_OT_select_all` semantic).
- **Click-on-handle** — selects that side only (Shift = add to existing); immediate drag with Blender-faithful handle-type conversions (already in Slice 5.B; preserved here).
- **Click-on-center** — selects whole keyform (`{center,left,right}` all true); immediate drag.
- **Drag-release everywhere** — runs `mergeDuplicateTimeKeys` (Blender's `BKE_fcurve_merge_duplicate_keys` parity, `fcurve.cc:1801-1910`) + `recalcKeyformHandles` so cross-induced ties collapse and auto/aligned handles re-settle.
- **Lock-view-during-drag** — view's auto-fit value range freezes at drag/modal start, unfreezes on release. Closes the 5.A UX wart where dragging a kf outside the range rescaled the y-axis mid-drag.

---

## Per-handle selection state

Selection model lifted from `Set<keyformIdx>` to `Map<idx, {center,left,right}>`, mirroring Blender's `BEZT_SEL_F2 / F1 / F3` flags (`DNA_curve_types.h:90-95`). Effects:

- Click on a keyform diamond selects all three parts (KNOT_ONLY semantic — click-center implies "edit the whole BezTriple").
- Click on a handle dot selects only that side.
- Box-select fills each kf's `{center, left, right}` independently based on whether each sub-component falls in the rect (`incl_handles=true`, matching Blender's `GRAPH_OT_select_box` default at `graph_select.cc:933-940`).
- Modal G uses per-part flags to decide what moves: center → whole kf + handles ride along; left/right only → just that handle.
- Modal S scales each part independently per the same flags.

---

## Pure-helpers extracted to `src/anim/graphEditOps.js`

Slice 5.B's existing `applyKeyformDrag` + `applyHandleDrag` preserved. New for 5.C:

| Helper | What | Blender ref |
|---|---|---|
| `snapshotKeyform` | Capture pre-transform state for modal G/S baseline | (SS infra) |
| `applyGrabToKeyform` | Per-kf grab; center→ride-along, handle-only→independent | `transform_convert_graph.cc:830-955` |
| `applyScaleToKeyform` | Per-kf scale around pivot | `transform_convert_graph.cc` TFM_RESIZE |
| `applyGrab` | Loops selection + applies per-kf grab + runs `testKeyformHandles` | `transform_convert_graph.cc:580` (`testhandles_fcurve` per-tick) |
| `applyScale` | Sister of `applyGrab` for resize | `transform_convert_graph.cc` TFM_RESIZE |
| `testKeyformHandles` | Per-kf BKE_nurb_bezt_handle_test in NURB_HANDLE_TEST_EACH | `curve.cc:4054-4084` |
| `snapKeyformsToFrame` | Round selected times to msPerFrame; handles ride along | `graph_edit.cc:2326-2418` GRAPHKEYS_SNAP_NEAREST_FRAME |
| `setHandleType` | Write handleType across selection (V menu) | `graph_edit.cc:1704-1736` sethandles_graph_keys |
| `setInterpolation` | Write interpolation across selection (T menu) | `graph_edit.cc` setipo_graph_keys |
| `setExtrapolation` | Write per-FCurve extrapolation (Shift+E menu) | `graph_edit.cc:1443-1496` setexpo_graph_keys |
| `deleteKeyforms` | Drop kfs with `parts.center=true`; returns remap | `fcurve.cc:1450-1490` BKE_fcurve_delete_keys |
| `mergeDuplicateTimeKeys` | Collapse same-time clusters; selected→average to FIRST; unselected→unconditional delete | `fcurve.cc:1801-1910` BKE_fcurve_merge_duplicate_keys |
| `remapSelection` | Drop deleted entries from a selection Map | (SS infra for editor's post-op selection sync) |

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Two parallel agents (architecture + Blender-fidelity) on feature commit `0d78ad3`. **8 real findings + 4 doc-only findings** addressed in audit-fix `213c748`:

| # | Severity | Source | File:line | Finding |
|---|---|---|---|---|
| HIGH-A1 / MED-B7 | HIGH | both | FCurveEditor.jsx::operatorSnapToFrame | Pre-sort selection indices fed to `mergeDuplicateTimeKeys` after `snapKeyformsToFrame` permuted entries; could collapse wrong keyform |
| HIGH-A2 | HIGH | arch | FCurveEditor.jsx::startModal | Reverse-scan `indexOfOriginMap` lookup collapsed origins on transient post-sort index collisions; one origin froze for rest of modal |
| HIGH-A4 | HIGH | arch | FCurveEditor.jsx::operatorDelete | "Would leave 0 keyforms" guard fired inside immer recipe AFTER beginBatch; phantom no-op undo snapshot pushed |
| HIGH-A5 | HIGH | arch | FCurveEditor.jsx::startBoxSelect | No cleanup ref; unmount mid-box-select leaked 3 window listeners + set-state warnings |
| HIGH-B1 | HIGH | Blender | graphEditOps.js::testKeyformHandles | VECT→FREE guard keyed off `flag1 !== flag2` (left vs right); Blender XORs each handle's flag with the CENTRE flag — `curve.cc:4074, 4079` |
| HIGH-B3 | HIGH | Blender | graphEditOps.js::mergeDuplicateTimeKeys | Kept LAST selected entry; Blender's reverse-sweep (`fcurve.cc:1869-1899`) keeps FIRST |
| MED-A2 | MED | arch | FCurveEditor.jsx::onKeyDown | `view` missing from useCallback deps; startModal captured stale `snap` after container resize |
| HIGH-B2 (doc) | HIGH | Blender | graphEditOps.js JSDoc | Snap enum citation `SNAP_KEYS_HORIZONTAL` is Blender's "Flatten Handles", not snap-to-frame. Replaced with `GRAPHKEYS_SNAP_NEAREST_FRAME` |
| HIGH-B4 (doc) | HIGH | Blender | graphEditOps.js::setHandleType JSDoc | `applySide` parameter has no Blender counterpart; annotated as SS extension |
| MED-B5 (doc) | MED | Blender | FCurveEditor.jsx::applyBoxSelect | Box-select `incl_handles=true` matched Blender default but no citation in code; added |
| MED-B6 (doc) | MED | Blender | FCurveEditor.jsx Slice 5.C header | Modal G/S missing axis-lock + typed numeric input not acknowledged; added as deferred-feature note |

**Cross-verification step (HIGH-B1)**: the architecture audit and the Blender-fidelity audit independently disagreed on the VECT→FREE logic. Before applying, I read `reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084` directly — Blender's check is unambiguously XOR-with-centre (`!(flag & SEL_F1) != !(flag & SEL_F2)` for h1). The fix matches Blender's pattern; tests now assert the partial-selection semantic that includes centre-only and both-handles-no-centre cases.

---

## Owed manual browser verification

Cannot be assertion-tested headlessly:

1. **Modal G end-to-end**: select two keyforms (one click + Shift-click), press G, drag, confirm with LMB. Verify both kfs translate together; release shows merged + sorted result.
2. **Modal G with Ctrl-snap**: same as above but hold Ctrl during drag. Verify dTime snaps to the FPS's frame grid (defaults to 24fps → 1000/24 ms per frame).
3. **Modal S around median pivot**: select 3 kfs spanning a curve, press S, drag outward. Verify all 3 expand from the median (kf 0 moves left, kf 2 moves right, kf 1 mostly stays).
4. **Box-select with rubber-band**: press B, drag a rect over part of the curve. Verify keyforms whose diamond OR a handle dot fall in the rect end up selected with the corresponding part(s) lit.
5. **V handle-type menu**: select kfs, press V. Verify popover appears, 1-5 shortcuts work, "current" type is highlighted, picking a type triggers visible handle-shape change.
6. **T interpolation menu**: select kfs, press T. Verify the same UX as V; picking changes the curve-path shape between the selected kfs.
7. **Shift+E extrapolation menu**: press Shift+E; pick Linear. Verify the curve extends as a line past the first/last kf instead of holding flat.
8. **Delete + last-kf guard**: select all but one kf, press Delete (or X). Verify the surviving kf stays. Then select the remaining kf and press Delete — should be a no-op (no phantom undo).
9. **Ctrl+G snap-to-frame**: pick a kf at a non-frame time, press Ctrl+G. Verify time snaps to the nearest 24fps frame; handles ride along; if it collided with a neighbour, the merge averages them.
10. **Home**: drag a kf outside the auto-fit range (the view freezes per HIGH-A1 polish); release; press Home. Verify view auto-fits to the new range.
11. **Box-select unmount cleanup** (HIGH-A5 verification): press B, drag, switch workspaces mid-drag. Open DevTools → no React unmounted-state-setter warnings. Re-enter the editor, drag again; no zombie rubberband.
12. **Modal G unmount cleanup** (HIGH-A1 from Slice 5.B preserved): press G, switch workspaces mid-modal. Verify undo (Ctrl+Z) still works on subsequent edits.
13. **Per-handle XOR test (HIGH-B1 visual)**: click a kf's centre dot AND Shift-click ONE of its handle dots so selection = `{center:true, left:true, right:false}` (or rotate to other side). Then trigger Modal G drag of ANY other kf in the curve — verify the centre+one-handle entry has its OPPOSITE handle (the one that disagreed with centre) flip per the XOR rule when it ends up partially-selected. (Indirect — the easier way to see this is via box-select that catches centre + one handle dot but not the other.)

---

## Tests passing (final state at `213c748`)

| Test | Pass/Fail |
|------|-----------|
| test:graphEditOps | 115/115 |
| test:fcurveHandles | 35/35 |
| test:fcurveEval | 35/35 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:motion3jsonRoundtrip | 42/42 |
| `tsc --noEmit` | clean |

---

## Resume paths (priority order post this session)

1. **Slice 5.C+ — Multi-curve display** (plan §5.C). Per-FCurve color, curve-list sidebar, active vs context curves. Per-handle selection store gets useful here (you can pick handles across multiple curves at once).

2. **Slice 5.D — Driver banner** (plan §5.D). "(D)" badge + clear-driver button + edit-disabled state when a driver overrides the FCurve.

3. **Modal G/S axis-lock + typed numeric input** (the MED-B6 deferred follow-on). Should share implementation with the viewport's `ModalTransformOverlay` (already wires axis + typed-buffer for canvas G/R/S); a small extraction into a shared `useModalTransformInput()` hook would let both editors converge.

4. **Phase 2 owed-manual verification** — from the prior close-out: live recording bezier handle export, Hiyori round-trip in Cubism Editor, visual auto-handle smoothness (now testable with 5.A+5.B+5.C all shipped), named-easing bake reload.

5. **Phase 3 — F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope. The cyclic-cycle support in `recalcKeyformHandles` (cited omission #2 from Slice 2.D close-out) lights up here; also the `setExtrapolation` MAKE_CYCLIC / CLEAR_CYCLIC shortcuts deferred from Slice 5.C.

6. **Round 8 UI sweep — F-1 follow-on** — ModePill lift to shared subcomponent.

7. **B2-B8 playback_controls gaps** — easiest first: `PLAY_REVERSE` (one new animationStore action); hardest: `use_preview_range` (needs new SS concept).

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5](./ANIMATION_BLENDER_PARITY_PLAN.md) (lines 1280-1358)
- Prior close-outs (same day):
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) — Slices 5.A+5.B
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) — Phase 2 (auto-handle calculator)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
