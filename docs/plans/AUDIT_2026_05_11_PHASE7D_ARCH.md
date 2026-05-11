# Phase 7.D Architecture Audit (2026-05-11)

Reviewed commit `59fedac` (master). Files examined: 3 changed files —
`package.json` (11 new `test:*` alias entries + chain extension),
`docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md` (§6 placeholder resolution +
§14 exit checklists + §15 coverage tables),
`docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE7D.md` (new close-out doc).

Traced the full alias section (lines 1–257) against all 234 `test_*.mjs`
files in `scripts/test/`; extracted the chain string from line 257;
verified alias→file mappings, chain coverage, dependency ordering, and
JSON well-formedness. Plan-doc content is the parallel sister audit's
territory and is not reproduced here.

---

## Summary

3 gaps found: **1 HIGH, 0 MED, 2 LOW.**

| ID  | Sev  | Pre-existing? | One-line |
|-----|------|---------------|----------|
| G-1 | HIGH | Yes (predates 7.D) | `test:typedArrayPool` + `test:spatialHash` — both files exist, both have alias definitions, neither is in the `npm test` chain; Phase 7.D's stated purpose was to close the orphan gap, leaving these 2 is a Rule №2 violation |
| G-2 | LOW  | No (introduced by 7.D alias placement) | `migrationV35` alias sits at line 221 (after Phase 8 primary aliases) in the alias block, but the chain executes it right after `migrationV34` — alias-section order silently diverges from chain execution order |
| G-3 | LOW  | Yes (predates 7.D) | `&&npm run` without space at two points in the chain near the depgraph/nodetree boundary |

---

## HIGH

### G-1: `test:typedArrayPool` and `test:spatialHash` are orphan aliases — files exist but chain skips them

**File:** `package.json:37` (`test:typedArrayPool`) and `package.json:91`
(`test:spatialHash`)

**Severity:** HIGH — Rule №2 violation. Phase 7.D's explicit stated purpose
(per `SESSION_CLOSEOUT_2026_05_11_PHASE7D.md`) was to wire all orphan test
files so that `npm test` covers every test suite on disk. Two test files
are on disk, have working aliases, but are not invoked by the canonical
chain.

**Evidence:**

```
# File exists:
scripts/test/test_typedArrayPool.mjs   — 96 lines, 8 BufferPool / getPoolForRigSpec tests
scripts/test/test_spatialHash.mjs      — 142 lines, 7 SpatialHash neighbour-query tests

# Alias defined:
package.json:37  "test:typedArrayPool": "node scripts/test/test_typedArrayPool.mjs"
package.json:91  "test:spatialHash":    "node scripts/test/test_spatialHash.mjs"

# Chain (package.json:257): neither alias appears in the && chain string.
```

The close-out doc's "11 orphans" inventory does not include these two.
They were pre-existing orphans before Phase 7.D; Phase 7.D's sweep found
and wired the 11 it targeted but did not run a completeness check against
all on-disk files with alias definitions.

**Why HIGH:** Phase 7.D's claim is "npm test now covers 363 newly-wired
assertions." Both orphaned suites cover real production code:
- `typedArrayPool.js` is imported directly by `chainEval.js` (the hot
  evaluation path); its 8 acquire/grow/clear/rig-keyed-pool assertions
  are the only coverage for that module.
- `spatialHash.js` is imported by `mesh/sample.js` and `mesh/generate.js`;
  its 7 tests are the only coverage for the neighbour-query correctness
  guarantee used by mesh deduplication.

The omission is a real coverage gap under Rule №2.

**Fix (two insertions in the chain string at `package.json:257`):**

Insert after `test:chainEval` (the logical neighbour for `typedArrayPool`,
since `chainEval.js` imports it) and after `test:meshSample` (the logical
neighbour for `spatialHash`, since `sample.js` imports it).

The alias definitions (lines 37 and 91) are already correct and require no
changes.

---

## LOW

### G-2: `migrationV35` alias placed after Phase 8 primary aliases in the alias block, but chain runs it before them

**File:** `package.json:221` (alias section ordering)

**Severity:** LOW — no functional impact. The `npm test` chain correctly
executes `migrationV35` before the Phase 8 primaries that depend on it
(the chain runs it right after `migrationV34`, well before `poseWriterHelpers`
and `poseWriteV19Shape`). However, the alias section places `migrationV35`
at line 221 — after `poseWriteV19Shape` (line 220) and before
`auditFixes20260511Phase7b` (line 222). A maintainer reading the alias
block top-to-bottom would infer the wrong order.

**Root cause:** `migrationV35` is the Phase 8 schema substrate. In the chain
it was inserted at the V33/V34 migration block (correct: substrate before
consumers). In the alias section it was appended after `poseWriteV19Shape`
(the last Phase 8 primary alias) rather than immediately after `migrationV34`
(its chain neighbour).

**Fix (cosmetic — alias section reorder, no chain change):**

Move the `"test:migrationV35": ...` alias entry to immediately after
`"test:migrationV34": ...`. This makes alias-section order match chain
execution order for the migration block.

---

### G-3 (pre-existing): `&&npm run` without space at two chain points

**File:** `package.json:257` — two occurrences in the chain string near the
depgraph/nodetree boundary.

**Severity:** LOW, pre-existing. Functionally harmless in npm/node shell
execution, but visually inconsistent.

**Fix (tidy-up while editing for G-1):** Add space around the `&&`
delimiters.

---

## Verified clean

| Question | Verdict |
|---|---|
| JSON well-formed | `package.json` parses correctly. No trailing commas, no missing commas. The long chain on line 257 is a single valid string value. |
| Duplicate alias keys | None. All 11 newly-added `test:*` keys are unique across the entire `scripts` object. |
| Duplicate chain invocations | `migrationV35` appears exactly once in the chain (early, after V34). No newly-wired alias appears twice in the chain string. |
| All 11 claimed orphans wired | All 11 appear in the chain string. All 11 file-alias mappings point to files confirmed present on disk. |
| Dependency order: migrationV35 before Phase 8 primaries | Chain runs `migrationV35` before `poseWriterHelpers` and `poseWriteV19Shape`. Correct. |
| Phase audit-pin ordering | `auditFixes20260511Phase7b` → `auditFixes20260511Phase7c` → `auditFixes20260511Phase8` in the chain. Correct chronological order. |
| Phase 7.C primaries before Phase 8 primaries | `poseModeClearLoc..poseModeCopyPaste` (7.C) run before `poseWriterHelpers, poseWriteV19Shape` (8). Correct. |
| Alias naming convention (camelCase) | All 11 new aliases use camelCase. Consistent with existing convention. |

---

## Repair priority

1. **G-1 (HIGH) — FIX:** Add `npm run test:typedArrayPool` to the chain
   after `test:chainEval` and `npm run test:spatialHash` after
   `test:meshSample`. Two insertions in `package.json:257`. Closes the
   Rule №2 orphan gap that Phase 7.D was supposed to eliminate.

2. **G-2 (LOW) — FIX (cosmetic):** Move `"test:migrationV35"` alias to
   immediately after `"test:migrationV34"` in the alias block.

3. **G-3 (LOW, pre-existing) — FIX (tidy-up):** Add spaces around the two
   `&&npm` occurrences in the chain string while editing for G-1.
