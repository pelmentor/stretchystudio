# Phase 6 — Manual Verification Checklist

**Owner:** user (single end-to-end sweep)
**Scope:** Phase 6 Slices 6.A → 6.F.2 (Dopesheet write-mode). 6.G (this
checklist + cross-slice review + test-chain wiring) is the Phase 6 exit
gate; this doc is its user-facing half. All seven substrate slices have
automated tests (544 + 84 supporting asserts across 8 scripts + 3
extended suites — see §0); the items below are end-user-visible
behaviors that automated tests can't cover.

**Purpose:** Consolidate the manual-verification items deferred during
each 6.A → 6.F.2 ship (`feedback_no_background` — no autonomous
dev-server start) into a single sweep the user can execute end-to-end.

**Estimated time:** 30–40 minutes (1 dev-server start, 1 test action
with mixed-type fcurves, no PSD re-import — Shelby's existing project
state suffices for every item per `feedback_test_character_is_shelby`).

---

## §0 — Tests already passing (automated; informational)

Run before starting manual sweep to confirm clean baseline:

```
npm run test:dopesheetSelectOps     # 6.A — 60 asserts
npm run test:dopesheetBoxSelect     # 6.B — 61 asserts
npm run test:dopesheetGrab          # 6.C — 70 asserts
npm run test:dopesheetDelDup        # 6.D — 83 asserts
npm run test:dopesheetClipboard     # 6.E — 107 asserts
npm run test:dopesheetChannelMute   # 6.F.1 — 56 asserts
npm run test:dopesheetChannelSolo   # 6.F.2 — 48 asserts
npm run test:fcurveSolo             # 6.F.2 — 59 asserts
npm run test:dopesheetRows          # cross-slice extended — 75 asserts
npm run test:fcurveGroups           # cross-slice extended — 89 asserts
npm run test:keyformSelectionStore  # cross-slice extended — 25 asserts
```

All wired into master `npm test` chain as of 6.G.

---

## Setup

```
npm run dev
```

Open in browser. Load Shelby project (the test character per
`feedback_test_character_is_shelby`). If no project loaded, import
Shelby PSD via the wizard once — subsequent items reuse the same
project state.

Open the **Animation** workspace, switch the bottom editor area to
**Dopesheet**, and assign an Action to `__scene__` with at least 3
fcurves of mixed types (e.g. `ParamAngleX`, `ParamAngleY`,
`ParamBodyAngleX`) — at least 4 keyforms per fcurve at varied times.
Any non-trivial action works.

---

## §1 — Slice 6.A: Tick selection + state lift

### §1.1 — Plain LMB → replace

- [ ] Click a tick in the dopesheet. Verify ONLY that tick highlights
  (all other selections clear).
- [ ] Click a different tick. Verify the previous selection clears and
  only the new tick highlights.

### §1.2 — Shift+LMB → extend (toggle)

- [ ] Click tick A. Shift+click tick B. Verify BOTH highlight.
- [ ] Shift+click tick A again. Verify tick A deselects (toggle), tick
  B stays selected.

### §1.3 — Ctrl/Cmd+LMB → deselect (SS DEVIATION 1)

- [ ] Click tick A. Click tick B (replace, only B selected).
- [ ] Shift+click tick A. Verify A and B both selected.
- [ ] Ctrl+click (Cmd+click on Mac) tick A. Verify A deselects, B
  stays. **SS-only behavior** — Blender uses Ctrl+LMB for box-select
  arming; SS rebound to deselect for editor consistency.

### §1.4 — Double-click → seek to tick time

- [ ] Position playhead at frame 0.
- [ ] Double-click a tick at a non-zero time. Verify the timeline
  playhead jumps to that tick's time.

### §1.5 — Cross-editor selection mirror

- [ ] Open the **FCurve Editor** in a second area (top of stack).
- [ ] In the **Dopesheet**, click a tick. Verify the corresponding
  keyform is also highlighted in the **FCurve Editor** (active-keyform
  panel updates).
- [ ] In the **FCurve Editor**, click a different keyform. Verify the
  **Dopesheet** updates its highlighted tick.

---

## §2 — Slice 6.B: Box-select (B + LMB-drag)

### §2.1 — Plain LMB-drag → replace box-select

- [ ] Click empty area in the dopesheet track region, drag a marquee
  rectangle over multiple ticks across 2+ fcurves.
- [ ] On release, verify all enclosed ticks highlight AND any
  previously-selected ticks outside the box deselect.
- [ ] Marquee should render in **blue**.

### §2.2 — Shift+LMB-drag → extend box-select

- [ ] Select tick A by clicking. Hold Shift, drag a marquee over a
  different region with ticks B and C.
