# Session Close-out — Animation Phase 6 Slice 6.A (Dopesheet tick selection)

**Session date:** 2026-05-19 (continuation; cross-compact)
**Branch:** master (166 commits ahead of origin/master; +2 this slice)
**Schema:** v42 (no bump — UI substrate only)
**Status:** Slice 6.A SHIPPED.
**Phase 6 status:** 6.A SHIPPED (foundation); 6.B (box-select), 6.C
(modal grab/drag), 6.D (delete/duplicate), 6.E (column ops), 6.F
(per-channel mute/solo), 6.G (tests + exit gate) remain.

---

## What this slice shipped

### Substrate

**`src/anim/dopesheetSelectOps.js`** (NEW, ~280 LOC after audit-fix)
exports:

- `applyTickSelectReplace(handles, fcurveId, kfIdx)` — plain LMB:
  clear all, select this tick. Identity-stable no-op when already
  the sole selection.
- `applyTickSelectExtend(handles, fcurveId, kfIdx)` — shift+LMB:
  toggle this tick (Blender `SELECT_INVERT`). Drops fcurveId entry
  from the outer Map when the inner sub empties.
- `applyTickSelectDeselect(handles, fcurveId, kfIdx)` — ctrl+LMB:
  remove this tick if present (SS DEVIATION 1 — see below).
  Identity-stable no-op when not present.
- `isTickSelected(handles, fcurveId, kfIdx)` predicate for UI.

All ops pure (input never mutated); throw (Rule №1) on bad input.

### Store lift (architectural — no UX change)

`src/store/keyformSelectionStore.js` — the cross-editor selection
store evolved from "FCurveEditor canonical / others read-only mirror"
(Slice 5.EE shape) to "canonical state across all writers" (Slice
6.A shape).

Changes:
- `publishHandles` → `setHandles` (cleaner name now that it's the
  canonical setter).
- Added `useKeyformSelectionState()` hook returning
  `[handles, setHandles]` with React-`useState` ergonomics. Setter
  is identity-stable (audit-fix CRITICAL).
- Module docstring updated to reflect the multi-writer model +
  history note explaining the Slice 5.EE → 6.A evolution.

`src/v3/editors/fcurve/FCurveEditor.jsx`:
- Replaced `useState(new Map())` (line 645) with
  `useKeyformSelectionState()` — same `[selectedHandles,
  setSelectedHandles]` tuple shape; all 22 in-file call sites
  unchanged.
- Removed the Slice 5.EE publish-effect (publish-on-change +
  clear-on-unmount); the store IS the state now.

### UI surface

`src/v3/editors/dopesheet/DopesheetEditor.jsx`:
- Tick LMB click → select via `dopesheetSelectOps` (plain = replace,
  shift = extend toggle, ctrl/cmd = deselect).
- Tick double-click → seek to tick time (via separate `onDoubleClick`
  handler, not via `onClick` detail-check after audit-fix HIGH-A2).
- Empty-fcurveId rows (synthetic/header) keep legacy single-click
  seek behavior.
- Tick visual: orange ring + amber-400 fill when selected; distinct
  from yellow-300 active-keyform halo + the primary "hot"
  current-frame styling.
- `handleTickClick` wrapped in `useCallback`; identity now actually
  stable (post audit-fix CRITICAL).

---

## Cite-discipline arc

| Cite | Verified |
|------|----------|
| `action_select.cc:1897-2047` (`mouse_action_keys`) | YES |
| `action_select.cc:2089-2125` (`ACTION_OT_clickselect`) | YES |
| `action_select.cc:2095` (`idname`) | YES |
| `ED_keyframes_edit.hh:62-69` (`SELECT_*` enum) | YES |
| `keyframes_edit.cc:1567-1580` (`select_bezier_invert`) | YES |
| `keyframes_edit.cc:1523` (`select_bezier_add`) | YES |
| `blender_default.py:2624-2663` (`km_dopesheet`) | YES |
| `blender_default.py:2640-2641` (shift+LMB extend) | YES |
| `blender_default.py:2651-2653` (Ctrl+LMB select_leftright) | YES |

**Pre-audit:** 3 cites attempted, 1 VERIFIED, **2 FABRICATIONS** —
`SELECT_REPLACE=0/EXTEND=1/INVERT=2` enum values + the
`SELECT_EXTEND` token (all fab); `mouse_action_keys:1530-1600` line
range (off ~370 lines, pointing at unrelated function).

**Post-audit:** 9 cites, all byte-verified against the reference
clone. **Cite-discipline RESET to 0 after BROKE at 2 on substrate**.

Streak arc continuation: 5.P broke at 0 → 3.F-4.C HOLDS at 5 →
4.D.1 BROKE → reset → 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 →
4.D.4 BROKE at 2 → reset → 4.E BROKE at 2 → reset → 4.F clean (no
new cites) → **6.A BROKE at 2, RESET to 0**.

The 3-slice pattern (4.D.4, 4.E, 6.A) all share: cites referencing
function NAMES, formula NUMBERS, or enum VALUES are the high-risk
class. Line ranges off by hundreds of lines, function names
invented, enum values wrong. Mitigation: byte-verify against the
reference clone BEFORE paste. The mitigation works — the audit
sweeps catch the fabs same-session every time — but the substrate
keeps eating the cite-discipline penalty. Worth a meta-feedback
memory: "for high-risk cite classes (names / numbers / enum values),
spawn an Explore agent to byte-verify EACH cite as a pre-ship
checklist item, not as an audit-time after-the-fact".

