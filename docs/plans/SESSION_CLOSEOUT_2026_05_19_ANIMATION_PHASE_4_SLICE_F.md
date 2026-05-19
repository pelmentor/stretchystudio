# Session Close-out — Animation Phase 4 Slice 4.F (test parity sweep + manual checklists)

**Session date:** 2026-05-19 (continuation, cross-compact)
**Branch:** master (163 commits ahead of origin/master; +1 this slice)
**Schema:** v42 (no bump — docs + tests only)
**Status:** Slice 4.F SHIPPED.
**Phase 4 status:** 4.A/4.B/4.C/4.D/4.E/4.F SHIPPED; 4.G (exit gate)
remains and is gated on the user-side manual verification checklist.

---

## What this slice shipped

### Coverage parity audit (plan §4.F vs as-shipped)

Walked every notional test file in plan §4.F (10 rows) and matched it
to actual SS test files + sections. Result:

- **8 rows fully covered** (under different filenames + grouped
  by-substrate-layer, not by-feature).
- **2 rows had partial coverage** — kernel tested in `test_nlaEval` §1
  but no stacked-strip INTEGRATION assertion. Filled with new sections
  §30 (subtract) + §31 (multiply).
- **1 row deliberately deferred** — `test_nla_blend_combine.mjs`. The
  `combine` blend mode was removed from Phase 4 scope per the Slice
  4.A/4.B audit-driven scope change (silent degrade to `replace` for
  non-rotation channels violates Rule №1). `test_nlaEval` §24 asserts
  `evaluateNla` THROWS on `blendmode: 'combine'`.

### Coverage closure additions (test_nlaEval.mjs §30 + §31)

```js
// §30 — Stacked-strip integration: subtract on top of replace
// Bottom: replace 0→100 ramp (yields 50 at t=500)
// Top: subtract a constant 30 (yields acc[pX] = 20)
// + partial-influence variant (subtract 30*0.5 = 15)

// §31 — Stacked-strip integration: multiply on top of replace
// Bottom: replace 0→100 ramp (yields 50 at t=500)
// Top: multiply by 2 (yields 1*(50*2) + 0*50 = 100)
// + partial-influence variant (yields 75 — lerps toward identity)
```

Mirrors §15 (replace+add) pattern verbatim.

### Manual verification checklists doc

New: `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`

Covers two backlogs in one place:

- **Phase 3 — FModifier UI surface (Slice 3.C carryover):**
  per-modifier-type add/edit (6 types: Generator/Envelope/Cycles/
  Noise/Limits/Stepped), common stack operations (mute/remove/
  reorder/collapse), inline editor controls, persistence + undo/redo
  round-trip.
- **Phase 4 — NLA end-to-end scenarios (§4.G accrual):**
  - 4.G.1 "Idle + breath" stacked → walk → talk-while-walking
  - 4.G.2 Two characters with shared "Blink" Action
  - 4.G.3 Tweak push → edit blink frequency → exit → underlay reflects
  - 4.G.4 Bake NLA → motion3.json → Cubism Viewer parity check

### Plan §4.F amendment

Replaced the v2-plan notional file table with a **status-augmented
mapping table** (notional name → SS file + sections + status) +
an **aggregate test-count table** (Phase 4 cumulative: **735 asserts**
across 6 test files including the v42 migration's 185 asserts) +
a coverage-closure note for §30 + §31.

---

## Cite-discipline arc

No new cites this slice (test additions only mirror existing §15
pattern; doc additions reference the as-shipped code). Cite-discipline
streak unchanged at **0** (RESET after 4.E).

---

## Audit findings

**No dual-audit run this slice** — per the standing convention
("dual-audit after every phase substrate ship"), Slice 4.F is
docs + small test additions only (no substrate code), so it doesn't
trigger the audit pattern. The new test sections follow the §15
verbatim pattern + assert against known-correct kernel outputs;
nothing novel to audit.

---

## Test counts

| File | Pre-slice | Post-slice | Delta |
|------|-----------|------------|-------|
| `test_nlaEval.mjs` | 86 | 90 | +4 |

Other NLA test suites unchanged (still all green):
- `test_nlaTweakMode.mjs`: 85
- `test_nlaEditorOps.mjs`: 209
- `test_nlaEditorData.mjs`: 56
- `test_bakeNla.mjs`: 110

**Phase 4 cumulative: 735 asserts** (550 directly-shipped this phase
+ 185 in the v42 NLA-substrate migration slice).

---

## SS deviations

None new this slice.

Cumulative Phase 4: still **22** (Slices 4.A through 4.E inclusive).

---

## Commits this slice (1)

```
218c68c test(anim): Phase 4 Slice 4.F — NLA test parity sweep + manual checklists
```

(+1 docs commit shipping this close-out + plan banner + MEMORY update.)

---

## Top queued path next

**Slice 4.G — Phase 4 exit gate.**

The exit gate is GATED ON the user-side manual verification
checklist coming back fully `[x]`:

- Phase 3 — FModifier UI (Slice 3.C carryover): 4 sub-sections (per-
  type add/edit, common stack ops, inline controls, persistence).
- Phase 4 — NLA end-to-end: 4 scenarios (idle-stack / shared-blink /
  tweak round-trip / bake-Cubism round-trip).

Until then, 4.G stays open. When the user reports the manual
checklist green, 4.G ships in a docs-only commit flipping the Phase
4 banner from `4.F SHIPPED, 4.G OPEN` to `Phase 4 SHIP COMPLETE`,
and rolling Phase 4's user-side-owed status off the books.

No more substrate work in Phase 4. Phase 5 (Graph Editor write-mode)
is the next phase substrate.

---

## Pre-compact state (snapshot)

- **Branch**: master, 163 commits ahead of origin (NEVER pushed this
  session per standing "Push only to origin" rule)
- **Working tree**: about to commit this close-out + plan banner + MEMORY
- **Schema**: v42 (unchanged)
- **Phase 4 progress**: 4.F SHIPPED; 4.G OPEN gated on user manual
  checklist
- **Tests added this slice**: 4 new asserts (test_nlaEval §30 + §31);
  all NLA suites still green; typecheck clean (no source changes)
- **Audit sweeps this slice**: 0 (docs + test slice; no substrate)
- **Cite-discipline**: streak unchanged at 0 (no new cites)
- **SS deviations**: 22 cumulative (no new this slice)
- **User-side owed**: NEW unified manual checklist at
  `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md` covers both
  Phase 3 FModifier UI carryover + Phase 4 end-to-end scenarios
