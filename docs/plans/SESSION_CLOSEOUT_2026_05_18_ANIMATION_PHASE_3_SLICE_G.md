# Session Closeout — Animation Phase 3 Slice 3.G (PHASE 3 SHIP-COMPLETE)

**Date:** 2026-05-18
**Branch:** master (135 commits ahead of origin/master, +2 this slice)
**Schema:** v41 (no bump — test-only slice + docs)
**Status:** SHIPPED — substrate `2a11be6` + audit-fix `259948a`
**Phase 3:** SHIP-COMPLETE (7/7 slices)

---

## What 3.G ships

Plan §3.G has 3 gate items:

1. **All FModifier tests green** — ✅ 270 assertions across 6 files
2. **Cubism Viewer load of Cycles-bearing motion3.json → loops** — user-side
3. **Round-trip: cycle-modifier on save → load → save preserves modifier** — ✅ automated

Concretely:

- **NEW [scripts/test/test_fmodifierRoundTrip.mjs](../../scripts/test/test_fmodifierRoundTrip.mjs)**
  — 32 assertions covering the SS-authored → JSON → import → re-export
  direction (test_motion3jsonCyclesExport §14/§15 already covered the
  opposite direction). 7 sections:
  - §1 SS-uniform-Cycles round-trip byte-identical incl. Cycles
    preservation on every imported fcurve (5 asserts)
  - §2 Loop=false trivial round-trip (4 asserts)
  - §3 Mixed-Cycles lossy case (post-stabilisation idempotence) (3 asserts)
  - §4 Cycles+Noise hybrid (Loop=true preserved + Noise determinism) (4 asserts)
  - §5 Noise-only (no Loop signal to lose) (2 asserts)
  - §6 SS project-store layer: JSON.parse(JSON.stringify) preserves
    cycles + noise + limits modifier stack with mixed mute/disable
    fields (4 asserts)
  - §7 Two consecutive saves of identical action byte-identical (1 assert)
  - Plus 9 sub-assertions for per-fcurve modifier-presence checks

- **NEW [docs/plans/PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md)**
  — ~25–35 min user-side sweep consolidating 3.C/3.D/3.E deferred items
  into a single end-to-end checklist:
  - §1 (3.C UI): N-panel Modifiers section — add 6 types, edit fields,
    mute/disable, remove/reorder, undo/redo, expand-collapse persistence
  - §2 (3.D Cycles): uniform → Loop=true, mixed → Loop=false+bake,
    no-Cycles → Loop=false, Cubism-motion-import round-trip, Cubism
    Viewer seamless loop
  - §3 (3.E Noise): bake fires, muted skips, Cycles+Noise hybrid,
    determinism
  - §4: Cubism Viewer integration items consolidated

- **[docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](ANIMATION_BLENDER_PARITY_PLAN.md)**
  Phase 3 SHIP-COMPLETE banner at line 953 + §3.G expansion at line 1180
  with full gate-coverage table.

## Time-precision finding (load-bearing for §3/§4/§5 idempotence framing)

Documented in §3.G plan-doc expansion:

> SS canonical time is INTEGER MILLISECONDS
> (`feedback_ms_canonical_animation_time` — Phase 0.0 of the parity
> plan). The bake helper samples at `stepMs = 1000/fps`, which is
> fractional for non-divisor FPS (e.g. 30fps → 33.333... ms). The first
> motion3.json export carries those fractional times verbatim (seconds
> with full fp precision); importing snaps them to integer ms via
> `Math.round(seg[0] * 1000)`. So a single round-trip is NOT
> byte-identical for baked outputs — the second export carries times
> like `0.033` instead of `0.03333...`. After stabilisation (i.e. from
> the second export onward), subsequent round-trips ARE byte-identical.

This is a SEMANTIC FINDING surfaced by the round-trip test, not a bug.
Properly attributed to the deliberate ms-canonical time policy. The
assertions assert export-3 ≡ export-2 (idempotence-after-stabilisation)
rather than the impossible single-pass byte-identity.

## Cite-discipline arc

**HOLDS at 2** (3.F clean → 3.G clean — no new fabs). Fidelity audit verified:

- `fmodifier.cc:635` (`BLI_assert(fcm->prev == nullptr)` — head-of-stack invariant) — ACCURATE
- `fmodifier.cc:814-867` (`fcm_noise_evaluate`) — ACCURATE
- `motion3jsonImport.js:313-320` (`attachLoopCyclesModifier` shape) — matches §1 fixture exactly
- `motion3jsonImport.js:202+` (`Math.round(seg[0] * 1000)` — ms snap) — verified live

The 3.G plan-doc + checklist + test JSDoc introduced **no new Blender
citations** to add fab risk. The slice is pure test + docs over
existing substrate cited at 3.A-3.F.

Fab streak: 3.B clean → 3.C broken (paragraph fab) → 3.D RESTORED →
3.E BROKEN (inheritance fab) → 3.F HOLDS at 1 → **3.G HOLDS at 2**.

