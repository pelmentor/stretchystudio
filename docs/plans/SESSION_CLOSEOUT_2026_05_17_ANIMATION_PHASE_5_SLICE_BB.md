# Animation Phase 5 — Slice 5.BB close-out

**Date**: 2026-05-17
**Commits**: `d1e05df` (substrate) → `2e2f8ce` (audit-fix sweep) → (this doc)
**Path #35 from Phase 5 queue** — *Group-children select operator (Shift+Ctrl+click)* — SHIPPED.

## What the path was

> "Slice 5.V shipped the FCurveGroup datablock but NOT the group-
> children select operator. Closure tied to a future 'group-children
> select' slice that walks `getFCurvesInGroup(action, groupId)` and
> dispatches selection to each."
> — `src/anim/fcurveChannelSelect.js` Slice 5.F module header,
> documented as a deferred deviation since 2026-05-16

## What shipped

Ports Blender's `selectmode = -1` branch of `mouse_anim_channels` at
`anim_channels_edit.cc:4163-4180`. Dispatched on Shift+Ctrl+click on
EITHER a group header OR an fcurve row (SS extension over Blender's
group-header-only behavior — see Deviation 1).

| Capability | Where |
|------------|-------|
| `applyGroupChildrenSelect(action, groupId, ctx)` pure mutator | `src/anim/fcurveChannelSelect.js` (~280 LOC of helper + JSDoc post-audit-fix) |
| `wouldGroupChildrenSelectChange` preflight | same |
| Sibling-group `selected` pre-clear (audit-fix HIGH-1) | same — mirrors Blender's `:714-722` ANIMTYPE_GROUP cascade |
| `applyGroupChildrenSelectOp` dispatcher (skipHistory:true, preflight-gated, hidden-filtered scope) | `FCurveEditor.jsx` ~line 2140 |
| Sidebar fcurve-row click handler: new Shift+Ctrl arm dispatches through `groupId` (ungrouped fcurves no-op) | `FCurveEditor.jsx` ~line 3460 |
| Sidebar group-header `name` span: cursor-pointer + Shift+Ctrl onClick + Slice 5.Y `wasDragRef` latch check (audit-fix LOW-1) | `FCurveEditor.jsx` ~line 3390 |
| Tests: 36 substrate + 9 audit-fix scenarios = 45 5.BB assertions (chain total 257, was 212 pre-5.BB) | `scripts/test/test_fcurveChannelSelect.mjs` |

## Substrate (`d1e05df`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveChannelSelect.js` | +helper +preflight +import +95 LOC helper +~120 LOC module-header semantics block | Pure helper + module-header Blender provenance |
| `scripts/test/test_fcurveChannelSelect.mjs` | +36 5.BB assertions | Guards, happy path, active-clear in/out of group, hidden-children intrinsic-list, idempotent, preflight-matches-setter |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | + import (2 exports), + dispatcher, + sidebar prop pass-through, + fcurve-row click arm, + group-header span onClick | Dispatcher + UI wiring |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 1    | 3   | 1   | 5     |
| Blender fidelity | 0    | 4   | 2   | 6     |
| **Combined**     | **1** | **7** | **3** | **11** |

**Fab streak HELD** (zero fab cites — last break 5.Y). 4th slice in
a row holding streak (5.W → 5.X → 5.AA → 5.BB).

Arch HIGH-1 (sibling group.selected pre-clear) maps 1:1 to fidelity
MED-2 (same finding from both angles). Both audits independently
verified against Blender source.

## Audit-fix sweep (`2e2f8ce`)

All HIGH + all MED + all LOW addressed.

### Architecture findings

**HIGH-1 — Sibling group `selected` flag not pre-cleared.** Blender's
`anim_channels_select_set` ANIMTYPE_GROUP case at `:714-722` calls
`ACHANNEL_SET_FLAG(agrp, sel, AGRP_SELECTED)` on every visible group
when `sel = CLEAR`. SS's pre-clear only walked fcurves; sibling
groups retained their `selected: true` flag across consecutive
children_only clicks. **Fix**: added Step 1b loop in setter walking
`action.groups` and sparse-deleting `g.selected` on every group
except the clicked one + matching preflight check + dedicated test
scenario. Currently no visible impact (no consumer reads
`isFCurveGroupSelected`) but will be load-bearing the moment
group-header selection highlighting wires up.

**MED-1 — Active-in-group test label.** Documentation improvement
only; test name now references Blender's no-re-elevation rule.

**MED-2 — Test gap: ungrouped selected fcurve in scope.** Added test
asserting `fc.groupId (undefined) !== groupId` correctly wipes
ungrouped fcurves on pre-clear.

**MED-3 — Test gap: group with zero children.** Added test asserting
`selectedCount=0, changed=true` (because `group.selected` still gets
written even when no children exist).

**LOW-1 — `wasDragRef` latch on group-header span.** Group-header
span's onClick now honors the Slice 5.Y drag-rect FSM latch
(consumes it the same way fcurve rows do). Sister-pattern to
Slice 5.Y MED-3.

### Fidelity findings

**MED-1 — Cite range too narrow.** Group-header comment cited
`:4154-4180` for "the ANIMTYPE_GROUP branch handling SELECT_REPLACE
/ SELECT_INVERT / SELECT_EXTEND_RANGE". SELECT_REPLACE is actually at
`:4181-4189` (the else-branch outside the cited range). **Fix**:
corrected to `:4154-4189` with sub-cites for each modifier branch.

**MED-2 — = arch HIGH-1.** Sister finding (same root cause, opposite
angle).

