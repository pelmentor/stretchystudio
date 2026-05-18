# Session Closeout — Animation Phase 3 Slice 3.E

**Date:** 2026-05-18
**Branch:** master (127 commits ahead of origin/master)
**Schema:** v41 (no bump — Noise consumption only)
**Status:** SHIPPED — substrate `8277399` + audit-fix `0a15508`

---

## What 3.E ships

Plan §3.E quote:

> `Noise` outputs a Perlin field. … The export pipeline bakes Noise
> modifiers into explicit keyframes at the FPS of the target Action —
> Cubism has no live-noise primitive.

Implementation lives in **[src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js)**:

- **`hasActiveNoiseModifier(fcurve)`** — scans the full modifier stack
  (Noise is value-only with no head-of-stack invariant unlike Cycles); returns
  true if any active (non-muted, non-disabled) Noise modifier is present
  regardless of stack position or `useRestrictedRange`.
- **Extended bake gate** — `shouldBake = hasActiveNoiseModifier(fcurve) ||
  (!loop && hasActiveCyclesModifier(fcurve))`. Noise fires
  **unconditionally** (regardless of `Meta.Loop`); the 3.D Cycles trigger
  is preserved.
- **JSDoc module section** rewritten to document the OR-composition + the
  Cycles+Noise+Loop=true hybrid semantic.

The bake helper `bakeFCurveModifiers` from 3.D is unchanged — it's already
modifier-type-agnostic (calls `evaluateFCurve`, which applies the full
FModifier stack). 3.E's contribution is the trigger gate, not new bake
mechanics.

## Determinism (post-audit-fix correction)

The Perlin field is fully determined by `(size, phase, offset, depth,
lacunarity, roughness, evaltime)` and a hardcoded permutation table.
**No** per-fcurve seed, **no** per-modifier seed — matching Blender's
`fcm_noise_evaluate` at `fmodifier.cc:814-867` exactly. Stable across
saves, across SS process restarts, byte-fidelity-testable by construction.

The original plan-draft + the 3.A FModNoiseData JSDoc both claimed seed
derived from `(fcurveId, modifierId, time)` — **aspirational fab, not
implemented**. The `fmodifiers.js:528-540` block-comment correctly
self-identified the divergence on the implementation side, but the
front-matter JSDoc + the plan doc carried the fab forward. Audit-fix
HIGH-1 corrected both.

## Cycles+Noise semantic (SS deviation)

When an action has uniform Cycles satisfying `Meta.Loop=true` (3.D) AND
one fcurve also has Noise (3.E forces bake on that channel), Cubism's
runtime replays the **same** baked noise samples each loop iteration.
Blender's live behaviour re-evaluates Noise at unwrapped absolute time
per iteration, so each Cycles cycle in Blender shows **different** noise.

**Accepted SS deviation** — Cubism has no live-noise primitive; the only
alternative is to bake a multi-cycle sequence (forcing Loop=false and
losing the runtime-loop efficiency). Documented in plan §3.E with
explicit "SS deviation: Cycles+Noise loop behaviour" callout
(audit-fix MED-1 fid).

## Cite-discipline arc

**Implementation cites all CLEAN** (fidelity audit verified):

- `fmodifier.cc:1568-1569` (forward-walk value pass) — ACCURATE
- `fmodifier.cc:864` (`replace` formula) — ACCURATE
- `fmodifier.cc:814-867` (noise evaluator span) — ACCURATE
- `fmodifier.cc:840` (golden-ratio offset) — ACCURATE
- `fmodifier.cc:807` (depth default 0) — ACCURATE
- `fmodifier.cc:635` (Cycles BLI_assert) — ACCURATE
- `fmodifier.cc:843-848` (Perlin call site) — ACCURATE
- `fmodifier.cc:1455-1488` (eval_fmodifier_influence) — ACCURATE
- `eFMod_Noise_Modifications` enum (`DNA_anim_enums.h:107-116`) — ACCURATE
- `FMod_Noise` struct (`DNA_anim_types.h:163-175`) — ACCURATE

**Fab streak**: BROKEN at 1 in 3.E (plan doc + FModNoiseData JSDoc both
inherited an aspirational seed-shape claim from the original plan draft).
The fab was **self-identified** in fmodifiers.js's block-comment but
left uncorrected in the two surrounding docstring locations. Both fixed
in audit-fix `0a15508`. Streak: 3.B clean → 3.C broken (paragraph fab)
→ 3.D RESTORED → **3.E BROKEN at 1 (plan + JSDoc inheritance)**.

This is a **different failure mode** from 3.C's: 3.C was a fab synthesised
during slice authoring; 3.E inherited a fab from the plan draft and
failed to correct it during the slice that was supposed to implement
the spec. Memory entry needed (see below).

## Dual-audit findings (commit `0a15508`)

### Architecture (3 actionable, 2 LOW)

- **MED-1**: Test §8b asserted `dualMean > singleMean`, fragile to
  Perlin output sign. Replaced with position-by-position mismatch
  counting — the actually-tested property.
