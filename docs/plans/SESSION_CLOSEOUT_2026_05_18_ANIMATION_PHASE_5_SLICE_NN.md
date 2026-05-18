# Animation Phase 5 — Slice 5.NN close-out

**Date**: 2026-05-18
**Commits**: `2cb56d8` (substrate; no audit-fix needed) → (this doc)
**Path #59 from Phase 5 queue** — *Wire `clearActiveFCurveGroups` into
bulk select-all* — SHIPPED. **First-ever single-commit substrate ship
in Phase 5** (audit returned 0 actionable findings).

## What the path was

> "59 | Wire `clearActiveFCurveGroups` into bulk select-all (closes
> 5.LL Dev 3) | **NEW TOP** for one-slice ships"
> — from Slice 5.MM close-out (`SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_5_SLICE_MM.md`)

Substrate extension of Slice 5.K's `applyChannelSelectAll`. Pre-5.NN
the helper operated only on `action.fcurves`; this slice extends scope
to `action.groups`, faithfully porting Blender's ANIMTYPE_GROUP case
of `anim_channels_select_set` at `:714-722`. Closes the last open
deviation from 5.LL.

## Blender divergence verified

| Aspect              | Blender                                          | SS port (5.NN)                                |
|---------------------|--------------------------------------------------|-----------------------------------------------|
| Operator entry      | `ANIM_OT_channels_select_all` `:3556`            | `applyChannelSelectAll(action, mode, ctx)`    |
| Walker              | `anim_channels_select_set` `:678-819`            | inline group + fcurve loops                   |
| Group select cascade | `:716` `ACHANNEL_SET_FLAG(agrp, sel, AGRP_SELECTED)` | per-group ADD/CLEAR/INVERT (sparse-delete on false) |
| Group active cascade | `:718-720` `if (change_active) { agrp->flag &= ~AGRP_ACTIVE; }` | unconditional `delete g.active` when change_active=true |
| FCURVE active cascade | `:728-732` `if (!FCURVE_SELECTED && change_active)` | gated on `!fc.selected && change_active` — preserves active fcurve |
| Toggle resolver     | `anim_channels_selection_flag_for_toggle` `:536-570` walks unified list | scans both `orderedIds` + `orderedGroupIds` |

**Key asymmetry ported faithfully**: GROUP active-clear is
UNCONDITIONAL (no selected-state gate); FCURVE active-clear is GATED
on "fcurve ends up deselected". The famous "Only erase the ACTIVE
flag when deselecting" comment at `:729-730` applies only to fcurves.
Groups lose AGRP_ACTIVE on every select-all regardless of post-select
state.

Sources verified (per fidelity audit, 100% pass):
- `anim_channels_edit.cc:683` `change_active = (sel != ACHANNEL_SETFLAG_EXTEND_RANGE)`
- `anim_channels_edit.cc:714-722` ANIMTYPE_GROUP case
- `anim_channels_edit.cc:723-734` ANIMTYPE_FCURVE case
- `anim_channels_edit.cc:728-732` FCURVE active-clear gate
- `anim_channels_edit.cc:718-720` GROUP unconditional active-clear
- `anim_channels_edit.cc:536-570` toggle resolver
- `anim_channels_edit.cc:3521-3554` `animchannels_selectall_exec`
- `anim_channels_edit.cc:3537/3540/3543` per-mode dispatch calls

## What shipped

| Capability | Where |
|------------|-------|
| `applyChannelSelectAll` extended with `ctx.orderedGroupIds` parameter | `src/anim/fcurveChannelSelect.js` ~line 481 |
| Toggle resolver scans both `orderedIds` + `orderedGroupIds` | same ~line 565 |
| Per-group `selected` cascade (sparse-delete on transition to false) | same ~line 620 |
| Per-group `active` UNCONDITIONAL clear (mirrors `:718-720` no-gate behavior) | same ~line 637 |
| Dispatcher populates `orderedGroupIds = a.groups.map(g => g.id)` | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 2128 |
| Slice 5.LL Deviation 3 marked RESOLVED | `src/anim/fcurveGroupActive.js` ~line 122 |
| Tests: 35 new 5.NN scenarios (chain total 441, was 406 pre-5.NN) | `scripts/test/test_fcurveChannelSelect.mjs` |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 0   | 0   | 0 (5 sub-threshold findings noted for transparency) |
| Blender fidelity | 0    | 0   | 1 (cosmetic) | 1     |
| **Combined**     | **0** | **0** | **1** | **1** |

**Fab streak HOLDING at 2 (5.MM + 5.NN)** — first two-in-a-row
all-green fidelity since pre-5.P. Per fidelity agent: "Asymmetry-
preservation port is byte-faithful. Citation hygiene is clean.
Function-attribution discipline (the 5.LL HIGH-2 regression pattern)
is intact — every function name in the JSDoc/comments matches the
actual reference function it cites."

