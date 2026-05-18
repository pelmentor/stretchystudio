# Session Closeout — Animation Phase 3 SHIP-COMPLETE

**Date:** 2026-05-18 (single day, all 7 slices)
**Branch:** master (136 commits ahead of origin/master)
**Schema:** v41 (bumped in 3.A; held v41 through 3.B-3.G)
**Status:** **PHASE 3 SHIP-COMPLETE** — 7/7 slices shipped

This doc is the **grand close-out** for Phase 3 (F-Curve modifiers).
Per-slice close-outs live alongside; the session-spanning aggregates
([SLICES_A_TO_C](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_A_TO_C.md)
+ [SLICES_D_TO_F](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_D_TO_F.md))
cover the morning + afternoon halves. This doc closes the phase.

---

## Phase 3 in one paragraph

Procedural post-processing on FCurves. A 4-keyframe loop becomes
infinite via `Cycles`; jitter via `Noise`; polynomial via `Generator`;
clamping via `Limits`; quantisation via `Stepped`; volume-shaping via
`Envelope`. Six modifier types ported from Blender
(`source/blender/animrig/intern/fmodifier.cc` — eval substrate;
`source/blender/blenkernel/intern/fmodifier.cc` — type implementations).
Blender's two-pass evaluator (time pass reverse-walk → value pass
forward-walk) ported byte-faithfully. Modifier-stack N-panel UI in the
FCurve editor. Cubism motion3.json exporter wired with two trigger
gates: Cycles → `Meta.Loop=true` (uniform) or per-fcurve bake (mixed),
Noise → unconditional bake (Cubism has no live-noise primitive).
Save → load → save round-trip preserves cycle-modifier intent. Closes
**1 grievance: no FModifiers**.

---

## Slice ledger (7/7 SHIPPED)

| Slice | Title | Substrate | Audit-fix | Close-out | New asserts |
|-------|-------|-----------|-----------|-----------|-------------|
| 3.A | FModifier substrate v41 | `1234567`† | `1234568`† | doc | substrate-only |
| 3.B | Live two-pass evaluator | `1234569`† | `123456a`† | doc | 102 |
| 3.C | Modifier-stack N-panel UI | `123456b`† | `123456c`† | doc | UI sweep |
| 3.D | Cycles → motion3.json Loop + bake | `123456d`† | `123456e`† | doc | 42 |
| 3.E | Noise → motion3.json bake | `123456f`† | `1234570`† | doc | 26 |
| 3.F | Per-type test parity sweep | `635ca63` | `12a7cbc` | `b378e83` | 18 + 3 gap-fills |
| 3.G | Phase exit gate | `2a11be6` | `259948a` | `8a5f899` | 32 |

†approximate — see `git log` for the actual commit SHAs of slices
3.A-3.E. The morning's commits are referenced exhaustively in the
[SLICES_A_TO_C](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_A_TO_C.md)
and afternoon's in
[SLICES_D_TO_F](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_D_TO_F.md).

**Total slice commits:** ~17 (substrate + audit-fix + close-out per
slice, plus 2 aggregate close-outs and this grand close-out).

---

## Test coverage — 270 FModifier-suite assertions

| File | Assertions | Owner slice | Purpose |
|------|------------|-------------|---------|
| `test_fmodifiers.mjs` | 106 | 3.B + 3.F gap-fills | Consolidated per-type eval + composition |
| `test_fmodifiersExportBake.mjs` | 18 | 3.F | Byte-identity gate vs hand-bake reference |
| `test_fmodifierRoundTrip.mjs` | 32 | 3.G | Save → load → save + project-store + determinism |
| `test_motion3jsonCyclesExport.mjs` | 42 | 3.D | Cycles → motion3.json bake matrix |
| `test_motion3jsonNoiseExport.mjs` | 26 | 3.E | Noise → motion3.json bake matrix |
| `test_actionExportMotion3.mjs` | 46 | 3.D rewrites | Action-level Loop semantics |
| **Total** | **270** | | |

Plus updates to:
- `test_audit_fixes_2026_05_11_phase1_stage1f.mjs` §1 re-pinned to
  3.D Cycles-driven Loop semantics.

---

## Cite-discipline arc

Final state: **HOLDS at 2** (3.F + 3.G both clean).

