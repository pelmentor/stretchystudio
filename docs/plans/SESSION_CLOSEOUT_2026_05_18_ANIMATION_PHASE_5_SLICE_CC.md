# Animation Phase 5 — Slice 5.CC close-out

**Date**: 2026-05-18
**Commits**: `827dc33` (substrate + close-out in one) → (this doc)
**Path #40 from Phase 5 queue** — *`applyChannelSelect.change_active=true` branch* — SHIPPED.

## What the path was

> "5.X-1 | Channel-deselect doesn't auto-clear `active` | When
> `applyChannelSelect` gains `change_active=true` branch (Blender's
> `setflag_anim_channels:728-733`)"
> — from Slice 5.X close-out deviation list, queued as path #40 in
> Slice 5.W→X session-spanning close-out

## What shipped

Small targeted patch to `applyChannelSelect`'s 'toggle' branch in
`src/anim/fcurveChannelSelect.js`: when Ctrl+click transitions an
fcurve from selected to !selected, also sparse-delete its `active`
flag. Mirrors Blender's per-channel cascade at
`anim_channels_edit.cc:728-732` ("Only erase the ACTIVE flag when
deselecting"), gated by `change_active = (sel != EXTEND_RANGE)` at
`:683` — true for SELECT_INVERT.

| Capability | Where |
|------------|-------|
| 3-line `delete clicked.active` cascade on toggle-OFF | `src/anim/fcurveChannelSelect.js` ~line 405 |
| Module-header deviation note marked RESOLVED 2026-05-18 (Slice 5.CC) | same — sister to Slice 5.Z's "RESOLVED 2026-05-17" framing |
| 17 new test assertions covering 4 scenarios | `scripts/test/test_fcurveChannelSelect.mjs` ~line 963 |

## Why no substrate audit

Same rationale as Slice 5.Z: **gap closure, not substrate slice**.

- No new files / modules / concepts.
- No new schema fields.
- No new Blender API ports — the cite `anim_channels_edit.cc:728-732`
  was verified during Slice 5.X close-out and is unchanged.
- 3 lines of helper modification + 17 test assertions + a JSDoc
  deviation update.

The dual-audit-after-phase-ship convention exists to catch
architectural drift in NEW substrate. This patch connects a
pre-existing helper's gap to its pre-existing audited closure
condition — the contract was already established by Slice 5.X
(`fc.active` slot + EXCLUSIVE invariant) and Slice 5.F (helper
return shape).

## Other two `applyChannelSelect` modifiers — no fix needed

- **'replace'**: dispatcher's `setActiveFCurve(a, clickedId)` (Slice
  5.X) EXCLUSIVELY clears every sibling's active in one pass.
  Already-correct flow: pre-clear wipes everyone's `selected`,
  clicked.selected=true, dispatcher's setActiveFCurve sets clicked
  as active + clears every other. Helper-side cascade would be
  redundant (and would risk divergence if a future caller skipped
  the dispatcher's setActiveFCurve).

- **'range'**: uses ACHANNEL_SETFLAG_EXTEND_RANGE. Blender's
  `:683` defines `change_active = (sel != EXTEND_RANGE)` — false for
  this path. The pre-walk wipe in 'range' clears `selected` on every
  visible fcurve, but does NOT cascade-clear ACTIVE per Blender.
  SS matches.

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:fcurveChannelSelect | 274/274 (was 257; +17 5.CC assertions) |

## What this does NOT close

**5.X-4** is the sister deviation: "No active-restore pass after bulk
select-toggle / deselect-all". Closure requires porting Blender's
`graphkeys_deselectall_exec:459-470` which re-elevates the
first-remaining-selected as active after a deselect-all. That's a
separate slice (queued path #41).

This slice ALSO doesn't close the broader "channel-deselect cascade"
question for the helper-side 'replace' branch (see "no fix needed"
above) — that's a deliberate architectural choice tied to where the
EXCLUSIVE write lives. Documented.

## Queued paths (post-5.CC)

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
| ~~40~~ | ~~`applyChannelSelect.change_active=true` branch~~          | **SHIPPED THIS SLICE**            |
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | **NEW TOP for one-slice ships**   |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | queued                            |
| 47  | Third preset `'default_no_toggle'` (closes 5.AA Dev 1)        | queued                            |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |

## Lessons

1. **Gap-closure cadence is fast and high-leverage.** 5.Z (2026-05-17)
   closed 5.K MED-A1 in ~5 lines. 5.CC (today) closes 5.X-1 in
   ~3 lines. Both took less than an hour from "Go" to commit. The
   per-deviation queued list from prior audit/close-outs is
   essentially a backlog of "free wins" — small focused patches that
   close documented contracts.

2. **Per-helper cascade vs dispatcher cascade — pick by who owns the
   write.** 'toggle' OFF needed a helper-side cascade because the
   dispatcher doesn't call setActiveFCurve (decision.makeActive=false).
   'replace' did NOT need one because the dispatcher always calls
   setActiveFCurve. The general rule: if the dispatcher owns the
   active-side write, the helper should leave active alone; if the
   helper owns the selected-side write but the dispatcher doesn't
   re-elevate, the helper also owns the cascade.

3. **Test scenarios should cover the no-change paths too.** I added
   a "toggle-OFF non-active is no-op for active" test — proves the
   sparse-delete doesn't fire when it shouldn't. Same for the
   "toggle-ON helper doesn't elevate" test — proves the dispatcher
   contract holds. Negative-space tests catch regressions where a
   future refactor over-fires the cascade.
