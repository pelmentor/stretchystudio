# Session Aggregate — Phase 7 Slices 7.C + 7.D + 7.E (2026-05-19 → 2026-05-20)

**Session window.** Started on the trailing edge of 2026-05-19 immediately after the previous session aggregate at `4494c88` (which covered Phase 6 SHIP-COMPLETE + 7.A + 7.B); rolled across into 2026-05-20 during 7.E.
**Slices shipped.** 7.C (I-key menu UI) + 7.D (auto-key mode parity) + 7.E (K-key first-use toast).
**Branch.** master. Pushed to origin (pelmentor fork) after each slice.
**Schema.** v42 throughout — no migrations across the 3 slices (Rule №2 compliance via sparse fields).
**Status.** **Phase 7 5/6 SHIP-COMPLETE.** Only 7.F (test sweep + exit gate) remaining.

---

## Commits (9 across 3 slices)

```
e9ccfba docs(plan): Phase 7 Slice 7.E SHIPPED — K-key first-use toast (streak EXTENDED 2→3)
fa6b462 fix(audit): Phase 7 Slice 7.E audit-fix — 2 MED + 2 LOW
49a4239 feat(anim): Phase 7 Slice 7.E — K-key first-use toast + __ssAutoKey sentinel
7cd7e74 docs(plan): Phase 7 Slice 7.D SHIPPED — Auto-key mode parity (streak EXTENDED 1→2)
3022543 fix(audit): Phase 7 Slice 7.D audit-fix — 2 HIGH + 3 MED + 1 LOW
26e53ce feat(anim): Phase 7 Slice 7.D — Auto-key mode parity (all/activeSet/available) + UI dropdown
0112b9e docs(plan): Phase 7 Slice 7.C SHIPPED — I-key Insert Keyframe menu (cite-streak RESTARTED)
57f2bb2 fix(audit): Phase 7 Slice 7.C audit-fix — 1 LOW (test coverage)
4643dc3 feat(anim): Phase 7 Slice 7.C — I-key Insert Keyframe menu + KeyingSetMenu popover
```

Pattern preserved across all 3 cycles: `feat(anim)` substrate → dual audit → `fix(audit)` same-day → `docs(plan)` close-out. No skip-hooks; no force-pushes.

---

## What each slice shipped

### Slice 7.C — `I`-key menu UI (substrate `4643dc3` + audit-fix `57f2bb2`)

**4 new + 5 modified files; ~615 LOC; 69 test asserts.**

- `src/anim/keyingSetDefault.js` — `pickDefaultKeyingSet({project, selection, editMode, activeBlendShapeId}) → setId | null`. Pure helper; BlendShape-mode (matching shape owner) → `BlendShape`; last-selected bone → `Rotation`; last-selected mesh → `LocRotScale`. LAST→FIRST walk matches SS's "active = most-recently-added" semantic.
- `src/anim/insertKeyframeResolver.js` — `buildLiveResolver(project, paramValues)` closes the **7.B MED-3 trap**. Regex `^objects\["__params__"\]\.values\["([^"]+)"\]$` routes `__params__` paths through live `paramValuesStore.values` snapshot before falling through to `evaluateRnaPath` (which returns `project.parameters[*].default`). NaN/Infinity fallback to default.
- `src/v3/operators/insertKey.js` — registers `insertKey.menu` (bound to `KeyI`; opens popover) + `insertKey.applySet` (forward hook for 7.D auto-key + command-palette). Exported `execApplyKeyingSet(setId)` runs full guarded pipeline: setId/project/time validation → `getKeyingSet` pre-validation → `updateProject(draft => applyKeyingSet(draft, …, {resolveValue: buildLiveResolver(draft, paramValues)}))` → toast.
- `src/v3/shell/KeyingSetMenu.jsx` — Radix-free popover (mirrors `ApplyMenu`/`SnapMenu`); lists `listKeyingSets(project)` (memoised on `[project]` per `feedback_filter_in_selector`); `•` indicator for active set + bold for default-picked.
- `src/store/editMenuStore.js` — `'keyingSet'` kind + `openKeyingSet({cursor})`.
- `src/v3/keymap/default.js` — `KeyI` → `insertKey.menu`.
- `src/v3/operators/registry.js` — `registerInsertKeyOperators` called at end of `registerBuiltins`.
- `src/v3/shell/AppShell.jsx` — lazy-mount `KeyingSetMenu` behind `editMenuKind === 'keyingSet'`.

