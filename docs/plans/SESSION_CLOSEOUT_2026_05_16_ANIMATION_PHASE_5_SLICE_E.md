# Session Close-out — Animation Phase 5 Slice 5.E SHIPPED

**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `5bfb551` — feat(anim): Animation Phase 5 Slice 5.E — Graph Editor modal G/S axis-lock + typed numeric input
- `9ff69d5` — fix(audit): Animation Phase 5 Slice 5.E dual-audit sweep — 1 HIGH-B + 2 MED-B + 1 MED-A
- *(this doc)* — close-out documentation

Sixth Phase 5 close-out of the day, on top of `bd1e68b` + `feb4bde` + `c880fad` (Slices 5.A+5.B), `0d78ad3` + `213c748` + `278003d` (Slice 5.C), `7589952` + `4f51bd8` + `ffa1da8` (Slice 5.C+), and `75a357e` + `12f9e17` + `ef4e077` (Slice 5.D). Closes the top queued resume path from Slice 5.D's close-out (Modal G/S axis-lock + typed numeric input).

---

## What shipped

Per Slice 5.D close-out doc resume path #1:

> "Modal G/S axis-lock + typed numeric input — Now even more useful with cross-curve modal G working AND per-curve driver-gating proven. Should share implementation with the viewport's `ModalTransformOverlay`; a `useModalTransformInput()` hook extraction."

Concretely:

- **X / Y axis lock during modal G/S.** Pressing `X` during modal G constrains the transform to the time axis (zero value-delta). Pressing `Y` constrains to the value axis. Same axis-key again clears the lock. For modal S, axis 'x' scales only time (scaleY=1); 'y' scales only value (scaleX=1). Blender confirms bare X/Y is valid in 2D editors at `reference/blender/source/blender/editors/transform/transform.cc:655-670` — only `TFM_MODAL_AXIS_Z` + plane locks are blocked under `T_2D_EDIT`; X/Y fall through.
- **Shift+X / Shift+Y noop** consumes the chord without state change. Mirrors the 2D plane-lock block at `transform.cc:660-662` (Blender returns false for `TFM_MODAL_PLANE_X/Y` in `T_2D_EDIT`).
- **Typed numeric input.** Digits / `.` / leading `-` accumulate into `typedBuffer`. The typed value drives the transform exactly:
  - For G with axis 'x' or no axis: typed = **frames** on time axis, converted via `msPerFrame` to ms.
  - For G with axis 'y': typed = raw value units on value axis.
  - For S: typed = scale multiplier (empty numericMode buffer = identity 1).
  - Typed values disable shift-precision + ctrl-frame-snap (typed is exact).
- **Numeric mode (`=`).** Pressing `=` enters numericMode (the modal holds at typed value, default 0 for G / 1 for S). `Ctrl+=` exits. Backspace on empty buffer also exits (SS escape-hatch from accidental `=`). One-way enable mirrors Blender's `NUM_EDIT_FULL` flag at `reference/blender/source/blender/editors/util/numinput.cc:369-378`.
- **ModalHUD** renders axis indicator + numericMode badge + typed buffer + units (`f` for frame-typed, `×` for scale-typed, no suffix for value-axis-typed), in the same visual idiom as the viewport `ModalTransformOverlay` HUD. Axis label uses Blender's "along X" / "along Y" 2D-editor phrasing (`transform.cc:953,958`) after audit-fix HIGH-B1.
- **Shared reducer architecture.** Both the viewport modal and this fcurve modal route axis / typed / numericMode transitions through ONE pure reducer — `transformInputReducer` at [src/lib/modal/transformInputReducer.js](../../src/lib/modal/transformInputReducer.js). Storage shape differs (zustand for the viewport because Footer subscribes cross-component; local hook state for the fcurve modal where the HUD is plot-relative), but validation rules + `=`-toggle semantics + `popTyped`-exits-numericMode live in ONE place per Rule №1.

---

## Pure helpers + hook extracted

`src/lib/modal/transformInputReducer.js` (NEW, ~210 LOC with jsdoc):

