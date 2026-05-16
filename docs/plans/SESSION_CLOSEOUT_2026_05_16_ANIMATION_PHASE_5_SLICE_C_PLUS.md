# Session Close-out - Animation Phase 5 Slice 5.C+ SHIPPED
**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `7589952` - feat(anim): Animation Phase 5 Slice 5.C+ - Graph Editor multi-curve display
- `4f51bd8` - fix(audit): Animation Phase 5 Slice 5.C+ dual-audit sweep - 4 HIGH + 6 MED + 3 deferral docs
- *(this doc)* - close-out documentation

Fourth Phase 5 close-out of the day, on top of `bd1e68b` + `feb4bde` + `c880fad` (Slices 5.A+5.B) and `0d78ad3` + `213c748` + `278003d` (Slice 5.C). The F-Curve Graph Editor is now fully Blender-faithful for single-action multi-curve editing.

---

## What shipped

Per plan §5.C at `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1332-1336`:

> Phase 5 supports displaying multiple FCurves at once (one color each). The "active" FCurve is the one being edited; others are background context. UI: a curve-list sidebar.

Concretely:

- **All resolvable FCurves in the active action render at once.** Each curve gets a stable rainbow color via `getcolorFcurveRainbow` (direct port of `getcolor_fcurve_rainbow` from `reference/blender/source/blender/editors/animation/anim_ipo_utils.cc:311-346`).
- **Active vs context** mirrors Blender's `FCURVE_ACTIVE` flag at `graph_draw.cc:1155-1161`:
  - Active curve: 2.5px stroke + full alpha (1.0) + full-size diamonds (4-5px) + interactive handle dots.
  - Context curves: 1.0px stroke + 0.5 alpha (matches `fcurve_display_alpha` at `graph_draw.cc:50-57` with `U.fcu_inactive_alpha = 0.5` default) + smaller diamonds (3-4px) + dimmer handles when selected.