**DEV 30** declared: I/K-key semantics inverted from Blender. Blender binds I → active KS direct (`keymap_data/blender_default.py:4561`) + K → always menu (`:4536`); SS ships I → always menu + K → legacy "insert all". Inversion rationale: legacy K already keys every visible property + a user-facing rebind UI is not yet shipped. Documented in `insertKey.js` header + `default.js` `KeyI` block.

**Audit sweep #80**: arch 0 HIGH / 0 MED / 1 LOW (test coverage gap on operator-wiring layer, fixed via §5 in audit-fix). Fidelity **0 / 0 / 0 across 9 cites** — **STREAK RESTARTED** after 7.A+7.B regression.

---

### Slice 7.D — Auto-key mode parity (substrate `26e53ce` + audit-fix `3022543`)

**1 new helper + 4 modified UI/trigger sites + 1 new test suite; ~302 LOC; 48 test asserts.**

- `src/anim/autoKeyDispatch.js` (~130 LOC) — `runAutoKey(project)` dispatcher + `getAutoKeyMode` (sparse-field coalesce with unknown-value warn) + `pickActiveSetIdForAutoKey` (`'LocRotScale'` fallback) + `AUTOKEY_MODES` frozen tuple. Maps SS's 3-mode enum to Blender's flag-bit dispatch at `keyframing_auto.cc:126-133` (ONLYKEYINGSET branch → `apply_keyingset`) vs `:139-150` (All path → `insert_keyframes`).
- `src/v3/shell/PlaybackControls.jsx` — `AutoKeyModeDropdown` sub-component (~70 LOC; Radix DropdownMenu+RadioGroup). Sparse-write: picking `'all'` deletes the field. `skipHistory: true` per audit-fix M-3 (mode is UI preference, not undo-worthy).
- 3 trigger-site refactors to call `runAutoKey(useProjectStore.getState().project)` instead of dispatching synthetic K:
  - `src/components/canvas/SkeletonOverlay.jsx:513-516`
  - `src/components/canvas/GizmoOverlay.jsx:366-369`
  - `src/components/canvas/CanvasViewport.jsx:3326-3334` (audit-fix H-2 — missed in initial sweep; canvas-direct drags were silently bypassing the mode dropdown)
- `src/components/canvas/CanvasViewport.jsx:1463` — audit-fix H-1: `e.target?.tagName` optional chaining (synthetic events set target to `window` which has no `tagName`).
- `src/v3/editors/parameters/ParamRow.jsx` — audit-fix M-2: inline `PHASE-7-GAP` comment documenting param-row bypass of `runAutoKey` (deferred to §7.E+ unification).

**Schema**: new SPARSE field `project.autoKeyMode?: 'all' | 'activeSet' | 'available'`. No migration; default coalesced via `?? 'all'`.

**DEV 31** declared: `'available'` mode dispatches to the `'Available'` built-in set (whose collector at `keyingSets.js:226-250` already filters to existing fcurves) rather than setting `INSERTKEY_FLAGS.AVAILABLE` on an unfiltered emit — semantically equivalent, structurally cleaner.

**Audit sweep #81**: arch 2 HIGH (H-1 target?.tagName + H-2 missed trigger) + 3 MED (M-1 AUTOKEY_MODES.includes; M-2 ParamRow gap doc; M-3 skipHistory) + 2 LOW (L-1 test §5.1; L-2 closed by M-1). All fixed in `3022543`. Fidelity **0 / 0 / 0 across 9 cites** — **STREAK EXTENDED 1 → 2**.

