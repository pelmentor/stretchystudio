# Session Closeout — Animation Phase 3 Slice 3.D

**Date:** 2026-05-18
**Branch:** master (124 commits ahead of origin/master)
**Schema:** v41 (unchanged from 3.A; no schema bump for 3.D — modifier consumption, not new field)
**Status:** SHIPPED — substrate `86286c0` + audit-fix `28a8d1c`

---

## What 3.D ships

Plan §3.D quote:

> the Cubism `.motion3.json` format has `IsLoop: bool` on the metadata
> and re-evaluates the curve modulo duration. Map: presence of a
> `Cycles` modifier with `before='none', after='repeat', afterCycles=0`
> on every FCurve in an Action → `IsLoop: true` in the exported
> motion3.json. If only some FCurves cycle, bake the cycles into
> explicit keyframes at export time.

Implementation lives in two files:

- **[src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js)** — exporter.
  Replaces the legacy `Loop = true` hardcoded default (Stage 1.F deviation) with
  `actionHasUniformLoopingCycles(action)`. The bake helper
  `bakeFCurveModifiers(fcurve, durationMs, fps)` samples the full FModifier stack
  via `evaluateFCurve` at the action FPS when the action isn't uniformly looping.
- **[src/io/live2d/motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js)** —
  round-trip companion. When `Meta.Loop=true` on import, every fcurve gets a
  head-of-stack `{type:'cycles', data:{after:'repeat'}, id: uid()}` modifier so the
  re-export gate sees the signal. Loop=true → Loop=true round-trip is now
  byte-identical for Cubism-authored loop motions.

The bake helper applies the **full** FModifier stack (Cycles + Noise + Generator +
Limits + Stepped + Envelope) since it calls `evaluateFCurve`. The 3.D **trigger**
is narrow: bake only when fcurve has an active (non-muted, non-restricted,
non-disabled) Cycles modifier AND the action isn't uniformly looping. Slice 3.E
(Noise) will add an unconditional bake trigger for Noise modifiers; until then,
non-Cycles modifiers on non-Cycles fcurves are silently dropped from export
(documented in the module JSDoc "Bake scope" section).

## Behaviour change

The legacy `Loop = true` default is **removed**. Actions without any Cycles
modifier now export `Meta.Loop = false`. This affects only `generateMotion3Json`
callers; the idle generator bypasses this path via `buildMotion3` and is
unaffected. Two callers exist in production: the standalone .motion3.json zip
export in `ExportModal.jsx` (handleMotion3Export), and the multi-action exporter
in `exporter.js`. Both inherit the new semantics; UI verification owed (see
below).

## Cite-discipline arc

**RESTORED at 1**. Fidelity audit (a5601bfd04274c067) verified every Blender
citation in the 3.D commit against `reference/blender/` directly:

- `fmodifier.cc:635` (`BLI_assert(fcm->prev == nullptr)`) — confirmed
- `fcurve.js:155` (evaluateFCurve start) — confirmed
- `v36_action_datablock.js:325-329` — confirmed (cite points to SS file, not Blender DNA header)
- `rna_fcurve.cc:1531+` (eFMod_Cycling_Modes UI labels) — confirmed
- `evaluate_time_fmodifiers` at `fmodifier.cc:1490` — confirmed
- `DNA_action_types.h:374-387` (eAction_Flags) — confirmed
- `fmodifier.cc:1455-1488` (eval_fmodifier_influence, added in audit-fix MED-1 comment) — confirmed

Fab streak: BROKEN at 3 (3.A) → RESTORED at 1 (3.B, clean) → BROKEN at 1 (3.C,
prose fab) → **RESTORED at 1 (3.D, clean)**.

## Dual-audit findings (commit `28a8d1c`)

### Architecture (3 actionable)

- **H-1**: `bakeFCurveModifiers` left `driver` on the returned shallow-clone
  alongside baked keyforms. `evaluateFCurve` folds the driver into each sample,
  so downstream re-eval would fire it twice. Fixed by stripping `driver`
  alongside `modifiers` in the destructure.
- **H-2**: `repeat_offset` and other non-loop Cycles modes pass through the bake
  gate (correct), but no test asserted this; the existing §4a test was confined
  to `before='repeat'`. Added test §17 for `repeat_offset` bake-fires + gradient
  waveform sampling. JSDoc on `bakeFCurveModifiers` now explicitly states
  modifier-presence-based gate semantics.
- **M-1**: `durationMs=0` produced two coincident keyforms via the
  `Math.max(2, sampleCount)` floor — Rule №1 silent-fallback shape. Fixed by
  early-returning the original fcurve unchanged when `durationMs <= 0`.

### Fidelity (2 actionable)

- **MED-1**: `useInfluence` comment was incomplete; expanded to cite
  `fmodifier.cc:1455-1488` and explain why `useInfluence=true, influence===1`
  is correctly accepted as a clean loop signal.
- **MED-2**: `attachLoopCyclesModifier` synthesised a Cycles modifier without
  an `id` field. FModifier typedef requires `id: string` (fmodifiers.js:117);
  3.C UI panel reads `modifier.id` for row keys + active highlight. Fixed by
  threading `opts.uid` through to the helper.

### Non-action

