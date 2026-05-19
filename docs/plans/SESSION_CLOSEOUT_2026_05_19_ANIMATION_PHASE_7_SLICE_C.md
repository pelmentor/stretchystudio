# Session Close-out — Animation Phase 7 Slice 7.C (I-key Insert Keyframe menu UI)

**Session date:** 2026-05-19.
**Slice:** 7.C — `I`-key menu UI + KeyingSetMenu popover + live-value resolver.
**Commits:** `4643dc3` (substrate) + `57f2bb2` (audit-fix).
**Branch:** master.
**Schema:** v42 (unchanged — UI consumes 7.A/7.B substrate; no new project fields).
**Status:** **SHIP-COMPLETE.** Substrate ships + audit-fix lands. Phase 7 now 3/6 slices done.

---

## What 7.C shipped

### 4 new files + 5 modified

| File | LOC | Role |
|------|-----|------|
| `src/anim/keyingSetDefault.js` | ~85 | `pickDefaultKeyingSet` — selection/mode → built-in set id |
| `src/anim/insertKeyframeResolver.js` | ~70 | `buildLiveResolver` — paramValuesStore-aware overlay |
| `src/v3/operators/insertKey.js` | ~210 | `insertKey.menu` + `insertKey.applySet` operators + `execApplyKeyingSet` |
| `src/v3/shell/KeyingSetMenu.jsx` | ~140 | Radix-free popover (Esc + outside-click close) |
| `scripts/test/test_keyingSetMenu.mjs` | +69 asserts | §1 picker · §2 resolver · §3 applyKeyingSet integ · §4 menu enum · §5 operator-wiring guards (added in audit-fix) |
| `src/store/editMenuStore.js` | EDIT | `'keyingSet'` kind + `openKeyingSet({cursor})` |
| `src/v3/keymap/default.js` | EDIT | `KeyI` → `insertKey.menu` |
| `src/v3/operators/registry.js` | EDIT | eager-import + register `insertKey.*` at end of `registerBuiltins` |
| `src/v3/shell/AppShell.jsx` | EDIT | lazy-mount `KeyingSetMenu` behind `editMenuKind === 'keyingSet'` |
| `package.json` | EDIT | `test:keyingSetMenu` wired into master chain |

### Public API surface

- `pickDefaultKeyingSet({project, selection, editMode, activeBlendShapeId}) → setId | null` (pure)
- `buildLiveResolver(project, paramValues) → (rnaPath) => number | undefined` (pure)
- `execApplyKeyingSet(setId)` — wired form of `applyKeyingSet` with store-read guards + live resolver + toast
- `registerInsertKeyOperators(registerOperator, lastMousePos)` — registry-injection entry point
- Keymap binding: `KeyI` → `insertKey.menu`

### Behavior

1. User presses `I` → dispatcher resolves to `insertKey.menu` → operator opens `KeyingSetMenu` popover at cursor.
2. Menu shows 7 built-ins + any user-defined sets (in `listKeyingSets` canonical order).
3. Default-picked set is highlighted (bold) per `pickDefaultKeyingSet`:
   - BlendShape mode with active shape on a matching owner → `BlendShape`
   - Last-selected bone-role group → `Rotation`
   - Last-selected meshed part → `LocRotScale`
   - Empty / no match → no highlight (user picks explicitly)
4. Active set (from 7.A's `project.activeKeyingSetId`) shows `•` indicator. **7.C does not set active** (non-sticky per Blender's `ANIM_OT_keyframe_insert_by_name` at `keyframing.cc:479-502`).
5. Click → `execApplyKeyingSet(setId)`:
   - Guards: setId/project/time validation + `getKeyingSet` pre-validation
   - `updateProject(draft => applyKeyingSet(draft, setId, selectionIds, currentTimeMs, NOFLAGS, {resolveValue: buildLiveResolver(draft, paramValues)}))`
   - Toast summarises per-channel result (`N keys inserted` / status-specific skip explanations)
6. Esc / outside-click closes without invoking.

### Legacy K-key untouched

