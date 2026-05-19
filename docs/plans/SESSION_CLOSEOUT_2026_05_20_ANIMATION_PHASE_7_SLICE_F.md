# Session Close-out — Animation Phase 7 Slice 7.F (Test sweep + Phase 7 exit gate)

**Session date:** 2026-05-20.
**Slice:** 7.F — Coverage audit + manual checklist + Phase 7
aggregate + plan banner update. **No new code.**
**Commits:** `71b835b` (substrate-and-close-out — meta-work slice)
+ audit-fix commit (sweep #83 + #83-F findings).
**Branch:** master.
**Schema:** v42 (unchanged; Phase 7 ships no schema bumps).
**Status:** **PHASE 7 SHIP-COMPLETE 6/6 SLICES.**

---

## What 7.F shipped

### 3 new docs + 1 plan-banner edit (no code)

| File                                                            | LOC   | Role                                                                                |
|------------------------------------------------------------------|-------|--------------------------------------------------------------------------------------|
| `docs/plans/ANIMATION_PHASE_7_COVERAGE_AUDIT.md`                | ~220  | Per-row subsumption proof for plan §7.F's 5 prescribed test files                    |
| `docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md`              | ~330  | User-facing 20–30 minute end-to-end verification (Setup + §1–§7 + Known gaps)        |
| `docs/plans/ANIMATION_PHASE_7_AGGREGATE.md`                     | ~280  | Phase rollup: API surface + sparse fields + keybindings + per-slice + 12 DEVs + arc  |
| `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` (banner edit)     | +60   | Phase 7 status flipped IN-FLIGHT 5/6 → SHIP-COMPLETE 6/6; 7.F subsection inserted    |

### Public API surface

None (meta-work slice).

### Behavior

No runtime behavior change.

---

## Coverage audit conclusion

Plan §7.F prescribed 5 test filenames. All 5 are subsumed by existing
suites at strictly higher coverage breadth:

| Plan §7.F prescribed                  | Subsumed by                              |
|----------------------------------------|------------------------------------------|
| `test_keyingSet_builtin.mjs`          | `test_keyingSets.mjs` §1–§7 + §12        |
| `test_keyingSet_userDefined.mjs`      | `test_keyingSets.mjs` §8 + §9 + §10 + §11 |
| `test_insertKeyframe_replace.mjs`     | `test_insertKeyframe.mjs` §4 + §6 + §11 + §19 |
| `test_insertKeyframe_onlyNeeded.mjs`  | `test_insertKeyframe.mjs` §5             |
| `test_autoKey_keyingSet.mjs`          | `test_autoKeyDispatch.mjs` §2 + §4 + §5  |

**Decision:** Zero new test files needed. 7.F substrate = the audit
doc + manual checklist + phase aggregate + banner edit.

Per Rule №2: the prescribed names are NOT documented as "TODO ship
later" — they're documented as "subsumed under existing names" so a
future maintainer searching for the prescribed name lands on the
audit doc and follows the pointer to the actual suite.

---

## Test re-verification pre-commit

All 5 Phase 7 suites re-ran on `master @ 4991662` immediately before
this commit:

```
npm run test:keyingSets          → 144 passed, 0 failed
npm run test:insertKeyframe      →  87 passed, 0 failed
npm run test:keyingSetMenu       →  69 passed, 0 failed
npm run test:autoKeyDispatch     →  48 passed, 0 failed
npm run test:kKeyFirstUseToast   →  22 passed, 0 failed
                                  ───
Phase 7 total                    →  370 asserts green
```

Typecheck (`npm run typecheck`) clean.

---

## Cite-discipline arc — STREAK BROKEN AT 7.F SUBSTRATE; FIXED IN AUDIT-FIX

| Slice | Pre-audit fabs            | Post-audit | Notes                                      |
|-------|---------------------------|------------|--------------------------------------------|
| 7.A   | 2 HIGH-F + 2 MED          | 1 HIGH-F leaked retroactively | Streak BROKEN; "post-fix" cite itself fab — discovered in 7.F sweep #83-F |
| 7.B   | 1 HIGH-F + 1 MED          | 0          | Multi-slice regression; inherited 7.A post-fix unwittingly |
| 7.C   | 0 / 0 / 0 across 9 cites  | 0          | Streak RESTARTED                           |
| 7.D   | 0 / 0 / 0 across 9 cites  | 0          | Streak EXTENDED 1 → 2                      |
| 7.E   | 0 / 0 / 0 across 3 carry  | 0          | Streak EXTENDED 2 → 3                      |
| **7.F substrate** | **0 new cites; inherited 7.A post-fix fab into 3 doc sites without rule-9 re-OPEN** | **1 HIGH-F + 1 MED-F + 1 LOW-F** caught in sweep #83-F | **Streak BROKEN at 7.F substrate** — meta-work still carries rule 9 obligation for inherited cites |
| **7.F audit-fix** | n/a — fix sweep   | 0          | All 3 fidelity findings fixed; correct cite re-located via grep+walk |

**7.F substrate** authored 3 new docs that all inherited the
`anim_sys.cc:1473-1490` cite from 7.A's audit-fix memory without
re-OPEN. This violated rule 9 in spirit (no behavior cited from
prior memory should ship without re-verification). Sweep #83-F
caught the leak: opening the file at those lines revealed
`nlaevalchan_get_default_values()` (NLA mix-mode dispatch) — no
relationship to `replace_keys` or handle preservation.

**7.F audit-fix** re-located the correct cite via
grep-`HD_FREE`-then-walk-keyframing-call-sites:
`animrig/intern/fcurve.cc:149-164` — the `replace_bezt_keyframe_ypos`
function. Literal comment at `:151`: *"Just change the values when
replacing, so as to not overwrite handles."* This is the
byte-faithful source for DEV 28 (free bezier handle preservation
across replace).

**Lesson generalised** to a feedback memory upgrade: rule 9 must
explicitly cover doc-level cite carry-over, not just substrate
authoring. Meta-work slices that ship documentation referencing
inherited cites must re-OPEN each cite before commit, identical to
substrate cite verification.

---

## File summary

```
docs/plans/ANIMATION_PHASE_7_COVERAGE_AUDIT.md     NEW    ~220 LOC
docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md   NEW    ~330 LOC
docs/plans/ANIMATION_PHASE_7_AGGREGATE.md          NEW    ~280 LOC
docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md        EDIT   +60 LOC (banner + 7.F subsection)
docs/plans/SESSION_CLOSEOUT_..._SLICE_F.md         NEW    (this doc)
```

Net 7.F: ~890 doc LOC + 0 code LOC + 0 test asserts + 0 new DEVs.

---

## Commits this slice (2)

```
71b835b docs(plan): Phase 7 Slice 7.F SHIPPED — Test sweep + Phase 7 exit gate (SHIP-COMPLETE 6/6)
[this commit] fix(audit): Phase 7 Slice 7.F audit-fix — 1 HIGH-F + 1 MED-F + 1 LOW-F + 2 HIGH-A + 1 MED-A
```

Substrate ship was scoped as "meta-work, no audit needed", but the
dual-audit pass per `feedback_dual_audit_after_phase_ship`
discovered the substrate inherited a fab cite from 7.A's audit-fix
memory (`anim_sys.cc:1473-1490` propagated into 3 new doc sites
without rule-9 re-OPEN), plus 2 internal-architecture issues
(off-by-one commit count; streak counter inconsistency) and 1 MED
(manual checklist known-gap omission). All 6 findings fixed in the
audit-fix commit.

---

## Top queued path

**Phase 7 done.** Polish slices §7.G+ (optional, not blocking):

1. **§7.G — K-rebind preference** — extract the 170-line legacy
   K-key fan-out at `CanvasViewport.jsx:1457-1633` into a pure
   helper `writeAllKeyframesForSelection(project, time, ids)`;
   then `runAutoKey('all')` calls the helper directly instead of
   via synthetic dispatch, and the rebind preference deferred from
   7.E can ship cleanly.
2. **§7.H — Param-row auto-key parity** — close the `ParamRow.jsx`
   write path so it routes through `runAutoKey` and respects
   `project.autoKeyMode`. PHASE-7-GAP inline comment at the write
   site flags this for the next maintainer.
3. **§7.I — Active-set UI** — add a "Set Active" submenu to
   `<KeyingSetMenu>` so users can pick the active keying set
   without dev-console writes.

**Phase 8 — Close-out, deprecations, telemetry, baggage sweep**
(plan §Phase 8). Not blocked by Phase 7. Goal: Rule №2 baggage
sweep + memory audit + per-tick telemetry counters.

---

## User-side owed

- **Phase 6 manual checklist** — outstanding from prior session.
- **Phase 7 manual checklist** — authored this slice
  (`docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md`); ~20–30
  minutes; sign-off via "Phase 7 manual checklist green" in next
  session.

---

## Pre-commit state

- **Branch:** master, **0 commits ahead of origin** (clean).
- **Working tree:** about to commit 3 new docs + plan banner edit
  + memory update + this close-out.
- **Schema:** v42 (unchanged).
- **Phase 7 progress:** **6/6 SHIP-COMPLETE.** Phase 7 closes here.
- **Phase 7 commit chain:** 19 commits opened with `2ebefe4`
  (7.A substrate, 2026-05-19) and closing with this 7.F audit-fix
  (2026-05-20).
- **Cite-discipline:** Phase 7 final streak = 3 consecutive clean
  ships (7.C + 7.D + 7.E); 7.F substrate broke it via inherited
  carry-over fab; 7.F audit-fix resolved it. Rules 9 + 10 + 11
  durably holding; rule 9 generalised to cover doc-level cite
  carry-over.