---

### Slice 7.E — K-key first-use toast (substrate `49a4239` + audit-fix `fa6b462`)

**3 modified + 1 new test suite; ~99 LOC; 22 test asserts.**

- `src/store/preferencesStore.js` — added sparse boolean `kKeyFirstUseShown` (default `false`; localStorage `v3.prefs.kKeyFirstUseShown`) + `setKKeyFirstUseShown` setter matching the existing `setMlEnabled`/`setLockObjectModes`/`setUseNumericInputAdvanced` boolean-pref pattern.
- `src/components/canvas/CanvasViewport.jsx:1505-1535` — toast emission AFTER all guards pass and BEFORE the `updateProject` recipe. Title: "K — Insert all properties"; description: "Press I to pick a specific keying set (Location / Rotation / All Parameters / …)." (real built-in labels per audit-fix MED-1; "Active Set" pre-fix was invalid).
- `src/anim/autoKeyDispatch.js:113-130` — `runAutoKey('all')`'s synthetic K event now carries `__ssAutoKey: true` expando (plain assignment per audit-fix MED-2 for Safari ≤14 compat; `Object.defineProperty` throws on native KeyboardEvent in older WebKit). The CanvasViewport handler skips toast when `e.__ssAutoKey` is set — auto-key triggered K-presses shouldn't fire the manual-K pointer toast.

**Scope decision: MVP only.** Plan §7.E's optional rebind preference ("A preference CAN re-bind K to I-default-set") deferred to §7.F+ because implementation requires extracting the 170-line legacy K-key fan-out (KEYFRAME_PROPS + mesh_verts + blend-shape values + auto-rest-keyform + JS-skinning expansion) into a pure helper. Plan-faithful per the "can" wording.

**No new DEVs.** Carries DEV 30 (I/K-key inversion).

**Audit sweep #82**: arch 0 HIGH / 2 MED (MED-1 invalid label; MED-2 defineProperty) / 2 LOW (LOW-1 descriptor pin; LOW-2 vacuous prefix check). All fixed in `fa6b462`. Fidelity **0 / 0 / 0 across 3 carry-over cites** — **STREAK EXTENDED 2 → 3**.

---

## Cite-discipline arc — 3-slice clean streak across the session

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.F.2 | 0 | 0 LOW-F | 4th consecutive clean (Phase 6) |
| 7.A | 2 HIGH-F + 1 MED-F | All fixed | Streak BROKEN (Phase 7 slice 1) |
| 7.B | 1 HIGH-F + 1 MED-F | All fixed | Multi-slice regression confirmed |
| **7.C** | **0 / 0 / 0 across 9 cites** | Clean ship | **STREAK RESTARTED** |
| **7.D** | **0 / 0 / 0 across 9 cites** | Clean ship | **STREAK EXTENDED 1 → 2** |
| **7.E** | **0 / 0 / 0 across 3 carry-over cites** | Clean ship | **STREAK EXTENDED 2 → 3** |

**Three consecutive clean ships post-introduction of rules 10 + 11.** Rules durably holding through 3 slices spanning UI integration (7.C), schema-edit + UI (7.D), and minimal-UI + preference (7.E). Rule mechanisms confirmed effective:

- **Rule 9 (re-OPEN every cite)** caught the session-aggregate's wrong `:569-580` cite in 7.C — verifying via fresh file read showed `:569-600` is the OT registration, not the menu invoker (`:509-567`).
- **Rule 10 (literal-source-value)** applied to `always_prompt=True` claim at `:4536` (7.C) and `AUTOKEY_FLAG_INSERTAVAILABLE = (1<<0)` at `:285` (7.D) — byte-quoted rather than paraphrased.
- **Rule 11 ("comment says X" promotes to byte-quote)** applied to the description string at `:443-445` of `ANIM_OT_keyframe_insert` (7.C) — quoted verbatim.

