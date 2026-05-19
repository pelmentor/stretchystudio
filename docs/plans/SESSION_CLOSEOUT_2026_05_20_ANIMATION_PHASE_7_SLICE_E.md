# Session Close-out — Animation Phase 7 Slice 7.E (K-key first-use toast)

**Session date:** 2026-05-20.
**Slice:** 7.E — K-key first-use toast + `__ssAutoKey` sentinel for auto-key suppression.
**Commits:** `49a4239` (substrate) + `fa6b462` (audit-fix).
**Branch:** master.
**Schema:** v42 (unchanged — pure UI + preferences-store change).
**Status:** **SHIP-COMPLETE.** Phase 7 now 5/6 slices done.

---

## What 7.E shipped

### 3 modified files + 1 new test suite

| File | LOC | Role |
|------|-----|------|
| `src/store/preferencesStore.js` | +35 | `kKeyFirstUseShown` sparse pref + `setKKeyFirstUseShown` setter + localStorage `K_FIRST_USE_KEY` |
| `src/components/canvas/CanvasViewport.jsx` | +28 | toast emission post-guards in K-key handler + `__ssAutoKey` skip + audit-fix MED-1 (real built-in label) |
| `src/anim/autoKeyDispatch.js` | +12 | `__ssAutoKey: true` expando on synthetic K event (audit-fix MED-2 — plain assignment for Safari ≤14 compat) |
| `scripts/test/test_kKeyFirstUseToast.mjs` | +22 asserts | §1 pref roundtrip + persistence + namespace · §2 sentinel tag · §3 descriptor pin |
| `package.json` | +2 | `test:kKeyFirstUseToast` wired into master chain |

### Public API surface

- `preferences.kKeyFirstUseShown: boolean` (default `false`)
- `preferences.setKKeyFirstUseShown(v: boolean) → void`
- Synthetic K events dispatched by `runAutoKey('all')` carry `__ssAutoKey: true` (expando)

### Behavior

1. User presses K in animation mode (manual K, not auto-key).
2. K-key handler runs all guards (preview / editable / animation-mode / actions / selection).
3. **If `e.__ssAutoKey` is set** (synthetic from `runAutoKey('all')`), skip toast — user dragged a bone, didn't manually press K.
4. **Else if `preferences.kKeyFirstUseShown === false`**:
   - Emit toast: title "K — Insert all properties"; description "Press I to pick a specific keying set (Location / Rotation / All Parameters / …)."
   - Flip `kKeyFirstUseShown` to `true` (persisted to localStorage).
5. Proceed with keyframe-insertion recipe (unchanged from pre-7.E).
6. Future K-presses on this device: toast never shows again.

### Scope decision: MVP only

Plan §7.E has two clauses: (a) first-use toast + (b) optional rebind preference. 7.E ships (a) only. The rebind preference is deferred to §7.F+ because extracting the 170-line legacy K-key fan-out (KEYFRAME_PROPS + mesh_verts + blend-shape values + auto-rest-keyform + JS-skinning expansion) into a pure helper is non-trivial test surface. The plan's "A preference CAN re-bind K" wording makes the rebind plan-faithfully optional.

---

## Audit findings + fixes (sweep #82)

**Architecture audit:** **0 HIGH / 2 MED / 2 LOW.**
**Blender-fidelity audit:** **0 HIGH-F / 0 MED-F / 0 LOW-F across 3 carry-over cites.**

| Finding | Class | Fix |
|---------|-------|-----|
| MED-1 | Invalid label in toast description | `CanvasViewport.jsx:1530-1531` "Active Set" → "All Parameters" (real built-in label per `keyingSets.js:307`). |
| MED-2 | `Object.defineProperty` throws on native KeyboardEvent in Safari ≤14 | `autoKeyDispatch.js:137` plain expando assignment `ev.__ssAutoKey = true` (with JSDoc `@type {any}` cast for `@ts-check`). |
| LOW-1 | Descriptor assertions out of sync with MED-2 fix | `test_kKeyFirstUseToast.mjs:122-141` §3 rewritten as contract pin for plain-assignment defaults (`writable/enumerable/configurable: true`). +2 asserts (20 → 22). |
| LOW-2 | Vacuous `v3.prefs.*` prefix check | `test_kKeyFirstUseToast.mjs:81-86` §1.5 now asserts exact key name. |

All 3 Blender cites verified byte-faithfully against `reference/blender/`:
- `keymap_data/blender_default.py:4536` (K Object Mode menu)
- `keymap_data/blender_default.py:4683` (K Pose Mode menu)
- `keymap_data/blender_default.py:4561` (I Object Mode non-pie default)

DEV 30 attribution correctly references the I/K-key inversion (verified by Blender-fidelity audit).

---

