# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.L

**Status:** SHIPPED + dual-audit closed. Streak: 2 consecutive zero-fab slices
(5.K reset, 5.L holds — both audits this slice found only clarity/citation
nits, zero fabrication, zero correctness gaps).

## Commits

| SHA       | Subject                                                                        |
|-----------|--------------------------------------------------------------------------------|
| `18b5a3a` | feat(anim): Animation Phase 5 Slice 5.L — keyform invert (Ctrl+I timeline region) |
| `df3ce81` | fix(audit): Animation Phase 5 Slice 5.L dual-audit sweep — 1 MED + 1 LOW       |

## What shipped

Closes Slice 5.K's top-queued deferral: Ctrl+I in the timeline (graph)
region of FCurveEditor now inverts every visible keyform's selection,
mirroring Blender's `graph.select_all` action='INVERT'.

The new operator completes the three-action keymap parity for
`*_template_items_select_actions(params, "graph.select_all")` —
together with Slice 5.K's earlier A (TOGGLE) and Alt+A (DESELECT)
graph-region wiring, all three actions Blender registers for the
graph region (`blender_default.py:2010`) are now present.

### Files

| File                                              | Lines change | Role |
|---------------------------------------------------|--------------|------|
| `src/anim/fcurveKeyformSelect.js`                 | +146 (NEW)   | Pure helper `applyKeyformInvertSelection` |
| `src/v3/editors/fcurve/FCurveEditor.jsx`          | +47 / -16    | Import + `operatorInvertSelection` callback + Ctrl+I branch + Slice 5.K comment rewrite |
| `scripts/test/test_fcurveKeyformSelect.mjs`       | +263 (NEW)   | 34 assertions |
| `package.json`                                    | +1           | `test:fcurveKeyformSelect` script |

## Blender semantics ported

- **Operator dispatch**: `graphkeys_deselectall_exec` at
  `graph_select.cc:423-475`, case SEL_INVERT → `deselect_graph_keys(.., false, SELECT_INVERT, true)`.
- **Per-BezTriple invert**: `select_bezier_invert` at
  `keyframes_edit.cc:1567-1580` — `f2 ^= SELECT`; handles ALWAYS
  force-mirror the new center (`f1 |= SELECT, f3 |= SELECT` when f2
  now selected; `f1 &= ~SELECT, f3 &= ~SELECT` otherwise).
- **Walker filter**: `ANIM_animdata_filter` with
  `ANIMFILTER_DATA_VISIBLE | ANIMFILTER_CURVE_VISIBLE |
  ANIMFILTER_FCURVESONLY | ANIMFILTER_NODUPLIS` at
  `graph_select.cc:363-368`. SS's `visible` memo (already filtered by
  Slice 5.I's `isFCurveHidden`) maps to `ANIMFILTER_CURVE_VISIBLE`.
- **Keymap (default config)**: Ctrl+I → INVERT at
  `blender_default.py:425` (the `if not params.use_select_all_toggle`
  branch, which fires under the default `use_select_all_toggle=False`
  at `:115`). Same row in the `else` branch at `:438` and the legacy
  branch at `:432` — all three branches agree on Ctrl+I semantics.
- **Industry-compat keymap**: Ctrl+I → INVERT at
  `industry_compatible_data.py:966` — agrees with default keymap.

## Dual-audit findings (closed)

Two agents in parallel, lens-specialized. Both reported zero HIGH
issues, zero correctness gaps. Findings table:

| Tag      | Severity | Title                                                | Status                                  |
|----------|----------|------------------------------------------------------|-----------------------------------------|
| MED-A1   | MED      | Asymmetric functional-update pattern vs `operatorSelectAll` | FIXED in `df3ce81` — in-place comment in `operatorInvertSelection` |
| LOW-B1   | LOW      | Citation line off by 13 (`:438` cited; default config uses `:425`) | FIXED in `df3ce81` — module header now cites both branches; FCurveEditor.jsx Slice 5.K comment also relabelled with branch-distinguished line numbers |