**MED-3 — Step 4 JSDoc overclaimed "no re-elevation".** Blender DOES
re-elevate the clicked GROUP to AGRP_ACTIVE in the post-branch
`ANIM_set_active_channel` call (`:4191-4200`). SS doesn't port
AGRP_ACTIVE per inherited Slice 5.V deviation
(`fcurveGroups.js:17`). **Fix**: rewrote step 4 to acknowledge
Blender's group elevation + SS's inherited omission.

**MED-4 — Hidden-active edge case not noted.** Blender's pre-clear
scope (`DATA_VISIBLE | LIST_CHANNELS`, NO `LIST_VISIBLE` per `:528`
"no list visible, otherwise, we get dangling") is broader than SS's
`orderedIds` (decoded ∩ !hidden). A hidden-but-data-loaded
previously-active fcurve has its FCURVE_ACTIVE cleared by Blender;
SS preserves it. Same conflation as Slice 5.Y MED-1; deferred. **Fix**:
documented as a sub-bullet under step 4.

**LOW-1 — Cmd/Meta extension undocumented.** Added Deviation 4:
macOS Cmd substitutes for Ctrl (`e.ctrlKey || e.metaKey`),
cross-platform parity with rest of editor; sister to Slice 5.AA
metaKey-as-Ctrl deviation.

**LOW-2 — `agrp->channels` equivalence assumption.** Added
Deviation 5: SS walks `action.fcurves` filtering by `groupId`;
equivalence holds iff no fcurve has a dangling groupId pointer (v40
migration is the sole writer; per Rule №1, dangling groupIds are an
upstream bug — not this helper's responsibility to defensively
filter).

## SS deviations from Blender (5 documented)

1. **Shift+Ctrl+click on FCURVE rows resolves to parent group's
   children_only.** Blender's `:4511-4515` early-return = no-op for
   non-group channels. SS extends so users get group-children-select
   without scrolling up to the group header. Ungrouped fcurves still
   no-op.

2. **Hidden children of clicked group still selected.** Matches
   Blender's `agrp->channels` walk (intrinsic child list). Sister to
   Slice 5.Y Deviation 3.

3. **No `OPTYPE_UNDO` snapshot.** Inherited Slice 5.F/5.K convention.

4. **macOS Cmd substitutes for Ctrl.** Sister to Slice 5.AA
   metaKey-as-Ctrl-equivalent deviation.

5. **`agrp->channels` equivalence assumption.** SS walks
   `action.fcurves` filtering by `groupId`; dangling-groupId
   defensive filter intentionally omitted per Rule №1.

## Queued paths (post-5.BB)

| Path | Title | Status |
|------|-------|--------|
| 13  | Phase 2 owed-manual verification                              | USER-SIDE (visual inspection in Cubism Viewer) |
| 14  | Phase 3 — F-Curve modifiers (full phase, ~weeks)              | queued                            |
| 16-27 | (other Phase 5 polish + carry-overs)                        | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| ~~35~~ | ~~Group-children select operator (Shift+Ctrl+click)~~       | **SHIPPED THIS SLICE**            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 40  | `applyChannelSelect.change_active=true` branch (closes 5.X Dev 1) | queued                        |
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | queued                            |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | queued                            |
| 47  | Third preset `'default_no_toggle'` (closes 5.AA Dev 1)        | queued                            |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49 (NEW) | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants — plain=SELECT_REPLACE, Ctrl=SELECT_INVERT, Shift=SELECT_EXTEND_RANGE) | queued |
| 50 (NEW) | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap — sister to 5.X for groups, would let SS surface active-group highlighting) | queued |

## Lessons

1. **Fab streak HELD 4 slices in a row.** 5.W (2 HIGH semantic-overclaim,
   0 fab) → 5.X (1 HIGH semantic-overclaim, 0 fab) → 5.AA (2 HIGH
   semantic-overclaim, 0 fab) → 5.BB (1 HIGH dormant-invariant +
   0 fab fidelity). The pattern is now well-established: pre-verify
   per-cite discipline scales when cites are load-bearing, even at
   substrate volume.

2. **Semantic-deviation-not-flagged-as-deviation is the recurring
   HIGH pattern.** 4th time in a row. Lesson: when writing a
   module-header section that names a Blender default behavior,
   explicitly check whether SS matches that default or deviates from
   it. If deviates, FLAG IT in the same paragraph, not in a separate
   "Deviations" section. The 5.BB HIGH was different — a real
   dormant-invariant bug — but the broader pattern of "JSDoc overstates
   parity" still applies (4 fidelity MEDs all fit this shape).

3. **Dormant invariants are still invariants.** HIGH-1 was a real
   bug with currently-zero visible impact (no consumer reads
   `isFCurveGroupSelected`). It would have surfaced the moment
   group-header selection highlighting wired up — at which point
   diagnosing "why does this group stay highlighted" would have been
   a much harder debug than just fixing the sibling-clear cascade
   here. Lesson: invariant cascades are worth porting even when no
   visible consumer exists, because the invariant itself is the
   contract; future consumers will assume it holds.

4. **Sister-pattern detection at audit time.** The arch H-1 and
   fidelity MED-2 were the SAME finding from different angles. Both
   agents independently surfaced it. This is the dual-audit's
   strongest signal — when both audits converge on the same issue,
   it's almost certainly load-bearing.

5. **2 new queued paths from this slice's scope decisions.** #49
   (plain/Ctrl/Shift group-header clicks) closes Blender's
   SELECT_REPLACE / SELECT_INVERT / SELECT_EXTEND_RANGE branches on
   group headers. #50 (port AGRP_ACTIVE) would close MED-3's cascade
   gap and let SS surface active-group highlighting. Both are
   contained future slices, not multi-week scope.
