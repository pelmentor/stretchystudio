# Phase 7.D Documentation / Consistency Audit (2026-05-11)

**Audit type:** Documentation / consistency
**Scope:** Phase 7.D commit `59fedac` — docs only (package.json wiring is
sister-audit territory: `AUDIT_2026_05_11_PHASE7D_ARCH.md`)
**Auditor suffix:** DOCS
**Date:** 2026-05-11
**Gaps labeled:** D-1 through D-8

---

## Verification results — items that PASS

**Commit hash accuracy (§15 Top-12 + Phase 7 table) — ALL CORRECT.**
Every hash verified against `git log`:

| Cited hash | Phase | Git log confirms |
|-----------|-------|------------------|
| `4a59d62` | Phase 0 vertex selection | `4a59d62…` "feat(toolset): Phase 0 — vertex selection model" |
| `f7fba11` | Phase 1 box/lasso | `f7fba11…` "feat(toolset): Phase 1" |
| `5b81205` | Phase 2 snap | `5b81205…` "feat(toolset): Phase 2 — snap-to-grid" |
| `fa17a46` | Phase 3 sculpt | `fa17a46…` "feat(toolset): Phase 3 — Sculpt Mode" |
| `428bcdf` | Phase 4 merge/dissolve | `428bcdf…` "feat(toolset): Phase 4" |
| `ea590ac` | Phase 5 extrude | `ea590ac…` "feat(toolset): Phase 5 — Extrude" |
| `f44a1b0` | Phase 6 select linked | `f44a1b0…` "feat(toolset): Phase 6" |
| `cdd3c93` | Phase 7.A object mode | `cdd3c93…` "feat(toolset): Phase 7.A" |
| `9489177` | Phase 7.B weight paint | `9489177…` "feat(toolset): Phase 7.B" |
| `fbf7f82` | Phase 7.C pose mode | `fbf7f82…` "feat(toolset): Phase 7.C" |
| `59fedac` | Phase 7.D wiring | `59fedac…` "chore(test): Phase 7.D" |

**"34 commits ahead" claim — CORRECT.** Phase 8 close-out stated "33 commits
ahead" at `be83451`. Phase 7.D adds exactly 1 commit (`59fedac`).

**Assertion arithmetic — CORRECT.** 23+10+9+24+53+30+45+72+46+25+26 = 363.

**All 11 orphan test files — VERIFIED ON DISK** at `scripts/test/`.

**Manual gate ID consistency — CORRECT.** IDs `7.A.6`, `7.B.6`, `7.C.7` are
consistent across §14, §15 Phase 7.D table, close-out doc, and
`project_blender_parity_plans_in_flight.md`.

**Resume paths A/B/C/D consistency — CORRECT.**

**MEMORY.md index one-liner — CORRECT on disk.**

**§6 schema bump table migration filenames — CORRECT.** `v33_project_cursor.js`,
`v34_weight_paint_settings.js`, `v35_pose_shape_repair.js` all verified on
disk and match §6 citations exactly.

**`project_blender_parity_plans_in_flight.md` body narrative — CONSISTENT.**

---

## Gaps

### CRITICAL — SHIP-BLOCKER

None.

### HIGH

**D-1 — §9 new-source-files table: two migration filenames are wrong**

- File: `docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md`
- Lines 1451–1452 (table is §9 "File index", not §15 — line numbers
  remain accurate)

The §9 table lists:

```
| src/store/migrations/v33_toolset_cursor.js  | 7.A | `project.cursor` field      |
| src/store/migrations/v34_toolset_xMirror.js | 7.B | `node.weightPaintSettings`  |
```

Actual files on disk:

```
src/store/migrations/v33_project_cursor.js
src/store/migrations/v34_weight_paint_settings.js
```

These names are wrong. The §6 "Migration filenames on disk" block (lines
1292–1294) in the same document correctly cites `v33_project_cursor.js` and
`v34_weight_paint_settings.js`. So §6 and §9 are inconsistent with each
other, and §9 is wrong.

**Fix:** Change lines 1451–1452 to use the actual filenames.

---

