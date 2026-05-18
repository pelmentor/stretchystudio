# Animation Phase 5 — Slice 5.MM close-out

**Date**: 2026-05-18
**Commits**: `47be013` (substrate) → `33bef23` (audit-fix sweep) → (this doc)
**Path #58 from Phase 5 queue** — *Port Shift+group-click range-select* — SHIPPED.

## What the path was

> "58 | **Port Shift+group-click range-select** (closes 5.LL Dev 1 +
> 5.KK Dev 4) | **NEW TOP** for one-slice ships (substrate ready)"
> — from Slice 5.LL close-out (`SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_5_SLICE_LL.md`)

Gap-closure of the last deferred branch in `applyGroupHeaderSelect`.
Slice 5.KK shipped plain + Ctrl with Shift explicitly no-op; 5.LL
shipped the AGRP_ACTIVE substrate that range-select needs as its
`is_active_elem` bound; 5.MM stitches them together.

## Blender divergence verified

| Modifier             | Blender selectmode      | SS port (5.MM)                                |
|----------------------|-------------------------|-----------------------------------------------|
| Plain LMB            | `SELECT_REPLACE`        | `'replace'` — shipped 5.KK + 5.LL elevation   |
| Ctrl+LMB             | `SELECT_INVERT`         | `'toggle'` — shipped 5.KK + 5.LL elevation    |
| **Shift+LMB**        | `SELECT_EXTEND_RANGE`   | **`'range'` — shipped 5.MM**                  |
| Shift+Ctrl+LMB       | `-1` = children_only    | shipped 5.BB                                  |

Auto-downgrade: when no AGRP_ACTIVE group exists, SELECT_EXTEND_RANGE
→ SELECT_INVERT (Blender `:4517-4522`, type-agnostic). SS ports
exactly — `getActiveFCurveGroup` null → recurse with `'toggle'`.

Sources:
- `anim_channels_edit.cc:4159-4162` — SELECT_EXTEND_RANGE entry in
  `click_select_channel_group`
- `anim_channels_edit.cc:3984-4025` — `animchannel_select_range` walker
- `anim_channels_edit.cc:683` — `change_active = (sel !=
  ACHANNEL_SETFLAG_EXTEND_RANGE)` (false for range → AGRP_ACTIVE
  preserved through pre-walk wipe)
- `anim_channels_edit.cc:4194` — post-branch elevation gate
  (`selectmode != SELECT_EXTEND_RANGE` SKIPS `ANIM_set_active_channel`)
- `anim_channels_edit.cc:4517-4522` — type-agnostic auto-downgrade
- `blender_default.py:3849-3850` — keymap entry (`extend_range: True`)

## What shipped

| Capability | Where |
|------------|-------|
| `applyGroupHeaderSelect(action, gid, 'range', ctx)` — walker + auto-downgrade + perf-break | `src/anim/fcurveChannelSelect.js` ~line 1208 |
| `wouldGroupHeaderSelectChange(action, gid, 'range', ctx)` — preflight (compute-set-first pattern) | same ~line 1404 |
| Shift branch in FCurveEditor group-header span onClick — dispatches `'range'` (was no-op) | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 3680 |
| Tests: 44 new 5.MM scenarios + 1 5.KK guard test updated = 45 5.MM assertions (chain total 406, was 362 pre-5.MM) | `scripts/test/test_fcurveChannelSelect.mjs` |

## Substrate (`47be013`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveChannelSelect.js` | +import `getActiveFCurveGroup` from `fcurveGroupActive.js` +`'range'` branch +matching preflight branch +module-header updates +Deviation 4 marked closed | Helper + Blender provenance |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | Shift branch in onClick now dispatches `'range'` + dispatcher + span comments updated | UI wire-up |
| `scripts/test/test_fcurveChannelSelect.mjs` | +44 5.MM assertions + 1 5.KK guard update | Walker + auto-downgrade + preflight parity |

## Implementation pattern — compute-set-first

The 'range' branch uses a two-pass shape:
1. **Walk pass** — iterate `action.groups`, flipping `inRange` at each
   bound (active group + clicked group), accumulating an `inPath` Set.
   Perf-break when both bounds hit.
2. **Apply pass** — for each group, set `selected=true` if in path,
   sparse-delete otherwise. Report `changed=true` only on NET state
   flips.

Sister-pattern to Slice 5.BB's "skip-if-in-target-group" optimization.
Reason: a naive "pre-walk wipe then range-add" implementation flips
state transiently (pre-walk deletes `selected`, walker re-adds) and
reports `changed=true` for every wipe/re-set pair — preflight then
diverges from setter on idempotent inputs. The compute-set-first
shape keeps both paths identical.

Test feedback caught the naive version on idempotent-range scenarios
(scenario 1: already-correct path; scenario 4: already-correct
single-cell range). Refactor to compute-set-first restored parity.

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 2   | 0   | 2     |
| Blender fidelity | 0    | 0   | 1   | 1     |
| **Combined**     | **0** | **2** | **1** | **3** |

**Fab streak RESTORED at 1** (was broken at 5.LL with 2 HIGH; 5.MM
all-green on fidelity is the FIRST all-green fidelity audit since
pre-5.P fab break). Per fidelity agent: "Zero `mouse_anim_channels`
misattribution. Zero comment-only cites (5.LL `:347` regression NOT
repeated)."