---

## Audit findings rolled up (sweep #71)

| Audit | CRITICAL | HIGH | MED | LOW | CITE FABS |
|-------|----------|------|-----|-----|-----------|
| Architecture | 1 (hook identity-stable claim was false) | 1 (double-click select-then-select-then-seek) | 1 (extend no-op missing) | 0 | 0 |
| Blender fidelity | 0 | 3 (2 cite fabs + Ctrl+LMB fab claim) | 1 (3-modes claim wrong) | 1 (REPLACE channel-cascade gap) | **2** |

All findings addressed in same-day audit-fix commit `5b4cccd`.

---

## SS deviations (1 new this slice; cumulative — Phase-6-specific 1)

- **DEV 1 (Phase 6)** — Ctrl+LMB rebound to deselect mode. Blender's
  Dopesheet keymap binds Ctrl+LMB to `action.select_leftright
  mode=CHECK` (range left/right-of-frame). SS rebinds for Phase 6.A's
  per-tick scope; the leftright operator can ship with its own
  Blender-faithful binding (likely `[`/`]` keys per
  `blender_default.py:2657-2660`) in a later slice.

---

## Rule №1 catches surfaced this slice

1. **Audit CRITICAL** — `useKeyformSelectionState` returned a fresh
   closure for `setHandles` every render, contradicting the docstring's
   identity-stable promise. Pre-fix this invalidated downstream
   `useCallback`s and created a latent stale-closure trap in
   FCurveEditor's pruning effect. Fix: wrap in `useCallback` with
   the stable Zustand action as the only dep.

2. **Audit HIGH-A2** — Double-click ran the select handler twice
   (detail=1 + detail=2). Separated onClick + onDoubleClick handlers
   so the seek path is explicit + the select calls dedupe via the
   identity-stable no-op return.

3. **In-substrate (MED-A3)** — `applyTickSelectExtend` had no
   identity-stable no-op for the toggle-on-already-selected case.
   Added the guard so the store's `setHandles` `===` check actually
   fires for the no-op.

4. **In-substrate (HIGH-F3)** — Fabricated claim that "Blender folds
   Ctrl+LMB into SELECT_INVERT". Replaced with honest SS DEVIATION 1
   documentation.

---

## Test counts

| File | Pre-slice | Post-substrate | Post-audit-fix |
|------|-----------|----------------|----------------|
| `test_dopesheetSelectOps.mjs` | 0 | 58 | 60 |

Sibling test suites unchanged + all still green:
- All `test_fcurve*.mjs` + `test_keyform*.mjs`: PASS
- All `test_nla*.mjs` + `test_bakeNla.mjs`: PASS
- Typecheck clean (TS2365 fixed in substrate ship).

---

## Commits this slice (2)

```
cfb82a9 feat(anim): Phase 6 Slice 6.A — Dopesheet tick selection + lift keyformSelectionStore
5b4cccd fix(audit): Phase 6 Slice 6.A audit-fix — Critical hook identity + 3 HIGH + 1 MED + 2 cite fabs
```

(+1 docs commit shipping this close-out + plan banner + MEMORY update.)

---

## Top queued path next

**Slice 6.B — Dopesheet box-select (B key + drag-rect)**.

Per plan §6.B: `dopesheet.boxSelect` operator bound to B key (modal
rect entry) + LMB-drag (immediate-rect). Mirrors Blender's
`ACTION_OT_select_box` at `action_select.cc:670-810` (approximate
range — to be byte-verified pre-ship). Should leverage the
selection ops shipped in 6.A by composing rect-hit + Replace /
Extend / Deselect modes.

After 6.B:
- **Slice 6.C** — Modal `graphEd.grab`-style time-only drag of
  selected ticks (G key). Mutates fcurve `keyforms[i].time` for
  each selected entry.
- **Slice 6.D** — Delete / Duplicate (Shift+D) selected ticks.
- **Slice 6.E** — Column ops (Ctrl+C copy column / Ctrl+V paste).
- **Slice 6.F** — Per-channel mute (M) / solo (Ctrl+Alt+M).
- **Slice 6.G** — Tests sweep + Phase 6 exit gate.

---

## Pre-compact state (snapshot)

- **Branch**: master, 166 commits ahead of origin (NEVER pushed this
  session per standing "Push only to origin" rule)
- **Working tree**: about to commit this close-out + plan banner + MEMORY
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A SHIPPED; 6.B-6.G remain (~3 days
  estimated remaining)
- **Tests added this slice**: 60 new asserts (test_dopesheetSelectOps);
  all sibling suites green; typecheck clean
- **Audit sweep this slice**: #71: 1 CRITICAL + 5 HIGH + 2 MED + 1
  LOW + 2 CITE FABS; all addressed
- **Cite-discipline**: BROKE at 2 on 6.A substrate, RESET to 0 after
  audit-fix; Phase-6-specific Cite-discipline tracking begins at 0
- **SS deviations**: 1 cumulative for Phase 6 (DEV 1 — Ctrl+LMB
  rebind)
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G
