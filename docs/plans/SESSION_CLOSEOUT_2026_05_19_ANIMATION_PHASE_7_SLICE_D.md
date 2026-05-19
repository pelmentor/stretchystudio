# Session Close-out — Animation Phase 7 Slice 7.D (Auto-key mode parity)

**Session date:** 2026-05-19.
**Slice:** 7.D — Auto-key mode dispatcher + UI dropdown (`'all'` / `'activeSet'` / `'available'`).
**Commits:** `26e53ce` (substrate) + `3022543` (audit-fix).
**Branch:** master.
**Schema:** v42 (unchanged — `project.autoKeyMode?` sparse field; Rule №2 compliance).
**Status:** **SHIP-COMPLETE.** Phase 7 now 4/6 slices done.

---

## What 7.D shipped

### 1 new helper + 4 modified files + 1 new test suite

| File | LOC | Role |
|------|-----|------|
| `src/anim/autoKeyDispatch.js` | ~130 | `runAutoKey` + `getAutoKeyMode` + `pickActiveSetIdForAutoKey` + `AUTOKEY_MODES` |
| `scripts/test/test_autoKeyDispatch.mjs` | 48 asserts | §1 mode coalescing · §2 active-set fallback · §3 'all' synthetic-K · §4 'activeSet' integration · §5 'available' integration · §6 sparse storage |
| `src/components/canvas/SkeletonOverlay.jsx` | EDIT | bone drag-end → `runAutoKey(project)` |
| `src/components/canvas/GizmoOverlay.jsx` | EDIT | gizmo drag-end → `runAutoKey(project)` |
| `src/components/canvas/CanvasViewport.jsx` | EDIT (audit-fix H-2) | canvas-direct drag-end → `runAutoKey(project)`; H-1 `e.target?.tagName` |
| `src/v3/shell/PlaybackControls.jsx` | EDIT | `AutoKeyModeDropdown` Radix sub-component (~70 LOC) + sparse-write + `skipHistory` |
| `src/v3/editors/parameters/ParamRow.jsx` | EDIT (audit-fix M-2) | inline `PHASE-7-GAP` comment documenting param-row bypass |
| `package.json` | EDIT | `test:autoKeyDispatch` wired into master chain |

### Public API surface

- `runAutoKey(project) → { mode, dispatched }` — dispatcher per mode
- `getAutoKeyMode(project) → 'all' | 'activeSet' | 'available'` — coalesce sparse field with warning on unknown
- `pickActiveSetIdForAutoKey(project) → string` — active KS id or `'LocRotScale'` fallback
- `AUTOKEY_MODES` frozen tuple
- `AutoKeyModeDropdown` JSX component (PlaybackControls)

### Behavior

1. User toggles AutoKey (red disc) ON in PlaybackControls — existing behavior preserved.
2. User picks one of 3 modes from the new chevron dropdown next to the AutoKey toggle:
   - **All Properties** (default; sparse-stored as absent field): every property of selection keyed at playhead. Routes through legacy K-key handler via synthetic `KeyboardEvent`.
   - **Active Keying Set**: only the active KS is keyed. Fallback to `LocRotScale` if no active set.
   - **Available**: only properties with existing F-Curves get a new keyform.
3. On any of 3 trigger sites (SkeletonOverlay bone drag-end, GizmoOverlay gizmo drag-end, CanvasViewport canvas-direct drag-end), `runAutoKey(project)` is invoked.
4. Mode dispatch is byte-faithful to Blender's `keyframing_auto.cc:126-133` (ONLYKEYINGSET branch → `apply_keyingset`) vs `:139-150` (All path → `insert_keyframes` with full rna_paths).

### Known gaps (documented inline, not silent)

- **Synthetic K-key dispatch for `'all'` mode** — pre-existing legacy path; extracting the K-key handler's property fan-out is §7.E+ scope (`autoKeyDispatch.js` module header).
- **ParamRow auto-key bypass** — param slider auto-key ignores `project.autoKeyMode`; per-param write semantic pre-dates 7.D. §7.E+ unification (`ParamRow.jsx:171` `PHASE-7-GAP` comment).