**D-2 — §9 new-source-files table: Phase 7.C pose operator filenames are wrong (6 rows, 2 actual files)**

- File: `docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md`
- Lines 1444–1450

The table shows six separate files:

```
| src/v3/operators/pose/clearLocation.js | 7.C |
| src/v3/operators/pose/clearRotation.js | 7.C |
| src/v3/operators/pose/clearScale.js    | 7.C |
| src/v3/operators/pose/clearAll.js      | 7.C |
| src/v3/operators/pose/mirror.js        | 7.C |
| src/v3/operators/pose/copyPaste.js     | 7.C |
```

Actual files on disk (verified):
```
src/v3/operators/pose/clearTransform.js   (contains all four clear ops)
src/v3/operators/pose/mirror.js           (contains mirror + copy/paste)
```

`clearLocation.js`, `clearRotation.js`, `clearScale.js`, `clearAll.js`, and
`copyPaste.js` do not exist. The `project_blender_parity_plans_in_flight.md`
body correctly describes "2 operator modules under `src/v3/operators/pose/`
(`clearTransform.js` + `mirror.js`)".

Additionally, line 1448's description for `mirror.js` says "Mirror Pose
(Ctrl+Shift+M)" — but Mirror Pose was moved to `Ctrl+Shift+V` by the
Phase 7.C audit-fix. `Ctrl+Shift+M` is Select Mirror.

**Fix (lines 1444–1450) — collapse to actual structure.**

---

### MEDIUM

**D-3 — Close-out doc commit hash for Phase 7.D shows "_pending_" in two places**

- File: `docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE7D.md`
- Lines 15 and 141

The "What shipped" table and the "Day-end commit chain" table both say
`| _pending_ |` for the Phase 7.D commit. The actual commit is `59fedac`.

**Fix:** Replace `_pending_` with `` `59fedac` `` in both table rows.

---

**D-4 — Phase 8 close-out doc internal inconsistency on initial `test_pose_writer_helpers` assertion count (PRE-EXISTING, not introduced by 7.D)**

- File: `docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE8.md`
- Lines 16 and 90

The "What shipped" commit description says "test_pose_writer_helpers.mjs
(56 assertions)" for the initial Phase 8 commit `b58b505`. The Test
Scoreboard shows `test_pose_writer_helpers` = 72.

The audit-fix sweep `be83451` added assertions, bringing the suite from 56
to 72. The scoreboard correctly reflects the final state, but the commit
description is not retroactively updated.

**Not introduced by Phase 7.D** — flagged for completeness only.

---

**D-5 — §6 sister-phase v35 note: cross-plan reference is appropriate, but lacks an explicit "see separate plan" pointer**

- File: `docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md`
- Lines 1282–1289

The §6 note says "Sister Phase 8 schema: v35 … Not strictly a toolset Phase 7
schema, but it lives in the same day's commit chain." Defensible but verbose.

**Suggested tightening (no hard requirement):** Reduce to a one-liner with a
link to `POSE_WRITE_CANONICALISATION_PLAN.md`.

---

### LOW

**D-6 — Audit-doc naming convention: Phase 7.D has no Blender-fidelity audit**

- N/A (absence)

The prior nine sub-sessions all produced two audit docs (ARCH + BLENDER, or
ARCH + DATA). Phase 7.D is a chore commit (test wiring + plan docs), so
there is no Blender-fidelity surface to audit. The sister architecture audit
covers test-chain integrity, Rule №1/№2 violations.

This audit is the second member of the pair. Its name is
`AUDIT_2026_05_11_PHASE7D_DOCS.md` (DOCS because Phase 7.D's second audit
surface is documentation/consistency, not Blender feature behavior).

**No fix required** — naming deviation is intentional.

---

**D-7 — Close-out doc "What was the gap" narrative: Phase 7.A/B/C close-out docs claimed "all tests green" but npm skipped orphans — not explicitly stated**

- File: `docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE7D.md`
- Lines 23–26

The close-out doc says the orphans existed but does not name which
close-out doc made the misleading "all tests green" claim. Not ship-blocking.

---

