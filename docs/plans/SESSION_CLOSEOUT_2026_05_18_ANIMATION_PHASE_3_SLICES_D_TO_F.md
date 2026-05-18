# Session-Spanning Closeout — Animation Phase 3 Slices 3.D → 3.F

**Date:** 2026-05-18 (single super-session, paired with morning's 3.A→3.C sweep)
**Branch:** master (130 commits ahead of origin/master)
**Schema:** v41 (unchanged across 3.D/3.E/3.F — consumption + tests only)
**Status:** 3 slices SHIPPED + Phase 3 now 6 of 7 slices complete

This doc aggregates the three slices shipped this session in a single
pre-compact snapshot. Per-slice details live in their dedicated
close-outs:
- [SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_D.md](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_D.md)
- [SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_E.md](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_E.md)
- [SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_F.md](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_F.md)

The morning's aggregate (3.A→3.C) is at
[SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_A_TO_C.md](SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICES_A_TO_C.md).

---

## What shipped this session

```
Phase 3 — F-Curve modifier stack
├─ 3.A — FModifier substrate ............... SHIPPED (morning) ......... v40→v41
├─ 3.B — Live two-pass evaluator ........... SHIPPED (morning)
├─ 3.C — Modifier-stack N-panel UI ......... SHIPPED (morning)
├─ 3.D — Cycles → motion3.json Meta.Loop ... SHIPPED (afternoon) ←──┐
├─ 3.E — Noise → motion3.json bake ......... SHIPPED (afternoon)    ├ THIS SESSION
├─ 3.F — Per-type test parity sweep ........ SHIPPED (afternoon) ←──┘
└─ 3.G — Phase exit gate ................... NEW TOP (next session)
```

## Per-slice TL;DR

### 3.D — Cycles → motion3.json Meta.Loop + per-fcurve bake

Replaces the legacy hardcoded `Meta.Loop = true` (Stage 1.F deviation)
with a per-FCurve Cycles modifier signal per plan §3.D. Predicate
`actionHasUniformLoopingCycles` gates `Meta.Loop`; bake helper
`bakeFCurveModifiers` (modifier-type-agnostic, calls `evaluateFCurve`)
fires when the action isn't uniformly looping AND the fcurve has
active Cycles. Importer companion synthesises a head-of-stack Cycles
modifier when importing motion3.json with `Loop=true` so round-trips
preserve loop intent byte-identically.

Files: [src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js),
[src/io/live2d/motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js).
Tests: NEW [test_motion3jsonCyclesExport.mjs](../../scripts/test/test_motion3jsonCyclesExport.mjs)
(42 asserts) + extended [test_actionExportMotion3.mjs](../../scripts/test/test_actionExportMotion3.mjs)
§5 (10 new) + re-pinned [test_audit_fixes_2026_05_11_phase1_stage1f.mjs](../../scripts/test/test_audit_fixes_2026_05_11_phase1_stage1f.mjs)
§1.

Audit: 2 HIGH arch (driver-leak in bake, repeat_offset test gap) + 1
MED arch (durationMs=0 silent fallback) + 2 MED fidelity (synthesised
modifier missing id, useInfluence comment) — all fixed same-day.

### 3.E — Noise → motion3.json unconditional bake

Extends the 3.D bake gate with an unconditional Noise trigger per plan
§3.E ("Cubism has no live-noise primitive"). `hasActiveNoiseModifier`
scans the full modifier stack (no head-of-stack invariant for Noise,
unlike Cycles); bake fires when EITHER (a) the 3.D Cycles condition
holds OR (b) any active Noise modifier is present regardless of
`Meta.Loop`. Cycles+Noise+Loop=true is the trickiest combo: the Noise
trigger bakes that fcurve while Loop=true is preserved at action
level; Cubism replays the same baked samples each iteration
(documented SS deviation from Blender's per-cycle Noise re-evaluation).

Files: [src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js),
[src/anim/fmodifiers.js](../../src/anim/fmodifiers.js) (JSDoc fab
correction).
Tests: NEW [test_motion3jsonNoiseExport.mjs](../../scripts/test/test_motion3jsonNoiseExport.mjs)
(26 asserts).

Audit: 1 HIGH fidelity (FAB INHERITANCE — plan §3.E + FModNoiseData
JSDoc both inherited an aspirational `(fcurveId, modifierId, time)`
seed claim from the original plan draft; actual `evaluateNoiseValue`
matches Blender exactly with no per-fcurve seed). Different failure
mode from 3.C — `fmodifiers.js` block-comment already self-acknowledged
the divergence, but the front-matter JSDoc + plan never caught up.
**New memory entry [feedback_check_plan_against_impl_on_consumption](C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_check_plan_against_impl_on_consumption.md)**.

### 3.F — FModifier per-type test parity sweep

Plan §3.F listed 8 dedicated test files; consolidated
`test_fmodifiers.mjs` (102 asserts) already covered all 6 modifier
types substantially. Per Rule №2 (no migration baggage) **did NOT
split** the working consolidated file. Instead:
- NEW [test_fmodifiers_export_bake.mjs](../../scripts/test/test_fmodifiers_export_bake.mjs)
  (18 asserts) — byte-identity gate vs hand-bake reference
- 3 gap-fills (§61/§62/§63) in [test_fmodifiers.mjs](../../scripts/test/test_fmodifiers.mjs)
  (Generator degree-0, Noise frequency response, Cycles+Noise+Limits
  3-way composition)
- Plan §3.F updated with explicit coverage mapping table

Audit: 0 HIGH, 3 MED arch (handBake invariant doc, §62 zero-crossing
fragility, §8 dead loop) + 2 LOW (cite refinement :1568→:1567, date
in section header). Cite-streak HELD.

## Aggregate stats

| Metric | Value |
|------|------|
| Commits | 9 (3 substrate + 3 audit-fix + 3 close-out) |
| Slices shipped | 3 (3.D / 3.E / 3.F) |
| Schema | v41 (no bump this session; all 3 slices consume substrate) |
| New tests | 89 assertions (42 Cycles + 26 Noise + 18 byte-identity + 3 gap-fills) |
| Total new test files | 3 (test_motion3jsonCyclesExport, test_motion3jsonNoiseExport, test_fmodifiers_export_bake) |
| Tests touched (extended) | 4 (actionExportMotion3, audit_stage1f, fmodifiers, motion3jsonImport) |
| Audit-fix sweeps | 3 (1 per slice) |
| New SS deviations opened | 1 (3.E Cycles+Noise+Loop=true replay) |
| SS deviations closed | 0 (Phase 3 first-of-kind everywhere) |
| New memory entries | 1 ([feedback_check_plan_against_impl_on_consumption](C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_check_plan_against_impl_on_consumption.md)) |
| Diff size | +2,460 / -92 LOC |

## Cite-discipline arc (this session)

| Slice | Cite-fab outcome |
|------|------|
| 3.D | **RESTORED at 1** — all 7 Blender cites verified clean (`fmodifier.cc:635`/`:1490`/`:1455-1488`, `fcurve.js:155`, `v36_action_datablock.js:325-329`, `rna_fcurve.cc:1531+`, `DNA_action_types.h:374-387`) |
| 3.E | **BROKEN at 1** — implementation cites all clean, but plan doc + FModNoiseData JSDoc inherited an aspirational seed-shape claim from the plan draft (fab inheritance via copy-paste). Different failure mode from 3.C's authoring-fab |
| 3.F | **HOLDS at 1** — all cites verified clean, including refined `fmodifier.cc:1567-1569` for the value-pass forward walk |

Phase 3 fab summary: 1 classic authoring-fab (3.C) + 1 fab inheritance
(3.E). Both caught by fidelity audit, both fixed same-day. Sister
audits per slice consistently caught what the architecture audits
missed (and vice versa) — **dual-audit pattern remains load-bearing**.

## Open SS deviations (Phase 3 total)

11 across Phase 3:
- 10 inherited from morning's 3.A/3.B/3.C (Smooth/FN_Generator deferred,
  FMODIFIER_FLAG_EXPANDED deprecated, sparse-defaults convention, etc.)
- **1 new this session**: 3.E Cycles+Noise+Loop=true replays the same
  baked noise samples each iteration (Blender re-evaluates per cycle).
  Documented in plan §3.E as accepted Cubism-format-forced divergence.

## What's still owed (UI manual verification by user)

Per `feedback_no_background`, did NOT start dev server unprompted across
any of these slices. User-side verification owed:

**From 3.C (still open from morning):**
1. `npm run dev`, open an FCurve in FCurveEditor, `N` for N-panel,
   exercise the Modifiers section: add each of 6 modifier types,
   confirm Cycles greys/lands at index 0 after first add, exercise
   mute/remove/reorder/expand-collapse, edit per-type fields, confirm
   undo/redo recovers each edit.

**From 3.D:**
2. Export an action with uniform Cycles → confirm `Meta.Loop: true`.
3. Export an action with mixed cycling/non-cycling fcurves → confirm
   `Meta.Loop: false` AND the cycling fcurves' segment arrays are
   significantly longer than their keyform counts.
4. Round-trip: import Hiyori `hiyori_m01.motion3.json` (`Loop: true`),
   open its fcurves in the FCurve Editor + N-panel, confirm a Cycles
   modifier appears at head of stack with `after=Repeat Motion` label.
   Re-export and confirm `Meta.Loop: true` survives.

**From 3.E:**
5. Add a Noise modifier (anywhere in stack) to a fcurve. Export.
   Confirm segment count is much higher than source keyform count.
6. Mute the Noise modifier. Re-export. Confirm bake does NOT fire.
7. Cycles+Noise: uniform-Cycles action + Noise on one fcurve.
   Confirm `Meta.Loop=true` AND that fcurve is baked (others ship
   as-authored).
8. Determinism sanity: export the same action twice; diff the two
   JSON outputs; byte-identical.

**From 3.F:** none (test-only slice, no UI surface).

**Cubism Viewer load** (3.G prerequisite): a 3.D Cycles export should
loop seamlessly when loaded into Cubism Viewer 5.0.

## Pre-compact state table

| Item | Value |
|------|------|
| Commits ahead of `origin/master` | 130 (+9 this session) |
| Working tree | clean |
| Schema | v41 (unchanged) |
| Phase 3 progress | 6 of 7 slices (3.A → 3.F shipped; 3.G next) |
| Session commits | 9 |
| Fab streak | 3.D RESTORED → 3.E BROKEN (inheritance) → 3.F HOLDS at 1 |
| New test assertions this session | 89 |
| Cumulative open SS deviations (Phase 3) | 11 |
| New memory entries | 1 (feedback_check_plan_against_impl_on_consumption) |
| UI manual verification | OWED by user (cumulative 3.C/3.D/3.E items) |
| Top queued path | **3.G — Phase 3 exit gate** (manual-verification consolidation + automated round-trip test + flip Phase 3 SHIP-COMPLETE marker) |

## Top queued path next session

**3.G — Phase 3 exit gate** (per plan §3.G):

```
- All FModifier tests green.                           ✓ (satisfied by 3.F)
- Cubism Viewer load of an exported motion3.json
  with `Cycles` → loops correctly.                     ⏳ user-side
- Round-trip: cycle-modifier on save → load → save
  preserves the modifier.                              ⏳ likely automatable
```

3.G will likely consist of:
1. Unified manual-verification checklist doc consolidating 3.C/3.D/3.E
   UI/Viewer items into a single sweep the user can execute end-to-end.
2. A `test_fmodifiers_round_trip.mjs` (or `test_fmodifierRoundTrip.mjs`)
   if the save→load→save round-trip can be automated below the Cubism
   Viewer layer — project store + motion3jsonImport already gives us
   all the pieces.
3. The "Phase 3 SHIP-COMPLETE" marker on the plan doc once all items
   green.

After 3.G: **Phase 3 SHIP COMPLETE**, then on to Phase 4 (NLA stack)
per the plan's ~7-week trajectory.

---

**Commits this session (9):**
- `86286c0` — feat(anim): Phase 3 Slice 3.D — Cycles → motion3.json Meta.Loop + per-fcurve bake
- `28a8d1c` — fix(audit): Phase 3 Slice 3.D audit-fix — 2 HIGH + 2 MED + cite-streak RESTORED
- `821a944` — docs(plan): Animation Phase 3 Slice 3.D close-out
- `8277399` — feat(anim): Phase 3 Slice 3.E — Noise → motion3.json unconditional bake
- `0a15508` — fix(audit): Phase 3 Slice 3.E audit-fix — 1 HIGH (plan+JSDoc fab) + 3 MED + 1 LOW
- `c4ebadc` — docs(plan): Animation Phase 3 Slice 3.E close-out
- `635ca63` — feat(anim): Phase 3 Slice 3.F — FModifier per-type test parity sweep
- `12a7cbc` — fix(audit): Phase 3 Slice 3.F audit-fix — 3 MED + 2 LOW + cite-streak HOLDS
- `b378e83` — docs(plan): Animation Phase 3 Slice 3.F close-out