| Export | What | Blender ref |
|---|---|---|
| `INITIAL_STATE` | Frozen `{axis:null, typedBuffer:'', numericMode:false}` | — |
| `transformInputReducer(state, action)` | Pure state machine; returns same identity on no-op | — |
| `parseTyped(buf)` | string → finite number or NaN | — |
| `keyEventToAction(event, opts)` | KeyboardEvent → reducer action / null | `transform.cc:655-670` (X/Y in 2D), `numinput.cc:369-378` (`=`) |

`src/lib/modal/useTransformModalInput.js` (NEW, ~110 LOC):

- React hook wrapping the reducer with `useState` + synchronous `stateRef` pattern, so imperative `applyModal` closures read post-action state without waiting for React's batch.
- Memoized return per audit-fix MED-A1 (no future-useCallback churn).

`src/store/modalTransformStore.js` (MODIFIED):

- `setAxis` / `appendTyped` / `popTyped` / `clearTyped` / `enterNumericMode` / `exitNumericMode` all delegate to `transformInputReducer`. Footer + viewport overlay subscriptions unchanged; the 26 existing `test:modalTransformTyped` assertions remain green without modification.

71 new headless assertions in `scripts/test/test_transformInputReducer.mjs` cover: `INITIAL_STATE` shape + freeze, `parseTyped` edge cases (empty / mid-typing `-` and `.`), every action type (idempotency, no-op identity-preservation, malformed input handling), `keyEventToAction` translation for every recognised key + non-handled keys, axis-allowed gating, and an E2E sequence simulating `1` `2` `.` `5` `=` `X` `Enter`. Registered as `test:transformInputReducer` + added to the aggregate `test` chain.

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Two parallel agents (architecture code-reviewer + Blender-fidelity general-purpose) on feature commit `5bfb551`. **4 fixes applied** in audit-fix `9ff69d5`.

| # | Severity | Source | Finding |
|---|---|---|---|
| HIGH-B1 | HIGH | Blender | **HUD axis label silently diverged.** SS rendered `axis: X` / `axis: Y` (invented phrasing). Blender's 2D editors use `IFACE_("along X")` / `IFACE_("along Y")` at `transform.cc:953,958` (separate from 3D editors' "global X" wording). **Fix:** changed ModalHUD to render "along X" / "along Y"; tooltip updated. In-code comment cites the line numbers. |
| MED-B1 | MED | Blender | **`USER_FLAG_NUMINPUT_ADVANCED` auto-enable omission.** Blender's `numinput.cc:353-365` auto-enables `NUM_EDIT_FULL` on the first digit — but ONLY when `USER_FLAG_NUMINPUT_ADVANCED` user pref is set (default OFF, verified at `DNA_userdef_types.h:34`). SS doesn't model the pref, so SS behaves identically to Blender's DEFAULT path. **Fix:** added "SS-deferred" jsdoc section to `transformInputReducer.js` quoting the Blender code + rationale + follow-on path. Not a behavioral fix — a documentation hygiene fix. |
| MED-B2 | MED | Blender | **`SIPO_DRAWTIME` frames-vs-seconds hardcoded.** Blender's `transform_mode_translate.cc:606-608` reads `display_seconds = (sipo->mode == SIPO_MODE_ANIMATION) && (sipo->flag & SIPO_DRAWTIME)`. SS hardcodes the `f` suffix (frames only) because we haven't shipped a display-mode toggle on the Animation Editor. **Fix:** in-code comment in ModalHUD documents the deferred follow-on (when seconds toggle ships, read same flag here). |
| MED-A1 | MED | arch | **`useTransformModalInput` returns fresh object literal per render.** Currently NOT a problem (no `useCallback` wraps the consumer), but a natural future refactor would silently invalidate memoized callbacks. **Fix:** wrapped the return in `useMemo` deps on `[state, dispatch, reset]`. `stateRef` is stable; `parseTyped` is module-level. Object identity now changes only when state actually transitions. |

**Cross-verification step** (every Blender citation grepped + Read on disk before quoting, per `feedback_blender_reference_strict`):