LOW-B1 in particular is a `feedback_modifier_binding_check_keymap_first`
lesson re-applied: the Blender-fidelity audit re-grepped the keymap
files (didn't trust the slice's citations) and caught a branch the
default config doesn't take. Streak preserved: the audit did the work
the rule says to do; the fix made the citations honest.

## Citation cross-verification ledger

Every Blender reference in `fcurveKeyformSelect.js` re-verified by the
Blender-fidelity audit agent. Outcomes:

| Citation                                               | Verdict                                |
|--------------------------------------------------------|----------------------------------------|
| `select_bezier_invert` — `keyframes_edit.cc:1567-1580` | EXACT                                  |
| `_template_items_select_actions` — `blender_default.py:420-439` | Range correct; specific line was off (see LOW-B1) |
| `_template_items_select_actions` registration — `blender_default.py:2010` | EXACT                          |
| `industry_compatible_data.py:966` (Ctrl+I → INVERT)    | EXACT                                  |
| `graph_select.cc:354-419` (`deselect_graph_keys`)      | EXACT — ANIMFILTER flags at :363 confirmed |
| `graph_select.cc:423-475` (`graphkeys_deselectall_exec`) | EXACT — active-FCurve save/restore at :437/:459-469 confirmed |
| `graph_select.cc:397-413` (channel-flag side-effect)   | EXACT — deviation 1 description matches reality |
| `SIPO_FLAG_ACTIVE_KEYFORM` non-mutation claim          | VERIFIED — grep returns zero `active_keyform` references in `graph_select.cc` |
| `FCURVE_MUTED` not in ANIMFILTER bitmask claim         | VERIFIED — mute is NLA-only in F-Curve filtering; muted curves are walked |

## SS deviations (intentional, documented)

| Deviation | Blender behavior | SS behavior | Pinned to |
|-----------|------------------|-------------|-----------|
| Channel-flag side-effect | `deselect_graph_keys` with `do_channels=true` sets `FCURVE_SELECTED` on every walked curve (graph_select.cc:408) | SS port stays at keyform layer; channel.selected untouched | `project_ss_is_embryo`; same precedent as existing `operatorSelectAll` |
| FCURVE_ACTIVE save/restore | `graphkeys_deselectall_exec` saves active F-Curve before walker, restores after | SS has no per-FCurve ACTIVE flag (derived from `selectStore`) → no clearing/restoration possible at this layer | `project_ss_is_embryo`; same deferral as Slice 5.K MED-A1 |
| Hidden-curve entry preservation | Walker SKIPS hidden curves → their existing keyform selection survives unchanged | SS port DROPS hidden curves' entries from the output map | Documented in module header; symmetric with `operatorSelectAll`'s `if (sub.size > 0)` convention. Pre-acknowledged deviation. |

## SS-deferred Blender operators (still pending)

Slice 5.K's queued resume paths are still queued. Slice 5.L closed
**path #1 (Ctrl+I → keyform invert)** only. The remaining 13 paths
from Slice 5.K's close-out (`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_K.md`)
remain available.

## Owed manual browser verification (Slice 5.L)

Slice 5.L touched only keymap dispatch + a pure helper; no canvas
rendering or store-shape changes. New flows to verify by user in a
browser session:

1. With cursor over the graph (timeline) region, press Ctrl+I when
   no keyforms are selected → ALL visible curves' ALL keyforms select.
2. Press Ctrl+I again → ALL deselect (involution).
3. Click-select a single keyform on one curve, then Ctrl+I → that
   keyform deselects; ALL OTHER keyforms across ALL visible curves
   select.
4. Box-select 3 keyforms across 2 curves, then Ctrl+I → those 3
   deselect, all others select.