- **MED-3**: No test for range-restricted Noise semantic outcome.
  Added §11 pinning bake-fires + outside-range carries baseline +
  inside-range varies.
- **LOW-2**: §7a 25% mismatch threshold replaced with `> 0` (principled
  property test).

### Fidelity (1 HIGH, 1 MED)

- **HIGH-1 (FAB)**: Plan §3.E + JSDoc carried aspirational seed claim.
  Both corrected to actual Blender-faithful input set.
- **MED-1**: Cycles+Noise loop divergence not documented as named SS
  deviation. Plan §3.E updated with explicit callout.

### Not actioned

- **MED-2 (arch)**: Logger.debug emit for Cycles+Noise+Loop=true hybrid
  bake. Skipped per Rule №1 framing: warning about correct behaviour is
  itself a crutch; JSDoc documents the behavior clearly.
- **LOW-1 (arch)**: Truthy-non-boolean `muted`/`disabled` handling
  consistent with 3.D pattern; no fix needed unless schema-level
  assertion is added.

## Test coverage

| File | Before | After | Delta |
|------|--------|-------|-------|
| test_motion3jsonNoiseExport.mjs (NEW) | n/a | 26 | +26 |
| test_motion3jsonCyclesExport.mjs | 42 | 42 | 0 |
| test_actionExportMotion3.mjs | 46 | 46 | 0 |
| test_fmodifiers.mjs | 102 | 102 | 0 |
| test_fcurveModifiersPanelData.mjs | 147 | 147 | 0 |

**New assertions this slice: 26** (substrate 23 → +3 audit-fix).

## Files touched (commits `8277399` + `0a15508`)

| File | Purpose |
|------|---------|
| src/io/live2d/motion3json.js | hasActiveNoiseModifier + extended bake gate + module JSDoc |
| src/anim/fmodifiers.js | FModNoiseData JSDoc fab corrected (HIGH-1) |
| scripts/test/test_motion3jsonNoiseExport.mjs | NEW — 26 assertions |
| docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md | §3.E marked SHIPPED + fab corrected + SS deviation added |
| package.json | test:motion3jsonNoiseExport entry + aggregate |

## SS deviations still open

3.E opens **1 new** SS deviation:

- **Cycles+Noise+Loop=true** — Cubism replays the SAME baked noise
  samples each loop iteration; Blender re-evaluates per cycle (different
  noise each time). Cubism format constraint. Documented in plan §3.E.

Inherited: **10 from 3.A/3.B/3.C** + **0 from 3.D** = **11 open total
across Phase 3** (count includes the new 3.E deviation).

## UI manual verification pending (cumulative with 3.D)

Per `feedback_no_background`, did NOT start dev server unprompted. 3.E
adds the following to the 3.D verification checklist:

1. Add a Noise modifier (anywhere in the stack — head, middle, or end)
   to a fcurve in a non-looping action. Export `.motion3.json`. Confirm
   the curve in the exported JSON has many more segments than the source
   keyform count (bake fired).
2. Set Noise modifier `muted=true` in the UI. Re-export. Confirm bake
   does NOT fire (segment count matches source keyforms).
3. Cycles+Noise: set up an action with uniform Cycles {after='repeat'}
   on every fcurve, then add a Noise modifier on one fcurve. Export.
   Confirm `Meta.Loop=true` (Cycles uniform predicate still satisfied)
   AND the Noise-bearing fcurve is baked while the Cycles-only fcurves
   ship as-authored.
4. Determinism: export the same action twice. Diff the two JSON outputs;
   they should be byte-identical.

## Top queued path next session

**3.F — Per-type test parity sweep** (per plan §3.F):

Plan lists 8 dedicated test files (`test_fmodifiers_cycles.mjs`,
`test_fmodifiers_noise.mjs`, `test_fmodifiers_generator.mjs`,
`test_fmodifiers_limits.mjs`, `test_fmodifiers_stepped.mjs`,
`test_fmodifiers_envelope.mjs`, `test_fmodifiers_stack.mjs`,
`test_fmodifiers_export_bake.mjs`).

Most of these are already substantially covered by `test_fmodifiers.mjs`
(102 assertions cover all 6 modifier types in the eval substrate +
composition + edge cases). The 3.F sweep will:
- Audit coverage gaps in the existing `test_fmodifiers.mjs` against the
  per-type test plan.
- Split if the consolidated file is too dense, or extend if gaps exist.
- Add the explicit `test_fmodifiers_export_bake.mjs` covering
  Noise-baked-at-export byte-identity vs hand-baked motion3.json
  (the byte-fidelity gate per plan §3.F).

After 3.F: 3.G (phase exit gate: Cubism Viewer load of Cycles-bearing
motion + round-trip verification). Phase 3 SHIP-COMPLETE marker on the
plan doc requires both 3.F + 3.G + manual UI verification.

---

**Commits this slice (2):**
- `8277399` — feat(anim): Phase 3 Slice 3.E — Noise → motion3.json unconditional bake
- `0a15508` — fix(audit): Phase 3 Slice 3.E audit-fix — 1 HIGH (plan+JSDoc fab) + 3 MED + 1 LOW
