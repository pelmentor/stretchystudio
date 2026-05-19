# Phase 7 — Coverage audit (Slice 7.F deliverable 1/3)

**Date:** 2026-05-20
**Slice:** 7.F (test sweep + Phase 7 exit gate)
**Question answered:** Does the existing automated-test surface satisfy
plan §7.F's prescribed 5 test files?

**Conclusion:** **Yes — all 5 prescribed test names are subsumed by
existing suites at strictly higher coverage breadth.** No new test
files are needed for 7.F. The substrate work for 7.F is the manual
checklist + phase exit gate + this audit; no new code.

---

## Method

Per `feedback_byte_verify_behavior_cites` rule 9, each existing suite
was re-OPENED end-to-end and the assertions cross-referenced against
the plan §7.F table at `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md`
line 2723. The matrix below lists each prescribed file, the suite(s)
that subsume it, and the specific section(s) inside each subsuming
suite that provide the coverage.

A "subsumes" claim requires:

1. Every behavior the prescribed test would have asserted is covered
   by at least one section of the subsuming suite.
2. The subsuming suite asserts strictly MORE behavior than the
   prescribed one (otherwise we'd just rename for clarity).
3. The subsuming suite is wired into `npm test` (audit verified
   2026-05-20 against `package.json:231-235` + `:328` master chain).

---

## Coverage matrix

| Plan §7.F prescribed                | Subsumed by                                  | Subsuming sections                              | Subsumed assert count |
|-------------------------------------|----------------------------------------------|-------------------------------------------------|-----------------------|
| `test_keyingSet_builtin.mjs`        | `scripts/test/test_keyingSets.mjs`           | §1–§7                                           | ~90 / 144             |
| `test_keyingSet_userDefined.mjs`    | `scripts/test/test_keyingSets.mjs`           | §8 + §9 + §10 + §11                             | ~40 / 144             |
| `test_insertKeyframe_replace.mjs`   | `scripts/test/test_insertKeyframe.mjs`       | §4 + §6 + §11 + §19                             | ~25 / 87              |
| `test_insertKeyframe_onlyNeeded.mjs`| `scripts/test/test_insertKeyframe.mjs`       | §5                                              | ~5 / 87               |
| `test_autoKey_keyingSet.mjs`        | `scripts/test/test_autoKeyDispatch.mjs`      | §2 + §4 + §5                                    | ~25 / 48              |

Each row's subsumption claim is unpacked below with the exact
behavior coverage.

---

### Row 1 — `test_keyingSet_builtin.mjs`

**Plan-prescribed scope:** "Each built-in set collects the right
channels."

**Subsumed by:** `test_keyingSets.mjs` §1 (registry shape, 7 built-in
ids, isBuiltin flag, label/description presence, DEV 20 Scaling-vs-
Scale, insertNew flags, null-id guards) + §2 (Location on non-bone
object: 2 paths, multi-object iteration, unknown-id silent filter) +
§3 (Pose paths on bone group: DEV 22 Euler-only Rotation, DEV 21
per-component Scaling, object-vs-bone path-prefix divergence) + §4
(LocRotScale composite: Blender :126-144 order pin) + §5 (BlendShape:
DEV 24 SS-original, per-mesh blendShapeValues iteration, no-shapes
empty-emit, non-part empty-emit) + §6 (AllParams: DEV 25 SS-original,
project-wide iteration, objectIds-ignored, empty-parameters empty) +
§7 (Available: walks fcurves, MED-1 shared-action group attribution,
defensive dedup, non-owner filter, no-animData empty) + §12
(collectChannels resilience — null project / null set / null
objectIds / empty-name fallback for every emit site).

Every one of the 7 built-ins (`Available`, `Location`, `Rotation`,
`Scaling`, `LocRotScale`, `BlendShape`, `AllParams`) has dedicated
channel-collection assertions, plus negative-space coverage that a
single-purpose `test_keyingSet_builtin.mjs` would not have included
(empty-name MED-2 audit-fix; shared-action MED-1 audit-fix).

---

### Row 2 — `test_keyingSet_userDefined.mjs`

**Plan-prescribed scope:** "Custom set CRUD."

**Subsumed by:** `test_keyingSets.mjs` §8 (active keying-set pointer:
get, set, null-clear, throws on unknown id, throws on null project)
+ §9 (`addKeyingSet` creates array + inserts; isBuiltin=false; rejects
built-in id shadow; rejects duplicate id; rejects missing paths;
rejects empty path string; `removeKeyingSet` true/false return;
refuses to remove built-in; active pointer auto-clears on owner
remove) + §10 (`cloneKeyingSet` returns new id, isBuiltin=false,
snapshots resolved paths, label inheritance vs newLabel override,
clone of user set copies static paths, rejects built-in id target,
rejects duplicate target id, rejects unknown source) + §11
(`listKeyingSets` ordering: built-ins first in canonical order, user
sets after in insertion order, shadow-attempt rejection, null/empty
project returns built-ins).

Full CRUD lifecycle (add, remove, clone, list, active-pointer
management) — strictly broader than `test_keyingSet_userDefined.mjs`
would have shipped (the prescribed test name omits clone + list +
active-pointer surfaces).

---

### Row 3 — `test_insertKeyframe_replace.mjs`

**Plan-prescribed scope:** "Replace existing key at time."

**Subsumed by:** `test_insertKeyframe.mjs` §4 (same-time insert
counts as replace, status='replaced', value updated, sibling keyform
unchanged) + §6 (REPLACE flag explicit: replaces existing key at
time, skipped-replace status for no-fcurve, REPLACE overrides NEEDED
when both set, no-existing-key-time skip leaves keyform count
unchanged) + §11 (TIME_EPSILON_MS = 0.5: time-within-epsilon replaces
single keyform; time-outside-epsilon inserts new) + §19 (audit-fix
MED-1: 'free' handle preservation across replace; mixed free+auto
handle types).

Covers both implicit-replace (no flag) and explicit-REPLACE (flag bit)
paths plus the epsilon-boundary case that a single-purpose test would
likely have missed. §19's free-handle preservation is the audit-fix
that validates SS doesn't smash user-authored bezier handles on
replace — a behavior Blender preserves at
`animrig/intern/fcurve.cc:149-164` (`replace_bezt_keyframe_ypos` —
literal comment at `:151`: *"Just change the values when replacing,
so as to not overwrite handles."*).

> Audit-fix HIGH-F sweep #83-F (2026-05-20): pre-fix cite was
> `anim_sys.cc:1473-1490` (inherited from 7.A's audit-fix without
> re-OPEN per rule 9). That range is inside
> `nlaevalchan_get_default_values()` (NLA mix-mode dispatch) — no
> `replace_keys` symbol, no handle logic. Re-located via
> grep-`HD_FREE`-then-walk-keyframing-call-sites in Slice 7.F audit.
> The cite-discipline streak narrative through 7.A's audit-fix
> (sweep #78) was retroactively broken when this slice's audit
> re-verified the post-fix.

---

### Row 4 — `test_insertKeyframe_onlyNeeded.mjs`

**Plan-prescribed scope:** "Skip when value matches."

**Subsumed by:** `test_insertKeyframe.mjs` §5 (NEEDED flag: skip when
current value matches eval, status='skipped-needed'; NEEDED on missing
fcurve still creates fcurve — matches Blender semantics where NEEDED
only governs comparison-against-existing); plus negative-space §10
(non-finite value paths bypass NEEDED comparison entirely and route
to skipped-non-finite).

The §5 assertions exercise both the skip path (values match → no
write) and the proceed path (values differ → replace), which is the
full NEEDED state machine.

---

### Row 5 — `test_autoKey_keyingSet.mjs`

**Plan-prescribed scope:** "Auto-key respects active set."

**Subsumed by:** `test_autoKeyDispatch.mjs` §2 (`pickActiveSetIdForAutoKey`:
active built-in wins, BlendShape active wins, stale active id falls
back to LocRotScale) + §4 (`runAutoKey('activeSet')` end-to-end with
real `useProjectStore` integration: active=Rotation writes
transform.rotation fcurve at correct value; no active falls back to
LocRotScale and writes 5 channels; verifies NO synthetic-K is
dispatched — only direct `execApplyKeyingSet` invocation) + §5
(`runAutoKey('available')` with one pre-existing fcurve: only existing
channel is keyed, no new fcurves created; mirrors Blender's
INSERTKEY_AVAILABLE-via-set-collection equivalence per DEV 31).

The §4 + §5 sections invoke `runAutoKey` against a real project store
with real `applyKeyingSet` writes — strictly broader than the
prescribed single-purpose test (which would have stopped at the
"active set is read" boundary). The end-to-end mutation verification
also covers the audit-fix M-1 membership check, the sparse-write
`?? 'all'` coalescing path, and the `LocRotScale` fallback when
`activeKeyingSetId` is stale.

---

## Coverage of behavior the §7.F table did NOT prescribe

The five prescribed test names cover the core Phase 7 surface but
not the full set of behaviors shipped across 7.A–7.E. The existing
suites add the following coverage *beyond* §7.F's table:

- **`test_insertKeyframe.mjs` §15** — input validation throws (null
  project, unknown setId, NaN time, non-number time) per Rule №1.
- **`test_insertKeyframe.mjs` §17** — `applyKeyingSet` leaves project
  untouched on Available-set-with-no-fcurves early return.
- **`test_insertKeyframe.mjs` §18** — HIGH-1 audit-fix: invalid-path
  status surfaces; counter increments; sibling valid path still
  inserts (non-toxic failure).
- **`test_insertKeyframe.mjs` §20** — LOW-1 audit-fix: malformed
  action default status routes by flag (no-action / skipped-available
  / skipped-replace).
- **`test_keyingSetMenu.mjs` §1–§5** (69 asserts) — full I-menu
  operator integration: null-project guard, empty/null setId guard,
  unknown setId guard, NaN/Infinity time guard, happy path with live
  values 17.5 / 0.7 from `paramValuesStore` (closes 7.B's MED-3 trap
  where `evaluateRnaPath` returned STATIC param defaults instead of
  live store values).
- **`test_kKeyFirstUseToast.mjs` §1–§3** (22 asserts) — toast
  pref roundtrip, `__ssAutoKey` sentinel tag, descriptor
  contract pin (MED-2 audit-fix).
- **`test_autoKeyDispatch.mjs` §1** — mode coalescing (sparse field,
  null/undefined, unknown-value console-warn path).
- **`test_autoKeyDispatch.mjs` §6** — sparse storage roundtrip
  (Rule №2 compliance).

---

## Aggregate Phase 7 test count

| Suite                                  | Asserts | Slice |
|----------------------------------------|---------|-------|
| `test_keyingSets.mjs`                  | 144     | 7.A   |
| `test_insertKeyframe.mjs`              | 87      | 7.B   |
| `test_keyingSetMenu.mjs`               | 69      | 7.C   |
| `test_autoKeyDispatch.mjs`             | 48      | 7.D   |
| `test_kKeyFirstUseToast.mjs`           | 22      | 7.E   |
| **Total Phase 7 net-new automated**    | **370** |       |

All 5 suites wired into the `npm test` master chain at
`package.json:328`. Subset run (each suite independently) passes
locally on `master` at `4991662`.

---

## Decision

**7.F ships zero new test files.** The plan §7.F table is satisfied
by the existing suites. 7.F's substrate work is:

1. **This audit doc** (`ANIMATION_PHASE_7_COVERAGE_AUDIT.md`).
2. **Phase 7 manual checklist** (`ANIMATION_PHASE_7_MANUAL_CHECKLIST.md`)
   for user-visible behaviors automated tests don't cover (UI
   keybindings, toast wording, menu interaction, mode dropdown).
3. **Phase 7 exit gate** — plan banner update from
   "Slice remaining: 7.F" → "Phase 7 SHIP-COMPLETE 6/6" + this
   slice's close-out doc + a Phase 7 phase-aggregate doc rolling up
   all 6 slices.

---

## Rule alignment

- **Rule №1.** No crutch in "subsumed by" claims; each row enumerates
  exact subsuming sections. If a future reader doubts the
  subsumption, they can re-open the named suite and re-verify the
  named section in O(1).
- **Rule №2.** No new test files means no future-rename baggage. The
  plan §7.F filenames are documented here as "subsumed under existing
  names" so a future maintainer searching for the prescribed name
  lands here and follows the pointer to the actual suite.
- **`feedback_byte_verify_behavior_cites` rule 9.** Every suite cited
  in this audit was re-OPENED end-to-end at 2026-05-20 (not
  inherited from prior session memory).
- **`feedback_dual_audit_after_phase_ship`.** The substrate-and-fix
  ship cadence continues at 7.F (dual-audit pass after this commit).