The 4-slice Phase 6 clean streak now has a 3-slice Phase 7 sibling streak. Combined with the 7.A+7.B regression as a control, rules 10+11 have **strong evidence of working** for content-claim fabs that rule 9 alone didn't catch.

7.F is the next durability test; if it ships clean, the rules are effectively-proven for Phase 7 scope.

---

## SS DEVIATIONs new this session (30 + 31)

| # | What | Honesty class |
|---|------|----------------|
| 30 (7.C) | I/K-key semantics inverted from Blender per plan §7.C/§7.E. Blender: `I` = use active KS / user-pref fallback (`blender_default.py:4561`); `K` = always menu with `always_prompt=True` (`:4536`). SS plan §7.C: `I` = always menu; `K` = legacy "insert all" (CanvasViewport.jsx:1457-1633). Inversion rationale: legacy K already keys all properties; no user-facing rebind UI yet. §7.E will surface the toast + preference. | Plan-driven UI divergence |
| 31 (7.D) | `'available'` mode dispatches to the `'Available'` built-in set (whose collector at `keyingSets.js:226-250` already filters to existing fcurves) rather than setting `INSERTKEY_FLAGS.AVAILABLE` on an unfiltered emit. Semantically equivalent; structurally cleaner. | Structural refactor — Blender ships both forms; SS picks the cleaner one |

DEV 30 carries forward through 7.E (the slice's whole point is to surface DEV 30's divergence to Blender muscle-memory users via the pointer toast).

---

## Test budget (139 new asserts this session)

| Suite | Asserts | Scope |
|-------|---------|-------|
| `test:keyingSetMenu` | 69 (55 substrate + 14 audit-fix §5) | 7.C — picker · resolver · applyKeyingSet integ · listKeyingSets · execApplyKeyingSet guards |
| `test:autoKeyDispatch` | 48 | 7.D — mode coalescing · active-set fallback · `'all'` synthetic-K · `'activeSet'` integration · `'available'` integration · sparse storage |
| `test:kKeyFirstUseToast` | 22 (20 substrate + 2 audit-fix LOW-1) | 7.E — pref roundtrip · sentinel tag · descriptor pin |

All wired into master `npm test` chain in canonical order (after `test:insertKeyframe`). Typecheck clean after every commit. Sibling suite regressions clean across all 3 audit sweeps (`test:keyingSets` 144, `test:insertKeyframe` 87, `test:preferencesStore` 62, `test:v3Operators` 125).

Plan §7.F's prescribed test files are ALREADY subsumed by existing suites:

- `test_keyingSet_builtin.mjs` + `test_keyingSet_userDefined.mjs` → covered by `test:keyingSets` (144 asserts; built-in + user-defined CRUD)
- `test_insertKeyframe_replace.mjs` + `test_insertKeyframe_onlyNeeded.mjs` → covered by `test:insertKeyframe` (87 asserts; REPLACE + NEEDED + AVAILABLE flags)
- `test_autoKey_keyingSet.mjs` → covered by `test:autoKeyDispatch` (48 asserts; all 3 modes)

So 7.F's test-creation work is essentially complete; the remaining work is **coverage audit + manual checklist + exit-gate aggregate**.

---

## Architectural patterns established / reinforced this session

1. **Sparse-field schema additions stay Rule №2-compliant.** Both `project.autoKeyMode?` (7.D) and `preferences.kKeyFirstUseShown` (7.E) ship as defaulted-via-coalesce-or-loadBool fields. No migrations, no schema bumps. UI setters that pick the default value (e.g. `'all'`) DELETE the field rather than persisting the default string (7.D `AutoKeyModeDropdown`).

2. **Mode-aware dispatcher pattern.** `runAutoKey(project)` (7.D) wraps multiple legacy code paths behind a single mode-dispatch entrypoint without rewriting the legacy paths. The 'legacy' mode preserves existing behavior; new modes get clean implementations. Rule №1 honest disclosure of the synthetic-K crutch in the module header rather than silent preservation.