All 20+ Blender cites verified against the reference clone. Verified
sites:
- `:4120-4221` `click_select_channel_group` span
- `:4159-4162` SELECT_EXTEND_RANGE branch
- `:4160` ANIM_anim_channels_select_set call
- `:4194` post-branch elevation gate
- `:3984-4025` `animchannel_select_range` walker span
- `:3992`, `:3996`, `:3997` walker per-step logic
- `:447-450` ANIM_is_active_channel GROUP case
- `:4517-4522` type-agnostic auto-downgrade
- `:678-819` anim_channels_select_set span
- `:714-722` ANIMTYPE_GROUP case
- `:683`, `:719`, `:723-734` per-line cites
- `:3849-3850`, `:3848-3854` keymap cites

## Audit-fix sweep (`33bef23`)

### Architecture findings

**MED-1 — JSDoc `@param modifier` types missing 'range'.** Both
setter (line 1167) and preflight (line 1424) annotations carried
`{'replace'|'toggle'}` from Slice 5.KK. TypeScript consumers + IDE
tooling would not see 'range' as a valid value. Fixed both to
`{'replace'|'toggle'|'range'}`.

**MED-2 — Stale "Active-elevation deferral" section + Deviation 1.**
The helper JSDoc still carried Slice 5.KK-era text claiming "There
is no parallel `group.active` slot today" + Deviation 1 saying
"AGRP_ACTIVE not ported". Contradicted Deviation 4 (updated this
slice) saying "Now that 5.LL ships the per-group ACTIVE bit".
Internal contradiction would confuse future auditors.

Fixed:
- Removed the "Active-elevation deferral" section (5.LL closed it).
- Updated post-branch elevation note under 'toggle' semantics to
  acknowledge 5.LL shipment.
- Rewrote Deviation 1 to mark it RESOLVED 2026-05-18 (Slice 5.LL)
  with pointer to `setActiveFCurveGroup` + explanation of 'range'
  branch's intentional skip per `:4194` gate.

### Fidelity findings

**LOW-1 — `:4517-4522` starts on a load-bearing comment.** Cite
starts at `:4517` which is the explanatory comment `/* Change
selection mode to single when no active element is found. */`; the
actual code block is `:4518-4522`. Per the 5.LL whitelist policy
("every `:N` reference should land on actual code or a load-bearing
comment that explicitly explains an invariant"), this is within
policy — `:4517` is exactly the kind of load-bearing comment the
whitelist preserves. **No fix needed.**

## SS deviations from Blender (1 documented for 5.MM)

1. **Walker scope** — SS walks `action.groups` array directly rather
   than passing through a `ctx.orderedGroupIds` parameter. The sidebar
   bucketization shows every group as a header regardless of expansion
   state (groups don't carry a "hide group entirely from sidebar" bit
   today). If a future slice adds group-level hide-from-sidebar, the
   walker scope will need narrowing. Sister to Slice 5.J's
   visible-scope handling for fcurves but with no current consumer
   for the narrower scope.

## Queued paths (post-5.MM)

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
| 59  | Wire `clearActiveFCurveGroups` into bulk select-all (closes 5.LL Dev 3) | **NEW TOP** for one-slice ships |
| 60  | Box-select group rows + AGRP_ACTIVE clear (closes 5.LL Dev 4) | queued (downstream of group-row hit-test substrate) |

## Lessons

1. **Fab streak RESTORED at 1 (5.MM).** First all-green fidelity
   audit since pre-5.P. The 5.LL break was a wake-up call — the
   audit briefing for 5.MM explicitly warned about the 5.LL
   `mouse_anim_channels` regression AND the `:347` comment-line
   trap, and both stayed clean. Lesson: explicitly NAMING the prior
   slice's fab pattern in the audit brief is high-value — agents
   internalize "don't repeat THAT" better than generic "verify all
   cites".

2. **The compute-set-first pattern recurs.** Slice 5.BB
   ("skip-if-in-target-group" optimization on children_only's
   pre-clear) → Slice 5.DD (Step 2 skip-previouslyActive) → Slice
   5.MM (compute inPath set first, apply net change second). Common
   shape: any helper that does "pre-walk wipe + main-walk re-set"
   has a setter/preflight divergence trap. The fix is always: shift
   to "compute target state, then mutate per-element to match in one
   pass". Lesson: when porting a Blender op that has a pre-walk
   wipe + main-walk set, default to compute-set-first; treat the
   naive two-walk shape as an anti-pattern unless the per-element
   work is asymmetric enough to require it.

3. **Stale JSDoc + stale deviations are a recurring polish gap.**
   Arch MED-1 (`@param` types) and MED-2 (Active-elevation deferral
   section + Deviation 1) are both "comments that didn't get
   updated when the substrate they reference shipped". Lesson: when
   a substrate slice closes a downstream deviation, the close-out
   doc should explicitly list which OTHER files' JSDoc / deviation
   sections need updating, and the next slice should sweep them as
   part of the wire-in.

4. **Substrate chain pays compound interest.** 5.LL was the AGRP_ACTIVE
   substrate (NEW TOP after 5.KK); 5.MM is the immediate consumer
   (NEW TOP after 5.LL). Each substrate slice creates 1-3 NEW TOP
   candidates in its close-out queue. Phase 5 queue has shrunk from
   ~12 dev tasks at 5.A entry to ~6 dev tasks at 5.MM entry, with
   most remaining items being downstream of un-shipped substrate
   (#14 F-Curve modifiers full phase) or low-priority polish.

5. **10-slice gap-closure streak (5.Z → 5.MM).** 5.Z/CC/FF/GG/HH/II/JJ
   shipped as single commits with no audit (sister-pattern); 5.KK +
   5.LL + 5.MM shipped with dual audit (substrate-shape). Convention
   re-validated: substrate slices get audit; sister-extensions of
   audited substrate ship as single commits.
