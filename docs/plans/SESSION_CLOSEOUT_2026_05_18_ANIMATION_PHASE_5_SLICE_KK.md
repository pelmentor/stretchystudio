# Animation Phase 5 — Slice 5.KK close-out

**Date**: 2026-05-18
**Commits**: `53ae395` (substrate) → `f314dc6` (audit-fix sweep) → (this doc)
**Path #49 from Phase 5 queue** — *Plain/Ctrl group-header click handlers
(closes 5.BB scoped-out variants)* — SHIPPED (Shift deferred to #50).

## What the path was

> "49 (NEW) | Plain/Ctrl/Shift group-header click handlers (closes
> 5.BB scoped-out variants — plain=SELECT_REPLACE, Ctrl=SELECT_INVERT,
> Shift=SELECT_EXTEND_RANGE) | NEW TOP for one-slice ships — different
> category (UI gesture, not preset-aware key)"
> — from Slice 5.BB close-out (`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_BB.md`)

Sister-pattern slice to 5.BB. Same shape (helper + preflight + dispatcher
+ sidebar wiring + tests), one categorical extension: 5.BB shipped only
the `children_only` branch (Shift+Ctrl), 5.KK fills in plain and Ctrl.
Shift is the one branch that depends on un-ported substrate (AGRP_ACTIVE
from path #50) and is explicitly deferred.

## Blender divergence verified

| Modifier             | Blender selectmode      | SS port (5.KK)                           |
|----------------------|-------------------------|------------------------------------------|
| Plain LMB            | `SELECT_REPLACE`        | `'replace'` — pre-clear visible + set    |
| Ctrl+LMB             | `SELECT_INVERT`         | `'toggle'` — XOR clicked group           |
| Shift+LMB            | `SELECT_EXTEND_RANGE`   | **no-op** (deferred; see Dev 4)          |
| Shift+Ctrl+LMB       | `-1` = children_only    | shipped Slice 5.BB                       |

Sources:
- `anim_channels_edit.cc:4120-4221` (`click_select_channel_group` body
  with all 4 branches at `:4154-4189`)
- `anim_channels_edit.cc:4475-4604` (`mouse_anim_channels` per-type dispatcher)
- `anim_channels_edit.cc:4614-4670` (`animchannels_mouseclick_invoke` —
  reads RNA props, derives selectmode, calls `mouse_anim_channels`)
- `blender_default.py:3848-3854` (keymap entries; identical mapping in
  `industry_compatible_data.py`)

## What shipped

| Capability | Where |
|------------|-------|
| `applyGroupHeaderSelect(action, groupId, modifier, ctx) → { changed, clearedActive, groupSelectedAfter }` | `src/anim/fcurveChannelSelect.js` ~line 985 |
| `wouldGroupHeaderSelectChange` preflight | same |
| `applyGroupHeaderSelectOp` dispatcher (skipHistory:true, preflight-gated) | `FCurveEditor.jsx` ~line 2229 |
| Sidebar group-header span onClick — full 4-modifier surface (Shift+Ctrl=children_only / plain=replace / Ctrl=toggle / Shift=explicit no-op) | `FCurveEditor.jsx` ~line 3630 |
| Tests: 57 substrate + 7 audit-fix scenarios = 64 5.KK assertions (chain total 338, was 274 pre-5.KK) | `scripts/test/test_fcurveChannelSelect.mjs` |

## Substrate (`53ae395`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveChannelSelect.js` | +helper +preflight +exports-list +~290 LOC | Pure helpers + module-header Blender provenance for the two modifier branches |
| `scripts/test/test_fcurveChannelSelect.mjs` | +57 5.KK assertions | Guards, both modifiers, active cascade, idempotency, visible-scope narrowing, preflight-matches-setter scenarios |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | + import (2 exports), + dispatcher, + Sidebar prop pass-through, + span onClick rewrite | Dispatcher + UI wiring |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 1   | 1   | 2     |
| Blender fidelity | 0    | 2   | 3   | 5     |
| **Combined**     | **0** | **3** | **4** | **7** |

**Fab streak HELD** (zero fab cites — last break 5.Y). **5th slice in a
row holding streak** (5.AA → 5.BB → 5.DD → 5.EE → 5.KK).

Arch findings are both test gaps (defensive coverage); no real bug.
Fidelity findings are all citation precision (function name, line range,
deviation rationale) — no semantic-port bug.

## Audit-fix sweep (`f314dc6`)

All MED + LOW addressed.

### Fidelity findings

**MED-1 — Function-name mis-attribution (4 sites).** Earlier draft
attributed the branches at `:4154-4189` to `mouse_anim_channels`
directly. They live inside `click_select_channel_group`
(`:4120-4221`); `mouse_anim_channels` is the per-type dispatcher at
`:4475`. Fixed in all 4 sites (helper JSDoc + dispatcher comment +
span comment) with explicit dispatch chain documented.

**MED-2 — Deviation 4 rationale rewritten.** Earlier draft implied
Blender's auto-downgrade at `:4517-4522` was fcurve-type-only — it
is type-agnostic. SS's no-op is an INTENTIONAL divergence (not a
faithful port): until path #50 ports AGRP_ACTIVE, every Shift would
trigger Blender's downgrade, making Shift indistinguishable from
Ctrl 100% of the time. Closes automatically when #50 lands.

**LOW-1 — `blender_default.py:3848-3853` off-by-1.** children_only
entry spans `:3853-3854`. Helper + span cites corrected to
`:3848-3854`. Dispatcher comment kept narrower at `:3848-3852` with
explicit range modifier cite added.

