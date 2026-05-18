# Animation Phase 3 — Session-spanning close-out: Slices 3.A → 3.C

**Date**: 2026-05-18 (one day, three slices)
**Commits**: 9 commits across 3 slices (`8312433` → `5930349`),
plus this aggregate doc.
**Predecessor**: `SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_5_SLICES_KK_TO_NN.md`
(Phase 5 group-selection wrap-up that immediately preceded Phase 3 opening).

Aggregate of three same-day slices that opened and pushed Phase 3
(F-Curve modifiers) from nothing to a working editor surface. After
this batch, **F-Curve modifiers ship end-to-end in the SS editor**:
authoring (3.C UI) → data (3.A typedef + v41 migration) → live eval
(3.B two-pass evaluator). The remaining 4 sub-slices (3.D → 3.G) are
export bake passes + tests + phase exit gate.

## Slices shipped

| Slice | Path | Title | Commits | Audit (HIGH/MED/LOW) |
|-------|------|-------|---------|----------------------|
| **3.A** | #14 | FModifier substrate (schema v41 + typedefs) | `8312433` + `31a713e` + `64c8f98` | 1 HIGH (fidelity, comment-line trap) + 5 MED + 3 LOW |
| **3.B** | #14 | FModifier evaluator (live two-pass) | `506d702` + `11470f3` + `c1defaf` | 2 HIGH (logic bugs, all cites verified clean) + 1 MED + 2 fidelity docs |
| **3.C** | #14 | FCurve Modifiers N-panel UI | `5c1a930` + `da9182c` + `5930349` | 1 FAB + 6 HIGH + 4 MED + ~7 LOW |

## Phase 3 progress (post-3.C)

```
Phase 3 — F-Curve modifiers (~1 week per plan)
├─ 3.A — Schema substrate ............ SHIPPED 2026-05-18 (typedefs + v41 migration)
├─ 3.B — Modifier evaluator .......... SHIPPED 2026-05-18 (live two-pass)
├─ 3.C — Properties panel UI ......... SHIPPED 2026-05-18 (manual UI verification pending)
├─ 3.D — Cycles → IsLoop export ...... NEW TOP
├─ 3.E — Noise bake-at-export ........ queued
├─ 3.F — Test-suite buildout ......... queued (296 baseline assertions across 3.A+3.B+3.C)
└─ 3.G — Phase exit gate ............. queued
```

Phase 3 is now ~45% done by slice count (3/7) and ~75% by load-bearing
weight (the editor surface is complete; remaining slices are export-bake
+ tests + Cubism Viewer round-trip gate).

## Cumulative effect on Phase 3 surface

**Before this batch** (post-5.NN state, Phase 3 not yet opened):
- F-Curve modifiers were a queued path (#14) with no data model, no
  evaluator, no UI
- Schema was v40 (post-Phase-5 group cascade)
- Plan §3 still described scope; no implementation

**After this batch** (post-3.C state):
- **Data model**: `FCurve.modifiers?: FModifier[]` — sparse, byte-faithful
  port of Blender's `FModifier` (6 type shapes ported; 2 deferred:
  `function_generator` + `smooth`). Schema v41.
- **Evaluator**: live two-pass dispatcher in `evaluateFCurve` — reverse-
  walk time pass (Cycles/Limits/Stepped) composes effective_time;
  forward-walk value pass (Cycles/Noise/Generator/Limits/Envelope)
  composes effective_value; influence + range/blendin/blendout
  semantics matched to Blender exactly.
- **UI**: per-fcurve modifier list in the N-panel (right sidebar, `N`
  key toggle) below `ActiveKeyformPanel`. Add Modifier dropdown + per-
  modifier card with collapse/reorder/mute/remove + per-type inline
  editors for all 6 types + common range/influence section.
- **Invariants enforced**: Cycles head-of-stack (`fmodifier.cc:635`),
  EXCLUSIVE per-fcurve active flag, single-on-add active behavior
  (Blender's `add_fmodifier:1213-1215`), promote-on-remove (SS UX
  convention).
- **Fidelity discipline**: 5 intentional SS deviations documented in
  per-slice close-outs (Noise size default ms vs Blender frame, stepped
  positive-sense flag flip, legacy_noise unmapped, Generator poly_order
  derived, perlinFbm partial-octave).

## Cite-discipline arc this session

Three audit cycles, three lessons:

**3.A** — fab streak BROKEN at 3 with ONE comment-line trap fab
(`DNA_anim_types.h:341` was struct opener; real `FCurve.modifiers`
field at `:353`). Same shape as Slice 5.LL HIGH-1 (off by 3 onto a
comment line) — the lesson didn't carry over from 5.LL to 3.A. Audit-
fix sweep documented "preflight every numeric line citation against the
reference clone BEFORE spawning the fidelity audit, not after."

**3.B** — fab streak RESTORED at 1. Fidelity audit explicitly verified
all 40 Blender citations against the reference clone — every claim
landed at the cited construct. The post-3.A preflight discipline
transferred for one slice. Note: 2 HIGH findings were LOGIC bugs
(Math.floor vs C int() trunc for negative operands; range gate against
warped time instead of original evaltime), not cite fabs — fab streak
measures citation discipline, not implementation correctness. Saved
[feedback_math_trunc_when_porting_c_int.md](../../memory/feedback_math_trunc_when_porting_c_int.md)
to memory.

**3.C** — fab streak BROKEN at 1 with a MORE ELABORATE fab. The
fabricated cite was `BKE_fmodifier_remove` at `fmodifier.cc:1167-1189`:
WRONG function name (real is `remove_fmodifier`), WRONG line range
(real at `:1289-1327`), AND WRONG attributed behavior (the function
does NOT touch ACTIVE on remove; the "promote neighbor" was an
SS-invented UX convention dressed up as a Blender port). The fab was
in a single paragraph comment inside `applyRemoveModifier`'s JSDoc,
not in a numbered citation block — and that's exactly the trap: prose
claims of Blender behavior get less attention than numbered cite blocks
but carry the same fab risk. Also 5 UI label mismatches were fixed
(Cycles "Repeat" → "Repeat Motion"; Generator "Polynomial" → "Expanded
Polynomial"; etc., all from Blender's `rna_fcurve.cc` `EnumPropertyItem`
arrays). Saved
[feedback_grep_rna_for_ui_labels.md](../../memory/feedback_grep_rna_for_ui_labels.md)
to memory.

**Cumulative arc**: BROKEN at 3 (3.A) → RESTORED at 1 (3.B) → BROKEN
at 1 (3.C). The transfer of preflight discipline isn't durable yet —
each slice needs its own dedicated cite-verification pass, regardless
of how the previous slice went.

