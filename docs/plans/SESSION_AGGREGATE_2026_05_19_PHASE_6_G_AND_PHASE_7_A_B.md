# Session Aggregate — Phase 6 SHIP-COMPLETE + Phase 7 Slices 7.A + 7.B (2026-05-19)

**Session date:** 2026-05-19 (continuation from session aggregate `8963a31`
covering Phase 6 Slices 6.E + 6.F.1 + 6.F.2).
**Branch:** master (195 commits ahead of origin/master; +7 this session).
**Schema:** v42 (unchanged across all 3 ship cycles this session).
**Status:** Phase 6 SHIP-COMPLETE. Phase 7: 2/6 slices SUBSTRATE-COMPLETE.

---

## Cycles shipped this session

| Cycle | Commits | New module(s) | Asserts |
|-------|---------|---------------|---------|
| Phase 6 Slice 6.G (exit gate) | `ab3daef` | — | 752 wired into chain (existing) |
| Phase 7 Slice 7.A (Keying Set registry) | `2ebefe4` + `768d25c` + `3d0b049` | `src/anim/keyingSets.js` | 144 |
| Phase 7 Slice 7.B (Insert Keyframe op) | `5bd0982` + `de91759` + `577ebdd` | `src/anim/insertKeyframe.js` | 87 |

Total this session: **7 commits**; **2 new substrate modules**; **231 new test asserts**.

---

## 1. Phase 6 Slice 6.G — Exit gate (PHASE 6 SHIP-COMPLETE)

Commit: `ab3daef`. Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_G.md`.

Three deliverables, no new code substrate:

1. **Test sweep + master `npm test` wiring** — All 8 Phase 6 scripts
   (60+61+70+83+107+56+48+59 = 544 asserts) confirmed green; plus
   cross-slice extended suites (dopesheetRows 75, fcurveGroups 89,
   keyformSelectionStore 25, graphEditOps 115, fcurveMute 124 — 752
   total under Phase 6 gating). All 8 + Phase 4.E oversight `test:bakeNla`
   (110) wired into master chain (between `test:nlaEditorOps` and
   `test:fmodifiers`).
2. **Cross-slice review** — 19 SS DEVIATIONs (Phase 6) reviewed for
   Rule №2 honesty; gate-pattern consistency table verified across all
   6 keymap-bound slices (6.B → 6.F.2); every shipped slice has a
   close-out doc + 2 cross-slice aggregates.
3. **Manual checklist** — `ANIMATION_PHASE_6_MANUAL_CHECKLIST.md` (9
   sections, ~30-40min user sweep modelled after PHASE_3_MANUAL_*).

**Phase 6 SHIP-COMPLETE** — 7 substrate slices (6.A → 6.F.2) + 1 exit
gate, all 2026-05-19. **Closes 1 grievance** (Dopesheet read-only).

---

## 2. Phase 7 Slice 7.A — Keying Set registry

Commits: `2ebefe4` (substrate) + `768d25c` (audit-fix) + `3d0b049` (close-out).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_A.md`.

**Substrate.** New `src/anim/keyingSets.js` (~500 LOC after audit-fix):

- 7 built-in keying sets (Blender ports: Available, Location, Rotation,
  Scaling, LocRotScale; SS-original: BlendShape, AllParams) in
  canonical menu order matching `keyingsets_builtins.py:647-670`.
- `getKeyingSet` / `listKeyingSets` / `getActiveKeyingSet` /
  `setActiveKeyingSet` lookup + active-pointer mutators.
- `collectChannels(project, set, objectIds)` — built-in `collect`
  dispatch + user-defined static `paths[]`.
- `addKeyingSet` / `removeKeyingSet` / `cloneKeyingSet` — CRUD for
  user-defined sets (built-ins read-only; throws on shadow attempts).

**Schema:** sparse fields `project.keyingSets[]` + `project.activeKeyingSetId`
(default `[]` / `null`). No migration; built-ins live in module static.

**Tests:** 144 asserts across 12 sections.

**SS DEVIATIONs (20-25):** Scaling id-vs-label split (DEV 20); per-
component RNA paths vs Blender array_index (DEV 21); rotation
Euler-only collapse (DEV 22); user-defined sets project-scoped
(DEV 23); BlendShape SS-original (DEV 24); AllParams SS-original (DEV 25).

**Audit sweep #78** — **Cite-streak BROKEN at 7.A** (1 slice in
Phase 7). Blender-fidelity: **2 HIGH-F + 1 MED-F + 1 LOW-F.**
Architecture: 0 HIGH + 2 MED + 4 LOW. All fixed same-day in `768d25c`:

- HIGH-F1 (`keyingsets.cc:355-364 BKE_keyingset_add_path`) — complete
  fab; real defn at `anim_sys.cc:173`; cited range was `remove_keyingset_button_exec`.
