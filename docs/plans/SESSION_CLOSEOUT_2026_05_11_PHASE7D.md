# Session Close-out — 2026-05-11 (Phase 7.D sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE8.md](./SESSION_CLOSEOUT_2026_05_11_PHASE8.md).
This sub-session shipped **Toolset Phase 7.D — Phase 7 exit gate**
(autonomous half: test-wiring + plan doc resolution; the 3 manual gates
remain user-side). Branch ahead of `origin/master` by 34 commits at HEAD
(close-out doc commit follows).

## What shipped this sub-session (1 commit)

### Phase 7.D autonomous closure

| Commit  | What |
|---------|------|
| `59fedac` | Phase 7.D — wire 11 orphan test files into `npm test`, resolve `vTB+1`/`vTB+2` schema placeholders to v33/v34 (+ note v35 sister), mark Top-12 + per-mode coverage as ✅ shipped, mark Phase 0–7.C exit checklists complete. |

(Close-out doc commit follows separately.)

## What was the gap

The Phase 7.A → 7.C ship rhythm produced 11 test files **on disk and
green**, but each was an orphan script — none were wired into the
canonical `npm test` chain in `package.json`. The Phase 7.A/B/C close-out
docs claimed "all tests green"; the audit-pin tests verified each phase's
substrate; but `npm test` skipped them entirely. Per Rule №2 (no migration
baggage / no orphan diagnostics), this was a real Phase 7.D gap.

The 11 orphans:

| # | File | Phase |
|---|------|-------|
| 1 | `test_poseMode_clearLoc.mjs` | 7.C primary |
| 2 | `test_poseMode_clearRot.mjs` | 7.C primary |
| 3 | `test_poseMode_clearScale.mjs` | 7.C primary |
| 4 | `test_poseMode_clearAll.mjs` | 7.C primary |
| 5 | `test_poseMode_mirrorPose.mjs` | 7.C primary |
| 6 | `test_poseMode_copyPaste.mjs` | 7.C primary |
| 7 | `test_audit_fixes_2026_05_11_phase7c.mjs` | 7.C audit-pin |
| 8 | `test_pose_writer_helpers.mjs` | 8 primary |
| 9 | `test_pose_write_v19_shape.mjs` | 8 primary |
| 10 | `test_migration_v35.mjs` | 8 substrate |
| 11 | `test_audit_fixes_2026_05_11_phase8.mjs` | 8 audit-pin |

**363 assertions** were uncovered by the canonical chain pre-Phase-7.D.
After wiring (this sub-session), the full `npm test` chain covers them
all and exits 0; typecheck clean.

## Plan doc resolution

`TOOLSET_BLENDER_PARITY_PLAN.md` had three documentation deferrals that
Phase 7.D resolved:

1. **§6 Schema bumps** — placeholders `vTB+1` / `vTB+2` resolved to
   real `v33` / `v34` (the audit-flagged Rule №2 collision was avoided
   by the resolution gate; both shipped 2026-05-11). Sister Phase 8
   `v35` noted in same table.
2. **§14 Phase exit checklists** — Phases 0–7.C marked `[x]` (with the
   manual gates explicitly tagged `← user-side gate <id>`); Phase 7.D
   + Phase 8 sections added. Pre-Phase-7.D the entire §14 was a
   `[ ]`-only list, ignoring 9 shipped phases.
3. **§15 Top-12 + per-mode coverage tables** — every entry now carries
   ship date + commit hash. Phase 7.D status sub-table added.

## Test scoreboard

All Phase 7.A/B/C/D + Phase 8 suites green via canonical chain.

| Suite | Assertions |
|-------|------------|
| `test_poseMode_clearLoc`                                                | 23  |
| `test_poseMode_clearRot`                                                | 10  |
| `test_poseMode_clearScale`                                              | 9   |
| `test_poseMode_clearAll`                                                | 24  |
| `test_poseMode_mirrorPose`                                              | 53  |
| `test_poseMode_copyPaste`                                               | 30  |
| `test_audit_fixes_2026_05_11_phase7c`                                   | 45  |
| `test_pose_writer_helpers`                                              | 72  |
| `test_pose_write_v19_shape`                                             | 46  |
| `test_migration_v35`                                                    | 25  |
| `test_audit_fixes_2026_05_11_phase8`                                    | 26  |
| **Total newly-wired**                                                   | **363** |

Full chain exits 0; typecheck clean.

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged from PHASE8 close-out. Depgraph coherent post Phase 0 + Phase 8
audit-fix; Phase 0.D flag flip is gated on user-side manual byte-fidelity
sweep on Shelby + test_image4 PSDs.

### B. Manual gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F + 7.A.6 + 7.B.6 + 7.C.7

Ten manual gates queued (browser-side). Phase 7.D **does not add a new
manual gate** — it's purely a substrate fix verifiable via unit tests.
Phase 7.D autonomous half is the natural close-out for the entire Phase 7
work; the 3 manual gates 7.A.6/7.B.6/7.C.7 are the same as Phase 7.D's
own manual half.

### C. Animation Phase 1 — Action datablock retirement (NEW next chunk)

Per the Phase 7 plan's §4 phase order, Phase 7 is the final toolset
phase. After Phase 7 ships fully (3 manual gates pass), the next
autonomous chunk is **Animation Phase 1 — `Action` datablock + NodeTree
retirement** (per `ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1, lines
419-578). Schema `v36` (next available after v35). 17+ consumer files
to migrate from `project.animations` → `project.actions`. 2-week scope
per plan; expect to sub-phase across multiple autonomous sessions:

- **Stage 1.A + 1.B**: schema definition + migration v36 + ALL 17+
  consumer rewires + tests. Single big commit. NO `actionRegistry`
  helpers yet, NO `__scene__` pseudo-Object, NO UI rename.
- **Stage 1.C + 1.D**: `actionRegistry.js` + `__scene__` pseudo-Object.
- **Stage 1.E**: AnimationsEditor → ActionsEditor UI rename.
- **Stage 1.F + 1.G**: 5 new test suites + exit gate (export
  byte-identity).
- **Audit-fix sweep + close-out** per phase.

**Sister gate**: Animation Phase 1 is the precondition for Phase 1C-flip
groundwork (multi-bone armature Object). Phase 8 helper consolidation
already chokepointed every pose writer through `setBonePoseField` /
`setBonePose`; the helper signature evolves from `(node, field, value)`
to `(armatureObject, boneId, field, value)` when 1C-flip ships.

### D. Phase 1C-flip groundwork (NOT scheduled)

Substrate-unblocked from Phase 8 helper consolidation but unscheduled.
Needs a plan doc on disk before autonomous start.

## Hotkey reservations

Phase 7.D added no new hotkeys (substrate fix + docs, not feature).

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (33 from earlier 2026-05-11 close-outs) | Phases 0-7.C ship + 9 audit-fix sweeps + close-outs + Phase 8 (initial + audit-fix + close-out) |
| 34    | `59fedac` | Phase 7.D — wire 11 orphan test files + resolve plan §6 placeholders + mark §14 + §15 shipped |

## Schemas after Phase 7.D

`CURRENT_SCHEMA_VERSION = 35` (unchanged from Phase 8). Phase 7.D
introduces no new schema — it's purely a test-wiring + plan-doc fix.