`CanvasViewport.jsx:1457-1633` legacy K-key handler stays in place per plan §7.E carve-out. The migration target (K → menu always, I → active KS direct, matching Blender) is documented as DEV 30 and deferred to 7.E.

---

## SS DEVIATION new this slice (30)

| # | What | Honesty class |
|---|------|----------------|
| 30 | I/K-key semantics inverted from Blender. Blender: `I` = use active KS / user-pref fallback (`blender_default.py:4561`); `K` = always menu with `always_prompt=True` (`:4536`). SS plan §7.C: `I` = always menu; `K` = legacy "insert all" (CanvasViewport.jsx:1457-1633). Inversion rationale: legacy K already keys all properties; no user-facing rebind UI yet. §7.E will surface the toast + preference. | Plan-driven UI divergence |

DEV 30 documented in `insertKey.js` module header + `default.js` `KeyI` block + plan §7.C audit.

---

## Audit findings + fixes (sweep #80)

**Architecture audit:** **0 HIGH + 0 MED + 1 LOW.**
**Blender-fidelity audit:** **0 HIGH-F + 0 MED-F + 0 LOW-F across 9 cites.**

| Finding | Class | Fix |
|---------|-------|-----|
| LOW-1 | Test coverage gap on operator-wiring layer | §5 added to `test_keyingSetMenu.mjs` (14 asserts): null project, empty/null setId, unknown setId, NaN/Infinity time, AllParams happy path with live resolver (17.5/0.7), LocRotScale on selected part. |

The architecture audit's MED-1 candidates (KeyingSetMenu listener leak, immer-recipe result capture, BlendShape stale-shape guard, useMemo dependency breadth, run() try/finally) were ALL re-scored to below LOW after second-pass verification. The reviewer's analysis is in audit-fix commit `57f2bb2`'s message.

All 9 Blender cites verified byte-faithfully against `reference/blender/`. Notable corrections:

- `keyframing.cc:509-567` is the actual `insert_key_menu_invoke` static function. The session-aggregate's pre-existing wrong cite at `:569-580` pointed at the OT registration `ANIM_OT_keyframe_insert_menu` which only wires `invoke = insert_key_menu_invoke` at `:580`. **Pre-empted via rule-9 application during substrate ship.**

---

## Cite-discipline arc — REGRESSION ENDS at 7.C

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.F.2 | 0 | 0 LOW-F | 4th consecutive clean (Phase 6) |
| 7.A | 2 HIGH-F + 1 MED-F | All fixed | Streak BROKEN (Phase 7 slice 1) |
| 7.B | 1 HIGH-F + 1 MED-F | All fixed | Multi-slice regression confirmed |
| **7.C** | **0 HIGH-F + 0 MED-F + 0 LOW-F** | **N/A — clean ship** | **STREAK RESTARTED** |

**Rules 9 + 10 + 11 worked.** Specifically:

- **Rule 9 (re-OPEN every cite)** caught the session-aggregate's wrong `:569-580` cite during substrate authoring — verifying via fresh file read showed `:569-600` is OT registration, not menu invoker.
- **Rule 10 (literal-source-value)** applied to the `always_prompt=True` claim at `:4536` — byte-quoted the keymap entry rather than paraphrasing.
- **Rule 11 ("comment says X" promotes to byte-quote)** applied to the description string at `:443-445` of `ANIM_OT_keyframe_insert` — quoted verbatim ("Insert keyframes on the current frame using either the active keying set, or the user preferences if no keying set is active").

The 4-slice Phase 6 clean streak was Phase 6's discipline; the 2-slice Phase 7 regression broke it; 7.C's clean ship suggests rules 10+11 have closed the content-claim-fab gap that rule 9 alone didn't catch. **One slice doesn't prove durability — 7.D will retest.**

---

## File summary

