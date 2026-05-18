# Session Closeout — Animation Phase 4 Slice 4.B (NLA EVALUATOR SHIPPED)

**Date:** 2026-05-18
**Branch:** master (141 commits ahead of origin/master, +2 this slice)
**Schema:** v42 (no bump — eval module only consumes 4.A substrate)
**Status:** SHIPPED — substrate `d91060d` + audit-fix `8d03d4c`
**Phase 4:** 2/7 slices complete

---

## What 4.B ships

Plan §4.B spec items (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1297`):

1. **`evaluateNla(animData, time, project) → Map<rnaPath, value>`** — ✅
   `src/anim/nlaEval.js`
2. **Track ordering bottom-to-top** — ✅ `tracksBottomToTop()` helper
   sorts by ascending `index`
3. **Mute / solo gating** — ✅ `isTrackEnabled` ports
   `BKE_nlatrack_is_enabled` (Blender nla.cc:690-697) byte-faithfully
   + handles `NLATRACK_DISABLED`
4. **Strip activation (extendmode)** — ✅ `stripActiveAt` for hold /
   hold_forward / nothing
5. **Strip time remap** — ✅ `remapStripTime` ports
   `nlastrip_get_frame_actionclip` (nla.cc:707-770) including
   scale / repeat / REVERSE / end-pin
6. **Strip influence** — ✅ `computeStripInfluence` ports
   `nlastrip_get_influence` (anim_sys.cc:1009-1027) with blendin /
   blendout ramps + USR_INFLUENCE override
7. **USR_TIME flag** — ✅ wired during audit-fix MED-F4
   (anim_sys.cc:1059-1071); supports USR_TIME_CYCLIC wrap
8. **4 blend mode kernels** — ✅ `applyBlendMode` byte-faithful to
   `nla_blend_value` (anim_sys.cc:1841-1873): replace / add /
   subtract / multiply
9. **Tweak-mode strip skip** — ✅ stub for Slice 4.C: the strip
   identified by `animData.tweakStripId` is skipped during walk
10. **`NLA_EVAL_OFF` short-circuit** — ✅ bypasses entire walker

Concretely:

- **NEW [src/anim/nlaEval.js](../../src/anim/nlaEval.js)** (~530 LOC after audit-fix)
  — 5 public exports + 6 internal helpers; all pure functions; ms
  canonical; no allocations beyond the single accumulator Map.

- **NEW [scripts/test/test_nlaEval.mjs](../../scripts/test/test_nlaEval.mjs)** (~720 LOC, 86 asserts across 29 sections)

## Cite-discipline arc

**HOLDS at 4** (3.F → 3.G → 4.A → 4.B all clean). Blender-fidelity
audit verified every cited file + line range + content match:

- `nla.cc:690-697` (BKE_nlatrack_is_enabled) — ACCURATE
- `nla.cc:707-770` (nlastrip_get_frame_actionclip) — ACCURATE
- `nla.cc:749` (reverse formula) — ACCURATE
- `nla.cc:759-764` (end-pin) — ACCURATE
- `nla.cc:769` (forward formula) — ACCURATE
- `anim_sys.cc:1009-1027` (nlastrip_get_influence) — ACCURATE
- `anim_sys.cc:1841-1873` (nla_blend_value all 4 kernels) — ACCURATE
  (incl. multiply operand order fp-associativity preserved)
- `anim_sys.cc:1086-1148` (extendmode + multi-strip awareness) —
  ACCURATE; SS simplification (per-strip no-neighbor-awareness)
  documented as substrate scope
- `anim_sys.cc:1180` (zero-influence skip) — ACCURATE
- `anim_sys.cc:1059-1071` (USR_TIME / USR_TIME_CYCLIC) — ACCURATE
  (wired during audit-fix MED-F4)
- `DNA_anim_enums.h:557` (ADT_NLA_EVAL_OFF) — ACCURATE
- `DNA_anim_enums.h:559` (ADT_NLA_EDIT_ON) — ACCURATE

Fab streak: 5.P broke at 0 → 3.F HOLDS at 1 → 3.G HOLDS at 2 → 4.A
HOLDS at 3 → **4.B HOLDS at 4**.

## Dual-audit findings (commit `8d03d4c`)

### Architecture (3 HIGH + 4 MED + 1 LOW — 2 HIGH + 4 MED + 1 LOW addressed)

- **HIGH-A1**: `blendStripIntoAccumulator` cloned the accumulator
  Map per strip (`const next = new Map(acc)`) — O(n_strips × n_channels)
  allocation per `evaluateNla` call with no purity benefit (caller
  immediately reassigned). **Fix**: mutate `acc` in place, return
  void; single Map allocated at top of `evaluateNla`.

- **HIGH-A2**: `if (tweakStripId && strip.id === tweakStripId)` — the
  `&&` falsy guard silently bypassed the skip when `tweakStripId === ''`
  (possible from raw-deserialized animData or hand-edited JSON).
  **Fix**: strict `string && length > 0` validation hoisted into a
  typed `tweakStripId` const; skip uses `!== null` check.

- **HIGH-A3 INVALID**: Auditor claimed overlapping blendin+blendout
  ramps picked wrong one due to "missing else". Re-read of Blender
  `nlastrip_get_influence` shows two separate `if`s with early
  `return` (structurally equivalent to else-if) — SS already matches.
  **Action**: added §26 test to LOCK IN the correct behavior so it
  can never regress silently. No code change.

- **MED-A4**: `applyBlendMode` default-fallback was a Rule №1 silent
  fallback at the boundary. **Fix**: validate `strip.blendmode`
  against `NLA_BLEND_MODES` in `evaluateNla` BEFORE calling the
  kernel; throw on unknown with strip id + bad mode + valid set +
  'combine deferred' callout. Kernel stays hot-path-clean matching
  Blender's own `default → LERP`.

- **MED-A5**: `influence <= 0` skip more aggressive than Blender's
  `IS_EQF`. Documented inline as intentional Rule №1 safety against
  hand-edited corrupt strip data. No code change.

- **MED-A6**: No immutability test for `evaluateNla`. Added §28 that
  deep-freezes inputs + verifies 3 calls don't throw + JSON-round-
  trip equal.

- **MED-A7**: No overlapping blendin/blendout test. Folded into §26.

- **LOW-A8**: No E2E test for `hold_forward` past-end pipeline. Added
  §29 covering both past-end (clamp + remap to actend) and before-
  start (skipped — hold_forward doesn't extend backward).

### Fidelity (1 MED + 2 MED-acceptable + 7 LOW — 1 wire + 8 acknowledged)

- **MED-F4**: `USR_TIME` flag was exposed in substrate (Slice 4.A) but
  evaluator ignored it — Rule №1 violation (half-finished API).
  **Fix**: wired into `remapStripTime`. Per-strip FCurve with
  `rnaPath === 'strip_time'` becomes action-local time directly,
  bypassing scale/repeat. USR_TIME_CYCLIC wraps back into
  [actstart, actend) via positive modulo. Added §27 tests.

- **MED-F3** (computeStripInfluence precedence): auditor verified
  USR_INFLUENCE-beats-blendin/out precedence IS preserved — was
  clarification, not finding. No action.

- **MED-F5** (stripActiveAt multi-strip awareness): documented as
  intentional substrate scope. Will revisit in Slice 4.D if
  NLAEditor surfaces multi-strip-per-track gaps.

- **7 LOW** (epsilon divergence, mod() vs fmodf, isTrackEnabled fold,
  lower-value=0, etc): all acceptable / already documented.

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_nlaEval.mjs (NEW this slice) | n/a | 86 | +86 |

Section breakdown (29 sections post-audit-fix):

| § | Asserts | Coverage |
|---|---|---|
| 1 | 8 | applyBlendMode kernel math, all 4 modes (byte-faithful) |
| 2 | 8 | applyBlendMode influence-zero early-out |
| 3 | 4 | remapStripTime forward no-scale-no-repeat |
| 4 | 2 | remapStripTime scale != 1 |
| 5 | 3 | remapStripTime repeat > 1 + end-pin |
| 6 | 3 | remapStripTime REVERSE flag |
| 7 | 1 | remapStripTime non-integer repeat does NOT pin actend |
| 8 | 3 | computeStripInfluence baseline (no ramps) |
| 9 | 4 | computeStripInfluence blendin ramp |
| 10 | 3 | computeStripInfluence blendout ramp |
| 11 | 5 | computeStripInfluence USR_INFLUENCE override + clamp |
| 12 | 11 | stripActiveAt all 3 extendmodes + zero-length |
| 13 | 3 | evaluateNla empty animData safety |
| 14 | 2 | evaluateNla single strip replace |
| 15 | 1 | evaluateNla two strips replace + add stacked |
| 16 | 1 | evaluateNla muted strip skipped |
| 17 | 1 | evaluateNla muted track skipped |
| 18 | 3 | evaluateNla solo track wins |
| 19 | 1 | evaluateNla NLATRACK_DISABLED skipped |
| 20 | 1 | evaluateNla NLA_EVAL_OFF bypasses walker |
| 21 | 1 | evaluateNla tweak-mode skips tweakStripId |
| 22 | 1 | evaluateNla blendin ramp at strip boundary |
| 23 | 1 | evaluateNla bottom-up index ordering |
| 24 | 2 | evaluateNla throws on combine; kernel still Blender-tolerant (MED-A4) |
| 25 | 1 | tweakStripId='' regression (HIGH-A2) |
| 26 | 3 | overlapping blendin+blendout lock-in (HIGH-A3 + MED-A7) |
| 27 | 4 | USR_TIME + USR_TIME_CYCLIC byte-faithful (MED-F4) |
| 28 | 3 | evaluateNla immutability on deep-frozen inputs (MED-A6) |
| 29 | 2 | hold_forward past-end E2E pipeline (LOW-A8) |

## Files touched (commits `d91060d` + `8d03d4c`)

| File | Purpose |
|------|---------|
| src/anim/nlaEval.js | NEW — NLA stack walker + 4 blend kernels + time remap + influence + tweak-mode skip |
| scripts/test/test_nlaEval.mjs | NEW — 86 asserts across 29 sections |
| package.json | test:nlaEval entry + aggregate addition |

## SS deviations from Blender (documented)

This slice introduces **3 documented deviations** (all with
re-litigation gates):

1. **Lower-value default = 0** for absent rnaPath in accumulator
   (Blender uses channel's RNA-resolved default). Phase 4.E motion3.json
   export will pre-seed accumulator with param defaults if needed.

2. **Multi-strip per-track HOLD inter-strip awareness simplified**
   (per-strip independent vs Blender's prev/next-strip-aware
   `nlastrips_ctime_get_strip`). Slice 4.D NLAEditor may refine when
   it surfaces multi-strip tracks with gaps.

3. **`influence <= 0` skip more aggressive than Blender's `IS_EQF`**.
   Rule №1 safety against hand-edited corrupt strip data — defensible
   as constructor-validation-gate ↔ evaluator-defense-net layering.

Inherited from Slice 4.A unchanged: 2 deviations
(`makeNlaStrip.flag = 0` vs Blender `SELECT|SYNC_LENGTH`;
`makeNlaTrack.flag = 0` vs Blender `SELECTED|OVERRIDELIBRARY_LOCAL`).

**Phase 4 cumulative deviations: 5 (2 from 4.A + 3 from 4.B)**.

## Plan-doc updates

`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4.B + §Phase 4
ship-status banner updated:
- Slice 4.B SHIPPED 2026-05-18 (commits `d91060d` + `8d03d4c`)
- 2/7 slices complete; remaining 4.C / 4.D / 4.E / 4.F / 4.G
- Cite-discipline HOLDS at 4

## Top queued path next

**Slice 4.C — Tweak mode** (~1-2 days projected):

Plan §4.C (line 1333):
> When the user opens an Action for editing while it's bound to an NLA
> strip, Blender enters "tweak mode": the Action becomes the topmost
> implicit track and edits write directly to the Action; the NLA stack
> below is rendered as the underlay.

Concretely:
- Implementation helpers paralleling Blender's
  `BKE_nla_tweakmode_enter` / `BKE_nla_tweakmode_exit` /
  `BKE_nla_tweakmode_clear_flags` (in `BKE_nla.hh`).
- Wire `animData.flag |= ADT_NLA_EDIT_ON` on entry; store pre-tweak
  action in `animData.tmpActionId` + `tmpSlotHandle` (substrate
  shipped in 4.A); set `animData.tweakStripId` + `tweakTrackId`.
- Update evaluator (4.B's tweak-skip becomes "skip but inject topmost
  implicit layer") — adds the tweak strip's action as a virtual
  REPLACE strip at index = max + 1 with influence = 1.
- Tweak entry rollback (Cancel) restores from backup pointers; Exit
  clears flags + backup pointers.

Slice 4.C blockers: none. 4.A substrate's backup pointers + flag
enums are ready; 4.B's tweak-skip leaves the necessary opening.

Phases 4.D (NLAEditor UI) / 4.E (BakeNLA operator) / 4.F (tests
sweep) / 4.G (exit gate) follow.

---

**Commits this slice (2):**
- `d91060d` — feat(anim): Phase 4 Slice 4.B — NLA evaluator (evaluateNla + blend kernels)
- `8d03d4c` — fix(audit): Phase 4 Slice 4.B audit-fix — 2 HIGH + 4 MED + 1 LOW + USR_TIME wire + cite-discipline HOLDS at 4

**Phase 4 progress: 2/7 slices.**

**Closes:** 0 grievances (evaluator-only; full Phase 4 closes 1
grievance — "no NLA stack"). Evaluator ready for Slice 4.C tweak-mode
topmost-layer injection + 4.E BakeNLA consumption.