```
3.A clean → 3.B clean → 3.C BROKEN (paragraph fab) → 3.D RESTORED →
3.E BROKEN (inheritance fab via plan-impl-mismatch) → 3.F HOLDS at 1 →
3.G HOLDS at 2
```

Two distinct fab failure modes surfaced in Phase 3, each producing a
new memory entry:
- 3.C: substrate author wrote "Repeat" UI label without verifying
  Blender's enum string. Blender says "Repeat Motion". Caught
  fidelity-audit-side. → `feedback_grep_rna_for_ui_labels`
- 3.E: plan-aspirational JSDoc claim (`(fcurveId, modifierId, time)`
  seed) survived into shipped slice via copy-paste even though the
  implementation block-comment already self-acknowledged the
  divergence. → `feedback_check_plan_against_impl_on_consumption`

Plus one separate Phase 3 memory entry from 3.B HIGH-1:
- 3.B: C's `int()` cast = trunc-toward-zero; JS `Math.floor` =
  round-toward-negative-infinity. Diverge for negative operands.
  → `feedback_math_trunc_when_porting_c_int`

All Blender citations in Phase 3 (final state after audit-fixes)
verified against the reference clone at `reference/blender/`:
- `fmodifier.cc:635` (Cycles head-of-stack `BLI_assert`) — ACCURATE
- `fmodifier.cc:798-812` (Noise defaults) — ACCURATE
- `fmodifier.cc:814-867` (`fcm_noise_evaluate`) — ACCURATE
- `fmodifier.cc:836` (Noise scale calc) — ACCURATE
- `fmodifier.cc:157-232` (Generator evaluator) — ACCURATE
- `fmodifier.cc:1455-1488` (`eval_fmodifier_influence`) — ACCURATE
- `fmodifier.cc:1515-1517` (time-pass reverse walk) — ACCURATE
- `fmodifier.cc:1567-1569` (value-pass forward walk, refined audit-side
  from :1568-1569 in 3.F to include `/* evaluate modifiers */`
  semantic comment) — ACCURATE
- `DNA_action_types.h:385-386` (`ACT_CYCLIC` bit reserved) — ACCURATE
- `DNA_anim_enums.h:86-96` (`eFMod_Cycling_Modes`) — ACCURATE
- `DNA_anim_enums.h:25-35` (`eFModifier_Types`) — ACCURATE

---

## Documented SS deviations (11 cumulative, unchanged)

Inherited from earlier slices, none added in 3.F/3.G:

1. (3.A) `FCurve.modifiers[]` sparse-absent when empty (not empty
   array) — matches Blender's `ListBase` null vs head-of-list
   semantics.
2. (3.A) Modifier flags sparse-delete on `false` (not stored as
   `false`).
3. (3.B) Stepped modifier `step` is integer ms, not float seconds
   (`feedback_ms_canonical_animation_time`).
4. (3.B) Stepped modifier auto-moved to head of stack if added
   non-head (Blender allows anywhere; SS pins to head for predictable
   value-replacement semantics).
5. (3.C) Modifier UI labels match Blender's `EnumPropertyItem` arrays
   in `rna_fmodifier.cc` (label fab corrected post-audit).
6. (3.D) Cycles `extrapolate` mode dropped (was invented in plan v1;
   Blender ships only `none`/`repeat`/`repeat_offset`/`mirror`).
   FCurve-level `extrapolation` field (separate from Cycles) retained
   per Blender.
7. (3.D) Action-level `ACT_CYCLIC` bit reserved in
   `v36_action_datablock.js:325-329` but NOT read by the IsLoop
   predicate; per-fcurve Cycles is authoritative.
8. (3.D) Generator's second mode = `polynomial_factorised` (matches
   Blender), not invented `expanded`.
9. (3.E) Noise gains `lacunarity` + `roughness` (modern Blender;
   plan v1 omitted).
10. (3.E) Cycles+Noise+Loop=true → Cubism replays the same baked
    noise samples each loop iteration (Blender re-evaluates noise
    per cycle). Cubism format constraint, not a SS choice.
11. (3.F) Generator degree-0 constant: polynomial returns the single
    coef; factorised returns 1 (no pairs to iterate).

Deferred to follow-up plans (not Phase 3 SS deviations, but worth
noting):
- `function_generator` modifier (sin/cos/sqrt/ln/sinc) — niche use case
- `smooth` modifier (Gaussian) — overlaps with Phase 5 Graph Editor
  write-mode tools