## Dual-audit findings (commit `259948a`)

### Architecture (1 MED + 2 LOW addressed)

- **MED-2**: §6 JSDoc overstated "future-proofing" coverage. Tightened
  to explicit "catches plain-data shape divergence; does NOT catch
  class-instance-with-toJSON or post-parse-injected fields" callout.
- **LOW** (was auditor's MED-1): `pureOne.Segments.length === 5`
  is the only exact-count assertion in the file. Added inline comment
  documenting the encoding so a future fixture-default change produces
  a comprehensible failure.
- **LOW-2** (checklist): §2.4 Hiyori-runtime-motion dependency wasn't
  marked optional. Marked OPTIONAL with 3 fallback candidates including
  self-seeding from §2.1.

Architecture LOW-1 (counter-reset between idempotence passes) was
confirmed HARMLESS by the auditor (ids never enter the motion3.json
domain being compared). No fix.

### Fidelity (1 MED DISMISSED)

- **MED-1 (DISMISSED)**: Fidelity auditor speculated "~103/43/27/48"
  assertion counts without measuring. Live recount via the same test
  runners I'd already used confirms exactly **270** (106 + 18 + 32 + 42
  + 26 + 46). Plan-doc table left unchanged. No code change.

Audit-fix LOW for §6: kept the JSON.stringify-based assertion (sound
for today's plain-data modifier shape under V8/Node) rather than
swapping in a deep-equal helper — Rule №1: no defensive complexity for
hypothetical class-instance modifiers that don't exist.

## Test coverage

| File | Before | After | Delta |
|------|--------|-------|-------|
| test_fmodifierRoundTrip.mjs (NEW) | n/a | 32 | +32 |

**New assertions this slice: 32**.

**Cumulative Phase 3 FModifier-suite assertions:** 270
  - test_fmodifiers.mjs: 106
  - test_fmodifiersExportBake.mjs: 18
  - test_fmodifierRoundTrip.mjs: 32 (NEW this slice)
  - test_motion3jsonCyclesExport.mjs: 42
  - test_motion3jsonNoiseExport.mjs: 26
  - test_actionExportMotion3.mjs: 46

## Files touched (commits `2a11be6` + `259948a`)

| File | Purpose |
|------|---------|
| scripts/test/test_fmodifierRoundTrip.mjs | NEW — 32 round-trip + project-store + determinism asserts |
| docs/plans/PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md | NEW — consolidated user-side sweep doc |
| docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md | Phase 3 SHIP-COMPLETE banner + §3.G expanded |
| package.json | test:fmodifierRoundTrip entry + aggregate addition |

## SS deviations still open

3.G opens **0 new** SS deviations. Inherited: **11 from 3.A/3.B/3.C/3.D/3.E**
(unchanged — 3.G is test-only + docs, no behavior change).

## UI manual verification

OWED by user — consolidated into
[PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md).
Single ~25–35 min sweep using existing Shelby project state. Covers
3.C/3.D/3.E UI items + Cubism Viewer integration tests previously
deferred per `feedback_no_background`.

## Top queued path next session

**Phase 4 — NLA stack** (plan §Phase 4, 1.5 weeks, schema v35-aspirational
(actual will be v42+ given current state)):

> Multi-action composition with blend modes, time remapping, and
> tweak-mode push.

Phase 4 ships 4 blend modes (`combine` REMOVED per audit-driven v2 change
— Rule №1 violation to silently degrade combine to replace for
non-rotation channels). Renamed `ANIM_TWEAK_MODE` → `ADT_NLA_EDIT_ON`
matching Blender DNA_anim_enums.h:553-587. AnimData backup pointers
wired (substrate already in animData shape from Phase 1).

Phase 4 is a longer phase (~1.5 weeks projected) versus Phase 3's 1
week. The grievance closed: zero NLA support today.

Optionally, before Phase 4 opens, user-side Phase 3 manual verification
sweep can run at any time — its result is a separate "Phase 3 audible
behaviour confirmed" milestone, independent of substrate work.

---

**Commits this slice (2):**
- `2a11be6` — feat(anim): Phase 3 Slice 3.G — Phase exit gate (round-trip test + manual checklist)
- `259948a` — fix(audit): Phase 3 Slice 3.G audit-fix — 1 MED + 2 LOW + cite-streak HOLDS at 2

**Phase 3 grand total (1 day, 7 slices, 14 commits including close-outs):**
- 3.A schema v41 substrate
- 3.B live two-pass evaluator
- 3.C modifier-stack N-panel UI
- 3.D Cycles → motion3.json Meta.Loop + per-fcurve bake
- 3.E Noise → motion3.json unconditional bake
- 3.F per-type test parity sweep
- 3.G Phase exit gate (this slice)

**Closes:** 1 grievance (no FModifiers). Phase 3 → SHIP COMPLETE.
