# Animation Phase 5 — Slice 5.Z close-out

**Date**: 2026-05-17
**Commits**: `78c18f9` (gap closure + close-out in one)
**Path #45 from Phase 5 queue (post-5.Y)** — *Wire `clearActive` through bulk select-all* — SHIPPED.

## What the path was

> "`applyChannelSelectAllOp` wire `clearActive` through
> `setActiveFCurve`/`clearActiveFCurves` (closes Slice 5.K MED-A1,
> opened by 5.X)"
> — from Slice 5.Y close-out queued paths

Slice 5.K MED-A1 was a documented deviation: the helper returned
`clearActive: boolean` matching Blender's per-channel "Only erase the
ACTIVE flag when deselecting" rule (`anim_channels_edit.cc:728-732`),
but the FCurveEditor dispatcher did NOT forward it because
`activeFCurveId` was derived from the param/node selection store —
clearing it would have had cross-editor side effects (deselect the
active param in the param editor, drop the keyform editor's active-row
context).

Slice 5.X shipped persisted `fc.active` (sparse, EXCLUSIVE) via
`src/anim/fcurveActive.js`, splitting the ACTIVE concept from the
global selection store. That unblocked this wire-through.

## What shipped

| Capability | Where |
|------------|-------|
| `applyChannelSelectAllOp` calls `clearActiveFCurves(a)` when `decision.clearActive === true` | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 2073 |
| Sidebar `bg-accent/60` highlight drops in lockstep with bulk select-all clearing the active channel's selection | (emergent — no UI change, just wired state) |
| Module-header deviation rewritten from "NOT forwarded today" to "RESOLVED 2026-05-17 (Slice 5.Z)" | `src/anim/fcurveChannelSelect.js` ~line 232 |
| 8 new integration assertions covering 'clear' / 'add' / 'invert' modes against the dispatcher's wire-through contract | `scripts/test/test_fcurveChannelSelect.mjs` tail |

## Why no substrate audit

This is a **gap closure**, not a substrate slice:

- No new files / modules / concepts.
- No new schema fields.
- No new Blender API ports.
- 5 lines of dispatcher wiring + 8 test assertions + a JSDoc rewrite.

The dual-audit-after-phase-ship convention exists to catch
architectural drift in NEW substrate. A wire-through that connects two
pre-existing audited helpers does not warrant a separate audit pass —
the contract was already established by Slice 5.K (helper) and Slice
5.X (`clearActiveFCurves`); this slice just connects them per their
documented contracts.

Pre-verify discipline still applied to the one new comment cite
(`anim_channels_edit.cc:728-732`) — that line range was verified
during Slice 5.X close-out and is unchanged.

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:fcurveChannelSelect | 212/212 (was 204; +8 5.Z assertions) |
| test:fcurveActive | 75/75 |
| test:fcurveBoxSelect | 71/71 |

## Queued paths (post-5.Z)

Carrying forward from Slice 5.Y close-out, minus the now-closed #45:

| Path | Title | Status |
|------|-------|--------|
| 13  | Phase 2 owed-manual verification                              | USER-SIDE (visual inspection in Cubism Viewer + UI K-hotkey) |
| 14  | Phase 3 — F-Curve modifiers (full phase, ~weeks)              | queued                            |
| 15  | SS keymap-preset selector                                     | NEW TOP for one-slice ships       |
| 16-27 | (other Phase 5 polish + carry-overs)                        | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| 35  | Group-children select operator (Shift+Ctrl+click)             | queued                            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 40  | `applyChannelSelect.change_active=true` branch (closes 5.X Dev 1) | queued                        |
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | queued                            |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| ~~45~~ | ~~Wire `clearActive` through (closes 5.K MED-A1)~~          | **SHIPPED THIS SLICE**            |

## Lessons

1. **Slice 5.X's substrate unblocked a closed-as-deferred deviation
   immediately.** Slice 5.K MED-A1 was marked as "deferred to the day
   SS grows a per-fcurve ACTIVE slot". Slice 5.X shipped that slot
   2026-05-17 morning. Slice 5.Z closed the deviation 2026-05-17
   evening. Pattern: every substrate ship has a "now-closable" gap
   list that should be visited within the same session to compound the
   value.

2. **Gap-closure slices are small but high-leverage.** ~5 lines of
   dispatcher wiring + 8 test assertions resolved a documented UX
   divergence from Blender that had been on the deviation list since
   Slice 5.K. The cost-to-value ratio is excellent — these are the
   "free wins" after a substrate ship.

3. **Skipping dual-audit on non-substrate slices is OK when the
   contract is pre-audited.** Slice 5.K (helper) and Slice 5.X
   (`clearActiveFCurves`) were both dual-audited. Connecting them per
   their documented contracts doesn't open a new attack surface for
   architectural drift or fab cites. Save audit-spawn budget for new
   substrate.
