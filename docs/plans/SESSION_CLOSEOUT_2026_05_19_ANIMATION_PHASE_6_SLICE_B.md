# Session Close-out — Animation Phase 6 Slice 6.B (Dopesheet box-select)

**Session date:** 2026-05-19 (continuation; cross-compact)
**Branch:** master (169 commits ahead of origin/master; +2 this slice)
**Schema:** v42 (no bump — UI substrate only)
**Status:** Slice 6.B SHIPPED.
**Phase 6 status:** 6.A + 6.B SHIPPED; 6.C (modal grab) + 6.D + 6.E +
6.F + 6.G remain.

---

## What this slice shipped

### Substrate

**`src/anim/dopesheetBoxSelect.js`** (NEW, ~340 LOC after audit-fix):

- `applyBoxSelect(handles, hitsInRect, mode)` — pure mutation. 3
  modes (`'replace'` / `'extend'` / `'subtract'`); identity-stable
  no-ops; throws Rule-№1 on bad input; drops fcurveId from outer Map
  when subtract empties a sub.
- `computeBoxHits(hitRows, tMin, tMax)` — pure hit calculator.
  Caller pre-filters rows by Y intersection; this helper walks
  keyforms with **INCLUSIVE bounds** (SS DEVIATION 2 vs Blender's
  STRICT inequality).
- `BOX_SELECT_MODES` frozen list.

### UI surface

`src/v3/editors/dopesheet/DopesheetEditor.jsx`:

- Track area pointerdown/move/up handlers manage `boxDrag` useState.
- 4px drag threshold disambiguates click vs drag (Slice 5.Y precedent).
- Drag-on-tick guard: pointerdown on `[data-tick="1"]` element returns
  early so the tick onClick fires normally (mirrors Blender's
  `actkeys_box_select_invoke` OPERATOR_PASS_THROUGH at
  `action_select.cc:613-618`). EXCEPTION: B-key armed overrides.
- B-key armed state: window keydown listener sets `bArmed=true`;
  next pointerdown starts drag-rect regardless of target. Escape
  clears.
- Marquee overlay rendered above threshold (blue for replace/extend;
  red for subtract).
- Rows carry `data-row-idx` for Y-intersection hit-test via
  `querySelectorAll`.

---

## Cite-discipline arc

| Cite | Verified |
|------|----------|
| `action_select.cc:603-622` (`actkeys_box_select_invoke`) | YES |
| `action_select.cc:624-673` (`actkeys_box_select_exec`) | YES |
| `action_select.cc:675-703` (`ACTION_OT_select_box`) | CORRECTED (was `:695`) |
| `action_select.cc:527-599` (`box_select_action`) | CORRECTED (was `:598`) |
| `action_select.cc:441-446` (`ACTKEYS_BORDERSEL_*`) | YES |
| `action_select.cc:613-618` (tweak path) | YES |
| `keyframes_edit.cc:1523-1543` (`select_bezier_add`) | CORRECTED (was `:1532`) |
| `keyframes_edit.cc:559-567` (`ok_bezier_framerange`) | NEW — replaces fab `action_select.cc:567` |
| `blender_default.py:2662-2671` (`km_dopesheet` box_select) | YES |

**Pre-audit:** 8 cites, 4 VERIFIED, **3 truncated + 1 FAB**.

**Post-audit:** all 9 cites byte-verified. **Cite-discipline RESET
to 0 after BROKE at 1 (fab)**.

Streak arc continues:
- 5.P broke at 0 → reset
- 3.F-4.C HOLDS at 5 → 4.D.1 BROKE → reset
- 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 → 4.D.4 BROKE at 2 → reset
- 4.E BROKE at 2 → reset → 4.F clean
- 6.A BROKE at 2 → reset
- **6.B BROKE at 1 → reset** (the fab inverted a semantic claim —
  Blender uses strict inequality, SS uses inclusive; both
  documented as honest deviation now)

**Pattern observation across the 4-slice fab streak (4.D.4, 4.E,
6.A, 6.B):** cites that claim "Blender's X behaves Y" are the
high-risk class. Line-range cites get truncated; function-name cites
get invented; semantic-claim cites get inverted. The 6.B mitigation
("byte-verify BEFORE paste") was partially effective — 4 of 8 cites
landed clean; 3 truncations were minor; the FAB was the load-bearing
one. Worth a meta-feedback memory: spawn a verification Explore
agent for ANY cite that asserts BEHAVIOR (not just existence).

---

## Audit findings rolled up (sweep #72)

| Audit | HIGH | MED | LOW | CITE FABS |
|-------|------|-----|-----|-----------|
| Architecture | 2 (move handler dep + B-key listener split) | 1 (conditional on H1) | 2 (test gap + doc) | 0 |
| Blender fidelity | 1 (inclusivity fab + inverted semantic) | 3 (cite truncations) | 0 | **1** |

All findings addressed in same-day audit-fix commit `dff1c99`.

---

## SS deviations (2 new this slice; Phase-6-cumulative 3)

