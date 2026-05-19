# Session Close-out — Animation Phase 7 Slice 7.B (Insert Keyframe operator)

**Session date:** 2026-05-19.
**Slice:** 7.B — Insert Keyframe kernel + `applyKeyingSet` operator.
**Commits:** `5bd0982` (substrate) + `de91759` (audit-fix).
**Branch:** master.
**Schema:** v42 (unchanged — kernel is read-substrate-then-write; no new project fields).
**Status:** **SUBSTRATE-COMPLETE.** Kernel ships; UI integration is 7.C.

---

## What 7.B shipped

### Substrate — `src/anim/insertKeyframe.js` (~410 LOC after audit-fix)

- `INSERTKEY_FLAGS` — frozen subset of Blender's `eInsertKeyFlags`
  (NOFLAGS, NEEDED, REPLACE, AVAILABLE) with byte-faithful bit
  positions for forward-compat.
- `applyKeyingSet(project, setId, objectIds, time, flags, options)` —
  top-level operator. Walks `collectChannels(set, objectIds)`,
  resolves owner action per channel via `resolveTargetAction`, calls
  `insertKeyformAtInAction` per channel. Returns
  `{count, results, skippedNoAction, skippedInvalidPath}`.
- `wouldApplyKeyingSetChange(...)` — pure predicate; no mutation.
- Internal helpers: `resolveTargetAction`, `buildFCurveForPath`,
  `findKeyformAt`, `insertKeyformAtInAction`.

### Tests — `scripts/test/test_insertKeyframe.mjs` (87 asserts after audit-fix)

20 sections covering INSERTKEY_FLAGS bit values, basic insert/replace
flow, NEEDED/REPLACE/AVAILABLE flag semantics, `__params__`/`__scene__`
routing (DEV 28), bone path routing, Available set integration,
no-animData skip, NaN/Infinity skip, time-epsilon (DEV 27), predicate
4-scenario coverage, input validation throws (Rule №1), user-defined
set integration, no-mutation guarantee on early-return paths, +
audit-fix regression coverage for HIGH-1 (invalid-path status) /
MED-1 (free-handle preserve) / LOW-1 (malformed-action fallback).

Wired into master `npm test` chain.

---

## SS DEVIATIONS new this slice (26-29)

| # | What | Honesty class |
|---|------|----------------|
| 26 | VALUE_EPSILON = 1e-4 for INSERTKEY_NEEDED comparison; tighter than animrig's only `compare_ff` call (`action.cc:762` uses `0.001f`). Audit-fixed rationale (HIGH-F1: pre-fix claimed Blender "default"; no such default exists). | Empirical (honest, post-fix) |
| 27 | TIME_EPSILON_MS = 0.5 (SS canonical ms; Blender uses 0.01f frames per `BKE_fcurve.hh:217`). Same epsilon as Slice 6.C DEV 6. | Honest divergence |
| 28 | `__params__` / `__scene__` paths route to `__scene__`'s `animData.actionId`. Object paths route to that object's animData. Mirrors Blender's `Scene.animation_data` for scene-level fcurves. | 1:1 mapping shift |
| 29 | `INSERTKEY_REPLACE` and `INSERTKEY_AVAILABLE` distinguished in result-status reporting (REPLACE → `skipped-replace`; AVAILABLE → `skipped-available`). Blender's enum at `DNA_anim_enums.h:522` notes REPLACE implies AVAILABLE's no-creation behavior; SS keeps them orthogonal for UI clarity. | UI-driven divergence |

All 4 deviations audit-verified.

---

## Audit findings + fixes (sweep #79)

**Architecture audit:** **1 HIGH + 5 MED + 3 LOW.**
**Blender-fidelity audit:** **1 HIGH-F + 1 MED-F + 2 LOW-F.**

| Finding | Class | Fix |
|---------|-------|-----|
| HIGH-1 | Substrate contract violation | `buildFCurveForPath` null returned `'skipped-available'` not `'skipped-invalid-path'`; misclassified diagnostic + undercounted counter. Fixed. |
| MED-1 | Free-handle destruction | `recalcKeyformHandles` explicitly skips `'free'` handles; pre-fix wipe-then-recalc destroyed user offsets. Guard added. |
| MED-2 | Predicate/op semantic divergence | `count` (channels-written) vs `wouldApplyKeyingSetChange` (state-changed) answer different questions; documented in both JSDocs. |
| MED-3 | `__params__` resolver trap | Default resolver returns static `project.parameters[*].default` not live value. Elevated to WARNING-level JSDoc for 7.C/7.D integrators. |
| MED-4 | Test coverage | Added §18 (HIGH-1 regression) + §20 (LOW-1 branches). |
| MED-5 | Memoization advisory | Matches 7.A `listKeyingSets` pattern; JSDoc note added to `wouldApplyKeyingSetChange`. |
| LOW-1 | Malformed-action default | Default branch was `'skipped-available'`; fixed to `'skipped-no-action'`. |
| LOW-2 | Cross-slice DEV cite | Naming clarified; DEV 27 is this slice's index; 6.C DEV 6 is upstream. |
| LOW-3 | `__scene__`-absent silent skip | Documented; matches substrate's defensive style. |
| HIGH-F1 | DEV 26 `compare_ff` fab | Claim "Blender `compare_ff` default = 1e-4" was invented (compare_ff takes max_diff as required parameter). Rewrote DEV 26 with empirical rationale + literal sibling-call cite. |
| MED-F1 | DEV 29 quote precision | `DNA_anim_enums.h:522` literal text was paraphrased then quoted. Re-quoted literally; equivalence explained in surrounding prose. |
| LOW-F1 | `:464` off-by-one | Cited `:464-:465` (assert + return). |
| LOW-F2 | Call-site range tightening | `:459` → `:459-:460` (multi-line call). |

