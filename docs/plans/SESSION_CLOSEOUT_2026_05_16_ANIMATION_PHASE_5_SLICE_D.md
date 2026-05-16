# Session Close-out — Animation Phase 5 Slice 5.D SHIPPED

**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `75a357e` — feat(anim): Animation Phase 5 Slice 5.D — Graph Editor driver banner
- `12f9e17` — fix(audit): Animation Phase 5 Slice 5.D dual-audit sweep — 3 HIGH-B + 2 MED-B citation/deviation fixes
- *(this doc)* — close-out documentation

Fifth Phase 5 close-out of the day, on top of `bd1e68b` + `feb4bde` + `c880fad` (Slices 5.A+5.B), `0d78ad3` + `213c748` + `278003d` (Slice 5.C), and `7589952` + `4f51bd8` + `ffa1da8` (Slice 5.C+). The Graph Editor now closes plan §5.D — Phase 5 substrate complete for single-action editing.

---

## What shipped

Per plan §5.D at `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1338-1343`:

> If the active FCurve has a `driver`, show the driver expression as a banner above the curve and a "(D)" badge. Editing handles is disabled when the driver is active (the driver overrides the curve); a button clears the driver to allow keyframe editing.

Concretely:

- **DriverBanner subcomponent** above the canvas when the active FCurve has a `driver` attached. Shows: color swatch + "DRIVER" pill + driver type (scripted/sum/min/max/avg) + truncated expression (or variable count for non-scripted) + live evaluated value (re-evaluates on `currentTime` change so it tracks the playhead) + "Clear Driver" button.
- **Per-fcurve edit-disabled gate** via `hasDriver(fc)` blocks every keyform/handle mutation path:
  - `startKeyformDrag` / `startHandleDrag` (early return on driven fcurve)
  - `operatorSetHandleType` / `operatorSetInterpolation` / `operatorSetExtrapolation` / `operatorSnapToFrame` / `operatorDelete` (skip driven curves in per-curve iteration loop)
  - Modal G / S `originsByFc` collection (driven curves don't enter the pivot calc OR get transformed; existing `n === 0` guard bails the modal cleanly if every selected fcurve is driven)
- **Selection / box-select / sidebar click / Home / A / seek** remain unaffected by the gate — the user can still SELECT keyforms to inspect timing, just not MUTATE them.
- **Sidebar "(D)" badge** on every row whose fcurve has a driver (active OR context) so the user spots driven channels at a glance.
- **Clear Driver button** drops `fcurve.driver` via batched `updateProject` — one undo entry per click. After the mutation the curve becomes editable again (the per-fcurve gate reads `hasDriver` per-call so the next G/S/V/T/Delete picks up the change without extra plumbing).
- **Plot-area ResizeObserver refactor** — observes `plotAreaRef` (the div directly hosting SVG + canvas) instead of the outer wrap. Necessary so the banner can shrink the plot-rect via flex-column layout. **Incidentally fixes a pre-existing bug** where the prior pass observed the outer wrap, so `view.w` was outer-width-including-sidebar, making canvas's explicit `style.width` overflow the plot-rect by `SIDEBAR_W = 168px` to the right (clipped by Wrapper's `overflow-hidden` but made the rightmost ~180px of the curve never visible).

---

## Pure helpers extracted

`src/anim/driverGate.js` (NEW, ~75 LOC after audit-fix doc expansion):

| Export | What | Blender ref |
|---|---|---|
| `hasDriver(fcurve)` | `!!fcurve?.driver` — single source-of-truth for the driver-locked question | (SS-specific; no direct Blender analogue — see "Deviations") |
| `clearDriver(fcurve)` | `delete fcurve.driver` in place; returns `true` if removed | Reference: `ANIM_remove_driver` at `reference/blender/source/blender/editors/animation/drivers.cc:511-544` (with documented deviation — see audit-fix HIGH-B3) |

21 headless assertions in `scripts/test/test_fcurveDriverGate.mjs` verify the helpers cover null/undefined-safety, all falsy `driver` values, truthy drivers (even empty `{}`), idempotent `clearDriver` no-op, and a round-trip showing `evaluateFCurve` returns the driver value while attached + the keyform lerp after clear. Registered as `test:fcurveDriverGate` + added to the aggregate `test` chain.

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Two parallel agents (architecture code-reviewer + Blender-fidelity general-purpose) on feature commit `75a357e`. **3 real fixes + 1 dismissed candidate** in audit-fix `12f9e17`.