- **DEV 2 (Phase 6)** — INCLUSIVE time-range bounds vs Blender's
  STRICT inequality (`ok_bezier_framerange` at `keyframes_edit.cc:
  559-567`). A tick exactly on the rect boundary is ACCEPTED in SS,
  REJECTED in Blender. Honest deviation; modern UI convention.
- **DEV 3 (Phase 6)** — Axis-range mode (Alt+B → FRAMERANGE /
  CHANNELS) NOT shipped in 6.B; scope-deferred to a follow-on slice.
  Promoted from informal "deferred to polish slice" footnote to
  numbered SS DEVIATION per Rule №2 (undeclared deferrals are
  migration baggage in disguise).

---

## Rule №1 catches surfaced this slice

1. **Architecture HIGH-A1** — `handleTrackPointerMove` recreated on
   every drag-move event. Pre-fix the `[boxDrag]` dep would cause
   60-120 Hz pointer-handler prop churn during a drag. Fixed by
   removing `boxDrag` from deps + relying on the functional
   `setBoxDrag` updater.

2. **Architecture HIGH-A2** — B-key useEffect re-registered both
   listeners on every `bArmed` flip. Pre-fix wasteful; post-fix
   split into two effects (one stable arm-listener, one
   conditionally-mounted Escape-clear).

3. **Fidelity HIGH-F1** — Pre-fix docstring CITE FAB inverted a
   semantic claim: SS used INCLUSIVE bounds + cited a fab line
   `action_select.cc:567` to claim Blender did too. The actual
   Blender semantic at `keyframes_edit.cc:559-567` is STRICT
   inequality (opposite!). Fixed by replacing fab cite with
   correct cite + documenting SS's choice as honest deviation.

4. **Honesty E** — Docstring claimed "SS deviations: None new this
   slice" while documenting axis-range deferral. Promoted to
   numbered SS DEVIATION 3 (Rule №2).

---

## Test counts

| File | Pre-slice | Post-slice |
|------|-----------|------------|
| `test_dopesheetBoxSelect.mjs` | 0 | 61 |

All sibling NLA / FCurve / Keyform / Dopesheet test suites still
green (verified via full sweep — fcurveActive, fcurveBoxSelect,
fcurveChannelSelect, fcurveEval, fcurveGroups, fcurveModifiers*,
keyform*, nla* incl. test_nlaEval/test_nlaEditorOps/test_nlaTweakMode/
test_nlaEditorData, test_bakeNla, test_dopesheetSelectOps, dopesheet
rows). Typecheck clean.

---

## Commits this slice (2)

```
bdf95a8 feat(anim): Phase 6 Slice 6.B — Dopesheet box-select (B key + LMB-drag rect)
dff1c99 fix(audit): Phase 6 Slice 6.B audit-fix — 2 HIGH-A + 1 cite FAB + 3 cite truncations + 2 new SS DEVs
```

(+1 docs commit shipping this close-out + plan banner + MEMORY.)

---

## Top queued path next

**Slice 6.C — Modal grab (G key) for time-translate of selected ticks.**

Per plan §6.B operator table: `dopesheet.grab | G | Modal drag
selection in time`. Mirrors Blender's `TRANSFORM_OT_translate` in
TFM_TIME_TRANSLATE mode invoked from `ACTION_OT_*` workflows. SS
will need:

- A modal "grab" state machine (entered on G keypress; pointer move
  updates a preview offset; LMB / Enter commits; RMB / Escape
  cancels).
- A pure op `applyTimeTranslate(action, selectedHandles, deltaMs)`
  that updates `keyform.time` for every selected center-bit entry
  while preserving handle offsets (handleLeft.time / handleRight.time
  shift by the same delta to keep the bezier shape).
- A live-preview overlay in the Dopesheet (translucent ticks at
  the proposed new positions while the drag is in progress).
- Auto-keyform-sort after commit (`keyforms[]` invariant is sorted
  by time — handle the case where the translate crosses adjacent
  keyforms).

After 6.C:
- **6.D** — Delete (Delete key) + Duplicate (Shift+D) selected ticks
- **6.E** — Column copy/paste (Ctrl+C / Ctrl+V)
- **6.F** — Per-channel mute (M) + solo (Ctrl+Alt+M)
- **6.G** — Test sweep + Phase 6 exit gate

---

## Pre-compact state (snapshot)

- **Branch**: master, 169 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit this close-out + plan banner +
  MEMORY
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A + 6.B SHIPPED (2/7 slices); 6.C-6.G
  remain (~2-3 days estimated)
- **Tests added this slice**: 61 new asserts (test_dopesheetBoxSelect);
  all sibling suites green; typecheck clean
- **Audit sweep this slice**: #72: 2 HIGH-A + 1 MED-A + 2 LOW-A +
  1 HIGH-F (fab) + 3 MED-F (cite truncations); all addressed
- **Cite-discipline**: BROKE at 1 (fab) on 6.B substrate, RESET to 0
  after audit-fix
- **SS deviations (Phase 6)**: 3 cumulative (DEV 1 Ctrl+LMB rebind;
  DEV 2 inclusive bounds; DEV 3 axis-range deferred)
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G