## Cite-discipline arc — STREAK EXTENDED 2 → 3

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.F.2 | 0 | 0 LOW-F | 4th consecutive clean (Phase 6) |
| 7.A | 2 HIGH-F + 1 MED-F | All fixed | Streak BROKEN (Phase 7 slice 1) |
| 7.B | 1 HIGH-F + 1 MED-F | All fixed | Multi-slice regression confirmed |
| 7.C | 0 / 0 / 0 across 9 cites | Clean ship | STREAK RESTARTED |
| 7.D | 0 / 0 / 0 across 9 cites | Clean ship | STREAK EXTENDED |
| **7.E** | **0 / 0 / 0 across 3 carry-over cites** | **Clean ship** | **STREAK EXTENDED 2 → 3** |

Three consecutive clean slices post-introduction of rules 10 + 11. The
audit's cite count is small for 7.E (3 carry-over vs 9 fresh in 7.C/7.D)
because the slice is UI-only and adds no new Blender references — but
those 3 cites WERE re-OPENed per rule 9 before each commit, and the
DEV 30 attribution was verified for content-honesty per rule 11.
**Rules durably holding** through 3 consecutive ships.

---

## File summary

```
src/store/preferencesStore.js              +35    EDIT (pref + setter + localStorage key)
src/components/canvas/CanvasViewport.jsx   +28    EDIT (toast trigger + sentinel skip)
src/anim/autoKeyDispatch.js                +12    EDIT (__ssAutoKey expando tag)
scripts/test/test_kKeyFirstUseToast.mjs    +22    NEW (22 asserts)
package.json                               +2     EDIT (test wire)
```

Net 7.E: ~99 LOC + 22 test asserts + 0 new DEVs.

---

## Commits this slice (2)

```
49a4239 feat(anim): Phase 7 Slice 7.E — K-key first-use toast + __ssAutoKey sentinel
fa6b462 fix(audit): Phase 7 Slice 7.E audit-fix — 2 MED + 2 LOW
```

Plus this close-out + plan banner + memory update (1 commit pending).

---

## Top queued path

**Slice 7.F — Test sweep + Phase 7 exit gate** (~2-3hr).

Plan §7.F specifies:

> | Test | What |
> |------|------|
> | `test_keyingSet_builtin.mjs` | Each built-in set collects the right channels |
> | `test_keyingSet_userDefined.mjs` | Custom set CRUD |
> | `test_insertKeyframe_replace.mjs` | Replace existing key at time |
> | `test_insertKeyframe_onlyNeeded.mjs` | Skip when value matches |
> | `test_autoKey_keyingSet.mjs` | Auto-key respects active set |

Most of these are ALREADY COVERED by existing test files shipped across 7.A-7.E:

- `test_keyingSets.mjs` (144 asserts) — covers built-in + user-defined CRUD; subsumes `test_keyingSet_builtin.mjs` and `test_keyingSet_userDefined.mjs`.
- `test_insertKeyframe.mjs` (87 asserts) — covers REPLACE flag + NEEDED flag + AVAILABLE flag; subsumes `test_insertKeyframe_replace.mjs` and `test_insertKeyframe_onlyNeeded.mjs`.
- `test_autoKeyDispatch.mjs` (48 asserts) — covers all 3 auto-key modes (all + activeSet + available); subsumes `test_autoKey_keyingSet.mjs`.

So 7.F's primary scope is:

1. **Audit existing test coverage** against plan §7.F's table; document what's covered vs not.
2. **Manual checklist** for Phase 7 (model after `PHASE_6_MANUAL_CHECKLIST.md`):
   - I-key menu opens with correct default-highlighted set per selection
   - K-key toast appears on first manual K-press only
   - K-key toast suppressed on auto-key triggered K
   - Mode dropdown changes affect bone/gizmo/canvas drag-end auto-key behavior
3. **Phase 7 exit gate** — banner update in `ANIMATION_BLENDER_PARITY_PLAN.md` and close-out aggregate.
4. **Optional**: extract the legacy K-key fan-out into a pure helper (defers from 7.E rebind preference; enables future Blender-faithful I/K-key swap).

Estimated 7.F: ~1.5hr coverage audit + 30min manual checklist + 30min close-out aggregate.

---

## User-side owed

Nothing new this slice. Phase 7 manual verification accrues at 7.F.
Phase 6 manual checklist remains outstanding.

---

## Pre-commit state

- **Branch**: master, **2 commits ahead of origin** (`49a4239` + `fa6b462`;
  will be **3 commits ahead** after this close-out commit; push pending
  per session rule).
- **Working tree**: about to commit this close-out + plan banner + memory update.
- **Schema**: v42 (unchanged).
- **Phase 7 progress**: 5/6 slices SHIP-COMPLETE. Only 7.F remaining.
- **Cite-discipline**: streak EXTENDED 2 → 3. Phase 7 Slices 7.C + 7.D
  + 7.E all clean post-introduction of memory rules 10 + 11.