## Pre-compact state table

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead of origin | **123** (was 113 pre-session, was 117 after 3.A, was 120 after 3.B, was 122 after 3.C, plus 1 for this doc = 123) |
| Schema version | v41 (was v40 pre-session; 3.A bumped; 3.B + 3.C didn't touch schema) |
| Slices shipped this session | 3 (3.A / 3.B / 3.C) |
| Per-slice commit count | 3 + 3 + 3 + 1 (this doc) = 10 total |
| Dual audits run | 3 (one per slice) |
| Audit-fix sweeps | 3 (every slice — none audit-clean) |
| Fab streak history | broken 3.A (comment-line trap) → restored 3.B → broken 3.C (BKE_fmodifier_remove fab in prose) |
| Audit-clean ships | 0 |
| Test suites green | all (46 v41 migration + 102 fmodifiers eval + 147 fcurveModifiersPanelData + 35 fcurveEval + 80 fcurveGroups + 75 fcurveActive + 441 fcurveChannelSelect + 61 animationEngine + 42 motion3jsonRoundtrip + 35 exportAnimation + 41 projectRoundTrip + adjacent = ~1100+ assertions verified) |
| New source files (3 across 3 slices) | `src/anim/fmodifiers.js` (3.A typedefs + 3.B evaluator) + `src/store/migrations/v41_fmodifiers.js` (3.A) + `src/v3/editors/fcurve/fcurveModifiersPanelData.js` (3.C) + `src/v3/editors/fcurve/FCurveModifiersPanel.jsx` (3.C) |
| New test files (3) | `scripts/test/test_migrationV41.mjs` (46 assertions) + `scripts/test/test_fmodifiers.mjs` (102) + `scripts/test/test_fcurveModifiersPanelData.mjs` (147) |
| Modified files | `src/anim/fcurve.js` (FCurve typedef + evaluateFCurve pipeline) + `src/store/projectMigrations.js` (v41 reg) + `src/store/projectSchemaVersion.js` (40→41) + `src/v3/editors/fcurve/FCurveEditor.jsx` (mount FCurveModifiersPanel) + `src/v3/editors/fcurve/ActiveKeyformPanel.jsx` (stale comment fix) + `scripts/test/test_migration_v39.mjs` (relaxed stale ===39 pin) + `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` (3.A schema header v34→v41) + `package.json` (3 new test:* scripts) |
| New memory entries (2) | `feedback_math_trunc_when_porting_c_int.md` (from 3.B HIGH-1) + `feedback_grep_rna_for_ui_labels.md` (from 3.C HIGH-2/3/4) |
| Deviations opened (still tracked) | 10 across 3 slices (Noise size 1000ms vs Blender 1.0fr, stepped flag positive-flip, legacy_noise unmapped, Generator poly_order redundancy from 3.A; perlinFbm partial-octave + Generator poly_order=0 from 3.B; promote-on-remove SS convention, legacy_noise UI omission, Generator Order field omission, Add Modifier inline vs operator menu, per-card collapse not persisted from 3.C). All documented as intentional SS simplifications. |
| Deviations closed | 0 (all 3 slices are first-of-their-kind for Phase 3; no prior devs to close) |
| **UI manual verification** | **NOT done by Claude per `feedback_no_background`** — 3.C UI substrate has 147 unit-test assertions but the visual layout / click flow / draft-input behavior is user-side check. Close-out lists 7 verification steps. |
| Top queued path | **#14 (continued) — 3.D Cycles → motion3.json IsLoop export** (per plan §3.D: detect `before='none', after='repeat', afterCycles=0` on every fcurve in an Action → IsLoop=true; otherwise bake cycles to explicit keyforms) |

## Cumulative session progress (super-session including all 2026-05-17/18 work)

Counting from `9f957b8` (pre-5.Y baseline at start of two-day super-session):
- Slices shipped: **20** (5.Y/Z/AA/BB/CC/DD/EE/FF/GG/HH/II/JJ/KK/LL/MM/NN + 3.A/3.B/3.C)
- Total commits: **44** (across 20 slices + 3 session-spanning aggregate docs)
- Dual audits: **12** (every substrate slice)
- Audit-fix sweeps: **11**
- Audit-clean ships: **1** (5.NN — first-ever; not yet replicated)
- Fab streak history (cumulative across all 20): broken 5.Y → restored 5.AA → held AA/BB/DD/EE/KK (5) → broken 5.LL (2 HIGH) → restored MM/NN (2) → broken 3.A (comment-line trap repeat) → restored 3.B (40 cites clean) → broken 3.C (BKE_fmodifier_remove prose fab)
- Test assertions added (cumulative): ~1000+ across 6 new test files (test_fcurveChannelSelect extensions + test_keymapPresets + test_graphSelectAllCascade + test_keyformSelectionStore + test_fcurveGroupActive + test_migrationV41 + test_fmodifiers + test_fcurveModifiersPanelData)
- New memory entries (cumulative): 3 (feedback_modifier_binding_check_keymap_first generalized 5.P; feedback_math_trunc_when_porting_c_int 3.B; feedback_grep_rna_for_ui_labels 3.C)

## What's left in the whole Blender-parity scope

**Animation Plan** (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md`) — 8 phases:
- ✅ Phase 0 — Wire what already exists
- ✅ Phase 1 — Action datablock + NodeTree retirement (schema v33)
- ✅ Phase 2 — BezTriple handles (schema v34/v39)
- 🟡 **Phase 3 — F-Curve modifiers** (3.A + 3.B + 3.C SHIPPED v41 + runtime + UI; 3.D + 3.E + 3.F + 3.G queued)
- 🔲 Phase 4 — NLA stack (~1.5 weeks)
- 🟡 Phase 5 — Graph Editor write-mode (slices A→NN shipped; surface largely tapped)
- 🔲 Phase 6 — Dopesheet write-mode (~3–4 days)
- 🔲 Phase 7 — Insert Keyframe + Keying Sets (~3–5 days) + close-out

**Toolset Plan** (`docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md`) — 8 phases, all ✅ shipped.

**Remaining Animation phases: 4** (3 in-progress, 4, 6, 7). Phase 3 is
~75% by load-bearing weight (editor surface complete; export bake +
exit gate remain). Phase 5 is ~99% (group-selection surface tapped).

## Lessons across the session

1. **Cite-discipline is genuinely a per-slice habit, not a session-
   wide one.** The fab streak history this session went BROKEN →
   RESTORED → BROKEN across just 3 slices. The 3.B restoration
   (40 cites verified clean by author preflight) didn't survive into
   3.C, where the author wrote `BKE_fmodifier_remove` (a function
   that doesn't exist) at `fmodifier.cc:1167-1189` (lines that
   contain a different function entirely) attributing behavior the
   real `remove_fmodifier:1289-1327` doesn't have. The transfer
   between slices is not automatic. Going forward: every slice
   substrate ship needs its own dedicated cite-verification pass,
   independent of how the previous slice went.

2. **Prose claims of Blender behavior carry the same fab risk as
   numbered cite blocks.** 3.A's fab was a numbered cite
   (`DNA_anim_types.h:341`). 3.C's fab was a paragraph claim ("mirrors
   Blender's `BKE_fmodifier_remove` behavior") with the cite buried
   inside. Both fool the reader equally. The audit-prompt convention
   of "verify every numbered cite" needs to extend to "verify every
   prose claim that names a Blender function/struct/file."

3. **JS-vs-C numeric semantic mismatches recur across slices.**
   3.B HIGH-1 was `Math.floor` where Blender used C `int()` cast.
   The semantic mismatch (truncation toward zero vs negative infinity)
   bites for negative operands. Memory entry
   `feedback_math_trunc_when_porting_c_int` captures the rule:
   default to `Math.trunc` when porting any `int()` cast; reserve
   `Math.floor` for explicit C `floor()` or provably non-negative
   operands.

4. **UI label parity is a substantial fidelity surface.** 3.C had 3
   HIGH fidelity items that were JUST label string mismatches
   ("Repeat" vs "Repeat Motion"). The substrate author wrote
   plausible-looking strings without grepping Blender's RNA enums.
   Memory entry `feedback_grep_rna_for_ui_labels` captures the rule:
   grep `rna_*.cc` for `EnumPropertyItem` arrays and paste labels
   verbatim. Data keys can stay SS-convention (British spelling for
   `polynomial_factorised`); only the user-facing labels need to flip
   to American per Blender.

5. **Two parallel audit agents catch different things, consistently.**
   Across 3 slices this session: arch found 6 HIGHs (logic bugs, doc
   lies, missing predicates, convention drift); fidelity found 7 HIGHs
   (1 FAB + 6 label/field mismatches; 0 logic-correctness findings).
   Neither agent caught both categories. The dual-audit convention
   from `feedback_dual_audit_after_phase_ship` is load-bearing and
   should NOT be optional even for UI slices where the cite surface
   is thin.

6. **The fab pattern keeps evolving.** First it was numbered cites
   landing on comment lines (5.LL `:347` and 3.A `:341`). Then it
   was attribution to wrong functions (`mouse_anim_channels` vs
   `click_select_channel_group` in 5.LL). Now it's wholesale
   fabrication of function names + line ranges + attributed behavior
   in prose (3.C `BKE_fmodifier_remove` — function doesn't exist, lines
   contain something else, behavior is SS-invented). Each cycle the
   audit-fix sweep names the prior trap as a thing to watch for; each
   cycle the next slice invents a new variation. **The cite-discipline
   meta-lesson: name the CATEGORY of fab (e.g. "any claim that names a
   Blender function/struct/enum") in the audit prompt, not just the
   prior incident's specific shape.**

7. **Manual UI verification is the dual-audit's blind spot.** 3.C
   ships 147 unit-test assertions over the data layer + dispatcher
   logic. The dual-audit reviewed code. NEITHER caught actual UI
   regressions because neither can click a button. Per
   `feedback_no_background` I didn't start the dev server unprompted;
   the close-out doc explicitly lists 7 user-side verification steps.
   The convention worth establishing: every UI-bearing slice's
   close-out should call out the verification gap explicitly so the
   "tested" claim doesn't overpromise.

8. **Substrate slices benefit from composition tests.** 3.B's audit-
   fix sweep added 5 regression tests, all of which test compositions
   (e.g. stepped warps t into limits' restricted range; cycles +
   stepped reverse-walk order). Per-type tests catch unit bugs;
   composition tests catch integration bugs that the per-type lens
   misses. Convention: when adding per-type evaluators, pair every
   per-type test with at least one composition test using the new type
   alongside another.

## Ready for `/compact`.
