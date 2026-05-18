# Animation Phase 3 — Slice 3.B close-out

**Date**: 2026-05-18
**Commits**: `506d702` (substrate) → `11470f3` (audit-fix sweep) → (this doc)
**Predecessor**: `SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_A.md`
(substrate typedefs, schema v41)
**Path #14 (continued) from Phase 3 queue** — *FModifier evaluator
(live two-pass eval)* — SHIPPED.

## What the path was

> "**3.B — Modifier evaluator** (per-FCurve modifier stack eval, port of
> `BKE_fmodifiers_calculate_*`) | NEW TOP"
> — from Slice 3.A close-out (`SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_A.md`)

Runtime consumer of the 3.A typedef substrate. Implements Blender's
two-pass FModifier evaluator (`fmodifier.cc:1490-1595`): reverse-walk
time-pass composes effective_time → keyframe sample → forward-walk
value-pass composes effective_value → driver override (when present).

## Blender divergence verified

| Aspect | Blender | SS port (3.B) |
|--------|---------|---------------|
| Time pass entry | `evaluate_time_fmodifiers` at `fmodifier.cc:1490-1548` | `evaluateTimeModifiers(modifiers, fcurve, evaltime)` |
| Value pass entry | `evaluate_value_fmodifiers` at `fmodifier.cc:1550-1595` | `evaluateValueModifiers(modifiers, fcurve, cvalue, evaltime, scratch)` |
| Time walk direction | REVERSE (last→first) per `:1515-1517` | `for (let i = modifiers.length - 1; i >= 0; i--)` |
| Value walk direction | FORWARD (first→last) per `:1568-1569` | `for (let i = 0; i < modifiers.length; i++)` |
| Influence calc | `eval_fmodifier_influence` at `:1443-1488` | `computeFModifierInfluence(mod, evaltime)` |
| Influence blend | `evaltime = interpf(nval, evaltime, influence)` at `:1540` | `t = interpf(nval, t, influence)` |
| Scratch handoff | `POINTER_OFFSET(storage->buffer, fcm_index * size_per_modifier)` at `:1534-1536` | Positional array `scratch[i]` (audit-fix MED-1) |
| Per-type dispatch | `FModifierTypeInfo.evaluate_modifier_time` / `evaluate_modifier` pointers | Switch on `mod.type` in each pass |
| Cycles head-of-stack | `BLI_assert(fcm->prev == nullptr)` at `:635` | Documented invariant; 3.C UI responsibility (not enforced at eval) |

## What shipped

| Capability | Where |
|------------|-------|
| Perlin 2D primitive (Ken Perlin reference, 256-entry perm table doubled) | `src/anim/fmodifiers.js` ~line 580 |
| `perlinFbm2D` fractal-Brownian-motion wrapper with octave summation + renormalisation to ~[0,1] | same ~line 650 |
| `computeFModifierInfluence` (useInfluence + RANGERESTRICT + blendin/blendout linear ramps) | same ~line 700 |
| 8 per-type evaluator functions (`evaluateCyclesTime/Value`, `evaluateNoiseValue`, `evaluateGeneratorValue`, `evaluateLimitsTime/Value`, `evaluateSteppedTime`, `evaluateEnvelopeValue`) | same ~line 780-1100 |
| `evaluateTimeModifiers` reverse-walk dispatcher (range gate + influence) | same ~line 1110 |
| `evaluateValueModifiers` forward-walk dispatcher | same ~line 1180 |
| `evaluateFModifierStack` combined-pass entry point | same ~line 1245 |
| `evaluateFCurve` extended with 4-step pipeline (time-pass → sample → value-pass → driver) | `src/anim/fcurve.js` ~line 150 |
| Tests: 102 assertions covering all 8 evaluators + 2 dispatchers + influence + integration | `scripts/test/test_fmodifiers.mjs` |
| `test:fmodifiers` script + test-runner registration | `package.json` |

## Dual audit (parallel agents)