---

## SS DEVIATION new this slice (31)

| # | What | Honesty class |
|---|------|----------------|
| 31 | `'available'` mode dispatches to the `'Available'` built-in set (whose collector at `keyingSets.js:226-250` already filters to existing fcurves) rather than setting `INSERTKEY_FLAGS.AVAILABLE` on an unfiltered emit. Semantically equivalent (both produce "key only existing fcurves"); structurally cleaner because the set-based path reuses 7.B's `applyKeyingSet` kernel without a flag-branch in the collector. | Structural refactor — Blender ships both forms; SS picks the cleaner one |

DEV 31 documented in `autoKeyDispatch.js` module header.

---

## Audit findings + fixes (sweep #81)

**Architecture audit:** **2 HIGH + 3 MED + 2 LOW.**
**Blender-fidelity audit:** **0 HIGH-F + 0 MED-F + 0 LOW-F across 9 cites.**

| Finding | Class | Fix |
|---------|-------|-----|
| H-1 | Missing optional chaining | `CanvasViewport.jsx:1463` `e.target?.tagName` — sister handler at `:1393` already used `?.`; 7.D made this path live every auto-key tick in 'all' mode. |
| H-2 | Missed trigger site | `CanvasViewport.jsx:3329` canvas-direct drag-end was bypassing `runAutoKey` — 3rd of 3 trigger sites, missed in initial sweep. Migrated. |
| M-1 | Enum duplication | `autoKeyDispatch.js:62-78` `getAutoKeyMode` now uses `AUTOKEY_MODES.includes(...)` instead of parallel `||` chain. |
| M-2 | ParamRow gap silent | `ParamRow.jsx:171` inline `PHASE-7-GAP` comment documenting bypass + §7.E+ scope deferral. |
| M-3 | Undo-stack pollution | `PlaybackControls.jsx:198-217` `setMode` adds `{skipHistory: true}` — Blender stores autokey_mode in user prefs, never on undo stack. |
| L-1 | Test §5.1 weak | `test_autoKeyDispatch.mjs:211-227` comment clarifying scope + cross-ref to `test_keyingSets.mjs §5` for deeper Available-collector semantic. |
| L-2 | Enum drift | Closed automatically by M-1. |

All 9 Blender cites verified byte-faithfully against `reference/blender/`:
- `keyframing_auto.cc:102-155` (autokeyframe_object)
- `keyframing_auto.cc:126-133` (ONLYKEYINGSET branch)
- `keyframing_auto.cc:139-150` (All path)
- `keyframing_auto.cc:193-258` (autokeyframe_pose_channel)
- `keyframing_auto.cc:235` (sister ONLYKEYINGSET check)
- `DNA_userdef_types.h:278-293` (eKeying_Flag enum)
- `DNA_userdef_types.h:285` (`AUTOKEY_FLAG_INSERTAVAILABLE = (1<<0)`)
- `DNA_userdef_types.h:287` (`AUTOKEY_FLAG_ONLYKEYINGSET = (1<<6)`)
- SS-internal `keyingSets.js:226-250` (availablePaths)

Naming honesty: the slice cites `eKeying_Flag` (a bitmask), not `eAutokey_Mode` (a different 3-state enum at `:249-260` about how keys are inserted — NORMAL/EDITKEYS). SS's mode dropdown abstracts over Blender's bitmask, not over `eAutokey_Mode`. Audit confirms framing is honest.

---

## Cite-discipline arc — STREAK EXTENDED 1 → 2

| Slice | Pre-audit fabs | Post-audit | Notes |
|-------|---------------|------------|-------|
| 6.F.2 | 0 | 0 LOW-F | 4th consecutive clean (Phase 6) |
| 7.A | 2 HIGH-F + 1 MED-F | All fixed | Streak BROKEN (Phase 7 slice 1) |
| 7.B | 1 HIGH-F + 1 MED-F | All fixed | Multi-slice regression confirmed |
| 7.C | 0 / 0 / 0 across 9 cites | Clean ship | **STREAK RESTARTED** |
| **7.D** | **0 / 0 / 0 across 9 cites** | **Clean ship** | **STREAK EXTENDED** |

