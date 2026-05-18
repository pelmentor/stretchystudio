# Session Closeout — Animation Phase 3 Slice 3.F

**Date:** 2026-05-18
**Branch:** master (129 commits ahead of origin/master)
**Schema:** v41 (no bump — test-only slice)
**Status:** SHIPPED — substrate `635ca63` + audit-fix `12a7cbc`

---

## What 3.F ships

Plan §3.F listed 8 dedicated test files (`test_fmodifiers_cycles.mjs`,
`test_fmodifiers_noise.mjs`, etc.). Implementation strategy: **don't
split** the consolidated [test_fmodifiers.mjs](../../scripts/test/test_fmodifiers.mjs)
that already covers all 6 modifier types substantially across 102
assertions. Per Rule №2 (no migration baggage), splitting working test
infrastructure just to match plan-aspirational file names is churn
without behavioral benefit.

Instead 3.F shipped:

- **[scripts/test/test_fmodifiers_export_bake.mjs](../../scripts/test/test_fmodifiers_export_bake.mjs)**
  — NEW dedicated file, 18 byte-identity assertions. Verifies
  `generateMotion3Json`'s bake helper produces segment arrays
  byte-identical to a manually-constructed hand-bake using the same
  FPS cadence + `evaluateFCurve` pipeline. The load-bearing missing
  piece from the plan target table.

- **[scripts/test/test_fmodifiers.mjs](../../scripts/test/test_fmodifiers.mjs)
  §61/§62/§63** — 3 gap-fill assertions added to the existing
  consolidated file:
  - §61: Generator degree-0 constant (polynomial single-coef
    replaces sampled value; factorised single unpaired coefficient
    returns 1 since no pairs iterated)
  - §62: Noise frequency response — `size=10` (high freq) vs
    `size=1000` (low freq) produce measurably different output (post-
    audit-fix MED-2: deterministic sample-difference check, not
    zero-crossing count)
  - §63: Cycles+Noise+Limits 3-way composition: Limits clamps every
    sample to ≤ 0.6 across 5 cycles (forward-walk modifier order)