5. Hide curve B (Slice 5.I — sidebar eye toggle), then on curve A
   select 1 keyform and Ctrl+I → curve A inverts; curve B's existing
   selection is DROPPED (intentional deviation #3 — verify).
6. With cursor over the SIDEBAR region, press Ctrl+I → Slice 5.K's
   channel-level invert fires; keyform selection unchanged. Verify
   sidebar/timeline region routing is still correct.
7. Modal state guard: enter G modal (press G), then while in modal
   try Ctrl+I → guard `if (modal) return` at top of `onKeyDown`
   should prevent invert. Cancel modal, retry → invert fires.
8. Menu state guard: open a menu (e.g., V for handle types), then
   try Ctrl+I → `if (menu) return` should suppress.
9. Input element guard: focus a text input (e.g., active-keyform
   value editor), press Ctrl+I → should NOT fire (browser default
   may handle).
10. With a curve marked hidden + a curve muted (Slice 5.G mute), 
    Ctrl+I should still invert the muted curve's keyforms (mute
    doesn't gate selection — verified by audit).

## Test suites affected (9 suites, 629 total)

| Suite                          | Count | Status |
|--------------------------------|-------|--------|
| test:fcurveKeyformSelect (NEW) | 34    | PASS   |
| test:fcurveChannelSelect       | 168   | PASS   |
| test:fcurveMute                | 38    | PASS   |
| test:fcurveVisible             | 49    | PASS   |
| test:fcurveActiveKeyform       | 62    | PASS   |
| test:fcurveEval                | 35    | PASS   |
| test:fcurveHandles             | 35    | PASS   |
| test:graphEditOps              | 115   | PASS   |
| test:projectRoundTrip          | 41    | PASS   |
| test:animFCurveBridge          | 52    | PASS   |
| **TOTAL**                      | **629** | **PASS** |

`tsc --noEmit` clean.

## Lessons / reflection

**Streak**: 2 consecutive zero-fabrication slices (5.K reset to 1; 5.L
holds at 2). Both audits this slice found only clarity/citation nits
— zero algorithmic divergences. The `feedback_modifier_binding_check_keymap_first`
memory worked exactly as designed: the Blender-fidelity audit didn't
trust the citation, re-grepped, and caught the branch error. The fix
was a citation correction, not a code correction.

**Pattern that worked**: spawning the architecture and Blender-fidelity
audits as a parallel pair gave non-overlapping coverage. Architecture
caught a React-pattern asymmetry the fidelity audit ignored; fidelity
caught a citation branch the architecture audit (correctly) didn't
re-verify. The dual-lens pattern is producing 1-2 findings per slice
reliably and catching them at the comment/clarity layer before they
become semantic divergences.

**MED-A1 takeaway**: when two sibling operators use different React
patterns for legitimate reasons (one needs the previous state, one
doesn't), document the WHY in code — not just in commit messages.
Future readers see code; they don't dig through git log.

## Queued resume paths (carried forward from Slice 5.K)

Slice 5.L closed path #1. The remaining 13 paths from Slice 5.K's
close-out remain prioritized as before:

1. ~~Ctrl+I → keyform invert (timeline region)~~ **SHIPPED (this slice)**
2. `GRAPH_OT_hide` / `GRAPH_OT_reveal` keymap parity — H / Shift+H / Alt+H.
3. Operators-on-selected-channels — bulk mute/unmute/delete/hide
   leveraging multi-channel selection from Slices 5.F/5.J/5.K.
4. Footer wiring for fcurve channel state — selected/muted/hidden
   counts + active-keyform-info.
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
11. Per-fcurve ACTIVE slot — would close Slice 5.K's MED-A1 visible
    divergence + Slice 5.L's Deviation 2. See `project_ss_is_embryo`.
12. `ANIM_OT_channels_select_box` drag-rect on sidebar — needs
    sidebar hit-test infra.
13. Phase 2 owed-manual verification — bezier export, Hiyori round-trip.
14. Phase 3 — F-Curve modifiers — Cycles/Noise/Generator/Envelope.

## Pre-compact state

| Field             | Value                                         |
|-------------------|-----------------------------------------------|
| Branch            | `master`                                      |
| Working tree      | clean                                         |
| Commits ahead     | 35 (33 pre-Slice-5.L + 2 Slice-5.L)           |
| `tsc --noEmit`    | clean                                         |
| Affected tests    | 629/629 pass across 9 suites + 1 new          |
| Streak            | 2 consecutive zero-fabrication slices         |
| Next path         | #2 (GRAPH_OT_hide / GRAPH_OT_reveal — H / Shift+H / Alt+H) |
