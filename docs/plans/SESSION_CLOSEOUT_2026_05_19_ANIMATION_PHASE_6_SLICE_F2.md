# Session Close-out — Animation Phase 6 Slice 6.F.2 (2026-05-19)

**Slice:** 6.F.2 — Per-FCurve solo (Ctrl+Alt+M).
**Status:** SHIPPED. Commits: `90e8655` (substrate) + `b1b7a5b` (audit-fix).
**Schema:** v42 (no bump — sparse boolean field, sister to `fcurve.mute`).
**Branch:** master (186 commits ahead of origin/master; +2 this slice).
**Phase progress:** 6.A + 6.B + 6.C + 6.D + 6.E + 6.F.1 + 6.F.2 SHIPPED
(7/7+ — only 6.G exit gate remains).

---

## TL;DR

- **SS-original DAW-convention extension** — NOT a Blender port.
  Blender's `ACHANNEL_SETTING_SOLO = 5` is NLA-tracks-only per
  [ED_anim_api.hh:674](reference/blender/source/blender/editors/include/ED_anim_api.hh)
  (verified character-for-character in sweep #76 + re-verified in #77).
  Per-FCurve solo has no Blender analog; this slice adds a new
  `fcurve.solo` flag bit + multi-solo DAW semantic (Pro Tools / Logic /
  Ableton pattern: any-soloed-plays, rest-silent; solo overrides mute).
- New [src/anim/fcurveSolo.js](../../src/anim/fcurveSolo.js) (~230 LOC)
  + [src/anim/dopesheetChannelSolo.js](../../src/anim/dopesheetChannelSolo.js)
  (~190 LOC).
- Extended [src/anim/fcurveGroups.js#isFCurveEffectivelyMuted](../../src/anim/fcurveGroups.js)
  cascade — all 4 eval call sites pick up solo semantics automatically
  (sister to Slice 5.V's group-mute cascade integration).
- New SS DEVIATION 19 (Ctrl+Alt+M hotkey choice). Audit-verified
  honest as SS-conventional.
- 116 new test asserts (59 fcurveSolo + 48 dopesheetChannelSolo +
  9 dopesheetRows solo cascade); all green.
- **Dual audit clean: 0 HIGH-F, 0 MED-F, 0 LOW-F.** 12/12 provenance
  cites byte-verified. SS-original framing HONEST across 3 docstring
  layers (the streak-extension test for SS-original work passed).
- **4 consecutive clean slices** (6.D + 6.E + 6.F.1 + 6.F.2) post-rule-6
  — discipline change confirmed durable.

---

## What shipped

### New: [src/anim/fcurveSolo.js](../../src/anim/fcurveSolo.js)

5 exports mirroring `fcurveMute.js`'s structural shape (for caller
ergonomics — NOT cite inheritance per rule 9):

- **`isFCurveSoloed(fc)`** — strict `=== true` read. Missing field
  → false.
- **`isAnyFCurveSoloed(action)`** — O(N) walk over `action.fcurves`.
  Mirrors Blender's `ADT_NLA_SOLO_TRACK` (`DNA_anim_enums.h:555`,
  "Only evaluate a single track in the NLA") in structural role only
  — Blender stores the bit on AnimData; SS derives per-call. Caching
  could be added later if profile shows it.
- **`toggleFCurveSolo(action, fcurveId)`** — single-curve in-place
  toggle.
- **`applyChannelSoloSelected(action, mode)`** — bulk toggle with
  scan-first resolution (sister to Slice 5.O `applyChannelMuteSelected`).
  Returns `{ changed, soloedCount, unsoloedCount, resolvedMode }`.
- **`wouldChannelSoloSelectedChange(action, mode)`** — phantom-undo
  preflight.

### New: [src/anim/dopesheetChannelSolo.js](../../src/anim/dopesheetChannelSolo.js)

3 exports — sister to 6.F.1's `dopesheetChannelMute.js`:

- **`pickSoloTarget(action, hoveredFcurveId)`** — pure decision tree
  (hover priority over selection; DEV 17 reuse).
- **`applyDopesheetChannelSolo(action, target)`** — immer-friendly
  dispatcher routing to single-curve or bulk solo. Post-audit-fix
  uses inline toggle (`fc.solo = !wasSolo`) instead of delegating to
  `toggleFCurveSolo` — eliminates double-find systemic risk.
- **`wouldDopesheetChannelSoloChange(action, target)`** — predicate
  for keymap effect's preventDefault gate.

### Modified: [src/anim/fcurveGroups.js](../../src/anim/fcurveGroups.js)

Extended `isFCurveEffectivelyMuted` with **solo cascade** as the
highest-priority check:

```
Decision matrix (when anySolo):
  this.solo=Y → false (solo wins; not effectively muted)
  this.solo=N → true  (effectively muted; DAW pattern)

Decision matrix (when !anySolo):
  Original per-curve mute + group mute cascade applies (unchanged).
```

Solo wins over BOTH per-curve mute AND group mute when active. All 4
eval call sites pick up the new semantic automatically:
- [src/anim/animationFCurve.js:382](../../src/anim/animationFCurve.js#L382)
- [src/anim/depgraph/kernels/fcurve.js:62](../../src/anim/depgraph/kernels/fcurve.js#L62)
- [src/anim/depgraph/kernels/animation.js:58](../../src/anim/depgraph/kernels/animation.js#L58)
- [src/renderer/animationEngine.js:233, :282](../../src/renderer/animationEngine.js)

### Modified: [src/v3/editors/dopesheet/DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx)

New Ctrl+Alt+M keymap effect — sister to the M-key mute effect from
6.F.1. Same gate pattern (input-skip + grab/box-drag ref suppression
+ action store-read at fire time + conditional preventDefault).
Reuses `hoveredFcurveIdRef` from 6.F.1; no new hover infrastructure.

### Modified: [src/v3/editors/dopesheet/dopesheetRows.js](../../src/v3/editors/dopesheet/dopesheetRows.js) (audit-fix HIGH-A)

The Slice 5.W audit-fix M4 inline cascade (parallel implementation of
`isFCurveEffectivelyMuted` for O(1) group lookup) was extended with
the solo branch. **Pre-fix the inline DIVERGED silently**: eval engine
correctly silenced non-soloed fcurves but the dopesheet UI showed all
rows ungreyed (no visual feedback for solo state). Fix hoists
`anySolo` ONCE per row-build, then branches the inline `isMuted`
decision on it.

### New tests

- [scripts/test/test_fcurveSolo.mjs](../../scripts/test/test_fcurveSolo.mjs)
  — 59 asserts across 24 sections.
- [scripts/test/test_dopesheetChannelSolo.mjs](../../scripts/test/test_dopesheetChannelSolo.mjs)
  — 48 asserts across 25 sections.
- [scripts/test/test_fcurveGroups.mjs](../../scripts/test/test_fcurveGroups.mjs)
  extended +12 asserts for solo cascade (89/89 total).
- [scripts/test/test_dopesheetRows.mjs](../../scripts/test/test_dopesheetRows.mjs)
  extended +9 asserts for solo greying cascade (75/75 total).

Sibling suites unaffected: `test:fcurveMute` 124/124,
`test:animationEngine` 61/61, `test:fcurveEval` 35/35,
`test:dopesheetChannelMute` 56/56.

---

## SS DEVIATIONs (Phase 6 cumulative — 19)

| DEV | What | Why honest |
|-----|------|-----------|
| 19  | Hotkey **Ctrl+Alt+M** — SS-conventional, no Blender analog | Blender has no per-FCurve solo hotkey. Picked to (a) avoid M-key collision with 6.F.1 mute, (b) stay in M-family (DAW idiom uses S; SS reserves S for snap/scale gestures), (c) plan §6.B specifies it. |

---

## Audit sweep #77 (dual-agent)

### ARCH (code-reviewer) — 1 HIGH-A + 1 MED-A systemic; both FIXED

- **HIGH-A** (FIXED): `dopesheetRows.js` inline cascade omitted solo
  branch. Eval correctly silenced non-soloed fcurves but UI rendered
  all rows ungreyed — no visual feedback for solo. Fix: hoist
  `anySolo` predicate before per-fcurve loop, branch the inline
  cascade on it.
- **MED-A** (FIXED, systemic): Double-find pattern in hovered
  dispatcher path (both `dopesheetChannelSolo.js` and
  `dopesheetChannelMute.js`). `find()` then `toggleFCurveX(action,
  id)` re-walks. Latent reference-aliasing risk if helpers ever
  refactor to splice-replace. Fix: inline the toggle
  (`fc.solo = !wasSolo;` / `fc.mute = !wasMuted;`) in both
  dispatchers; dropped now-unused `toggleFCurveSolo` /
  `toggleFCurveMute` imports.
- Other scrutiny points (10 total) cleared as correct-as-coded.

### BLENDER-FIDELITY (general-purpose) — 0 findings

- **HIGH-F**: NONE.
- **MED-F**: NONE.
- **LOW-F**: NONE.
- **12/12 provenance cites byte-verified**:
  - `ED_anim_api.hh:665-680` (full enum) including `:674`
    `ACHANNEL_SETTING_SOLO = 5` with `/** only for NLA Tracks */`
    comment — verified EXACTLY (load-bearing).
  - `anim_channels_defines.cc:4424-4447` (`acf_nlatrack_setting_flag`)
    + 5 other dispatchers (`:891`, `:1095`, `:3818`, `:3982`, `:4273`)
    all confirming NLA-only.
  - `DNA_anim_enums.h:469` `NLATRACK_SOLO = (1 << 3)` + `:555`
    `ADT_NLA_SOLO_TRACK = (1 << 0)` with comments verified.
  - `anim_channels_defines.cc:4347-4350` (per-track draw with
    "tagged for special non-solo handling") + `:4393-4411` (validity
    dispatch).
  - `anim_sys.cc:347-352` (mute eval gate, re-quoted from 5.V; rule 9
    re-verification passes).
- **SS-original framing**: HONEST. Three docstring layers
  (fcurveSolo.js header, dopesheetChannelSolo.js header,
  DopesheetEditor.jsx comments) all explicitly declare "NOT a Blender
  port — SS-original DAW-convention extension". No false port claim
  detected.
- **DEV 19 hotkey**: ACCURATE. Explicit acknowledgment that
  Pro Tools / Logic / Ableton use plain S (not Ctrl+Alt+M); SS picks
  Ctrl+Alt+M as compromise to stay in M-family without stealing S.

The audit explicitly noted: **"6.F.2 is the first slice that's NOT a
Blender port — it's SS-original. The audit risk is different: not 'did
the port match Blender' but 'did the docstring HONESTLY frame the
implementation as SS-original where no Blender code exists to port'.
Honest declaration is the streak-extension test for SS-original work."**
That test PASSED.

---

## Tests delta

| File | Asserts | Sections | Status |
|------|---------|----------|--------|
| `test_fcurveSolo.mjs` (NEW) | **59** | **24** | green |
| `test_dopesheetChannelSolo.mjs` (NEW) | **48** | **25** | green |
| `test_fcurveGroups.mjs` (extended) | 89 (+12) | (+1 section) | green |
| `test_dopesheetRows.mjs` (extended) | 75 (+9) | (+4 sections) | green |

Sibling suites all green (no regressions):
- `test:fcurveMute` 124/124
- `test:dopesheetChannelMute` 56/56
- `test:dopesheetGrab` 70/70
- `test:dopesheetDelDup` 83/83
- `test:dopesheetBoxSelect` 61/61
- `test:dopesheetClipboard` 107/107
- `test:animationEngine` 61/61
- `test:fcurveEval` 35/35

Typecheck: clean.

---

## Commits

```
90e8655 feat(anim): Phase 6 Slice 6.F.2 — Per-FCurve solo (Ctrl+Alt+M)
b1b7a5b fix(audit): Phase 6 Slice 6.F.2 audit-fix — 1 HIGH-A + 1 MED-A systemic
```

(+ docs/plan/memory update commit forthcoming.)

---

## Next slice (6.G — Phase 6 exit gate)

**Test sweep + Phase 6 exit gate + manual checklist.** Per plan §6.B:

1. **Test sweep**: ensure all dopesheet-related tests pass cleanly in
   isolation + as part of `npm test` (the master chain). Currently
   the dopesheet test scripts are individually-runnable but not in the
   master chain — 6.G decides whether to wire them in.

2. **Phase 6 exit gate**: review all 7 shipped slices (6.A through
   6.F.2) for:
   - Cumulative SS DEVIATION compliance (19 total — each verified as
     either honest extension or honest deferral per Rule №2).
   - Cross-slice consistency (gate patterns, dep arrays, ref usage).
   - Documentation completeness (every slice has a close-out doc).

3. **Manual checklist**: end-user-visible behaviors to verify in the
   browser, since the test suite covers pure-ops semantics but not UI
   integration. Examples:
   - Tick-click selection (6.A)
   - Box-select drag (6.B)
   - G-key modal grab with ghost diamonds (6.C)
   - Del + Shift+D + auto-grab-modal (6.D)
   - Ctrl+C → clipboard → Ctrl+V at new playhead (6.E)
   - M on hovered channel → row greys (6.F.1)
   - **Ctrl+Alt+M → row greys others, soloed row stays normal (6.F.2)**

   These accrue at 6.G into `docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`
   (paralleling the existing `ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`).

Estimated 6.G: ~1 hour (mostly docs).

---

## Pre-/loop continuation snapshot

- **Branch**: master, 186 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit close-out + plan + MEMORY.
- **Schema**: v42 (unchanged).
- **Phase 6 progress**: 7/7+ slices SHIPPED. Only 6.G exit gate remains.
- **Cite-discipline**: 4 consecutive clean slices post-rule-6
  (6.D + 6.E + 6.F.1 + 6.F.2). Rule 9 re-source/not-re-quote held
  across all 4; rule-9 audit specifically validated SS-original
  framing on 6.F.2 (the first non-port slice in the streak).
- **SS deviations (Phase 6 cumulative)**: 19.
- **User-side owed**: Phase 3 + 4 manual checklists outstanding;
  Phase 6 manual checklist accrues at 6.G.