All findings addressed in audit-fix commit `de91759`.

**+15 test asserts** post-fix (72 → 87).

---

## Memory rule 10 + rule 11 added

In `feedback_byte_verify_behavior_cites` memory entry:

- **Rule 10** — Cite the LITERAL source value for constants/defaults/
  thresholds. Rule 9 ("re-OPEN every cite") catches file/function-
  doesn't-exist fabs; rule 10 closes the content-claim-fab gap (the
  7.B HIGH-F1 case: function exists, signature read, but claim
  about its content was fabricated from training-data memory).
- **Rule 11** — "Comment says X" promotes X to byte-quotation. Use
  "comment implies / notes that" to license paraphrase. The 7.B
  MED-F1 case: literal comment was paraphrased then quoted.

The 7.B HIGH-F1 was authored DESPITE the substrate docstring opening
with "RE-OPENED per memory rule 9, post-7.A regression" — rule 9 was
applied per file-existence but not per content-claim. Rules 10+11
specifically target this failure mode for 7.C onwards.

---

## Cite-discipline arc — REGRESSION CONFIRMED MULTI-SLICE

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.F.2 | 0 | 0 LOW-F | 4th consecutive clean (Phase 6) |
| **7.A** | **2 HIGH-F + 1 MED-F** | All fixed | Streak BROKEN (1 slice in Phase 7) |
| **7.B** | **1 HIGH-F + 1 MED-F** | All fixed | **Multi-slice regression confirmed** |

The 7.A regression looked like a one-off; 7.B confirmed the pattern
is structural. Both Phase 7 slices had a HIGH-F fab + a MED-F
paraphrase-as-quote. The fab mode shifted between slices:
- 7.A: "didn't open the file" (function doesn't exist at cited line)
- 7.B: "opened file, read function, invented content claim"

Rule 9 catches 7.A-style fabs; rules 10+11 are added specifically
for 7.B-style fabs. Whether they hold at 7.C is the test.

---

## File summary

```
src/anim/insertKeyframe.js          ~410 LOC  NEW + audit-fix
scripts/test/test_insertKeyframe.mjs +87      NEW + audit-fix (+15)
package.json                        +2 lines  EDIT test:insertKeyframe wire
```

---

## Commits this slice (2)

```
5bd0982 feat(anim): Phase 7 Slice 7.B — Insert Keyframe kernel + applyKeyingSet operator
de91759 fix(audit): Phase 7 Slice 7.B audit-fix — 2 HIGH + 6 MED + 5 LOW
```

Plus this close-out + plan banner update (1 commit).

---

## Top queued path

**Slice 7.C — `I`-key menu UI.** Plan §7.C specifies:

> The `I` hotkey in CanvasViewport (and TimelineEditor) opens a menu
> listing all registered keying sets. Click → invoke
> `animation.insertKeyframe(set.id)`.
>
> Default visible set: pick the first applicable from the active
> object type (Object → LocRotScale; Bone → Rotation; Mesh in
> BlendShape mode → BlendShape).

Blender refs to re-OPEN per rule 9 + verify per content per rule 10:

- `editors/animation/keyframing.cc:569-580` —
  `ANIM_OT_keyframe_insert_menu` (the I-key menu invoker).
- `keymap_data/blender_default.py:1402` — I-key binding to
  `anim.keyframe_insert`. **Re-verify the bind name + line.**
- The menu construction lives in `keyframing.cc:535-560` (preferred
  shape: bind each set to a numbered hotkey within the menu via
  `ANIM_OT_keyframe_insert_by_name`).

UI integration: SS doesn't have Blender's `WM_menu_invoke` —
substitute is a popover / dropdown via Radix. Existing analog:
the `ApplyMenu` from Phase 6 Toolset. Re-use the popover host.

7.C also needs the runtime value resolver wired (the WARNING-level
trap from MED-3): a paramValuesStore-aware resolver that returns
live values for `__params__` paths. The substrate exposes
`options.resolveValue`; UI wires it once at the I-key handler.

Estimated 7.C: ~3-4hr substrate + 1hr audit-fix + 30min close-out.

---

## User-side owed

Nothing new this slice — 7.B is internal substrate. Manual verification
accrues at 7.F (Phase 7 exit gate).

---

## Pre-commit state

- **Branch**: master, 194 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit this close-out + plan banner.
- **Schema**: v42 (unchanged).
- **Phase 7 progress**: 7.A + 7.B SUBSTRATE-COMPLETE; 4 slices remaining
  (7.C / 7.D / 7.E / 7.F).
- **Cite-discipline**: 2-slice regression in Phase 7 (7.A + 7.B);
  memory rules 10 + 11 added. 7.C will test the new rules.