- **Draw order**: context curves first, active LAST so it overdraws (matches Blender's deferred-active-FCurve pattern at `graph_draw.cc:1493-1503`).
- **Curve-list sidebar** (left edge, 168px wide): each FCurve row shows color swatch + label + eye toggle + "has selection" indicator + active highlight. Click row -> elevates that FCurve to active via `selectionStore.select(target, 'replace')`. Plain click wipes per-keyform selection on non-clicked channels (Blender's `SELECT_REPLACE` semantic at `graph_select.cc:1741`).
- **Per-handle selection state lifted** from `Map<idx, parts>` -> `Map<fcurveId, Map<idx, parts>>`. This is the cross-curve selection model promised in Slice 5.C's close-out: a box-select / shift-click can now pick handles across multiple curves simultaneously.
- **Cross-curve click** elevates the clicked curve to active (Blender's `mouse_graph_keys` -> `ANIM_set_active_channel` at `anim_channels_edit.cc:237`; non-Shift only, matching `select_mode != SELECT_INVERT` guard at `graph_select.cc:1843-1856`).
- **Cross-curve handle drag** walks every fcurve in the selection (active first, then context) for handle hits. Pre-audit-fix this was limited to the active curve only.
- **Modal G / S** iterate the per-curve sub-selections via per-fcurve `originsByFc` + `dragIdxByOriginByFc` Maps. The pivot is the median (time, value) across the WHOLE multi-curve selection (matches Blender's `transform_convert_graph.cc:962-988`).
- **Modal G Ctrl-snap** snaps the absolute final pivot time to whole frames (matches Blender's modal T_SNAP_KEYS pattern); the prior delta-snap that preserved sub-frame offsets was the MED-B5 audit fix.
- **Box-select B** walks every visible fcurve; each kf's centre + both handle dots are independently rect-tested (matches `KEYFRAME_OK_KEY/H1/H2` bits at `keyframes_edit.cc:1527-1536` under `KEYFRAME_ITER_INCL_HANDLES`).
- **V / T menus** apply the picked handle-type / interpolation to every selected keyform across all fcurves; **Shift+E** applies extrapolation per-fcurve to every fcurve in the selection (or the active curve if selection is empty).
- **Delete / X** iterates per-fcurve with per-curve last-kf guard (defended both pre-batch fast-fail AND live-draft re-check per audit-fix HIGH-A7).
- **Ctrl+G snap-to-frame** iterates per-fcurve, each with the identity-track + post-sort remap pattern from Slice 5.C audit-fix HIGH-A1.
- **A** select-all toggles across ALL visible curves' ALL keyforms.
- **View auto-fit** considers all visible curves' min/max so context curves stay in-frame.
- **Eye-toggle** in sidebar hides a curve from rendering (session-local; persistence deferred).

---

## Pure helper extracted

`src/anim/fcurveColor.js` (54 LOC):

| Export | What | Blender ref |
|---|---|---|
| `getcolorFcurveRainbow(cur, tot)` | Byte-faithful HSV rainbow assignment | `anim_ipo_utils.cc:311-346` (`FCURVE_COLOR_AUTO_RAINBOW`) |
| `hsvToHsl(h, s, v)` | Standard HSV->HSL because CSS `hsl()` takes Lightness not Value | Wikipedia HSV-to-HSL |
| `fcurveColorCss(cur, tot, alpha)` | Composes the above into an `hsla(...)` CSS string | (SS infra) |

24 headless tests in `scripts/test/test_fcurveColor.mjs` verify the port against hand-derived numbers from the Blender algorithm (grouping rule, hue rotation, saturation band, value pinning, wrap-around). Registered as `test:fcurveColor` in package.json.

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Two parallel agents (architecture code-reviewer + Blender-fidelity general-purpose) on feature commit `7589952`. **10 real fixes + 3 documented deferrals + 3 dismissed candidates** in audit-fix `4f51bd8`:

| # | Severity | Source | Finding |
|---|---|---|---|
| HIGH-A1 | HIGH | arch | `decoded` recomputed every render -> cascade through samples/curvePaths on every drag tick |
| HIGH-A5 | HIGH | arch | `activeActionId` missing from `onKeyDown` deps -> operators silently no-op on stale action |
| HIGH-A7 | HIGH | arch | `operatorDelete` last-kf guard read stale `action` memo; double-Delete could drop a curve's final keyform |
| HIGH-B1 | HIGH | Blender | Fabricated Blender symbol `select_pchannel_keychannel_first` (does not exist); replaced with `ANIM_set_active_channel` at `anim_channels_edit.cc:237` |
| MED-A3 | MED | arch | `onPickActiveByTarget` inline arrow recreated every render -> Plot's `onPointerDown` useCallback cache busted on every drag tick |
| MED-A4 | MED | arch | `applyBoxSelect` closed over stale `view` in `onUp`; container resize mid-box-select made rect mapping stale |
| MED-B4 | MED | Blender | Shift-click on context curve should NOT elevate to active (folded into HIGH-B1 fix) |
| MED-B5 | MED | Blender | Modal G Ctrl-snap snapped DELTA not absolute pivot; sub-frame starting positions preserved sub-frame forever |
| MED-B7 | MED | Blender | Cross-curve handle drag artificially limited to active curve; context-curve handles drew but were unclickable |
| MED-B8 | MED | Blender | Sidebar plain-click left ghost keyform selections on non-clicked channels; missed Blender's `SELECT_REPLACE` deselect |

**Documented deferrals (3 new entries in file-header SS-deferred list):**

- **Per-FCurve mute render** (`FCURVE_MUTED` greyish hue at `graph_draw.cc:1190-1200`) - SS doesn't ship `fcurve.mute` schema field, so there's nothing to differentiate visually. Follow-on slice would add both schema + render branch.
- **Channel-vs-keyform selection split** - Blender keeps `FCURVE_SELECTED` (channels in the channel list) independent of per-keyform selection. SS collapses both onto `selectionStore` (active curve) + local `selectedHandles` Map (keyforms). Sidebar multi-channel-select via Shift not wired this slice; would need a new graph-local "selected channels" set.
- **Active-keyform highlight** (`draw_fcurve_active_vertex` at `graph_draw.cc:241-280`, the per-FCurve `BKE_fcurve_active_keyframe_index`) - SS has no active-keyform field on FCurves; TH_VERTEX_ACTIVE band omitted.

**Dismissed (3 candidate findings):**

- **MED-A2** (closure mutation fragility in `dragIdxByOriginByFc`) - `updateProject` is synchronous under current contract; no concrete bug today.
- **MED-A6** (Sidebar per-tick re-render) - fixed transitively by HIGH-A1 + MED-A3.
- **MED-B6** (box-select handles should follow center) - re-read Blender source; `select_bezier_add` at `keyframes_edit.cc:1527-1536` tests each handle INDEPENDENTLY when `incl_handles=true`. SS's per-component test is faithful, not a divergence.

**Cross-verification step (HIGH-B1)**: before applying the citation fix, I grepped `reference/blender/source/blender/` directly for `select_pchannel_keychannel_first` (zero hits) and `ANIM_set_active_channel` (multiple hits including the actual `graph_select.cc:1850` invocation from `mouse_graph_keys`). The fabricated symbol must have crept in from the prior session's working-from-memory; cross-checking with the live tree caught it.

---

## Owed manual browser verification

Cannot be assertion-tested headlessly:

1. **Sidebar appears** with one row per resolvable FCurve in the active action; each row has color swatch + label + eye + active highlight.
2. **Active row** matches the curve `pickFCurve` resolves from global selection. Clicking a sidebar row switches active.
3. **Plain sidebar click** wipes keyform selection on non-clicked channels (MED-B8 verification): select kfs on curves A + B; click row for curve C; verify A + B selections are gone.
4. **Eye toggle** hides/shows curves; auto-fit re-fits to visible curves' range.
5. **Cross-curve click** on a context-curve diamond elevates that curve to active AND selects the kf. (Blender pattern.)
6. **Shift-click cross-curve** does NOT elevate active but DOES extend selection (MED-B4 + HIGH-B1 verification).
7. **Cross-curve box-select**: drag a rect over keys on two visible curves; both curves get per-component selection.
8. **Cross-curve modal G**: select kfs on two curves, press G; both curves' kfs translate together. Pivot is the median across both.
9. **Modal G + Ctrl** (MED-B5 verification): pick a kf at a non-frame time (e.g., 17ms), press G + Ctrl, drag a small amount; verify the kf lands exactly on a 24fps frame (41.67ms), not at 17+N*41.67ms.
10. **Cross-curve handle drag** (MED-B7 verification): shift-click a handle dot on a context curve, drag it; verify the handle moves (pre-audit-fix it was unclickable).
11. **Cross-curve V/T**: select kfs on two curves, press V or T, pick a type; verify both curves' kfs get the new type.
12. **Shift+E extrapolation**: select on two curves, Shift+E, pick Linear; verify both fcurves' extrapolation field changes.
13. **Cross-curve Delete**: select kfs across two curves; Delete; verify both curves shrink. Then select all kfs on one curve and Delete - last-kf guard refuses (HIGH-A7).
14. **`activeActionId` change** (HIGH-A5 verification): keyform-edit, switch to a different action, immediately press G - verify the modal opens on the new action's selected kfs, not silent no-op against the old action.
15. **Container resize mid-box-select** (MED-A4): press B, start drag, resize the editor panel mid-drag, release - verify the released box uses post-resize pixel-to-time mapping (no off-by-anything selection).

---

## Tests passing (final state at `4f51bd8`)

| Test | Pass/Fail |
|------|-----------|
| test:fcurveColor | 24/24 |
| test:graphEditOps | 115/115 |
| test:fcurveHandles | 35/35 |
| test:fcurveEval | 35/35 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:motion3jsonRoundtrip | 42/42 |
| `tsc --noEmit` | clean |

364 headless assertions, all green.

---

## Resume paths (priority order post this session)

1. **Slice 5.D - Driver banner** (plan §5.D). "(D)" badge + clear-driver button + edit-disabled state when a driver overrides the FCurve. Discrete + small (single fcurve property).

2. **Modal G/S axis-lock + typed numeric input** (the MED-B6 from Slice 5.C deferred follow-on). Now even more useful with cross-curve modal G working. Should share implementation with the viewport's `ModalTransformOverlay`; a `useModalTransformInput()` hook extraction.

3. **Channel-vs-keyform selection split** - Blender's `FCURVE_SELECTED` independent of `FCURVE_ACTIVE`. Schema field + sidebar Shift-click extends channel selection + multi-channel "highlighted" state in sidebar. Cited deferral from this slice.

4. **`fcurve.mute` schema field + muted-grey render** - Blender's `FCURVE_MUTED`. Both a new schema field and the render branch at the same time (per `feedback_no_migration_baggage_rule_two`).

5. **Active-keyform field + highlight** - `BKE_fcurve_active_keyframe_index` parity, `TH_VERTEX_ACTIVE` highlight.

6. **Persistent `fcurve.visible` schema field** - replace the local-React `hidden` Set with the persisted flag.

7. **Phase 2 owed-manual verification** - from prior close-outs: live recording bezier handle export, Hiyori round-trip in Cubism Editor, visual auto-handle smoothness, named-easing bake reload.

8. **Phase 3 - F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope. Once shipped, the F-Modifier-drawn curve branch at `graph_draw.cc:1151-1153` can light up here too.

9. **Round 8 UI sweep - F-1 follow-on** - ModePill lift to shared subcomponent.

10. **B2-B8 playback_controls gaps**.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5](./ANIMATION_BLENDER_PARITY_PLAN.md) (lines 1280-1358)
- Prior close-outs (same day):
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) - Slices 5.A+5.B
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md) - Slice 5.C operator pass
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) - Phase 2 (auto-handle calculator)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