3. **Sentinel-on-synthetic-event pattern.** `__ssAutoKey` (7.E) distinguishes synthetic events dispatched by SS infrastructure from real user events at the consumer side. Plain expando assignment (audit-fixed in MED-2) is the portable shape; `__` prefix marks SS-internal namespace. Pattern applicable to future "skip this side-effect because it's a synthetic dispatch" scenarios.

4. **Audit-driven scope deferral.** 7.E's optional rebind preference was deferred to §7.F+ in the substrate ship documentation BEFORE the architecture audit could flag it — pre-emptive scope-cutting that the audit confirmed was correct. The pattern: when the survey reveals refactor-risk, explicitly document the deferral in the commit message + close-out, then ship the MVP. Future audits then attest the deferral was honest.

5. **Audit-fix sweep numbering convention.** Sweeps #80 (7.C) + #81 (7.D) + #82 (7.E) extend the running counter from #79 (7.B). Plan banner + close-out doc + commit message all reference the sweep number for cross-doc traceability.

---

## Files touched this session

```
# 7.C — NEW
src/anim/keyingSetDefault.js                ~85 LOC
src/anim/insertKeyframeResolver.js          ~70 LOC
src/v3/operators/insertKey.js               ~210 LOC
src/v3/shell/KeyingSetMenu.jsx              ~140 LOC
scripts/test/test_keyingSetMenu.mjs         69 asserts

# 7.C — EDIT
src/store/editMenuStore.js                  +8
src/v3/keymap/default.js                    +20 (KeyI + DEV 30 doc)
src/v3/operators/registry.js                +10
src/v3/shell/AppShell.jsx                   +4
package.json                                +2

# 7.D — NEW
src/anim/autoKeyDispatch.js                 ~130 LOC
scripts/test/test_autoKeyDispatch.mjs       48 asserts

# 7.D — EDIT
src/components/canvas/SkeletonOverlay.jsx   +5
src/components/canvas/GizmoOverlay.jsx      +2
src/components/canvas/CanvasViewport.jsx    +13 (substrate + audit-fix H-1/H-2)
src/v3/shell/PlaybackControls.jsx           +90 (AutoKeyModeDropdown + skipHistory)
src/v3/editors/parameters/ParamRow.jsx      +12 (audit-fix M-2 doc)
package.json                                +2

# 7.E — NEW
scripts/test/test_kKeyFirstUseToast.mjs     22 asserts

# 7.E — EDIT
src/store/preferencesStore.js               +35
src/components/canvas/CanvasViewport.jsx    +28 (toast + sentinel skip + audit-fix MED-1)
src/anim/autoKeyDispatch.js                 +12 (__ssAutoKey expando + audit-fix MED-2)
package.json                                +2

# Plan docs (3 close-out + 3 banner updates + this aggregate)
docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md       (3 edits)
docs/plans/SESSION_CLOSEOUT_2026_05_19_*_SLICE_C.md  NEW
docs/plans/SESSION_CLOSEOUT_2026_05_19_*_SLICE_D.md  NEW
docs/plans/SESSION_CLOSEOUT_2026_05_20_*_SLICE_E.md  NEW
docs/plans/SESSION_AGGREGATE_2026_05_20_PHASE_7_C_D_E.md  NEW (this file)
```

---

## Memory updates

`MEMORY.md` `project_blender_parity_plans_in_flight` entry kept current after each slice (rewritten 3 times this session). Final state:

> anim Phase 0+1+2+3+6 SHIP-COMPLETE; Phase 4 SUBSTRATE-COMPLETE; Phase 5 SHIP-COMPLETE; **Phase 7 IN-FLIGHT** (5/6 slices). 7.A keyingSets.js+CRUD (144); 7.B insertKeyframe+applyKeyingSet (87); 7.C I-key menu+resolver+picker (69; DEV 30); 7.D auto-key mode parity+`project.autoKeyMode` sparse (48; DEV 31); 7.E K-key first-use toast + `__ssAutoKey` sentinel (22; MVP — rebind preference deferred to §7.F+). Commits `2ebefe4`→`fa6b462` (12 total). **Cite-discipline streak EXTENDED 2→3** (7.C + 7.D + 7.E all shipped 0/0/0). Phase 7 regression (7.A 2 HIGH-F + 7.B 1 HIGH-F) ended; rules 9 + 10 + 11 durably holding. **Next: Slice 7.F** (test sweep + Phase 7 exit gate, ~2-3hr).