- [ ] Verify A + B + C all highlight (additive).
- [ ] Marquee should render in **blue**.

### §2.3 — Ctrl+LMB-drag → subtract box-select

- [ ] Select 5+ ticks via plain box-select.
- [ ] Hold Ctrl, drag a marquee over 2 of the selected ticks.
- [ ] Verify those 2 ticks deselect; the other 3 stay highlighted.
- [ ] Marquee should render in **red**.

### §2.4 — B-key arming

- [ ] Press B. Click+drag from a tick (normally tick-drag-grab would
  win). Verify the marquee starts at the tick instead of grab — B-key
  overrides the drag-on-tick guard for that next pointerdown.

### §2.5 — 4px threshold

- [ ] Click and release without dragging (or drag <4px) on empty
  track area. Verify NO marquee renders and selection is unaffected.

### §2.6 — Axis-range mode (SS DEVIATION 3) — NOT YET SHIPPED

Alt+B (Blender's FRAMERANGE/CHANNELS-only box) is intentionally
deferred to a future 6.B.1 polish slice. No verification.

---

## §3 — Slice 6.C: Modal grab (G key time-translate)

### §3.1 — G key entry

- [ ] Select 3+ ticks via box-select (mix from 2 fcurves).
- [ ] Press G. Verify status pill appears reading
  `Grab: +0ms · LMB/Enter commit · RMB/Esc cancel` (or similar).
- [ ] With NO selection, press G. Verify nothing happens (status pill
  does NOT appear).

### §3.2 — Mousemove preview

- [ ] Enter grab modal (G with selection).
- [ ] Move mouse right. Verify status pill `+Nms` increments AND
  translucent **ghost diamonds** render at the new times for every
  selected tick. The original ticks stay in place.
- [ ] Move mouse left. Verify the ghost diamonds shift earlier in time
  (negative delta).

### §3.3 — Commit (LMB or Enter)

- [ ] Enter grab, drag right by some amount, press Enter. Verify the
  ticks move to the previewed positions AND the ghost diamonds
  disappear AND status pill clears.
- [ ] Repeat using LMB to commit. Same behavior.
- [ ] Verify the playhead-evaluated values reflect the new times
  (scrub past the moved tick).

### §3.4 — Cancel (RMB or Escape)

- [ ] Enter grab, drag, press Escape. Verify ticks REVERT to original
  positions, ghost diamonds disappear, status pill clears.
- [ ] Same with RMB.

### §3.5 — Tick-click + box-select suppression during grab

- [ ] Enter grab. Try to click another tick. Verify the click does
  NOT alter selection (suppressed via `grabActiveRef`).
- [ ] Try to drag a marquee. Verify no marquee starts.

### §3.6 — Merge-on-collision

- [ ] Add two keys to the same fcurve at times T1 and T2 (say 100 and
  500 ms), with different values.
- [ ] Select only the tick at T1. Enter grab, drag to T2 (or just
  past — within 0.5ms epsilon). Commit.
- [ ] Verify only ONE tick remains at T2 AND its value is the AVERAGE
  of the two (per Blender `BKE_fcurve_merge_duplicate_keys`; SS
  DEVIATION 6 — epsilon is 0.5ms vs Blender's `0.01f` frames).

### §3.7 — Snap-to-frame (SS DEVIATION 5) — NOT YET SHIPPED

Frame-snap is deferred to 6.C.1 polish slice. No verification.

---

## §4 — Slice 6.D: Delete + Duplicate-move (Del / Backspace / Shift+D)

### §4.1 — Delete selected (Del)

- [ ] Select 2 ticks. Press Delete. Verify both disappear AND the
  fcurves still exist (with the remaining keyforms — SS DEVIATION 7:
  empty-fcurve auto-removal NOT shipped).
- [ ] With NO selection, press Delete. Verify nothing happens (no
  toast, no error).

### §4.2 — Backspace alias (SS DEVIATION 9)

- [ ] Select 1 tick. Press Backspace. Verify it deletes (Mac laptop
  alias — Blender binds only Delete; SS aliases Backspace too).

### §4.3 — No confirm dialog (SS DEVIATION 8)

- [ ] Press Delete with selection. Verify NO confirmation dialog
  appears — matches Blender's dopesheet keymap `confirm=False`.

### §4.4 — Shift+D duplicate + auto-grab

- [ ] Select 2 ticks. Press Shift+D. Verify:
  - 2 duplicate ticks appear AT the same times as originals (not
    visually distinguishable yet — confirm by tick count).
  - Selection AUTO-TRANSFERS to the duplicates (originals deselect).
  - Grab modal IMMEDIATELY enters (status pill appears).
- [ ] Move mouse, commit (Enter or LMB). Verify the duplicates moved
  to the new position AND the originals stayed at their original
  positions.

### §4.5 — Duplicate cancel reverts both

- [ ] Select 2 ticks. Shift+D. In grab modal, press Escape.
- [ ] Verify the duplicates DISAPPEAR (cancel rolls back both the
  duplicate AND the auto-entered grab).

### §4.6 — Selection profile inheritance (SS DEVIATION 10)

- [ ] Select a tick via box-select (which sets all 3 selection bits:
  left handle / center / right handle). Shift+D. Verify the duplicate
  is also fully-selected.
- [ ] (Partial-bit selections are a Blender-divergent corner case;
  no manual check needed.)

---

## §5 — Slice 6.E: Copy/Paste (Ctrl+C / Ctrl+V)

### §5.1 — Ctrl+C copies center-selected ticks

- [ ] Select 2 ticks on 2 different fcurves. Press Ctrl+C.
- [ ] Verify no visible UI change (clipboard is module-internal). No
  console errors.

### §5.2 — Ctrl+V pastes at playhead

- [ ] After §5.1, move the playhead to a new time (e.g. 2000ms).
  Press Ctrl+V.
- [ ] Verify 2 new ticks appear at times offset by
  `playhead - originTime` (CFRA_START offset per Blender default).
- [ ] Verify the NEW ticks are selected (originals deselect — SS
  DEVIATION 15: global-replace selection-after-paste).

### §5.3 — MIX merge (same-time replace)

- [ ] Position playhead so the paste lands on an existing tick's time.
  Ctrl+V.
- [ ] Verify the existing tick's value is REPLACED by the pasted
  tick's value (no duplicate at same time).

### §5.4 — Cross-action paste by fcurve id (SS DEVIATION 12)

- [ ] Create a SECOND action with the SAME fcurve ids (same paramIds).
- [ ] In Action A, Ctrl+C on a tick. Switch active Action to B.
- [ ] Ctrl+V. Verify the tick lands on the matching fcurve in Action B
  (matched by exact id, not RNA path).

### §5.5 — Browser text-copy still works (MED-A3 audit-fix)

- [ ] Clear dopesheet selection. Select some text in the FCurve
  editor's value spinner (Range selection). Press Ctrl+C.
- [ ] Verify the OS clipboard receives the text — SS bails out of its
  Ctrl+C handler when `window.getSelection().type === 'Range'`.
- [ ] Paste into another app to confirm (or use browser DevTools
  console: `await navigator.clipboard.readText()`).

### §5.6 — Empty clipboard / no match

- [ ] After app start (no copy yet), press Ctrl+V. Verify nothing
  happens (no error, no insert).
- [ ] Ctrl+C on a fcurve that doesn't exist in destination Action.
  Switch to that Action. Ctrl+V. Verify nothing pastes (no error).

### §5.7 — Shift+Ctrl+V flipped (SS DEVIATION 14) — NOT SHIPPED

SS dopesheet keyforms have no `pose.bones["..."]` RNA paths; flip-
mirror semantic doesn't apply. No verification.

### §5.8 — Other offset/merge modes (SS DEVIATION 13) — NOT SHIPPED

Blender exposes 4 offset modes + 4 merge modes via F6 redo panel; SS
has no redo panel, ships only CFRA_START + MIX defaults. No verification.

---

## §6 — Slice 6.F.1: Mute hovered/selected channel (M key)

### §6.1 — M with hover → toggle hovered

- [ ] Hover the mouse over a fcurve row (the channel sidebar area
  where the row name appears).
- [ ] Press M. Verify that row's mute icon toggles AND the row visually
  GREYS OUT.
- [ ] Press M again with the same row hovered. Verify it un-mutes AND
  the grey-out clears.

### §6.2 — Eval drops muted contribution

- [ ] Set up a fcurve that visibly affects the canvas character
  (e.g. `ParamBodyAngleX`).
- [ ] With non-zero values, observe the canvas character.
- [ ] Hover the fcurve row, press M. Verify the canvas character REVERTS
  to neutral for that parameter (muted fcurve evaluates as if absent).
- [ ] M again to unmute → canvas reflects the fcurve again.

### §6.3 — M without hover → toggle on selected (scan-first, SS DEVIATION 17)

- [ ] Select 3 fcurves (click row names in sidebar with Shift to
  multi-select).
- [ ] Move cursor OFF any fcurve row (e.g. into the toolbar area).
- [ ] Press M. Verify per Blender `setflag_anim_channels` scan-first
  toggle resolution: if ALL 3 were unmuted, all 3 become muted; if ANY
  were already muted, all 3 become unmuted (the "TOGGLE" mode at
  `anim_channels_edit.cc:2968-2980`).

### §6.4 — Hover priority over selection

- [ ] Select 3 fcurves (as in §6.3).
- [ ] Hover over the row of an UNSELECTED fcurve.
- [ ] Press M. Verify ONLY the hovered fcurve toggles (the 3 selected
  stay unchanged) — DEV 17 hover-priority.

### §6.5 — Greyed rows in dopesheet

- [ ] Mute a fcurve via §6.1. Verify the tick ROW in the dopesheet
  also greys out (per Slice 5.W M4 inline cascade in
  `dopesheetRows.js`).

---

## §7 — Slice 6.F.2: Per-FCurve solo (Ctrl+Alt+M)

### §7.1 — Ctrl+Alt+M with hover → toggle solo on hovered

- [ ] Hover a fcurve row. Press Ctrl+Alt+M.
- [ ] Verify that row becomes "soloed" — visually indicated by some
  marker (currently: NON-soloed rows grey out when ANY row is soloed,
  per DAW convention; the soloed row stays full-opacity).
- [ ] Press Ctrl+Alt+M again on the same hovered row. Verify it
  un-solos AND all rows return to normal (no rows soloed → no rows
  greyed).

### §7.2 — Solo overrides mute (DAW semantic)

- [ ] Mute a fcurve via §6.1.
- [ ] With the same fcurve hovered, press Ctrl+Alt+M. Verify the
  fcurve becomes audible/visible AGAIN — solo overrides per-curve mute
  (any-soloed-plays semantic).
- [ ] Un-solo (Ctrl+Alt+M). Verify the mute returns to effect.

### §7.3 — Multi-solo: stacking solo on multiple curves

- [ ] Hover fcurve A, Ctrl+Alt+M (solo A). Verify B + C grey out, A
  stays full-opacity.
- [ ] Hover fcurve B, Ctrl+Alt+M (solo B). Verify A AND B both
  full-opacity (both audible), only C grey.
- [ ] Hover fcurve A, Ctrl+Alt+M (un-solo A). Verify only B audible
  (A + C greyed).

### §7.4 — Ctrl+Alt+M without hover → toggle on selected (scan-first)

- [ ] Select 2 fcurves via sidebar click. Move cursor off rows. Press
  Ctrl+Alt+M.
- [ ] Verify scan-first toggle resolution (same as §6.3 for mute):
  if NEITHER was soloed, both become soloed; if EITHER was soloed,
  both become un-soloed.

### §7.5 — Eval cascade matches UI

- [ ] Configure a scene where 3 fcurves visibly affect the canvas.
- [ ] Solo fcurve A. Verify the canvas reflects ONLY A's contribution
  (B and C silenced even if unmuted).
- [ ] Solo also B (multi-solo). Verify canvas reflects A + B (C still
  silent).
- [ ] Un-solo all. Verify all 3 contribute again.

### §7.6 — Hover priority over selection (sister to §6.4)

- [ ] Select 3 fcurves. Hover an unselected one. Ctrl+Alt+M. Verify
  only the hovered toggles.

---

## §8 — Gate semantics (cross-slice)

The window-level keymap effects in DopesheetEditor.jsx all share the
same gate pattern: input-skip + grab/box-drag ref suppression + action
store-read at fire time. Verify the gate holds for ALL of Ctrl+C /
Ctrl+V / G / Del / Shift+D / M / Ctrl+Alt+M:

### §8.1 — Input/textarea skip

- [ ] Focus an `<input>` (e.g. action name field, or a param spinner).
- [ ] Try each of the above hotkeys. Verify NONE of them fire the
  dopesheet behavior (the input/spinner gets the keystroke instead).

### §8.2 — During grab modal

- [ ] Enter grab modal (G key with selection). Try each of: Del,
  Shift+D, M, Ctrl+C, Ctrl+V, Ctrl+Alt+M.
- [ ] Verify NONE fire (suppressed via `grabActiveRef`).
- [ ] Escape to cancel grab.

### §8.3 — During box-drag

- [ ] Start a box-drag (click empty track area + drag, don't release).
  Try each of the hotkeys above.
- [ ] Verify NONE fire (suppressed via `boxDragActiveRef`).

---

## §9 — Sign-off

- [ ] All §1 — §8 items pass on **Shelby** (Western fixture).
- [ ] (Optional, per `feedback_test_character_is_shelby` dual-PSD
  convention) repeat §1 — §8 on **test_image4** (anime fixture).

When all items pass, file a note in the next session message saying
"Phase 6 manual checklist green" — at that point 6.G is fully
complete and Phase 6 ships SHIP-COMPLETE.

If any item fails: write down the failing item number, repro steps,
and any console output, then report. Failed items are post-6.G polish
slices (6.A.1, 6.B.1, etc.), not 6.G blockers.