| # | Severity | Source | Finding |
|---|---|---|---|
| HIGH-A1 | HIGH | arch | (**DISMISSED**) Claimed hooks-order violation between FCurveEditor.jsx:325/332 early returns and the new `useProjectStore` at line 1525. Cross-verified: early returns are in `FCurveEditor` (function ends at 354), the hook is in `Plot` (starts at 372). Plot only renders when the early returns don't fire; within Plot the hook order is consistent. Grep for top-level `if`/`return` in Plot body before line 1525 returned zero hits. **False positive.** |
| HIGH-B1 | HIGH | Blender | `driverGate.js` header cited `(fcu->flag & FCURVE_DISABLED) != 0` at `graph_buttons.cc:227` as the Blender pattern for "active-driver gates editing". WRONG — verified at `DNA_anim_enums.h:320-322`: `FCURVE_DISABLED = (1 << 10)` means "skip evaluation, as RNA-path cannot be resolved". The actual Blender flag for "keyframes cannot be edited" is `FCURVE_PROTECTED = (1 << 3)` at `DNA_anim_enums.h:311`, surfaced via `EDITABLE_FCU` at `ED_anim_api.hh:490`. Rewrote the header to cite the correct flag AND explain that Blender's transform pipeline doesn't gate on driver at all — SS's gate exists because SS merges Blender's two graph-editor modes. |
| HIGH-B2 | HIGH | Blender | (folded into MED-B1) SS's per-channel driver-gate is an SS UX choice required by the merged-mode editor, not "Blender pattern" — Blender's `transform_convert_graph.cc` has ZERO `fcu->driver` checks (grep-verified). Documented as a "Deviations from Blender" entry in FCurveEditor.jsx file-header. |
| HIGH-B3 | HIGH | Blender | `clearDriver` doc-block cited `ANIM_OT_driver_button_remove` as "clears the channel's driver pointer + frees the ChannelDriver struct". WRONG — verified at `drivers.cc:511-544`: `ANIM_remove_driver` does `BLI_remlink(&adt->drivers, fcu); BKE_fcurve_free(fcu);` — removes the ENTIRE FCurve from `adt->drivers`. Rewrote to explain the architectural deviation: Blender splits driver-FCurves into a separate ListBase (`AnimData::drivers`); SS overlays the driver on the same fcurve that owns `keyforms[]`. Clearing the driver keeps the keyform-bearing fcurve in place — which IS the point of the "Clear Driver" button. |
| MED-B1 | MED | Blender | Banner mode-split deviation undocumented. Blender splits keyframe vs driver editing into `SIPO_MODE_ANIMATION` + `SIPO_MODE_DRIVERS` (verified at `space_graph.cc:244,256,304` and `graph_buttons.cc:733-742` panel-poll). SS merges them in one editor + banner. Added "Deviations from Blender" subsection to FCurveEditor.jsx file-header. |
| MED-B2 | MED | Blender | "(D)" sidebar badge has no Blender precedent at the channel-row level. `anim_channels_defines.cc:1631` uses `ICON_DRIVER` only for the DRIVERS-mode group-header expander, not per-fcurve. Added to the same "Deviations from Blender" subsection. |

**Cross-verification step (every Blender citation grepped on disk before quoting, per `feedback_blender_reference_strict`):**

- `FCURVE_DISABLED` vs `FCURVE_PROTECTED` at `DNA_anim_enums.h:311+322` — Read confirmed both flags exist with the documented semantics
- `EDITABLE_FCU` at `ED_anim_api.hh:490` — grep confirmed
- Zero `fcu->driver` references in `transform_convert_graph.cc` — grep confirmed
- `ANIM_remove_driver` at `drivers.cc:511` + `BLI_remlink + BKE_fcurve_free` body at `drivers.cc:525-526` — Read confirmed
- `SIPO_MODE_DRIVERS` cases at `space_graph.cc:244,256,304` — grep confirmed
- `ICON_DRIVER` at `anim_channels_defines.cc:1631` — grep confirmed

The two HIGH-B citation fabrications follow the same pattern as Slice 5.C+ audit-fix HIGH-B1 (the `select_pchannel_keychannel_first` fabrication): working from memory introduced wrong symbols; only direct grep against the reference tree caught them. The dual-audit pattern keeps paying off.

---

## SS-deferred (documented in file-headers, not shipped this slice)

- **Driver variable list / expression editor in the banner.** Blender's Drivers Editor panel surfaces `variables[]` with type-specific targets (single-prop / rot-diff / loc-diff / trans-channel / context-prop). SS's `evaluateDriver` only handles `singleProp` (see [driver.js](../../src/anim/driver.js) "Deviations from Blender"); a UI to author variables doesn't exist yet — the banner shows the count read-only this slice.
- **Driver invalid-flag display (`DRIVER_FLAG_INVALID` red_alert at `graph_buttons.cc:1026-1031`).** `evaluateDriver` returns NaN on unsafe / failing expressions; there's no persisted invalid-flag on the driver object today.
- **Driver influence slider** — `ChannelDriver.influence` is not modelled in SS yet; a driver either fully overrides or doesn't fire.
- **Mode-split (SIPO_MODE_DRIVERS vs SIPO_MODE_ANIMATION).** SS merges Blender's two graph-editor modes by design — the merge is what makes the per-channel gate necessary in the first place. A future port could split SS into a separate Drivers Editor mode to drop the per-channel gate; deferred indefinitely (the merge is more useful for SS's smaller-action workflow).
- **Channel-list driver group expander** (`ICON_DRIVER` in `anim_channels_defines.cc:1631`). SS uses a per-row "(D)" badge instead; a follow-on could add a collapsible "Drivers" group in the sidebar if the user accumulates many driven channels.