```
src/anim/keyingSetDefault.js              ~85 LOC  NEW
src/anim/insertKeyframeResolver.js        ~70 LOC  NEW
src/v3/operators/insertKey.js             ~210 LOC NEW
src/v3/shell/KeyingSetMenu.jsx            ~140 LOC NEW
scripts/test/test_keyingSetMenu.mjs       +69      NEW (55 substrate-ship + 14 audit-fix)
src/store/editMenuStore.js                +8       EDIT
src/v3/keymap/default.js                  +20      EDIT (KeyI binding + DEV 30 doc)
src/v3/operators/registry.js              +10      EDIT (import + registerInsertKeyOperators call)
src/v3/shell/AppShell.jsx                 +4       EDIT (lazy-import + mount)
package.json                              +2       EDIT (test wire)
```

Net 7.C: ~615 LOC + 69 test asserts + 1 plan-driven DEV.

---

## Commits this slice (2)

```
4643dc3 feat(anim): Phase 7 Slice 7.C — I-key Insert Keyframe menu + KeyingSetMenu popover
57f2bb2 fix(audit): Phase 7 Slice 7.C audit-fix — 1 LOW (test coverage)
```

Plus this close-out + plan banner update (1 commit pending).

---

## Top queued path

**Slice 7.D — Auto-keyframe parity** (~2-3hr).

Plan §7.D specifies:

> Existing auto-key behaviour writes every property of the selection.
> After Phase 7, auto-key respects the active keying set:
> - "AutoKey: All" (current behaviour, becomes opt-in)
> - "AutoKey: Active Keying Set" (new default, matches Blender)
> - "AutoKey: Available" (insert only into existing FCurves)
>
> UI: a dropdown next to the auto-key button picks the auto-key mode.

Substrate hooks already in place:

- `insertKey.applySet` operator (registered this slice; can be invoked with `{setId}` from any auto-key trigger)
- `buildLiveResolver` (use the same paramValuesStore-aware resolver)
- 7.A's `getActiveKeyingSet(project)` (returns active or null)
- 7.B's `INSERTKEY_FLAGS.AVAILABLE` (already covers the "Available" mode bit)

Auto-key wiring lives in v2 / legacy paths today (search: `autoKey` in `src/store/animationStore.js` + `CanvasViewport.jsx`). 7.D will:

1. Add `project.autoKeyMode?: 'all' | 'activeSet' | 'available'` (sparse, default 'all' — Rule №2 compliance, no migration).
2. Refactor existing auto-key write site to dispatch on mode:
   - 'all' → legacy path (unchanged)
   - 'activeSet' → `applyKeyingSet(project, activeId, ...)` if `activeKeyingSetId` set; else fall back to legacy with toast
   - 'available' → `applyKeyingSet(project, 'Available', ..., INSERTKEY_FLAGS.AVAILABLE)`
3. UI dropdown next to auto-key button in `TimelineEditor` toolbar (or wherever the auto-key toggle currently lives).

**Blender refs to re-OPEN per rule 9 + content-verify per rules 10+11:**

- `editors/animation/keyframing.cc:177-240` — `insert_key_with_keyingset` (the unified entry point used by both manual I-key and auto-key paths in Blender).
- `editors/animation/anim_keyframing.cc` (search for `auto_keyframe_*` symbols) — the auto-key dispatcher. **Re-verify file path + function name.**
- `DNA_userdef_types.h` — `autokey_mode` enum definition.
- `space_view3d.cc` or `userdef_ui.py` — auto-key dropdown UI surface (for SS UI parity).

Estimated 7.D: ~2-3hr substrate + 30min audit-fix + 30min close-out.

---

## User-side owed

Nothing new this slice — 7.C is internal UI infrastructure. Manual verification accrues at 7.F (Phase 7 exit gate).

Phase 6 manual checklist remains outstanding from `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_G.md`.

---

## Pre-commit state

- **Branch**: master, 2 commits ahead of origin (`4643dc3` + `57f2bb2`; ABOUT TO PUSH per session-start instruction).
- **Working tree**: about to commit this close-out + plan banner.
- **Schema**: v42 (unchanged).
- **Phase 7 progress**: 7.A + 7.B + 7.C SHIP-COMPLETE; 3 slices remaining (7.D / 7.E / 7.F).
- **Cite-discipline**: 2-slice Phase 7 regression ENDED at 7.C; clean-streak counter at 1. Rules 9 + 10 + 11 held. 7.D will test durability.
