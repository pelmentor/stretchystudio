# Animation Phase 5 — Slice 5.LL close-out

**Date**: 2026-05-18
**Commits**: `f2c75e0` (substrate) → `9fed54b` (audit-fix sweep) → (this doc)
**Path #50 from Phase 5 queue** — *Port AGRP_ACTIVE* — SHIPPED.

## What the path was

> "50 | **Port AGRP_ACTIVE** (closes 5.BB MED-3 + 5.KK Dev 1 + 5.KK
> Dev 4 → unblocks Shift+group-click range-select) | **NEW TOP**
> (substrate slice)"
> — from Slice 5.KK close-out (`SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_5_SLICE_KK.md`)

Substrate slice (sister-shape to Slice 5.X's `fcurveActive.js`). Adds
the per-group `AGRP_ACTIVE` bit, wires it into the two existing
group-selection helpers (5.BB children_only + 5.KK plain/Ctrl
header-click), and surfaces it in the sidebar via 3-tier backdrop tint.

## Blender divergence verified

| Aspect            | Blender                                        | SS port (5.LL)                                |
|-------------------|------------------------------------------------|-----------------------------------------------|
| Flag definition   | `AGRP_ACTIVE = (1 << 1)` (`DNA_action_types.h:350`) | `group.active === true` (sparse boolean)  |
| Set semantics     | `ANIM_set_active_channel` (`:237-339`), EXCLUSIVE per-type clear+set | `setActiveFCurveGroup(action, gid)` — same shape |
| Read semantics    | `ANIM_is_active_channel` (`:447-450`)          | `isFCurveGroupActive(group)` — strict `=== true` |
| Bulk-clear cascade | `anim_channels_select_set` ANIMTYPE_GROUP `:719` | `clearActiveFCurveGroups(action)` (helper exists; not yet wired into bulk select-all — Deviation 3) |
| Box-select clear  | `box_select_anim_channels` `:3625-3632`        | Deferred — Slice 5.Y operates on fcurves only (Deviation 4) |
| Post-click elevation | `click_select_channel_group` `:4194-4218`   | Wired into both 5.KK helpers (replace + toggle) and 5.BB helper (children_only) |
| Range-select walker | `animchannel_select_range` uses `ANIM_is_active_channel` at `:3997` for bound | Deferred to slice downstream of this one (Deviation 1) |

## What shipped

| Capability | Where |
|------------|-------|
| `isFCurveGroupActive(group) → boolean` | `src/anim/fcurveGroupActive.js` |
| `getActiveFCurveGroup(action) → group \| null` | same |
| `setActiveFCurveGroup(action, groupId)` — EXCLUSIVE, sparse-write | same |
| `clearActiveFCurveGroups(action)` — bulk clear | same |
| `wouldSetActiveFCurveGroupChange(action, groupId)` — preflight | same |
| Post-branch elevation in `applyGroupHeaderSelect` (5.KK) — both replace + toggle | `src/anim/fcurveChannelSelect.js` |
| Post-branch elevation in `applyGroupChildrenSelect` (5.BB) — children_only | same |
| 3-tier backdrop tint on group-header row (active=`bg-accent/60`, selected=`bg-accent/25`, default=`bg-muted/40`) | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 3620 |
| FCurveGroup typedef extended with `[active]` field | `src/anim/fcurveGroups.js` |
| Tests: 77 new helper assertions (sister-shape coverage) + 24 wire-in scenarios + 2 idempotency updates = 103 new 5.LL assertions | `scripts/test/test_fcurveGroupActive.mjs` + `test_fcurveChannelSelect.mjs` (chain total 439, was 338+0 pre-5.LL) |

## Substrate (`f2c75e0`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveGroupActive.js` | NEW (~270 LOC) | Pure helper + module-header Blender provenance + 4 documented deviations |
| `scripts/test/test_fcurveGroupActive.mjs` | NEW (~230 LOC, 77 assertions) | Sister-shape coverage mirroring `test_fcurveActive.mjs` |
| `src/anim/fcurveChannelSelect.js` | +import +Step 4 in `applyGroupHeaderSelect` 'replace' branch +elevation in 'toggle' branch +Step 5 in `applyGroupChildrenSelect` +preflight updates | Wire-in into both group-selection helpers |
| `scripts/test/test_fcurveChannelSelect.mjs` | +24 5.LL scenarios, 2 idempotency tests updated | Verifies elevation triggers correctly + preflight parity |
| `src/anim/fcurveGroups.js` | +`[active]` JSDoc field | Documents new sparse boolean on FCurveGroup |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | + `isFCurveGroupSelected` import + `isFCurveGroupActive` import + 3-tier backdrop tint computation + className restructure | Sidebar surfacing |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 1   | 0   | 1     |
| Blender fidelity | **2** | 0   | 1   | 3     |
| **Combined**     | **2** | **1** | **1** | **4** |

**Fab streak BROKEN at 6** (was: 5.AA / 5.BB / 5.DD / 5.EE / 5.KK held;
broken at 5.LL HIGH-1).

Architecture HIGH = 0 (clean substrate shape, EXCLUSIVE invariant
holds, preflight parity verified). The MED finding was a CSS class-merge
edge case (group muted + active overlap).

Fidelity HIGH = 2:
- HIGH-1: `DNA_action_types.h:347` claim wrong (real line `:350`, off
  by 3 — `:347` is a comment line). **FAB cite.**
- HIGH-2: 5.KK MED-1 regression. Despite explicit audit-prompt warning
  about `mouse_anim_channels` vs `click_select_channel_group` lineage,
  3 new sites in 5.LL repeated the same attribution error. Line ranges
  correct, function name wrong.

## Audit-fix sweep (`9fed54b`)

All findings addressed.

### Fidelity findings

**HIGH-1 — AGRP_ACTIVE bit cite off by 3 lines.** Fixed `:347` →
`:350` with explicit enum-block context (`:346-370`) so future readers
land at the actual declaration rather than a comment line. Audit-fix
note inline.

**HIGH-2 — `mouse_anim_channels` mis-attribution (5.KK MED-1 regression).**
Fixed in all 3 new-this-slice sites:
- `fcurveGroupActive.js` auto-elevation JSDoc
- `fcurveChannelSelect.js` Step 4 elevation in `applyGroupHeaderSelect`
  'replace'
- `fcurveChannelSelect.js` Step 5 elevation in
  `applyGroupChildrenSelect` (touched-in-5.LL site)

Each fix names `click_select_channel_group` with its `:4120-4221` range
and explains the dispatch chain (`mouse_anim_channels` `:4475` is the
per-type dispatcher; the cited branches live in the per-type handler).

**LOW-1 — `:343-348` off-by-1.** ANIMTYPE_GROUP case starts at
`:344`; `:343` is the outer `switch (channel_type)` line. Fixed in
both JSDoc sites to `:344-348`.

### Architecture findings

**MED-1 — Group-header className text-class conflict.** Pre-fix
emitted both `text-foreground` (from `groupTint` ternary) and
`text-muted-foreground/70` (from muted ternary) when a group was
simultaneously muted + active. With raw string concat (no `cn()` /
`tailwind-merge`), CSS generation order determined the winner —
unpredictable.

Fixed by splitting `groupTint` into INDEPENDENT `groupBackdrop` +
`groupTextColor` so the className emits exactly one `text-*` class.
Precedence: muted > active/selected > default (an evaluated-off group
should read as dim regardless of selection state — matches Blender's
italic-strikethrough convention for muted channels).

## SS deviations from Blender (4 documented)

1. **No range-select walker.** Closure: Shift+group-click slice
   downstream of this substrate (path #58 in the queue). The walker
   will call `getActiveFCurveGroup(action)` as the `is_active_elem`
   bound, the clicked group as the `is_cursor_elem` bound, then walk
   `action.groups` in display order between them.

2. **ACTIVE writes use `skipHistory: true`** at the dispatcher
   (inherited from Slice 5.X / 5.F's view-state UX choice). Closure
   when the 50-entry undo budget stops being the binding UX constraint.

3. **Bulk select-all (Slice 5.K) does NOT clear group actives.**
   Currently `applyChannelSelectAll` operates only on `action.fcurves`.
   Blender's `anim_channels_select_set` cascade at `:719` clears
   AGRP_ACTIVE on every visible group when `change_active=true`.
   Closure: when bulk select-all is extended to include groups in
   its scope. Not strictly required today (no consumer reads stale
   group-active state across a bulk select-all).

4. **Box-select (Slice 5.Y) does NOT touch group rows.** Sidebar
   rows are fcurve-keyed today. Closure: when box-select hit-tests
   group rows.

## Queued paths (post-5.LL)

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
| 58  | **Port Shift+group-click range-select** (closes 5.LL Dev 1 + 5.KK Dev 4) | **NEW TOP** for one-slice ships (substrate ready) |
| 59 (NEW from 5.LL) | Wire `clearActiveFCurveGroups` into bulk select-all (closes 5.LL Dev 3) | queued |
| 60 (NEW from 5.LL) | Box-select group rows + AGRP_ACTIVE clear (closes 5.LL Dev 4) | queued (downstream of group-row hit-test substrate) |

## Lessons

1. **Fab streak BROKEN at 6.** HIGH-1 was a genuine line-number fab
   (`:347` cited for `AGRP_ACTIVE = (1 << 1)`; real line `:350`). The
   "verify every cite" discipline scaled through 5 substrate slices
   then slipped at the headline cite of slice #6. Lesson: cite the
   ENUM BLOCK range, not a single line — enum members shift by 1-2
   lines whenever Blender adds a comment, and single-line cites are
   inherently fragile.

2. **Same-mistake regression is worse than first-time fab.** HIGH-2
   was the EXACT same `mouse_anim_channels` vs `click_select_channel_group`
   attribution that 5.KK audit flagged as MED-1. Despite the audit
   brief warning the parallel agent to check for this regression, the
   substrate JSDoc repeated it 3 times. Lesson: when a finding closes
   on lineage (function names, file structure), add a comment NEXT TO
   the right cite that explicitly NAMES the previously-wrong version
   so future sister slices see the warning at write time.

3. **Sister-shape ports are productive but compound mistakes.** Slice
   5.LL was a clean sister-shape port of 5.X — 77 test assertions in
   one pass, all green. Substrate ROI compounds (5.LL closes 5.BB
   MED-3 + 5.KK Devs 1 & 4 in one slice, unblocks #58 + #59 + #60).
   But the sister-shape pattern also COPIES the comment shape including
   any cite errors from the lineage. Lesson: when copying a sister
   helper's structure, audit the cites independently — don't trust the
   sister's cites as ground truth.

4. **Class-merge brittleness is a recurring SS issue.** Arch MED-1
   was a Tailwind class-merge ambiguity. SS doesn't use `cn()` /
   `tailwind-merge` at this callsite (or most others). The fix was to
   split `groupTint` into independent `groupBackdrop` +
   `groupTextColor` so the className emits exactly one class per CSS
   property. Lesson: when adding a new tint dimension to an existing
   className construction, audit the OTHER classes for property
   conflicts and split into independent variables when needed.

5. **9-slice gap-closure streak (5.Z → 5.LL).** Substrate slices keep
   compounding. 5.LL itself was a substrate slice (not a gap-closure)
   that immediately unblocked 3 future paths (#58 + #59 + #60). The
   pattern: ship the missing primitive + wire it into existing
   consumers + document follow-ups. Each substrate slice
   simultaneously closes prior deviations AND enables new ones.