**D-8 — "Branch ahead of origin/master by 34 commits" in close-out doc — self-referential by established convention**

- File: `docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE7D.md`
- Line 6

Phase 8 close-out used the same self-referential phrasing pattern. No fix
needed.

---

## Summary

| ID | Severity | Issue | Introduced by Phase 7.D? |
|----|----------|-------|--------------------------|
| D-1 | HIGH | §9 lines 1451–1452: migration filenames `v33_toolset_cursor.js`/`v34_toolset_xMirror.js` don't exist | Yes — Phase 7.D added these rows in earlier ship |
| D-2 | HIGH | §9 lines 1444–1450: 6 Phase 7.C source files cited that don't exist; only 2 real files | No — pre-existing plan drift; Phase 7.D didn't correct it |
| D-3 | MED | SESSION_CLOSEOUT_2026_05_11_PHASE7D.md lines 15, 141: `_pending_` instead of `59fedac` | Yes — Phase 7.D left the hash unfilled |
| D-4 | MED | SESSION_CLOSEOUT_2026_05_11_PHASE8.md line 16: 56 vs 72 assertions in same doc | No — pre-existing in Phase 8 doc |
| D-5 | LOW | §6 v35 cross-plan note verbose | Yes — Phase 7.D added |
| D-6 | LOW | Naming: `_DOCS` suffix vs `_BLENDER`/`_DATA` | Intentional |
| D-7 | LOW | "Gap" narrative doesn't name prior misleading close-out | Yes — Phase 7.D authored |
| D-8 | LOW | Self-referential commit count | Convention |

**Total: 0 CRITICAL, 2 HIGH, 2 MED, 4 LOW**

---

## Sister-sweep finding (out of original audit scope, surfaced during D-1/D-2 verification)

While verifying D-1/D-2 against the on-disk filesystem, found **additional
§9 file index drift** beyond what the audit brief covered:

| §9 line | Cited path | Actual on-disk |
|---------|-----------|----------------|
| 1417 | `src/v3/shell/BoxSelectOverlay.jsx` | `src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx` |
| 1418 | `src/v3/shell/LassoSelectOverlay.jsx` | (does not exist; folded into BoxSelectOverlay) |
| 1419 | `src/v3/shell/CircleSelectOverlay.jsx` | `src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx` |
| 1413 | `src/v3/operators/select/box.js` | (does not exist; inlined in `src/v3/operators/registry.js`) |
| 1414 | `src/v3/operators/select/lasso.js` | (does not exist; inlined in registry) |
| 1415 | `src/v3/operators/select/circle.js` | (does not exist; inlined in registry) |
| 1420 | `src/lib/snap.js` | `src/lib/snap/{index,snapHash,snapMath}.js` |
| 1424 | `src/lib/sculpt/inflate.js` | `src/lib/sculpt/pinch.js` (audit D-7 rename) |
| 1431 | `src/v3/operators/apply/menu.js` | `src/v3/shell/ApplyMenu.jsx` (UI not operator) |
| 1437 | `src/v3/operators/object/clearParent.js` | (does not exist; inlined in registry) |
| 1443 | `src/lib/weightPaint/mirrorMap.js` | (does not exist; folded into operator file) |

The §9 file index is significantly drifted from shipped reality. Of 41
"new files" rows, 11 have wrong paths or don't exist. Per the audit brief's
"anything a future-me would find confusing" mandate, this is a docs-quality
cliff that the same-day fix sweep should sweep.

**Promotion:** This sister-sweep finding is itself MED-promoted-to-HIGH for
the same-day Phase 7.D audit-fix sweep — fixing only D-1 + D-2 leaves a
similar cliff for the rest of the rows. Phase 7.D's own mandate (close
plan-doc resolution) covers all of §9, not just the 7.A/7.B/7.C entries.

---

## Ship-blocker verdict

**No ship-blockers** for the prior `59fedac` commit. The HIGH gaps are
documentation accuracy issues in §9's key-files table. Neither prevents the
test chain from running, and neither affects any code path. Both should be
fixed in the same-day correction pass per the established audit-fix sweep
rhythm.