- HIGH-F2 — orphan `(:157-162)` cite attached visually to wrong file.
- MED-F — `keyingsets_builtins.py:72-73` constant-vs-literal split.
- MED-A1 — `availablePaths` group attribution wrong for shared-action;
  filter by `objects["${oid}"]` prefix (mirrors Blender basePath at
  `_keyingsets_utils.py:157-160`).
- MED-A2 — `node.name ?? id` → `node.name || node.id` at 11 sites
  (empty-string fallback).
- + 4 LOW (selector trap JSDoc, silent-empty-snapshot JSDoc, test
  coverage, cite range polish).

**Memory rule 9 tightened** mid-audit-fix to "re-OPEN, not just re-source:
every cite must come from a same-session file open. Draft notes are
stale by definition."

---

## 3. Phase 7 Slice 7.B — Insert Keyframe kernel + applyKeyingSet operator

Commits: `5bd0982` (substrate) + `de91759` (audit-fix) + `577ebdd` (close-out).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_B.md`.

**Substrate.** New `src/anim/insertKeyframe.js` (~410 LOC after audit-fix):

- `INSERTKEY_FLAGS` — frozen subset of Blender's `eInsertKeyFlags`
  (NOFLAGS, NEEDED, REPLACE, AVAILABLE); bit positions mirror Blender
  at `DNA_anim_enums.h:500-525` for forward-compat.
- `applyKeyingSet(project, setId, objectIds, time, flags, options)` —
  top-level operator. 9-status per-channel result enum (`inserted`/
  `replaced`/`created-fcurve`/`skipped-needed`/`skipped-replace`/
  `skipped-available`/`skipped-invalid-path`/`skipped-no-action`/
  `skipped-non-finite`). Returns `{count, results, skippedNoAction,
  skippedInvalidPath}` for UI feedback.
- `wouldApplyKeyingSetChange(...)` — pure predicate; no mutation.
- Internal: `resolveTargetAction` (`__params__`/`__scene__` routing per
  DEV 28), `buildFCurveForPath`, `findKeyformAt`, `insertKeyformAtInAction`.

**Tests:** 87 asserts across 20 sections.

**SS DEVIATIONs (26-29):** VALUE_EPSILON empirical (DEV 26); TIME_EPSILON_MS
0.5 sister to 6.C DEV 6 (DEV 27); `__params__`/`__scene__` routing
(DEV 28); REPLACE+AVAILABLE distinguished in result-status (DEV 29).

**Audit sweep #79** — Blender-fidelity: **1 HIGH-F + 1 MED-F + 2 LOW-F.**
Architecture: **1 HIGH + 5 MED + 3 LOW.** All fixed same-day in `de91759`:

- **HIGH-F1** — DEV 26 `compare_ff` "default = 1e-4" was fabricated;
  `compare_ff(a, b, max_diff)` at `blenlib/intern/math_base_inline.cc:457-460`
  takes max_diff as a REQUIRED parameter; there IS no default. Closest
  sibling at `animrig/intern/action.cc:762` uses `0.001f` (10× looser
  than SS). New failure mode: **content-claim fab** — file exists,
  function exists, signature read, but claim ABOUT the function was
  invented from training-data memory.
- HIGH-A1 — `buildFCurveForPath` null returned `'skipped-available'`
  not `'skipped-invalid-path'` (Rule №1 contract violation).
- MED-A1 — Handle reset on replace destroyed user-authored `'free'`
  handles silently (`recalcKeyformHandles` skips them; pre-fix wipe
  lost offsets permanently).
- MED-F1 — DEV 29 cited `DNA_anim_enums.h:522` as comment "says
  'AVAILABLE is implied by REPLACE'"; actual literal text "Don't
  create new F-Curves (implied by #INSERTKEY_REPLACE)". Paraphrased-
  as-quoted.
- + 4 MED + 5 LOW (predicate/op divergence docs, `__params__` resolver
  WARNING, test coverage, memoization advisory, malformed-action
  fallback, cite range polish).

**Memory rules 10 + 11 added** mid-audit-fix:

- **Rule 10** — Cite the LITERAL source value for constants/defaults/
  thresholds. Rule 9 catches file/function-doesn't-exist fabs;
  rule 10 closes the content-claim-fab gap.
- **Rule 11** — "Comment says X" promotes X to byte-quotation. Use
  "comment implies / notes that" to license paraphrase.

---

## Cite-discipline arc — MULTI-SLICE PHASE 7 REGRESSION

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.D (prior) | 0 | Clean | Streak break — 5-slice fab streak ended |
| 6.E (prior) | 0 | 3 LOW-F | 2nd clean |
| 6.F.1 (prior) | 0 | 2 LOW-F | 3rd clean |
| 6.F.2 (prior) | 0 | 0 LOW-F | **4th clean — false automaticity sense** |
| **7.A** | **2 HIGH-F + 1 MED-F** | All fixed | Streak BROKEN |
| **7.B** | **1 HIGH-F + 1 MED-F** | All fixed | **Multi-slice regression confirmed** |

The 4-slice Phase 6 clean streak (6.D + 6.E + 6.F.1 + 6.F.2) gave
false automaticity. Phase 7 immediately regressed with TWO consecutive
fab slices. Distinct failure modes:

- **7.A failure mode**: "didn't open the file" — function names spelled
  right but line numbers + cited content was for unrelated functions.
  Rule 9 was DECLARED in substrate docstring but NOT APPLIED per-cite.
- **7.B failure mode**: "opened file, read signature, invented content
  claim" — `compare_ff` exists, signature was read, but the claim that
  it has a "default of 1e-4" was fabricated from training-data memory.
  Rule 9 catches file-doesn't-exist but not content-claim fabs.

**Three memory rules added across the two slices:**

- Rule 9 (tightened on 7.A) — re-OPEN every cite per slice, not just
  re-source. Catches 7.A-style fabs.
- Rule 10 (new on 7.B) — literal-source-value for constants/defaults/
  thresholds. Closes the content-claim-fab gap.
- Rule 11 (new on 7.B) — "comment says X" promotes X to byte-quotation.
  Catches paraphrase-as-quote near-fabs.

**Open question for Phase 7 onward:** whether rules 10+11 hold at
7.C/7.D/7.E/7.F or whether the regression continues. The 4-slice clean
streak was the longest in Animation phases (Phases 0-6 mostly had
1-2 clean then 1 fab); Phase 7 may need different discipline (e.g.,
mandatory pre-ship blender-fidelity-agent dry-run instead of
post-substrate dual-audit).

---

## SS DEVIATIONs cumulative (Phase 7: 10 new this session)

Phase 6 cumulative: 19 (DEV 1-19).
Phase 7 new this session: 10 (DEV 20-29).

| # | Slice | What | Class |
|---|-------|------|-------|
| 20 | 7.A | Scaling id="Scaling" + label="Scale" split | Faithful |
| 21 | 7.A | Per-component RNA paths vs vector+array_index | Substrate divergence |
| 22 | 7.A | Rotation Euler-only collapse (no quat/axis_angle) | 2D-only model |
| 23 | 7.A | User-defined sets project-scoped vs scene-scoped | 1:1 mapping shift |
| 24 | 7.A | BlendShape set SS-original | SS feature |
| 25 | 7.A | AllParams set SS-original | SS feature |
| 26 | 7.B | VALUE_EPSILON = 1e-4 empirical (post-audit-fix rationale) | Empirical |
| 27 | 7.B | TIME_EPSILON_MS = 0.5 (SS canonical ms; same as 6.C DEV 6) | Time-discipline |
| 28 | 7.B | `__params__`/`__scene__` routing to `__scene__`'s animData | 1:1 mapping shift |
| 29 | 7.B | REPLACE/AVAILABLE distinguished in result-status | UI-driven divergence |

All 10 audit-verified.

---

## Schema state

Phase 7 ships TWO sparse-field additions on project (no migration):

- `project.keyingSets?: Array<{id, label, description?, insertNew?,
  paths: Array<{path, group}>}>` — user-defined sets (default `[]`).
- `project.activeKeyingSetId?: string | null` — pointer to currently
  active set (default `null`).

Built-ins live in `src/anim/keyingSets.js` static registry, NOT in
project file (Rule №2: no migration baggage).

Schema stays at **v42** (no bump).

---

## Tests added this session

| File | Asserts | Wired into master chain? |
|------|---------|--------------------------|
| `test_keyingSets.mjs` (NEW) | 144 | ✓ (between fcurveSolo + fmodifiers) |
| `test_insertKeyframe.mjs` (NEW) | 87 | ✓ (between keyingSets + fmodifiers) |
| `package.json` master chain | — | + 8 Phase 6 + bakeNla wired via 6.G + 2 Phase 7 wired this session |

**Total new session test asserts: 231.** All sibling suites green
(animationEngine 61, animationStore 55, fcurveEval 35, fcurveHandles
35, actionRegistry 95). Typecheck clean throughout.

---

## Commits this session (7)

```
ab3daef docs(plan): Phase 6 Slice 6.G — Phase exit gate (PHASE 6 SHIP-COMPLETE)
2ebefe4 feat(anim): Phase 7 Slice 7.A — Keying Set registry substrate
768d25c fix(audit): Phase 7 Slice 7.A audit-fix — 2 HIGH-F cite + 2 MED + 4 LOW
3d0b049 docs(plan): Phase 7 Slice 7.A SHIPPED — Keying Set registry close-out (cite-streak BROKEN)
5bd0982 feat(anim): Phase 7 Slice 7.B — Insert Keyframe kernel + applyKeyingSet operator
de91759 fix(audit): Phase 7 Slice 7.B audit-fix — 2 HIGH + 6 MED + 5 LOW
577ebdd docs(plan): Phase 7 Slice 7.B SHIPPED — Insert Keyframe close-out (cite-regression confirmed multi-slice)
```

(+ this aggregate doc, +1 commit.)

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

**Blender refs to re-OPEN per rule 9 + content-verify per rules 10+11:**

- `editors/animation/keyframing.cc:569-580` —
  `ANIM_OT_keyframe_insert_menu` (I-key menu invoker).
- `editors/animation/keyframing.cc:479-502` —
  `ANIM_OT_keyframe_insert_by_name` (per-set named-target operator;
  menu items dispatch to this).
- `editors/animation/keyframing.cc:535-560` — menu construction logic
  (`layout.op("ANIM_OT_keyframe_insert_by_name", item->name, item->icon)`
  at `:548`).
- `keymap_data/blender_default.py:1402` — I-key binding (re-verify).

**UI integration:** SS doesn't have Blender's `WM_menu_invoke` —
substitute is a popover / dropdown via Radix. Existing analog:
the `ApplyMenu` from Phase 6 Toolset. Re-use the popover host.

**Runtime resolver wiring (MED-3 trap from 7.B):** the I-key handler
in CanvasViewport / TimelineEditor MUST pass a paramValuesStore-aware
`resolveValue` to `applyKeyingSet` for any call covering `__params__`
paths. Default `evaluateRnaPath` returns static `project.parameters[*].default`
not the live value — would silently key wrong values otherwise.

Estimated 7.C: ~3-4hr substrate + 1hr audit-fix + 30min close-out.

After 7.C: **7.D** (auto-keyframe set parity), **7.E** (K-key toast
/ rebind preference), **7.F** (test sweep + Phase 7 exit gate).

---

## Pre-compact state

- **Branch**: master, 195 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit this aggregate.
- **Schema**: v42 (unchanged across all 3 ship cycles this session).
- **Phase 6**: **SHIP-COMPLETE** (8/8 slices, all 2026-05-19).
- **Phase 7**: **2/6 SUBSTRATE-COMPLETE** (7.A + 7.B); 4 remaining
  (7.C UI + 7.D autokey + 7.E K-key + 7.F exit gate).
- **Tests added this session**: 231 asserts (2 new test files).
- **Cite-discipline**: 4-slice Phase 6 clean streak did NOT extend
  into Phase 7. 2-slice multi-slice fab regression at 7.A + 7.B.
  Memory rules 9 (tightened), 10 (NEW), 11 (NEW) added across the
  two slices. 7.C will test whether the new rules hold.
- **SS deviations (Phase 7)**: 10 new this session (DEV 20-29).
- **User-side owed**: Phase 6 manual checklist
  (`ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`); Phase 3+4 manual checklist
  (still outstanding from prior sessions); Phase 7 accrues at 7.F.

---

## Notable architectural patterns established this session

1. **Sparse-field schema extension without migration** (7.A, 7.B) —
   `project.keyingSets[]` and `project.activeKeyingSetId` follow the
   same sparse pattern as `fcurve.mute` / `fcurve.solo` from Phase 6.
   Schema stays at v42. Built-in registry lives in module static, NOT
   in project file — saves migration weight + lets future builds add
   built-ins without touching project files.

2. **Per-channel result-status enum for batch operators** (7.B) —
   9-value string discriminator (`inserted`/`replaced`/`created-fcurve`/
   5x `skipped-*`/`skipped-non-finite`). Sister to Blender's
   `CombinedKeyingResult` / `SingleKeyingResult` but with simpler
   string enum. Pattern reusable for future batch ops (e.g. 7.B's
   future DELETE_KEY mode; potential bulk transform ops).

3. **Default-resolver trap pattern** (7.B MED-3) — when a substrate
   operates on data that has both a static-default form and a live-
   runtime form, the API should accept a `resolveValue` callback with
   the static form as default, plus a WARNING-level JSDoc that
   integrators MUST pass the live resolver for the relevant paths.
   Substrate stays testable + decoupled; UI takes ownership of live-
   value wiring.

4. **Memory rule promotion mid-session** (7.A + 7.B) — when an audit
   finding identifies a new failure mode not caught by existing rules,
   promote a new rule to memory IN THE SAME AUDIT-FIX commit, not in
   a deferred polish slice. Rule 9 tightened on 7.A; rules 10+11
   added on 7.B. Each new rule has an explicit lesson cite (the slice
   + finding that triggered it) so future readers know the rule's
   provenance.