| Lane | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
| Architecture | 2 | 3 | 4 | 9 |
| Blender fidelity | 0 (citation integrity CLEAN) | 1 | 1 | 2 |
| **Combined actionable** | **2** | **3** | **5** | **10** |

**Fab streak: RESTORED at 1 (3.B)** — the fidelity audit explicitly
verified all 40 Blender citations against the reference clone and found
NO fab. Quote: "Citation integrity: clean. All 40 Blender line
citations land on the described constructs. No comment-line trap, no
off-by-N, no wrong-function body. The post-3.A preflight discipline
held for 3.B."

The HIGH findings are LOGIC bugs (truncation-vs-floor in stepped;
range-gate against warped time), NOT citation fabs. Different
discipline, same scoring lens.

Architecture agent's 3rd MED was a false alarm: it claimed
`fmodifier.cc:483-497` was a comment-line trap because that range is
the `FMI_ENVELOPE` type-info struct (not the evaluator function body).
But the substrate's dispatch-table comment is INTENTIONALLY citing the
type-info struct (which contains the function pointers), not the
function body — fidelity agent's parallel review independently cleared
the cite. False positive; arch agent misread the intent.

## Audit-fix sweep (commit `11470f3`)

| Finding | Severity | Fix |
|---------|----------|-----|
| HIGH-1: `Math.floor` vs C `int()` truncation in `evaluateSteppedTime` | arch + fidelity LOW-4 | Replaced with `Math.trunc`. For `(evaltime - offset)` negative, the snap-block now matches Blender's int-cast semantics. Regression test 20b verifies. |
| HIGH-2: Time-pass range/influence gates against warped `t` instead of original `evaltime` | arch | Captured `evaltime` separately; both gates now read the original per `:1528-1530` and `:1539`. Regression test 42b verifies (stepped warps t in→out of limits' restricted range → pre-fix returned 600, post-fix returns 900). |
| MED-1: Cycles scratch-handoff silently dropped state when `mod.id` was missing (Rule №1 crutch) | arch | Switched scratch from `Map` keyed by `mod.id` to positional `Array` indexed by modifier position. Closer to Blender's `POINTER_OFFSET(storage->buffer, fcm_index * size_per_modifier)` AND removes the id-missing footgun. Regression tests 48b + 48c verify. |
| MED-3 fidelity: Generator `poly_order=0` guard not ported | fidelity (sub-threshold) | Documented as intentional SS simplification — SS derives degree from `coefficients.length`; the Blender edge case of `poly_order=0 with non-empty coefficients` cannot be expressed in SS's data model. |
| HIGH-1 fidelity (sub-threshold): perlinFbm partial-octave fractional blend missing | fidelity | Documented as safe deviation — `FMod_Noise.depth` is `short` in DNA, fractional depths cannot enter from FModifier eval. |

LOW items (4 from arch; 1 from fidelity) all sub-threshold; not fixed
in this sweep. Sub-threshold transparency captured in the close-out doc.

## SS deviations from Blender (still open, documented)

1. **Noise per-fcurve seeding** — plan §3.E claimed `(fcurveId,
   modifierId, time)`. Blender seeds ONLY on `(modifier params,
   evaltime)`. SS matches Blender; plan claim documented as wrong.
2. **Perlin source** — Blender uses internal hash-based gradient
   (`BLI_noise.hh`); SS uses Ken Perlin's reference permutation table.
   Same FBM math, different sample values bit-for-bit. Acceptable
   because 3.E bakes SS noise at export time — no Blender round-trip.
3. **Cycles head-of-stack constraint** — Blender asserts; SS doesn't
   enforce at evaluator. 3.C UI responsibility.
4. **Generator poly_order=0 with non-empty coefficients** — SS data
   model can't express this Blender edge case. Documented as
   intentional simplification.
5. **perlinFbm partial-octave fractional blend** — SS truncates to
   integer octaves. Safe because `depth` is integer in DNA.

## Queued paths (post-3.B)

| Path | Title | Status |
|------|-------|--------|
| 14 (continued) | **3.C — Properties panel UI** (per-FCurve modifier list: add/remove/reorder/mute/expand; per-type inline data editors) | NEW TOP |
| 14 (continued) | 3.D — Cycles → motion3.json IsLoop export | queued |
| 14 (continued) | 3.E — Noise bake-at-export pipeline | queued |
| 14 (continued) | 3.F — Test-suite buildout (per-modifier + composition tests) | partial (3.B ships 102 baseline; 3.F adds per-modifier deep dives) |
| 14 (continued) | 3.G — Phase 3 exit gate (round-trip + Cubism Viewer load) | queued |
| 13 | Phase 2 owed-manual verification | USER-SIDE |
| 16-27 | (other Phase 5 polish + carry-overs) | queued |
| 33 | Auto-group on fcurve add (closes 5.V Dev 5) | queued |
| 34 | Group-flush helper (closes 5.V Dev 6) | queued |
| 36 | DopeSheet editor + per-editor expand bit | queued |
| 37 | AGRP_MODIFIERS_OFF cascade — now UNBLOCKED post-3.B | queued (downstream of 3.C) |
| 38 | AGRP_CURVES_ALWAYS_VISIBLE pin | queued |
| 60 | Box-select group rows + AGRP_ACTIVE clear (closes 5.LL Dev 4) | queued |

## Lessons

1. **Citation discipline is repeatable. Logic discipline is the next
   frontier.** 3.B's substrate author preflighted 40 Blender cites
   against the reference clone before spawning the fidelity audit; all
   40 verified clean. But the LOGIC of the implementation still had 2
   real bugs (stepped trunc; range-gate against warped time). Lesson:
   citation correctness ≠ logic correctness. Going forward, preflight
   should add a SECOND pass — "walk the evaluator function and confirm
   that the LOGIC matches the cited Blender source, not just that the
   cite exists." Specifically for evaluators: check loop directions,
   accumulator-vs-original variable usage, gate operands.

2. **JS-vs-C numeric semantics keep biting.** HIGH-1 is the second time
   JS `Math.floor` was used where Blender used C `int()` cast. The
   semantic mismatch is subtle (matters only for negative operands) and
   would not have been caught by anyone reasoning from the cite alone
   ("looks like a snap-to-step calculation, JS floor is fine"). **A
   convention worth establishing**: when porting any `int()` cast from
   C, default to `Math.trunc` (not `Math.floor`) unless there's an
   explicit reason floor is correct. Add a memory entry naming this
   convention.

3. **Rule №1 crutch patterns extend to scratch-handoff code, not just
   error handling.** MED-1's `if (mod.id) scratch.set(mod.id, s)` was
   pure Rule №1 — silent fallback that hides real failure (cycyofs=0
   wrong, no warning, no throw). Lesson: any code shape `if (X) write(X,
   value)` where the absent path silently returns a default deserves a
   second look. Either the X must be present (assert/throw) or the
   storage shape should not depend on X at all (use position, or a
   guaranteed-present key).

4. **Architecture audit and fidelity audit catch different things.**
   Fidelity audit explicitly verified all 40 cites and found the
   stepped trunc bug (LOW-4) but didn't connect it to the architecture
   implication. Arch audit found HIGH-2 (range gate against warped
   time) — fidelity didn't flag it because the cites WERE correct;
   only the LOGIC of the SS port diverged. Lesson: keep running both
   audits in parallel for substrate slices; they're complementary, not
   redundant. The arch agent catches "is this code well-designed";
   the fidelity agent catches "does this code claim to match Blender
   and does it actually". A code path can be well-designed without
   matching Blender; matching Blender without being well-designed; or
   neither.

5. **Substrate slices benefit from independent integration tests.**
   The audit-fix sweep added 5 regression tests, all of which test
   compositions rather than per-evaluator correctness. Tests like 42b
   (stepped + limits with range restriction) catch composition bugs
   that per-type tests can't. Lesson: when adding per-type evaluators,
   pair every per-type test with at least one composition test that
   uses the new type alongside another. Composition coverage was the
   pre-audit blind spot.

## Pre-doc state table

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead of origin | **119** (was 117 pre-slice; +2 substrate+audit-fix; +1 this doc) |
| Schema version | v41 (unchanged across this slice — pure runtime) |
| Slices shipped this session | 2 (3.A + 3.B) |
| Per-slice commit count | 2 (substrate + audit-fix) + 1 (this doc) = 3 total for 3.B |
| Dual audits run | 1 (3.B) |
| Audit-fix sweeps | 1 (3.B) |
| Audit findings | 2 HIGH (both arch; one cross-confirmed by fidelity LOW-4) + 3 MED + 5 LOW; total 10 actionable |
| **Fab streak** | **RESTORED at 1 (3.B)** — fidelity audit explicitly cleared all 40 citations |
| Test suites green | all (102 fmodifiers + 35 fcurveEval + 80 fcurveGroups + 75 fcurveActive + 441 fcurveChannelSelect + 41 projectRoundTrip + 61 animationEngine + 42 motion3jsonRoundtrip + 35 exportAnimation + 39 actionExportMotion3 + 37 actionScene + 66 breathFidelity = 1054 assertions verified) |
| Typecheck | clean |
| New files | `scripts/test/test_fmodifiers.mjs` |
| Modified files | `src/anim/fmodifiers.js` (+~600 LOC eval block) + `src/anim/fcurve.js` (4-step pipeline) + `package.json` (test registration) |
| Deviations opened (still tracked) | 5 (Noise size 1000ms default, stepped flag-flip, legacy_noise unmapped, poly_order redundancy from 3.A; perlinFbm partial-octave + Generator poly_order=0 from 3.B) — all documented as intentional SS simplifications |
| Deviations closed | 0 (substrate slice; no pre-existing devs to close) |
| Top queued path | **#14 (continued) — 3.C Properties panel UI** (add/remove/reorder/mute/expand per modifier; per-type inline data editors) |

## Phase 3 progress (post-3.B)

```
Phase 3 — F-Curve modifiers (~1 week per plan)
├─ 3.A — Schema substrate ............ SHIPPED 2026-05-18 (typedefs + v41)
├─ 3.B — Modifier evaluator .......... SHIPPED 2026-05-18 (this slice)
├─ 3.C — Properties panel UI ......... NEW TOP
├─ 3.D — Cycles → IsLoop export ...... queued
├─ 3.E — Noise bake-at-export ........ queued
├─ 3.F — Test-suite buildout ......... queued (3.A + 3.B together ship 143 baseline assertions)
└─ 3.G — Phase exit gate ............. queued
```

## Whole-Animation-Plan progress (post-3.B)

```
Animation Plan — 8 phases:
├─ ✅ Phase 0 — Wire what already exists
├─ ✅ Phase 1 — Action datablock + NodeTree retirement (schema v33)
├─ ✅ Phase 2 — BezTriple handles (schema v34/v39)
├─ 🟡 Phase 3 — F-Curve modifiers (3.A + 3.B SHIPPED v41 + runtime; 3.C..3.G queued)
├─ 🔲 Phase 4 — NLA stack (~1.5 weeks)
├─ 🟡 Phase 5 — Graph Editor write-mode (slices A→NN shipped; surface largely tapped)
├─ 🔲 Phase 6 — Dopesheet write-mode (~3–4 days)
└─ 🔲 Phase 7 — Insert Keyframe + Keying Sets (~3–5 days) + close-out
```

Phase 3 is now ~30% done by slice count (2/7) and ~50% done by load-
bearing weight (typedef + evaluator are the substrate; the remaining 5
slices are UI + 2 export bake passes + tests + exit gate).
