# Animation Phase 5 — Slice 5.DD close-out

**Date**: 2026-05-18
**Commits**: `036e33c` (substrate) → `339b022` (audit-fix sweep) → (this doc)
**Path #41 from Phase 5 queue** — *Active-restore pass on bulk select-toggle* — SHIPPED.

## What the path was

> "5.X-4 | No active-restore pass after bulk select-toggle / deselect-all
> | Same as 5.X-1 + 5.X-2 plus port of `graphkeys_deselectall_exec:459-470`"
> — from Slice 5.X close-out deviation list

## What shipped

Ports two coupled Blender behaviors from the GRAPH-region (timeline)
select-all operator:

1. **`do_channels=true` cascade** — `deselect_graph_keys` at
   `reference/blender/source/blender/editors/space_graph/graph_select.cc:397-413`
   cascades the bulk keyform-selection operation into per-fcurve
   `FCURVE_SELECTED` AND unconditionally clears `FCURVE_ACTIVE` on
   every visible fcurve.

2. **Active-restore pass** — `graphkeys_deselectall_exec` at
   `:459-470` stashes the previously-active fcurve BEFORE the cascade
   and re-elevates it (`FCURVE_SELECTED | FCURVE_ACTIVE`) AFTER.
   Blender's `:433-436` comment explains the UX intent: "find active
   F-Curve, and preserve this for later or else it becomes annoying
   with the current active curve keeps fading out even while you're
   editing it".

| Capability | Where |
|------------|-------|
| `applyGraphSelectAllChannelCascade(action, mode, ctx)` pure mutator | `src/anim/graphSelectAllCascade.js` (~315 LOC post-fix) |
| `wouldGraphSelectAllChannelCascadeChange` preflight | same |
| `graphSelectAllOp(mode)` dispatcher (preflight-gated post-audit-fix) | `FCurveEditor.jsx` ~line 2200 |
| Graph-region keymap branch rewired: A/Alt+A/Ctrl+I now ALSO fire the channel cascade after the existing keyform-handle op | same ~line 2640 |
| 47 test assertions (42 substrate + 5 audit-fix edge cases) | `scripts/test/test_graphSelectAllCascade.mjs` |

## Substrate (`036e33c`)

| File | Status | Role |
|------|--------|------|
| `src/anim/graphSelectAllCascade.js` | NEW (~250 LOC substrate, ~315 post-fix) | Pure helper + preflight |
| `scripts/test/test_graphSelectAllCascade.mjs` | NEW (42 substrate, 47 post-fix) | Coverage: guards, modes, cascade-clear, restore in/out of scope, EXCLUSIVE stale-active cleanup, preflight integration |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | refactored | Import, dispatcher, keymap branch rewire, onKeyDown deps |
| `package.json` | +1 test entry + chain | `test:graphSelectAllCascade` |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 3   | 2   | 5     |
| Blender fidelity | 1    | 3   | 2   | 6     |
| **Combined**     | **1** | **6** | **4** | **11** |

**Fab streak HELD 5 slices in a row** post-5.Y break (5.W → 5.X →
5.AA → 5.BB → 5.DD). Zero fab cites.

The 1 HIGH was a real Blender-parity break (semantic divergence on
INVERT cascade), NOT a fab. The pattern shifts from "5.W/X/AA pattern
of semantic-deviation-not-flagged-as-deviation" to a real
semantic-port-bug caught by careful code reading of the Blender
reference.

## Audit-fix sweep (`339b022`)

All HIGH + all MED + 2 of 4 LOW addressed. 2 LOW deferred.

### Fidelity HIGH-1 (real Blender-parity break):

The 'invert' branch flipped `fc.selected` PER CHANNEL. Verified
against Blender's `:404-409`:

```cpp
if (sel == SELECT_SUBTRACT) fcu->flag &= ~FCURVE_SELECTED;
else                        fcu->flag |= FCURVE_SELECTED;
```