---

## Owed manual browser verification

Cannot be assertion-tested headlessly:

1. **DriverBanner mounts** above the canvas when the active FCurve has a driver attached; vanishes when the curve has no driver.
2. **Banner shows live value** that updates as the playhead advances (or as a driven RNA-path's source value changes; e.g., move a slider that the driver expression references).
3. **"Clear Driver" button** drops the driver — the banner disappears, keyforms become editable, undo restores the driver.
4. **Per-fcurve edit-disable gate:**
   a. Click a keyform on a driven curve — selection happens, but drag doesn't (HIGH-A1-equivalent verification).
   b. Click a handle dot on a driven curve — same: selection but no drag.
   c. Press G on a selection that includes a driven curve + an undriven curve — modal G starts, only the undriven curve's keyforms move.
   d. Press G on a selection consisting ONLY of driven curves — modal bails immediately (no-op, no error).
   e. Press V / T / Shift+E / Ctrl+G / Delete on a mixed selection — only undriven curves get the operator applied.
5. **Sidebar "(D)" badge** appears on every driven row (active or context). Tooltip on driven rows shows "(driver-locked)".
6. **ResizeObserver refactor** — the rightmost ~180px of the curve now visible (verifies the incidental canvas-overflow fix). Container resize during interaction still works (MED-A4-equivalent from prior slice still holds).
7. **Banner truncates long expressions** at 60 chars with "..." but the full expression is in the `title` tooltip.
8. **NaN driver value** (e.g., expression `undefined_var * 2`) shows "NaN (fallback to keyforms)" in the value pill, banner stays mounted, gate still blocks editing.
9. **Empty expression** (`fcurve.driver.expression = ''`) shows "empty expression" italic in the strip.
10. **Sum/min/max/avg driver** (non-scripted) shows variable count instead of expression text.

---

## Tests passing (final state at `12f9e17`)

| Test | Pass/Fail |
|------|-----------|
| test:fcurveDriverGate | 21/21 (new) |
| test:fcurveColor | 24/24 |
| test:graphEditOps | 115/115 |
| test:fcurveHandles | 35/35 |
| test:fcurveEval | 35/35 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:motion3jsonRoundtrip | 42/42 |
| test:driverTreeEval | 15/15 |
| `tsc --noEmit` | clean |

385 headless assertions, all green.

---

## Resume paths (priority order post this session)

1. **Modal G/S axis-lock + typed numeric input** (the MED-B6 from Slice 5.C deferred follow-on). Now even more useful with cross-curve modal G working AND per-curve driver-gating proven. Should share implementation with the viewport's `ModalTransformOverlay`; a `useModalTransformInput()` hook extraction.

2. **Channel-vs-keyform selection split** — Blender's `FCURVE_SELECTED` independent of `FCURVE_ACTIVE`. Schema field + sidebar Shift-click extends channel selection + multi-channel "highlighted" state in sidebar. Cited deferral from Slice 5.C+.

3. **`fcurve.mute` schema field + muted-grey render** — Blender's `FCURVE_MUTED`. Both a new schema field and the render branch at the same time (per `feedback_no_migration_baggage_rule_two`).

4. **Active-keyform field + highlight** — `BKE_fcurve_active_keyframe_index` parity, `TH_VERTEX_ACTIVE` highlight.

5. **Persistent `fcurve.visible` schema field** — replace the local-React `hidden` Set with the persisted flag.

6. **Driver variable list / expression editor** — Slice 5.D's biggest deferral. Both the banner UI to author variables AND the `evaluateDriver` extension to support multi-target compound types (`DVAR_TYPE_ROT_DIFF` / `DVAR_TYPE_LOC_DIFF` / `DVAR_TYPE_TRANSFORM_CHAN`).

7. **Phase 2 owed-manual verification** — from prior close-outs: live recording bezier handle export, Hiyori round-trip in Cubism Editor, visual auto-handle smoothness, named-easing bake reload.

8. **Phase 3 — F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope. Once shipped, the F-Modifier-drawn curve branch at `graph_draw.cc:1151-1153` can light up here too.

9. **Round 8 UI sweep — F-1 follow-on** — ModePill lift to shared subcomponent.

10. **B2-B8 playback_controls gaps**.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5.D](./ANIMATION_BLENDER_PARITY_PLAN.md) (lines 1338-1343)
- Prior close-outs (same day):
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) — Slices 5.A+5.B
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md) — Slice 5.C operator pass
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md) — Slice 5.C+ multi-curve display
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) — Phase 2 (auto-handle calculator)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
