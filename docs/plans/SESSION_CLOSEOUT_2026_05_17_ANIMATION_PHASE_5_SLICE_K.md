# Animation Phase 5 Slice 5.K — Session close-out (2026-05-17)

## Commits

| SHA | Subject |
|---|---|
| `fe70101` | feat(anim): Animation Phase 5 Slice 5.K — bulk channel select-all (A / Alt+A / Ctrl+I) |
| `dd1faf1` | fix(audit): Animation Phase 5 Slice 5.K dual-audit sweep — 1 MED + 1 LOW + self-caught keyform Alt+A |
| (this doc) | docs(plan): Animation Phase 5 Slice 5.K close-out |

## What shipped

Port of Blender's `ANIM_OT_channels_select_all` (`anim_channels_edit.cc:3521-3554`) to the SS FCurveEditor sidebar — bulk channel-level selection via three modes (toggle / clear / invert) reachable through:

1. **Sidebar header buttons** — three small uppercase chips ("All" / "None" / "Inv") in the F-Curves header. Always-visible; discoverable without keybind knowledge.
2. **Region-routed keymap** — KeyA / Alt+A / Ctrl+I fire the same three operators when the cursor is over the sidebar. Tracked via `regionHoverRef` (a `useRef` updated by Sidebar's `onPointerEnter` / `onPointerLeave`).

Bonus alignment caught during audit-fix LOW-A1 verification: graph-region Alt+A now correctly fires keyform-level DESELECT (matches `_template_items_select_actions(params, "graph.select_all")` at `blender_default.py:2010`). Pre-Slice 5.K, this was unbound on the SS side.

## Files changed

| File | Δ | Purpose |
|---|---|---|
| `src/anim/fcurveChannelSelect.js` | +183/-1 | Added `applyChannelSelectAll(action, mode, ctx)` helper + extended module header with the Slice 5.K Blender citation chain + clarified `clearActive` deviation note |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | +185/-6 | Added `applyChannelSelectAllOp` callback + `regionHoverRef` + sidebar header buttons + region-aware keymap branches (sidebar A/Alt+A/Ctrl+I + tightened+extended graph A/Alt+A) |
| `scripts/test/test_fcurveChannelSelect.mjs` | +272/-1 | +63 assertions for the new helper (6 guards + 4 modes × ~4 cases + scope/ghost/sister/sparse-field coverage) |
| `docs/plans/SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_K.md` | NEW | This file |

## Dual-audit findings

| Severity | Finding | Resolution |
|---|---|---|
| MED-A1 | `clearActive` deviation note overclaimed "functionally identical" — divergence is visible (active row stays highlighted after Alt+A) | Rewrote deviation note in module header to flag visible UX gap, pinned to `project_ss_is_embryo` deferral |
| LOW-A1 | Graph-region KeyA missed `!e.altKey` guard | REVISED on verification — initial tighten-to-no-op was wrong because Blender binds Alt+A in graph region too (DESELECT keyforms). Kept tightening AND added new Alt+A → `clearSelection()` branch with `:2010` + `:437` citations |
| (Blender-fidelity audit) | Zero findings | All 6 Blender citations verified on disk. Streak resets to 1 zero-fabrication slice after Slice 5.J's break. |

## Citation cross-verification ledger

Every Blender citation in the new code was verified by reading the cited file at the cited lines:

| Citation | Confirmed |
|---|---|
| `anim_channels_edit.cc:3521-3554` (operator exec) | ✓ exact — `animchannels_selectall_exec` switch on SEL_TOGGLE/SELECT/DESELECT/INVERT |
| `anim_channels_edit.cc:536-570` (toggle resolver) | ✓ exact — `anim_channels_selection_flag_for_toggle` short-circuits on first FCURVE_SELECTED |
| `anim_channels_edit.cc:728-732` (per-channel active-clearing) | ✓ exact — `if (!(fcu->flag & FCURVE_SELECTED) && change_active) { fcu->flag &= ~FCURVE_ACTIVE; }` |
| `anim_channels_edit.cc:683` (`change_active` definition) | ✓ exact — `const bool change_active = (sel != ACHANNEL_SETFLAG_EXTEND_RANGE);` |
| `blender_default.py:3864` (channels keymap entry) | ✓ exact — `*_template_items_select_actions(params, "anim.channels_select_all")` inside `km_animation_channels` |
| `blender_default.py:420-439` (template definition) | ✓ exact — three branches: not-toggle, legacy, default; default at `else:` returns TOGGLE/DESELECT/INVERT triplet |
| `blender_default.py:2010` (graph keymap entry) | ✓ exact — same template applied to `graph.select_all` inside `km_graph_editor` |
| `blender_default.py:437` (default Alt+A → DESELECT) | ✓ exact |
| `industry_compatible_data.py:2345-2350` (alternate keymap) | ✓ exact — Ctrl+A SELECT / Ctrl+Shift+A DESELECT / Ctrl+I INVERT (no TOGGLE) |
| `anim_channels_edit.cc:3568` (`OPTYPE_REGISTER \| OPTYPE_UNDO`) | ✓ exact — Blender does enroll bulk select-all in undo; SS deliberately skips per Slice 5.F precedent |

**No mis-citations.** Slice 5.J's HIGH-B1 lesson (read keymap not operator) was internalized.

## SS deviations from Blender (Slice 5.K)

1. **`clearActive` computed but NOT forwarded.** Helper returns `clearActive: boolean` correctly per Blender, but the caller in FCurveEditor does NOT clear `selectionStore.activeFCurveId` because that id is derived from param/node selection — clearing it would deselect the active param in the param editor and the keyform editor's active-row (cross-editor side effect). Visible consequence: sidebar's active row stays highlighted after Alt+A. Deferred to the day SS grows a per-fcurve ACTIVE slot independent of the param/node store (`project_ss_is_embryo`).

2. **Skip undo (`OPTYPE_REGISTER | OPTYPE_UNDO` not ported).** Channel-list selection is UI state, not document state; matches Slice 5.F's `skipHistory: true` precedent.

3. **Ctrl+I → keyform invert NOT ported on the timeline-region branch.** Only the sidebar-region Ctrl+I is wired today; the graph-region Ctrl+I (matching `graph.select_all` INVERT at `blender_default.py:2010` + `:438`) is deferred because SS has no `operatorInvertSelection` keyform helper yet. Queued resume path.

4. **`BackdropClickToDeselect` style — graph-region empty-area click does NOT deselect.** Unrelated to this slice but adjacent — Blender's graph-region empty-area click invokes `graph.select_box` with `deselect=True`; SS does not. Pre-existing deviation, not introduced here.

## SS-deferred Blender operators

The following Blender operators bind to keys that THIS slice did NOT port (intentional minimum scope; queued for future slices):

- `GRAPH_OT_select_all` with `action='INVERT'` (Ctrl+I in graph region) — needs per-keyform invert helper
- `ANIM_OT_channels_select_box` (drag-rect on sidebar) — defer until SS sidebar gains hit-test infra
- `ANIM_OT_channels_select_filter` (Ctrl+F text filter) — defer with the toolbar/filter UI
- `ACTION_OT_select_all` (dopesheet equivalent) — N/A; SS doesn't have a separate dopesheet view yet

## Owed manual browser verification flows

Test in Cubism browser run:

1. Click a channel in the sidebar → press A → all channels in the sidebar toggle (assert: row backdrop shows accent/25 on previously-unselected channels).
2. After step 1 → press A again → all deselected (rows revert to muted-foreground tint).
3. After step 1 → press Alt+A → all deselected unconditionally (separate code path from step 2's toggle-to-clear; both should look identical visually).
4. After step 1 → press Ctrl+I → selection inverted (no overlap with prior selection).
5. Hover cursor over the graph (timeline) area → press A → keyforms toggle (Slice 5.B path; should NOT touch channel selection). Active channel row stays as-is.
6. Hover over timeline → press Alt+A → keyforms deselect (NEW this slice; previously was un-bound and would fall through to `else operatorSelectAll()` which was incorrect for the Alt modifier — graph-region Alt+A now correctly bound).
7. Hover over timeline → press Ctrl+I → SHOULD be a no-op today (deferred to future slice; verify no crash, no unexpected mutation).
8. Click the sidebar "All" button → toggle-select-all (same effect as KeyA over sidebar).
9. Click "None" → deselect all channels.
10. Click "Inv" → invert.
11. Select a channel, set it as the active curve via plain click, then press Alt+A → assert: active row STILL highlights (the visible-divergence MED-A1 documented deviation). When SS gets a per-fcurve ACTIVE slot, this verification flow will be updated to assert active-row de-highlights.
12. Resize sidebar narrow → buttons should not overflow (verified at `SIDEBAR_W = 168`; ~150px header content fits).
13. Hidden curves (with the eye-off toggle) — verify channel select-all DOES affect them (they're in `decoded` and rendered in the sidebar with strikethrough, so they're part of `orderedIds`).
14. Click a sidebar button, then immediately press KeyA over the sidebar — verify no double-toggle race (both should resolve based on the post-button state).
15. Tab between actions in the Actions panel mid-press — verify `applyChannelSelectAllOp` operates on the new active action (its dep array includes `activeActionId`).

## Affected test suites

| Suite | Count | Status |
|---|---|---|
| `test:fcurveChannelSelect` | 168 (was 105) | ✓ |
| `test:fcurveMute` | 38 | ✓ |
| `test:fcurveVisible` | 49 | ✓ |
| `test:fcurveActiveKeyform` | 62 | ✓ |
| `test:fcurveEval` | 35 | ✓ |
| `test:projectRoundTrip` | 41 | ✓ |
| `test:graphEditOps` | 115 | ✓ |
| `test:animFCurveBridge` | 52 | ✓ |
| `test:fcurveHandles` | 35 | ✓ |
| **Total** | **595** | **595/595** |

`tsc --noEmit`: clean.

## Lessons / reflection

- **Slice 5.J's HIGH-B1 lesson internalized.** Every modifier-bound citation in Slice 5.K reads the keymap file directly. The Blender-fidelity audit returned zero findings. The new `feedback_modifier_binding_check_keymap_first` memory paid off on first use.
- **Self-caught my own audit-fix mistake.** LOW-A1's initial "tighten Alt+A to no-op" was wrong because I didn't verify the graph-region keymap before drafting the comment. Caught by my own keymap-grep before commit. The keymap-first reflex is now reflexive enough that I caught a slice-internal error within the same session.
- **`clearActive` deferral was the right call but the comment overclaimed.** "Functionally identical" was sloppy framing for a visible UX gap. The honest framing — "computed but not forwarded; visible row stays highlighted; deferred to per-fcurve ACTIVE slot work" — is what shipped. Lesson: when documenting a deferred deviation, the comment must describe the OBSERVABLE consequence, not just the code-level decision.
- **Streak status: 1 zero-fabrication slice (5.K).** Slice 5.J broke 5.E-through-5.I's 4-slice zero-fab streak. Slice 5.K is a fresh 1.

## Queued resume paths

Priority order for next session (carried forward from Slice 5.J's queue + new entries):

1. **Ctrl+I → keyform invert (timeline region)** — needs new `operatorInvertSelection` keyform helper. Mirrors `graph.select_all` INVERT at `blender_default.py:2010` + `:438`. Slice 5.K explicitly deferred.
2. **`GRAPH_OT_hide` / `GRAPH_OT_reveal` keymap parity** — H / Shift+H / Alt+H.
3. **Operators-on-selected-channels** — bulk mute/unmute/delete/hide leveraging the multi-channel selection that Slices 5.F + 5.J + 5.K now produce.
4. **Footer wiring for fcurve channel state** — selected/muted/hidden counts + active-keyform-info.
5. **N-panel active-keyform numerical editor** — Blender's `graph_buttons.cc` per-keyform inline edit.
6. **Driver variable list / expression editor** — Slice 5.D's biggest deferral.
7. **`SIPO_DRAWTIME` seconds-vs-frames toggle** — MED-B2 from Slice 5.E.
8. **`USER_FLAG_NUMINPUT_ADVANCED`** — MED-B1 from Slice 5.E.
9. **Group-level mute (`AGRP_MUTED`) + group-level hide** — gated on FCurveGroup datablock.
10. **DopesheetEditor row-state styling** — mute-row + active-keyform-row + hide-row.
11. **Per-fcurve ACTIVE slot** — would close MED-A1's visible divergence by letting Slice 5.K's `clearActive` decision be honored. See `project_ss_is_embryo`.
12. **`ANIM_OT_channels_select_box` drag-rect on sidebar** — needs sidebar hit-test infra.
13. **Phase 2 owed-manual verification** — bezier export, Hiyori round-trip.
14. **Phase 3 — F-Curve modifiers** — Cycles/Noise/Generator/Envelope.

## Pre-compact state table

| Item | Value |
|---|---|
| Slice 5.K commits | `fe70101` (feat) + `dd1faf1` (audit-fix) + this close-out |
| Affected test suites | 9 suites, 595/595 |
| New tests | +63 (Slice 5.K)|
| `tsc --noEmit` | clean |
| Working tree | clean (after close-out commit) |
| Branch | master, ahead of origin/master by 33 commits |
| Streak | 5.K = 0 Blender-fab from audit (1 self-caught miss during fix → streak reset to 1) |
| Next resume path | Ctrl+I → keyform invert (timeline region) |