The else branch fires for BOTH SELECT_ADD AND SELECT_INVERT — channel-
level cascade treats INVERT identically to ADD (unconditional set).
SS port was wrong. **Fix**: 'invert' now sets `fc.selected = true`
unconditionally, matching Blender's normalization. Per-keyform invert
is at the BezTriple level (caller's `setSelectedHandles` invocation).
Pre-fix: Ctrl+I in graph region would leave half the channels
deselected; post-fix: all visible channels stay selected, only
per-keyform flips.

### Other fidelity findings

- **MED-1**: cite `:386` was attributed as "computed sel = SELECT_INVERT"
  — actually `sel` is the caller's arg from `:452`; `:386` builds the
  per-bezt callback. Rewrote.
- **MED-2**: cite `:3521-3554` was attributed to
  `ANIM_OT_channels_select_all` — that range is
  `animchannels_selectall_exec`; operator type defn is at `:3556-3575`.
  Corrected in both files.
- **MED-3**: `EXTEND_RANGE` shortened from full enum name
  `ACHANNEL_SETFLAG_EXTEND_RANGE`. Restored.
- **LOW-1**: documented `get_active_fcurve_channel` filter-set
  divergence (`graph_utils.cc:83-89` omits `ANIMFILTER_CURVE_VISIBLE`
  which `deselect_graph_keys` includes). SS's `orderedIds`-gated skip
  is stricter than Blender. Documented in Deviation 3.
- **LOW-2**: added "# Toggle resolution scope" section cross-referencing
  where `'toggle'` is resolved (FCurveEditor graph-region keymap branch).

### Architecture findings

- **MED-1**: dispatcher was unconditionally firing `update()` even on
  no-op. **Fix**: preflight-gated via `wouldGraphSelectAllChannelCascadeChange`.
  Reads live action via `useProjectStore.getState()` (matches
  `applyChannelBoxSelectOp` pattern). Skips phantom render.
- **MED-2**: two-update sequencing (`setSelectedHandles` then `update`)
  not documented. **Fix**: added comment block explaining `visible` is
  derived from project store `action`, not from `selectedHandles`, so
  the visible scope can't go stale between the two state updates within
  a single event handler.
- **MED-3**: preflight 'invert' was unconditionally `return true` —
  diverged from setter on dangling-id edge case. **Fix**: rewrote
  'invert' to follow same logic as 'add' (both set fc.selected=true
  per HIGH-1 fix), so preflight + setter agree.
- **MED-4**: test gaps (empty action, deleted previouslyActive). **Fix**:
  added 2 edge case scenarios. 47 total assertions.
- **LOW-1**: `restoredActive` JSDoc didn't explain the semantic
  asymmetry from `changed`. **Fix**: added `@returns` explanation:
  `restoredActive` = "restore path executed", not "transition occurred".
- **LOW-2 (deferred)**: `visible` dep narrowing — would require a
  `visibleIds = useMemo(...)` extraction shared across multiple
  dispatchers. Phase-5-wide pattern refactor, not slice-scoped.

## SS deviations from Blender (5 documented)

1. **Scope = `ctx.orderedIds`** — `decoded ∩ !isFCurveEffectivelyHidden`.
   Matches the same Slice 5.Y MED-1 scope convention.

2. **EXCLUSIVE re-elevation via `setActiveFCurve`** — Blender does
   direct bit-OR without clearing other actives; SS routes through
   the EXCLUSIVE setter to enforce Slice 5.X invariant. Functionally
   equivalent given Step 2 cleared all in-scope `fc.active` first;
   defensive against stale out-of-scope state.

3. **Stash scope match (with subtle filter-set divergence)** — SS's
   `orderedIds`-gated skip is stricter than Blender. A hide-toggled
   but `DATA_VISIBLE` active fcurve gets restored in Blender but
   skipped in SS. Trade-off: dropping the gate would re-set selected
   on a row the user explicitly hid (SS-UX regression). Documented.

4. **No `OPTYPE_UNDO` snapshot** — inherited Slice 5.F/5.K convention.

5. **Step 2 optimization** — skip clearing `previouslyActive.active`
   (Step 3 re-sets it anyway). Net state matches Blender's
   unconditional-clear + restore; only intermediate state differs
   (not observable across the immer draft's recipe boundary). Sister
   pattern to Slice 5.BB pre-clear in-group skip + Slice 5.Y
   pre-clear optimization.

## Queued paths (post-5.DD)

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
| ~~41~~ | ~~Active-restore pass on bulk select-toggle~~              | **SHIPPED THIS SLICE**            |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | **NEW TOP for one-slice ships** |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | queued                            |
| 47  | Third preset `'default_no_toggle'` (closes 5.AA Dev 1)        | queued                            |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51 (NEW) | `visibleIds` memo extraction across dispatchers (closes 5.DD LOW-2 arch) | queued |
| 52 (NEW) | Drop `orderedIds` gate on restore (matches Blender filter-set; SS-UX trade-off — see 5.DD Deviation 3) | queued |

## Lessons

1. **Fab streak HELD 5 slices in a row.** Pre-verify per-cite
   discipline scales when cites are load-bearing, even at substrate
   volume. 5.W → 5.X → 5.AA → 5.BB → 5.DD all held streak. The
   pattern is now well-established and habitual.

2. **HIGH findings pattern shifted from "deviation-not-flagged" to
   "real semantic-port-bug".** 5.W/X/AA HIGHs were all "documented
   deviation with wrong description of Blender's behavior". 5.BB HIGH
   was a dormant-invariant bug. 5.DD HIGH was a real semantic-port-bug
   where the code SS shipped wasn't what Blender does. The audit
   methodology caught it via careful per-line reading of the Blender
   reference, which is the same methodology that catches fabs. Lesson:
   per-line cite verification serves DUAL duty — fab detection AND
   semantic divergence detection.

3. **The `else` branch trap in Blender porting.** Blender's
   `do_channels` cascade for INVERT was a load-bearing else-branch:
   only SUBTRACT explicitly subtracts; everything else (ADD, INVERT,
   etc.) sets. The SS port assumed INVERT meant per-channel flip
   because the function NAME is `deselect_graph_keys` and the SS
   helper is `applyGraphSelectAllChannelCascade`. Lesson: when
   porting a switch-like dispatch with a default else, ALWAYS
   enumerate which inputs hit the default — don't assume INVERT does
   something invert-ish at every level (it might at the leaf, not at
   the channel).

4. **Preflight gating is cheap and correct.** Slice 5.DD shipped
   without the preflight gate; the audit immediately flagged it.
   Adding the gate took 5 lines and matches the sister pattern from
   `applyChannelBoxSelectOp`. Lesson: when a helper exposes a
   preflight, the dispatcher that calls the helper should ALWAYS gate
   on it — unless there's an explicit reason not to.

5. **Filter-set divergence is its own deviation category.** Blender's
   `get_active_fcurve_channel` vs `deselect_graph_keys` use different
   filters (`!CURVE_VISIBLE` in the former, `+CURVE_VISIBLE` in the
   latter). The Blender team accepted this asymmetry — SS doesn't
   need to match exactly, but the divergence should be documented.
   New queued path #52 captures the Blender-faithful alternative
   (drop the SS gate) with the explicit UX trade-off noted.