Two consecutive clean slices post-introduction of rules 10 + 11.
Rules **may** be durable — 7.E + 7.F will confirm or invalidate.

---

## File summary

```
src/anim/autoKeyDispatch.js                ~130 LOC NEW
scripts/test/test_autoKeyDispatch.mjs      +48      NEW
src/components/canvas/SkeletonOverlay.jsx  +5       EDIT
src/components/canvas/GizmoOverlay.jsx     +2       EDIT
src/components/canvas/CanvasViewport.jsx   +13      EDIT (substrate + 2 audit-fixes)
src/v3/shell/PlaybackControls.jsx          +90      EDIT (dropdown component + skipHistory)
src/v3/editors/parameters/ParamRow.jsx     +12      EDIT (audit-fix M-2 doc comment)
package.json                               +2       EDIT (test wire)
```

Net 7.D: ~302 LOC + 48 test asserts + 1 plan-driven DEV.

---

## Commits this slice (2)

```
26e53ce feat(anim): Phase 7 Slice 7.D — Auto-key mode parity (all/activeSet/available) + UI dropdown
3022543 fix(audit): Phase 7 Slice 7.D audit-fix — 2 HIGH + 3 MED + 1 LOW
```

Plus this close-out + plan banner update (1 commit pending).

---

## Top queued path

**Slice 7.E — K-key toast + rebind preference** (~1-2hr).

Plan §7.E specifies:

> Existing K-key keeps current behaviour ("Insert all visible") but
> displays a small toast on first use after Phase 7 lands: "K inserts
> all properties; use I to choose a keying set". A preference can
> re-bind K to `I`-default-set if the user prefers.

Substrate hooks already in place:

- `useEffect`-mount toast trigger pattern (existing pattern in many SS modules)
- Preferences store (`src/store/preferencesStore.js`) — persistable across sessions
- Toast wrapper (`src/hooks/use-toast.js`)
- Existing K-key handler at `CanvasViewport.jsx:1457-1633` (target for rebind toggle)

Per plan:
1. Add `preferences.keymapPresetForI?: 'menu' | 'activeSet'` (or similar)
2. Add first-use toast emitted when user presses K in animation mode + preference not yet set
3. (Optional) Add preference UI in a Preferences modal — defer if no modal yet

**Blender refs to re-OPEN per rule 9 + content-verify per rules 10+11 BEFORE substrate ship:**

- `keymap_data/blender_default.py:4561` — I-key Object Mode default
- `keymap_data/blender_default.py:4536` — K-key Object Mode default
  with `always_prompt=True`
- `editors/animation/keyframing.cc:438-461` — `ANIM_OT_keyframe_insert`
  (Blender's I-key target for the "active KS direct" semantic)

Estimated 7.E: ~1.5hr substrate + 30min audit-fix + 30min close-out.

---

## User-side owed

Nothing new this slice. Manual verification accrues at 7.F (Phase 7
exit gate). Phase 6 manual checklist remains outstanding.

---

## Pre-commit state

- **Branch**: master, **5 commits ahead of origin** (`4643dc3` + `57f2bb2`
  + `0112b9e` + `26e53ce` + `3022543`; will be **6 commits ahead** after
  this close-out commit; push pending per session rule).
- **Working tree**: about to commit this close-out + plan banner.
- **Schema**: v42 (unchanged).
- **Phase 7 progress**: 7.A + 7.B + 7.C + 7.D SHIP-COMPLETE; 2 slices
  remaining (7.E / 7.F).
- **Cite-discipline**: streak EXTENDED 1 → 2. Phase 7 Slices 7.C + 7.D
  both shipped with 0 HIGH-F / 0 MED-F / 0 LOW-F.