Architecture agent: "Every architectural invariant checked out:
sparse-write consistency, unconditional active-clear correctness,
EXCLUSIVE invariant, backwards compatibility, toggle resolver
order-insensitivity, test coverage for the asymmetry — all
verified."

**No audit-fix sweep needed** — first time in Phase 5 the audit
returned cleanly enough to skip the fix-sweep commit. Convention
preserved: when both agents return 0 findings ≥ MED, skip the
audit-fix commit; document the clean-audit result inline in the
close-out.

## Implementation notes

### The asymmetry preservation pattern

The most load-bearing detail is the GROUP-vs-FCURVE asymmetry on
active-clear:

```c
// Blender — :714-734 (ANIMTYPE_GROUP + ANIMTYPE_FCURVE cases)
case ANIMTYPE_GROUP: {
  ACHANNEL_SET_FLAG(agrp, sel, AGRP_SELECTED);
  if (change_active) {
    agrp->flag &= ~AGRP_ACTIVE;  // UNCONDITIONAL (no SELECTED gate)
  }
  break;
}
case ANIMTYPE_FCURVE: {
  ACHANNEL_SET_FLAG(fcu, sel, FCURVE_SELECTED);
  if (!(fcu->flag & FCURVE_SELECTED) && change_active) {
    fcu->flag &= ~FCURVE_ACTIVE;  // GATED on !SELECTED
  }
  break;
}
```

SS port preserves both shapes inline. The temptation to "unify" the
two loops into one would erase the asymmetry — explicitly avoided.

### Sparse-write split (fcurves vs groups)

Pre-existing convention from Slice 5.F (fcurves) and Slice 5.V
(groups): fcurves write `=false` on transition; groups `delete` on
transition. Preserved in 5.NN's extension — the fcurve loop uses
`fc.selected = false`, the group loop uses `delete g.selected`.

### Toggle resolver order

SS scans fcurves first, then groups (Blender walks unified list
interleaved). Order is semantically irrelevant — the scan is a
boolean OR with short-circuit on first found; any-selected resolves
to CLEAR regardless of which scope holds the truthy entry.

## SS deviations from Blender (1 new, inherited)

1. **Walker scope** — SS walks `orderedIds` (fcurve ids) +
   `orderedGroupIds` (group ids) explicitly via the dispatcher's
   ctx. Blender walks `anim_data` filtered by visible-channel
   filter inside the helper. Sister to Slice 5.MM walker scope
   deviation: the sidebar bucketization shows every group header
   regardless of expansion, so `orderedGroupIds = a.groups.map(g
   => g.id)` (no further filter today). If a future slice adds
   group-level hide-from-sidebar, this list will need narrowing.

## Queued paths (post-5.NN)

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
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |
| 57  | Graph-region select_box B (default) vs Q (IC) keybinding      | queued (downstream of #55)        |
| 60  | Box-select group rows + AGRP_ACTIVE clear (closes 5.LL Dev 4) | queued (downstream of group-row hit-test substrate) |

## Lessons

1. **First-ever clean-audit ship in Phase 5.** Both agents returned 0
   findings ≥ MED. Convention preserved: skip the audit-fix commit
   when audits are clean; document the clean result inline in the
   close-out. Single-commit substrate ships are the goal state for
   well-disciplined work. Lesson: cite-discipline pays compound
   interest — 5.MM's clean fidelity audit transferred to 5.NN
   without effort, because the same author was operating with the
   same lens.

2. **Asymmetry preservation is a recurring port discipline.** The
   FCURVE-vs-GROUP active-clear asymmetry is one of dozens of
   per-type behavior differences scattered through Blender's
   channel system. The temptation to "factor out the common pattern"
   would erase the asymmetry. Lesson: when porting a per-type
   switch, default to keeping each case's body inline rather than
   extracting helpers — the case bodies ARE the spec, and any
   factoring must explicitly preserve the per-type differences.

3. **11-slice gap-closure streak (5.Z → 5.NN).** 5.NN is the second
   slice (after 5.MM) in the post-substrate-chain cleanup phase.
   Each closes one or two deviations from prior substrate slices
   (5.LL Dev 3 closed by 5.NN; 5.KK Dev 4 + 5.LL Dev 1 closed by
   5.MM). The remaining open Phase 5 deviations (5.LL Dev 4
   box-select group rows, 5.MM Dev 1 walker scope, etc.) are all
   downstream of substrate that doesn't exist yet (group-row
   hit-test, group-level hide-from-sidebar). Phase 5 active work
   surface is nearly tapped out; remaining items are mostly polish
   + downstream of un-shipped substrate (#14 F-Curve modifiers full
   phase).

4. **Sparse-write split is load-bearing.** The fcurves-use-`=false`,
   groups-use-`delete` split is established convention from Slices
   5.F + 5.V. 5.NN's extension preserved both correctly. A future
   "unify the sparse-write convention" slice should be careful —
   either approach has pros/cons, but flipping in either direction
   without a careful migration would break the sparse-field
   invariants in dozens of helper sites.