**LOW-2 — `:4202-4204` pchan cite off-by-1.** Actual call
`ED_pose_bone_select` at `:4201-4203`. Fixed.

**LOW-3 — `anim_channels_select_set` partial-range cite.** Function
defined `:678-819`; earlier cite `:678-734` named the function but
covered only the FCURVE case. Rewritten to clarify scope.

### Architecture findings

**MED-1 — Test gap: 'toggle' on `group.selected === false` (literal).**
Setter correctly handles the literal-false case (else-branch sets
true). Defensive test added — sister to Slice 5.F's
`isFCurveSelected({ selected: false })` test.

**LOW-1 — Test gap: 'replace' with active fcurve as child of clicked
group.** Scenario was exercised only indirectly via preflight-parity
loop. Standalone test added asserting `clearedActive === true` and
that fc1 is NOT auto-selected (replace ≠ children_only).

## SS deviations from Blender (5 documented)

1. **AGRP_ACTIVE not ported.** Blender re-elevates the clicked group
   to AGRP_ACTIVE after SELECT_REPLACE (`:4194-4204`) and toggles the
   active-group slot on SELECT_INVERT (`:4194-4218`). SS has no
   `group.active` field today; elevation dropped until path #50.
   Sister deviation to Slice 5.BB MED-3.

2. **No pchan cascade.** SS has no armature/pchan model — N/A.

3. **No `OPTYPE_UNDO` snapshot.** Inherited from Slice 5.F/5.K/5.BB
   convention.

4. **Shift+click on group header is a no-op — INTENTIONAL divergence
   from Blender's auto-downgrade.** Blender's auto-downgrade at
   `:4517-4522` is type-agnostic; would fire 100% for groups (no
   AGRP_ACTIVE exists), making Shift ≡ Ctrl in all cases. SS
   explicitly avoids the masquerade until path #50 lands AGRP_ACTIVE.

5. **macOS Cmd substitutes for Ctrl.** Sister to Slice 5.BB Dev 4
   and Slice 5.AA metaKey-as-Ctrl deviation.

6. **Visible-scope pre-clear narrower than `LIST_VISIBLE`.** Sister
   to Slice 5.BB audit-fix fidelity MED-4 and Slice 5.Y MED-1. Same
   conflation across all visible-scope helpers; deferred to a future
   scope-unification slice.

## Queued paths (post-5.KK)

| Path | Title | Status |
|------|-------|--------|
| 13  | Phase 2 owed-manual verification                              | USER-SIDE                         |
| 14  | Phase 3 — F-Curve modifiers (full phase, ~weeks)              | queued                            |
| 16-27 | (other Phase 5 polish + carry-overs)                        | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (5.Y Dev 3)      | low-priority                      |
| 50  | **Port AGRP_ACTIVE** (closes 5.BB MED-3 + 5.KK Dev 1 + 5.KK Dev 4 → unblocks Shift+group-click range-select) | **NEW TOP** (substrate slice)     |
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |
| 57  | Graph-region select_box B (default) vs Q (IC) keybinding      | queued (downstream of #55)        |
| 58 (NEW from 5.KK) | Port Shift+group-click range-select with AGRP_ACTIVE auto-downgrade | queued (downstream of #50) |

## Lessons

1. **Fab streak HELD 5 slices in a row.** Pre-verify per-cite
   discipline scales when cites are load-bearing. **But MED-1
   (function-name mis-attribution) is a new category** — not a
   fabrication (the lines exist and contain what was claimed), but
   the function name was wrong so readers grepping for it land in
   the wrong place. Lesson: cite the function name AND the line
   range together, then verify both by `grep -n "static.*function_name"`
   to ensure the function actually owns those lines.

2. **Test gaps for "sparse-delete convention should make this
   impossible" cases are still worth covering.** Arch MED-1 (toggle
   on literal `selected: false`) is a defensive test for a state
   that shouldn't normally exist but would be silently mis-handled
   if any future write path produced it. Sister to Slice 5.BB arch
   MED-2 (ungrouped selected fcurve in scope) which had the same
   "shouldn't normally exist but tests it anyway" shape. Lesson:
   when the helper uses a strict `=== true` check, add a defensive
   test for the literal-false case even if the convention forbids
   it.

3. **Deviation rationale verification is its own audit pass.** MED-2
   was a non-fab fidelity finding: the cite line range was correct
   but the rationale ("Blender restricts to fcurve-type") was wrong.
   The auto-downgrade gate at `:4517-4522` IS type-agnostic; SS's
   no-op is a chosen divergence, not a faithful port. Lesson: when
   writing a deviation that frames SS as "matching Blender", verify
   by reading the cited gate and tracing what types it actually
   applies to.

4. **8-slice gap-closure streak (5.Z → 5.KK) — substrate ROI
   compounds.** Slice 5.AA's resolver substrate plus Slice 5.BB's
   group-children helper continue to enable single-commit ships.
   This is the 8th consecutive gap-closure after the 5.AA substrate.
   Lesson: a well-audited substrate slice is worth ~8 follow-up
   single-commit slices over a 2-day span. Measure substrate ROI in
   downstream-slice-count, not just LOC.

5. **Categorical deferrals create clean future-slice boundaries.**
   Shift+click on group header was a natural deferral point —
   independent dependency (path #50's AGRP_ACTIVE port), independent
   UI behavior (range walker vs single-channel mutation), independent
   test surface (range bounds vs single-id). Lesson: when a modifier
   surface has N branches and one depends on un-shipped substrate,
   ship N-1 with the dependent one explicitly no-op'd rather than
   forcing a half-port. The deviation closes automatically when the
   substrate lands.