- **[docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](ANIMATION_BLENDER_PARITY_PLAN.md)**
  §3.F marked SHIPPED with explicit coverage mapping table (plan
  target → actual implementation, addressing the Rule №2 "where did
  the other 7 files go?" concern).

## Byte-identity gate scope

The new `test_fmodifiers_export_bake.mjs` covers 8 distinct bake
scenarios:
1. Noise-only bake byte-identical to hand-bake
2. Cycles-only bake (forced via mixed action) byte-identical
3. Cycles+Noise composition byte-identical
4. All 4 Noise blend types (replace/add/subtract/multiply)
5. Cross-run determinism (run-1 ≡ run-2)
6. Multiple FPS values (24/30/60)
7. Non-aligned-duration clamp arithmetic (333ms @ 30fps — last sample
   clamps to durationMs, not stepMs × N)
8. Driver-bearing fcurve regression-pin (3.D audit-fix H-1 — driver
   must be applied BEFORE strip)

Audit-fix LOW-2 (fidelity) added an explicit JSDoc section noting what
the test does **NOT** gate: Blender-fidelity of the eval substrate
(that's `test_fmodifiers.mjs`). Byte-identity here proves the bake
helper is faithful to SS's pipeline; the pipeline's Blender-fidelity
is gated elsewhere.

## Cite-discipline arc

**HOLDS at 1** (no fab re-introduction). Fidelity audit verified:

- `fmodifier.cc:1567-1569` (value-pass forward walk, refined from
  :1568-1569 to include the `/* evaluate modifiers */` comment) — ACCURATE
- `fmodifier.cc:1515-1517` (time-pass reverse walk) — ACCURATE
- `fmodifier.cc:836` (Noise scale calc) — ACCURATE
- `fmodifier.cc:798-812` (Noise defaults) — ACCURATE
- `fmodifier.cc:157-232` (Generator evaluator) — ACCURATE

The 3.E inheritance fab correction (`fmodifiers.js:209-221`) remains
intact — no re-introduction in any 3.F change.

Fab streak: 3.B clean → 3.C broken (paragraph fab) → 3.D RESTORED →
3.E BROKEN (inheritance fab) → **3.F HOLDS at 1** (clean throughout).

## Dual-audit findings (commit `12a7cbc`)

### Architecture (3 actionable, 1 LOW)

- **MED-1**: handBake first-sample invariant not documented. JSDoc
  updated with explicit INVARIANT callout.
- **MED-2**: §62 zero-crossing heuristic fragile (`!==` assertion
  could pass even when low-freq has MORE crossings — opposite of
  stated intent). Replaced with deterministic sample-difference check.
- **MED-3**: §8 dead for-loop in driver test. Replaced with working
  sweep across all sample positions.
- **LOW-2**: Date in section header (Rule №2 nudge). Removed.

### Fidelity (1 MED, 2 LOW, plus the same MED-2/MED-3 as arch)

- **MED-2 (M-2)**: `fmodifier.cc:1568-1569` cite range landed on loop
  variable declaration; refined to `:1567-1569` to include
  `/* evaluate modifiers */` semantic comment.
- **LOW-2 (L-2)**: JSDoc didn't distinguish byte-identity-of-bake
  from Blender-fidelity-of-eval. Added explicit "What this test does
  NOT gate" section.
- LOW-1 (§61a unpaired factorised polynomial test): skipped — testing
  the SS implementation's actual edge-case behavior; could add a
  deviation note but it's truly an edge case not exercised in practice.

## Test coverage

| File | Before | After | Delta |
|------|--------|-------|-------|
| test_fmodifiers.mjs | 102 | 106 | +4 (§61/§62/§63 gap-fills) |
| test_fmodifiers_export_bake.mjs (NEW) | n/a | 18 | +18 |

**New assertions this slice: 22**.

## Files touched (commits `635ca63` + `12a7cbc`)

| File | Purpose |
|------|---------|
| scripts/test/test_fmodifiers_export_bake.mjs | NEW — 18 byte-identity assertions |
| scripts/test/test_fmodifiers.mjs | §61/§62/§63 gap-fills + audit-fix hardening |
| docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md | §3.F marked SHIPPED + coverage mapping |
| package.json | test:fmodifiersExportBake entry + aggregate |

## SS deviations still open

3.F opens **0 new** SS deviations. Inherited: **11 from 3.A/3.B/3.C/3.D/3.E**
(unchanged — 3.F is test-only, no behavior change).

## UI manual verification

3.F doesn't add any UI surface — pure test-only slice. The UI
verification owed for 3.C/3.D/3.E remains the open item per
`feedback_no_background`.

## Top queued path next session

**3.G — Phase 3 exit gate** (per plan §3.G):

> - All FModifier tests green.
> - Cubism Viewer load of an exported motion3.json with `Cycles` → loops correctly.
> - Round-trip: cycle-modifier on save → load → save preserves the modifier.

3.G is the **phase-completion gate**. The first checkbox is already
satisfied by 3.F (all FModifier tests green: 106 + 18 + 42 + 26 + ...
across the consolidated + dedicated files). The second + third
checkboxes require user-side manual verification (Cubism Viewer load +
save/load/save round-trip — both already deferred per
`feedback_no_background` from 3.C/3.D/3.E).

3.G will likely consist of:
- A unified manual-verification checklist doc consolidating 3.C/3.D/3.E
  UI/Viewer items into a single sweep the user can execute end-to-end.
- A `test_fmodifiers_round_trip.mjs` if the save→load→save round-trip
  can be automated below the Cubism Viewer layer (likely yes — the
  project store + motion3jsonImport already give us all the pieces).
- The "Phase 3 SHIP-COMPLETE" marker on the plan doc once all items
  green.

After 3.G: **Phase 3 SHIP COMPLETE**, then on to Phase 4 (NLA stack)
per the plan's ~7-week trajectory.

---

**Commits this slice (2):**
- `635ca63` — feat(anim): Phase 3 Slice 3.F — FModifier per-type test parity sweep
- `12a7cbc` — fix(audit): Phase 3 Slice 3.F audit-fix — 3 MED + 2 LOW + cite-streak HOLDS