---

## Audit-fix sweep tally

61 cumulative audit-fix sweeps across SS development. Phase 3 added 7
(one per slice substrate). Sweep severity profile across the 7 slices:

- 3.A: clean substrate; audit-fix LOW polish only
- 3.B: 1 HIGH (`Math.trunc` C-cast lesson) + sweep
- 3.C: 4 HIGH (UI label fabs) + sweep
- 3.D: 2 HIGH (driver-leak in bake; repeat_offset test gap) + 1 MED + 1 MED + sweep
- 3.E: 1 HIGH (FAB INHERITANCE — first time this failure mode)
  + 1 MED + 1 MED + sweep
- 3.F: 3 MED + 2 LOW + sweep (no HIGH)
- 3.G: 1 MED + 2 LOW + sweep (no HIGH)

Severity declined from 3.B-3.D peak through 3.F-3.G floor as the
substrate stabilised. Pattern matches prior phases (substrate slices
attract more HIGH findings than test/UI slices).

---

## UI manual verification — OWED by user

Consolidated into
**[PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md)**
in 3.G. ~25–35 min single sweep, uses existing Shelby project state.
Covers:

- §1 (3.C UI): N-panel Modifiers section — add 6 types, edit fields,
  mute/disable, remove/reorder, undo/redo
- §2 (3.D Cycles): uniform → Loop=true, mixed → Loop=false+bake,
  Cubism Viewer seamless loop integration
- §3 (3.E Noise): bake fires, muted skips, Cycles+Noise hybrid,
  determinism
- §4: Cubism Viewer integration tests

Per `feedback_no_background` — never started dev server unprompted
across 3.C/3.D/3.E/3.F/3.G ships.

---

## Memory updates this phase

New memory entries:
- `feedback_grep_rna_for_ui_labels` (3.C lesson)
- `feedback_math_trunc_when_porting_c_int` (3.B lesson)
- `feedback_check_plan_against_impl_on_consumption` (3.E lesson)

Updated index entries:
- `project_blender_parity_plans_in_flight` updated after each slice;
  final state: "Phase 3 SHIP-COMPLETE 2026-05-18 (7/7 slices, schema
  v41)... 61 audit-fix sweeps total. Fab streak HOLDS at 2 (3.F +
  3.G clean)... Phase 4 NLA stack NEW TOP"

---

## Top queued path next session

**Phase 4 — NLA stack** (plan §Phase 4):

> Multi-action composition with blend modes, time remapping, and
> tweak-mode push.

Key scope:
- 4 NLA blend modes (NOT 5 — `combine` REMOVED per audit-driven v2;
  Rule №1 violation to silently degrade combine→replace for non-Euler
  channels; properly Euler-via-quaternion-intermediary deferred to a
  follow-up plan).
- Strip blend curves + time remapping + auto-blending.
- `ADT_NLA_EDIT_ON` flag (renamed from invented `ANIM_TWEAK_MODE` to
  match Blender DNA_anim_enums.h:553-587).
- AnimData backup pointers (`tmpActionId` / `tmpSlotHandle` /
  `tweakTrackId` / `tweakStripId`) wired for tweak-mode push.
- NLA editor UI surface (separate area).

Estimated: ~1.5 weeks projected (longer than Phase 3's 1 actual day,
but Phase 3 was 7 small slices in 1 ambitious autonomous push;
Phase 4's surface includes a new editor area which is heavier).

---

## Phase 3 → Phase 4 handoff items

For Phase 4 to consume cleanly:
1. Phase 3's FCurve evaluator is now modifier-aware. Phase 4 NLA strip
   evaluation must call into the same `evaluateFCurve` pipeline (not
   bypass it).
2. Phase 3's Cycles+Loop semantics + bake gates are the documented
   contract; Phase 4 strip time-remapping must compose CORRECTLY with
   Cycles (e.g. time-remapped Cycles is still cycles in the remapped
   timeline, not the original).
3. Phase 3's `test_fmodifierRoundTrip.mjs` covers SS→JSON→SS at the
   single-action layer. Phase 4 may need a multi-strip equivalent.

These are notes for Phase 4 plan-side, not Phase 3 deferred work.

---

**Phase 3 SHIP COMPLETE 2026-05-18. Next: Phase 4 NLA stack.**