- Architecture M-3 (audit-pin §1 comment narration about "deferred ACT_CYCLIC
  wiring") is load-bearing, not stale. No change.

## Test coverage

| File | Before | After | Delta |
|------|--------|-------|-------|
| test_motion3jsonCyclesExport.mjs (NEW) | n/a | 42 | +42 |
| test_actionExportMotion3.mjs | 36 | 46 | +10 |
| test_audit_fixes_2026_05_11_phase1_stage1f.mjs | 44 | 44 | 0 (§1 re-pinned) |
| test_motion3jsonRoundtrip.mjs | 42 | 42 | 0 (no change needed) |
| test_motion3json.mjs | 33 | 33 | 0 |
| test_idleBuilder.mjs | 40 | 40 | 0 |
| test_fmodifiers.mjs | 102 | 102 | 0 |
| test_fcurveModifiersPanelData.mjs | 147 | 147 | 0 |

**New assertions this slice: 52** (42 in dedicated file + 10 extended).

## Files touched (commits `86286c0` + `28a8d1c`)

| File | Purpose |
|------|---------|
| src/io/live2d/motion3json.js | Loop signal source + bake helper + JSDoc rewrite |
| src/io/live2d/motion3jsonImport.js | Round-trip companion (loop→Cycles synth) |
| scripts/test/test_motion3jsonCyclesExport.mjs | NEW — 42 assertions |
| scripts/test/test_actionExportMotion3.mjs | §5 rewritten (10 sub-asserts for Cycles predicate) |
| scripts/test/test_audit_fixes_2026_05_11_phase1_stage1f.mjs | §1 re-pinned to 3.D semantics |
| docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md | §3.D marked SHIPPED with impl details |
| package.json | test:motion3jsonCyclesExport entry + aggregate |

## SS deviations still open

3.D opens **0 new** SS deviations; all behaviour is direct Blender-port:

- The IsLoop predicate's binary nature reflects Cubism's format constraint
  (`Meta.Loop: bool`) — not an SS choice.
- `before='none'` requirement for IsLoop matches Cubism's forward-only loop
  semantic (Cubism wraps at t > Duration; doesn't extrapolate backward).
- Range-restricted Cycles disqualified from both IsLoop and bake-trigger —
  the scoped semantic doesn't map cleanly to Cubism, and a partial bake would
  silently drop the cycling intent. Future refinement (Phase 5+) could
  selectively bake the scoped region; out of 3.D scope.

Inherited from 3.A/3.B/3.C: **10 still-open intentional deviations** documented
in those slices' close-outs (Smooth/FN_Generator deferred, FMODIFIER_FLAG_EXPANDED
deprecated, sparse-defaults convention, etc.).

## UI manual verification pending

Per `feedback_no_background`, did NOT start dev server unprompted. User needs to:

1. Run `npm run dev`.
2. Create or load an action with at least one fcurve.
3. Open FCurve Editor, press `N` for the N-panel, expand the new "Modifiers"
   section.
4. **Loop=true path**: Add a `Cycles` modifier (head-of-stack), set
   `after='repeat'`. Export via the .motion3.json zip flow (ExportModal). Open
   the exported JSON in a text editor; confirm `Meta.Loop: true`. Reload in
   Cubism Viewer; confirm the motion loops cleanly.
5. **Bake path**: Add a `Cycles` modifier to one fcurve only (multiple fcurves
   in the action). Export. Confirm `Meta.Loop: false` AND the cycling fcurve's
   `Curves[].Segments` array is significantly longer than its keyform count
   would suggest (bake fired, ~FPS × duration samples).
6. **Round-trip**: Import a Cubism motion with `Meta.Loop=true` (e.g. Hiyori's
   `hiyori_m01.motion3.json`). Open one of its fcurves in FCurve Editor + N-panel.
   Confirm a `Cycles` modifier is present at the head of the stack with
   `after=Repeat Motion` label. Re-export and confirm `Meta.Loop: true`
   survives.
7. **Cubism Viewer load**: feed a known-good 3.D export to Cubism Viewer 5.0 and
   verify the loop boundary is seamless.

## Top queued path next session

**3.E — Noise → motion3.json bake** (per plan §3.E):

> The export pipeline bakes Noise modifiers into explicit keyframes at the FPS
> of the target Action — Cubism has no live-noise primitive.

3.E will:
- Add `hasActiveNoiseModifier(fcurve)` to the bake trigger gate in
  `motion3json.js` (OR-composes with `hasActiveCyclesModifier`).
- Reuse the existing `bakeFCurveModifiers` helper — it's already
  modifier-type-agnostic (audit-fix H-2 documentation pinned this).
- Add `test_motion3jsonNoiseExport.mjs` with seeded-determinism assertions.
- Per plan §3.E: the Perlin seed must derive from `(fcurveId, modifierId, time)`
  so noise is stable across saves and byte-fidelity-testable. The seed
  derivation lives in 3.B's `evaluateNoiseValue`; 3.E just wires the bake.

After 3.E: 3.F (per-type tests, mostly already covered by 3.B's 102 asserts) +
3.G (phase exit gate: Cubism Viewer load of a Cycles-bearing motion + round-trip
verification).

---

**Commits this slice (2):**
- `86286c0` — feat(anim): Phase 3 Slice 3.D — Cycles → motion3.json Meta.Loop + per-fcurve bake
- `28a8d1c` — fix(audit): Phase 3 Slice 3.D audit-fix — 2 HIGH + 2 MED + cite-streak RESTORED