- `transform.cc:953,958` "along X" / "along Y" labels — Read confirmed
- `transform.cc:655-670` X/Y axis-lock exemption from T_2D_EDIT — Read confirmed
- `transform.cc:660-662` 2D plane-lock block — Read confirmed
- `numinput.cc:353-365` `USER_FLAG_NUMINPUT_ADVANCED` digit auto-enable — Read confirmed
- `numinput.cc:369-378` `=` / `Ctrl+=` one-way enable — Read confirmed
- `transform_mode_translate.cc:606-608` `SIPO_DRAWTIME` display_seconds — Read confirmed
- `DNA_userdef_types.h:34` `USER_FLAG_NUMINPUT_ADVANCED` definition — Grep confirmed

All 7 cited line ranges accurate. **Zero citation fabrications this slice** (vs 3 fabrications caught in Slice 5.D's audit — citation discipline is improving as the pattern matures).

**Dismissed audit findings** (cross-verification telemetry):

- **Hook-order safety** (arch HIGH): Plot()'s hooks are all above early returns; the early returns are in the OUTER `FCurveEditor`, which is a separate function. Same false-positive shape as Slice 5.D HIGH-A1. **False positive.**
- **`stateRef` synchrony** (arch MED): The hook keeps `stateRef.current` updated synchronously in `dispatch`; `onKey` calls `dispatch` then `applyModal` on the next line — `applyModal` reads `stateRef.current` and sees the post-action value. Cross-verified correct.
- **Cross-modal simultaneous firing** (arch MED): Viewport overlay's keydown listener is gated by `if (!kind) return` in `useEffect`; when viewport modal is idle, listener is not installed. Cross-verified correct.
- **Frame-snap + axis-lock + typed matrix** (arch HIGH): All 12 cells (axis x|y|null × typed on|off × kind g|s × ctrl on|off) walked through; typed-G branch writes single-axis delta then mouse-axis-lock at `FCurveEditor.jsx:1097-1100` is guarded by `!useTyped` so no double-apply. Cross-verified correct.
- **Cleanup ordering** (arch MED): Both commit and cancel call `modalInput.reset()` AFTER the final data mutation and `endBatch`. Typed buffer doesn't influence post-cleanup data. Cross-verified correct.
- **HIGH-B2 popTyped exits numericMode is a Blender divergence**: Already documented in the reducer's module header with rationale. No action needed.

---

## SS-deferred (documented in file-headers, not shipped this slice)

- **`USER_FLAG_NUMINPUT_ADVANCED` auto-enable on digit.** See `transformInputReducer.js` "SS-deferred" jsdoc section. Would need a `preferences.numericInputAdvanced` toggle + an extra `'enterNumericMode'` dispatch from `appendTyped`.
- **`SIPO_DRAWTIME` seconds-vs-frames display mode.** SS Animation Editor only surfaces frame numbers; when a seconds toggle ships, ModalHUD's `unit` derivation should read the same flag.
- **Per-keyform pivot for S (median vs cursor vs individual).** SS uses global median across all selected keyforms. Blender's "Pivot Point" header dropdown not ported to fcurve editor.
- **Axis lock on per-keyform DRAG path** (`startKeyformDrag` / `startHandleDrag`). Those use `applyKeyformDrag` rather than the modal `applyGrab` and don't open a HUD. A follow-on could route them through the same hook when shift-locked.
- **Footer wiring for fcurve modal.** Footer currently subscribes only to the viewport `modalTransformStore`. The fcurve modal's local hook state could be lifted into a parallel store (`fcurveModalTransformStore`) so the Footer surfaces "GRAB along X · 5f" while editing keyforms too. Trade-off vs the simpler local-state architecture; deferred until there's user demand for cross-component status.

---

## Owed manual browser verification

Cannot be assertion-tested headlessly:

1. **Press G in Graph Editor with selected keyforms.** Modal starts; HUD shows "GRAB" label. Drag → keyforms move in both time and value.
2. **Press X mid-G.** HUD shows "along X" (amber). Keyforms only move horizontally (time changes; value stays). Press X again — lock clears, free 2D drag resumes.
3. **Press Y mid-G.** HUD shows "along Y". Keyforms only move vertically. Press Y → clear.
4. **Type `5` mid-G.** HUD shows `5f` (or `5` if Y-locked). Selection moves by exactly 5 frames (or +5 raw value if Y-locked).
5. **Type `-10` mid-G.** Selection moves by -10 frames. Verify the `-` mid-stream is rejected (typing `1` then `-` keeps buffer at `1`).
6. **Press `=` mid-G with empty buffer.** HUD shows "= " badge. Modal holds at 0 (no movement). Type `7` → HUD shows `= 7f`; selection moves by 7 frames.
7. **Press `Ctrl+=` while in numeric mode.** Badge clears; modal returns to mouse-driven.
8. **Backspace at empty buffer with numericMode on.** Both buffer stays empty AND numericMode badge clears (SS escape hatch).
9. **Press Shift+X mid-G.** Noop (consumed without preventing global hotkey fall-through). Verify no axis lock fires and the chord doesn't bubble to a Tab-mode switch or similar.
10. **Press S → X → type `2`.** Scale modal locks to time-axis; keyforms expand 2× along time only (value stays). HUD shows `2×`.
11. **Press G → drive with mouse → press Enter.** Final delta committed; one undo entry per the existing `beginBatch`/`endBatch` pattern.
12. **Press G → mouse → Escape.** Selection reverts to original positions; no undo entry; modal cleans up.

---

## Tests passing (final state at `9ff69d5`)

| Test | Pass/Fail |
|------|-----------|
| test:transformInputReducer | 71/71 (new) |
| test:modalTransformTyped | 26/26 |
| test:fcurveDriverGate | 21/21 |
| test:graphEditOps | 115/115 |
| test:fcurveHandles | 35/35 |
| test:fcurveEval | 35/35 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:motion3jsonRoundtrip | 42/42 (not re-run; no change to motion3 path) |
| test:driverTreeEval | 15/15 (not re-run; no change to driver path) |
| `tsc --noEmit` | clean |

416 headless assertions covered by the slice-affected suites, all green.

---

## Resume paths (priority order post this session)

1. **Channel-vs-keyform selection split** — Blender's `FCURVE_SELECTED` independent of `FCURVE_ACTIVE`. Schema field + sidebar Shift-click extends channel selection + multi-channel "highlighted" state in sidebar. Cited deferral from Slice 5.C+.

2. **`fcurve.mute` schema field + muted-grey render** — Blender's `FCURVE_MUTED`. Both a new schema field and the render branch at the same time (per `feedback_no_migration_baggage_rule_two`).

3. **Active-keyform field + highlight** — `BKE_fcurve_active_keyframe_index` parity, `TH_VERTEX_ACTIVE` highlight.

4. **Persistent `fcurve.visible` schema field** — replace the local-React `hidden` Set with the persisted flag.

5. **Driver variable list / expression editor** — Slice 5.D's biggest deferral. Both the banner UI to author variables AND the `evaluateDriver` extension to support multi-target compound types (`DVAR_TYPE_ROT_DIFF` / `DVAR_TYPE_LOC_DIFF` / `DVAR_TYPE_TRANSFORM_CHAN`).

6. **Footer wiring for fcurve modal status** — lift the local hook state into a parallel `fcurveModalTransformStore` so Footer can surface "GRAB along X · 5f" while editing keyforms (sister to the viewport's footer line).

7. **`SIPO_DRAWTIME` seconds-vs-frames display toggle** — when shipped, ModalHUD's `unit` derivation needs to read the same flag (audit-fix MED-B2 left a documented placeholder).

8. **`USER_FLAG_NUMINPUT_ADVANCED` preference + auto-enable** — port the digit-implicit `NUM_EDIT_FULL` path (audit-fix MED-B1 left a documented placeholder). Would need `preferences.numericInputAdvanced` toggle in user prefs.

9. **Phase 2 owed-manual verification** — from prior close-outs: live recording bezier handle export, Hiyori round-trip in Cubism Editor, visual auto-handle smoothness, named-easing bake reload.

10. **Phase 3 — F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope.

11. **Round 8 UI sweep — F-1 follow-on** — ModePill lift to shared subcomponent.

12. **B2-B8 playback_controls gaps**.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5](./ANIMATION_BLENDER_PARITY_PLAN.md)
- Prior close-outs (same day):
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5.md) — Slices 5.A+5.B
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C.md) — Slice 5.C operator pass
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md) — Slice 5.C+ multi-curve display
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_D.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_D.md) — Slice 5.D driver banner
  - [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) — Phase 2 (auto-handle calculator)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