No new memory entries created. Rules 9/10/11 (`feedback_byte_verify_behavior_cites`) unchanged this session — their durable behavior is the session's evidence.

---

## Push state

After each slice's close-out commit, pushed 3 commits to `origin/master` (pelmentor fork). No skip-hooks, no force-pushes. Total session pushes: 3 (one per slice). Branch is **0 commits ahead** of origin at session aggregate time.

---

## Top queued path

**Slice 7.F — Test sweep + Phase 7 exit gate** (~2-3hr).

Plan §7.F prescribes 5 test files; ALL ALREADY SUBSUMED by existing suites:

- `test_keyingSet_builtin.mjs` + `test_keyingSet_userDefined.mjs` → `test:keyingSets` (144)
- `test_insertKeyframe_replace.mjs` + `test_insertKeyframe_onlyNeeded.mjs` → `test:insertKeyframe` (87)
- `test_autoKey_keyingSet.mjs` → `test:autoKeyDispatch` (48)

So 7.F's primary work is **NOT** writing new test files — it's:

1. **Coverage audit** — write a one-doc audit cross-referencing plan §7.F's table against existing suite assertions; identify any actual gaps (likely few).
2. **Manual checklist** for Phase 7 (model after `PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md` + `ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`). User-side verification of:
   - I-key menu opens with default-highlighted set per selection (Object → LocRotScale; Bone → Rotation; BlendShape-mode → BlendShape)
   - Click on any keying set writes keys correctly (toast confirms count)
   - K-key first-use toast appears on FIRST manual K-press only; suppressed thereafter
   - K-key toast does NOT appear when auto-key dispatches synthetic K (e.g. bone drag with auto-key on)
   - Auto-key mode dropdown affects bone drag-end / gizmo drag-end / canvas-direct drag-end behavior
   - `'available'` mode skips properties without existing fcurves
3. **Phase 7 exit gate** — banner update in `ANIMATION_BLENDER_PARITY_PLAN.md` from "IN-FLIGHT 5/6" → "SHIP-COMPLETE 6/6"; phase-aggregate doc covering all 6 slices.
4. **Optional bonus** — extract the legacy K-key fan-out into a pure helper (`writeAllKeyframesForSelection(project, time, ids)`) so `runAutoKey('all')` calls it directly instead of via synthetic dispatch, AND the rebind preference deferred from 7.E can ship cleanly. This is HIGH-VALUE refactor but HIGH-RISK; should be its own slice if pursued.

Estimated 7.F: ~1hr coverage audit + 30min manual checklist + 30min exit gate + 1hr optional fan-out extraction = 2-3hr total.

---

## User-side owed

- **Phase 6 manual checklist** (from `SESSION_CLOSEOUT_2026_05_19_*_SLICE_G.md`) — still outstanding.
- **Phase 7 manual checklist** — to be authored as part of 7.F.

No automated work owed; all SS-side substrate + audits + close-outs complete for the session.

---

## Pre-compact state

- **Branch**: master, 0 commits ahead of origin (all pushed).
- **Working tree**: about to commit this aggregate.
- **Schema**: v42 (unchanged across all 3 slices).
- **Phase 7 progress**: 5/6 SHIP-COMPLETE. 7.F is the last.
- **Cite-discipline**: 3-slice clean streak post-regression. Rules 9+10+11 durably holding through 3 consecutive ships.
- **Test budget**: 139 new asserts this session (231 in the prior 7.A+7.B aggregate); Phase 7 total ~370 asserts across the 5 shipped slices.
- **Push owed**: this aggregate commit only (3 commits pushed already across the 3 slices).
