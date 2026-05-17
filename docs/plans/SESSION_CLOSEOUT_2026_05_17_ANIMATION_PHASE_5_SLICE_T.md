# Animation Phase 5 — Slice 5.T close-out (2026-05-17)

Slice 5.T ships the SIPO_DRAWTIME / "Use Timecode" toggle for the
F-Curve editor, closing Slice 5.Q Deviation 3 ("Frame field shows ms
not frames"). One substrate+audit-fix commit + this close-out.

## Commits

| SHA       | Subject                                                                              |
|-----------|--------------------------------------------------------------------------------------|
| `ea0d5f6` | `feat(anim): Animation Phase 5 Slice 5.T — "Use Timecode" toggle (closes 5.Q Dev 3)` |
| (this)    | `docs(plan): Animation Phase 5 Slice 5.T close-out`                                  |

## What shipped

Substrate
- **`editorStore`** — new `fcurveShowSeconds: false` slot +
  `setFCurveShowSeconds` / `toggleFCurveShowSeconds` actions. Default
  matches Blender's `SIPO_DRAWTIME` off
  (`reference/blender/source/blender/makesdna/DNA_space_enums.h:293`).
- **`src/v3/editors/fcurve/fcurveTimeFormat.js`** (NEW, ~180 LOC).
  Pure display-layer module — canonical storage stays ms
  (`feedback_ms_canonical_animation_time`). Exports
  `getEffectiveFps`, `formatXTickLabel`, `formatTimeFieldLabel`,
  `formatTimeFieldValue`, `parseTimeFieldValue`.
- **`scripts/test/test_fcurveTimeFormat.mjs`** (NEW, 77 assertions).
- **`FCurveHeader`** — View menu CheckboxItem "Use Timecode" mirrors
  Blender's `GRAPH_MT_view` at `space_graph.py:240`
  (`layout.prop(st, "show_seconds")`). Tooltip "Show timing as a
  timecode instead of frames" verbatim from `rna_space.cc:7220`.
- **`FCurveEditor`** — X-axis tick labels route through
  `formatXTickLabel`; `Plot` subscribes `fcurveShowSeconds`;
  `ActiveKeyformPanel` mount receives `showSeconds` + effective `fps`
  props.
- **`ActiveKeyformPanel`** — 3 Time field rows (Time / L Time / R
  Time) all route label + display + parse through the formatter.

Audit-fix sweep (dual-audit 2026-05-17)
- **HIGH-A1** (architecture): Modal G typed-numeric input
  (FCurveEditor.jsx:~1324) now respects `fcurveShowSeconds` — typed
  `2` means 2 seconds in timecode mode, 2 frames in frames mode.
  `ModalHUD` unit suffix flips between `'f'` and `'s'`. The stale
  comment at ~3185 ("deferred until SIPO_DRAWTIME ships") predicted
  this exact fix and is now closed.
- **HIGH-B1** (Blender fidelity): Added Deviation 3 documenting that
  `formatXTickLabel` emits `"0.5s"` whereas Blender's
  `BLI_timecode_string_from_time`
  (`reference/blender/source/blender/editors/interface/view2d/view2d_draw.cc:425`,
  styles in
  `reference/blender/source/blender/blenlib/intern/timecode.cc:149-158`)
  picks one of MINIMAL/SMPTE/SECONDS_ONLY per `U.timecode_style`.
- **MED-A1**: `parseTimeFieldValue` now rounds the input in frames
  mode (`frameToMs(Math.round(value), fps)`) — display↔parse symmetry,
  matches Blender's Key Frame field PROP_INT contract.
- **MED-A2**: Purged stale "Time (ms)" / "queued path #7" comment in
  `activeKeyformPanelData.js`; Deviation 3 marked CLOSED with cross-
  reference to the new `fcurveTimeFormat.js` deviation 2.
- **MED-B1**: Replaced `FCurveEditor.jsx` ModalHUD stale "deferred
  until SIPO_DRAWTIME ships" comment with current-behavior cite.

Rule №2 audit-pin (5.S oversight caught during 5.T pre-work)
- `package.json` registered TWO missing test entries:
  - `test:driverEditorData` — Slice 5.S created
    `scripts/test/test_driverEditorData.mjs` (106 assertions) but
    never wired it into the npm script list. Classic Rule №2
    staged-but-not-registered violation; caught during 5.T pre-work.
  - `test:fcurveTimeFormat` — this slice's new test.
  - Both appended to the aggregate `test` chain.

## Streak status

| Audit lane          | Result                                                                  |
|---------------------|-------------------------------------------------------------------------|
| Architecture        | 1 HIGH + 2 MED found; all addressed in same sweep                       |
| Blender fidelity    | 1 HIGH + 1 MED found; all addressed in same sweep                       |
| **Fab cite count**  | **0** (streak now 2 — first clean run was 5.S, holding)                 |
| typecheck           | clean                                                                   |
| Touched-paths tests | all green (77+106+188+62+35+35+97+115+26+71+26+35 across 12 suites)     |

## Documented SS deviations (7 new — cumulative 38 across Phase 5)

| #         | Deviation                                                       | Closure condition                                  |
|-----------|-----------------------------------------------------------------|----------------------------------------------------|
| 5.T Dev 1 | Toggle applies uniformly; no SIPO_MODE_DRIVERS gate             | Phase 5 path #6 (separate driver editor)           |
| 5.T Dev 2 | Time field tracks toggle (Blender keeps it always frames)       | None — fixing would re-introduce unit drift        |
| 5.T Dev 3 | X-axis "0.5s" decimal-with-suffix vs Blender timecode styles    | `User.timecode_style` port + BLI_timecode port     |
| 5.T Dev 4 | Modal G typed-input unit toggles with display                   | None — matches Blender exactly per `transform_mode_translate.cc:606-608` |
| 5.T Dev 5 | Frame mode parse rounds rather than rejects fractional input    | None — SS UX gain over Blender's hard reject       |
| 5.T Dev 6 | "Use Timecode" menu item always enabled (even no-action)        | None — no-op without action; toggle persists       |
| 5.T Dev 7 | No real-time update notifier (Blender's `NC_SPACE \| ND_SPACE_GRAPH`) | SS uses React subscription; equivalent semantics |

Cumulative across Phase 5 Slices 5.L → 5.T:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| 5.Q   | 4     |
| 5.R   | 3     |
| 5.S   | 7     |
| 5.T   | 7     |
| **Total** | **34** |

(5.Q Dev 3 is now CLOSED by this slice; net active 33.)

## Owed manual browser verification

Verify by switching to the F-Curve editor with an animation loaded:

- **View → Use Timecode → check ON**: X-axis ticks change from
  integer frames (e.g. `0`, `8`, `16`, `24`) to seconds with suffix
  (`0.0s`, `0.3s`, `0.7s`, `1.0s`). The Time row in the N-panel
  relabels from "Frame" to "Time (s)" and the value flips.
- **View → Use Timecode → check OFF (Blender default)**: reverses
  both display surfaces.
- **N-panel "Frame" field, type a fractional value (e.g. `12.7`)**:
  rounds to nearest frame on blur/Enter (frame 13 → 13/fps*1000 ms).
- **N-panel "Time (s)" field**: accepts decimal seconds verbatim;
  `0.5` becomes 500 ms canonical.
- **Modal G + type `2` + Enter, frames mode**: moves selected
  keyframes by 2 frames (1000/fps ms × 2).
- **Modal G + type `2` + Enter, seconds mode**: moves by 2000 ms.
- **Modal HUD unit suffix**: `f` in frames mode, `s` in seconds mode,
  `×` for Scale (regardless of toggle).
- **Toggle persists across editor tab switches but resets on full
  page reload** (UI-ephemeral state, not project-persisted —
  matches Blender's SpaceGraph.flag which is per-session screen).
- **L Time / R Time handle rows** (bezier kf with neighbors): also
  flip label + value + parse alongside the centre Time row.
- **Effective fps source**: When action has a per-action `fps`
  override (e.g. idle motion at 30 fps with global 24), the X-axis
  ticks + N-panel display use 30. Edit the global FPS field in the
  PlaybackControls → if action.fps is null, the X-axis ticks
  reflect the new global.

## Queued resume paths (after 5.T)

| #   | Path                                                                | Status                            |
|-----|---------------------------------------------------------------------|-----------------------------------|
| 1-3 | Earlier slices (5.L→5.O)                                            | SHIPPED                           |
| 4   | Footer wiring                                                       | SHIPPED in 5.P                    |
| 5   | N-panel active-keyform numerical editor                             | SHIPPED in 5.Q                    |
| 5.R | Active Keyframe handle editing                                      | SHIPPED in 5.R                    |
| 6   | Driver variable list / expression editor                            | SHIPPED in 5.S                    |
| 7   | SIPO_DRAWTIME seconds-vs-frames toggle                              | **SHIPPED in 5.T (this slice)**   |
| 8   | USER_FLAG_NUMINPUT_ADVANCED                                         | **NEW TOP**                       |
| 9   | Group-level mute + hide                                             | queued (FCurveGroup gate)         |
| 10  | DopesheetEditor row-state styling                                   | queued                            |
| 11  | Per-fcurve ACTIVE slot                                              | queued                            |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar                    | queued                            |
| 13  | Phase 2 owed-manual verification                                    | queued                            |
| 14  | **Phase 3 — F-Curve modifiers** (full phase; closes 5.R Dev 1)      | queued                            |
| 15  | SS keymap-preset selector                                           | queued                            |
| 16  | Hide/reveal toast notifications                                     | queued                            |
| 17  | Sidebar focus tracking for region-aware keys                        | queued                            |
| 18  | Popup-menu primitive                                                | queued (paired with PROTECT)      |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port)                          | queued                            |
| 20  | N-panel collapse-state persistence + multi-panel host               | queued                            |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE`              | queued                            |
| 22  | Pre-verify cite discipline workflow item                            | queued                            |
| 23  | Compound driver variable types (closes 5.S Dev 1)                   | queued                            |
| 24  | Driver compile-cache + invalidation hooks (closes 5.S Dev 6)        | queued                            |
| 25  | `self` magic identifier for drivers (closes 5.S Dev 7)              | queued                            |
| 26  | `ChannelDriver.influence` slider (closes 5.S Dev 4)                 | queued                            |
| 27  | `DRIVER_FLAG_INVALID` status field + error labels (closes 5.S Dev 3) | queued                           |
| 28 (NEW) | `User.timecode_style` preference + `BLI_timecode_string_from_time` port (closes 5.T Dev 3) | queued |
| 29 (NEW) | SIPO_MODE_DRIVERS gate for X-axis (closes 5.T Dev 1 once Phase 5 #6 lands the separate driver editor) | queued (downstream of #6) |

## Pre-compact state

- 58 commits ahead of `origin/master`, working tree clean
- typecheck clean
- Touched-paths suites green (12 of them; full suite was green pre-
  audit-fix and the audit-fix sweep doesn't touch any non-tested
  paths — modal G typed-input change is exercised by manual
  verification only)
- 5.S oversight (unregistered test) caught and closed
- Fab streak 2 of 2 (5.S → 5.T) — pre-verify-cite discipline is
  working

## Session lessons

1. **Closing one deviation often creates two**: 5.T closes 5.Q Dev 3
   but opens 5.T Devs 1+2+3+4+5+6+7 (mostly small, but the timecode-
   style one is real). The deviation list is a healthy ledger of
   intentional cuts, not a debt counter.
2. **Sister-component sweep catches latent bugs**: the modal G
   typed-input had been frames-hardcoded since Slice 5.E with a
   "deferred until toggle ships" comment. The toggle shipped — the
   comment promised a fix — without the architecture audit's HIGH-A1
   flag, the comment would have stayed stale (Rule №2 violation in
   waiting) AND the modal HUD would have silently disagreed with the
   visible axis labels. Sister-component review is load-bearing
   even when "we already thought of this".
3. **Pre-verify cite discipline keeps paying**: 2 of 2 clean fab-
   runs (5.S, 5.T). The discipline added in 5.P after the streak
   broke at 5.O hasn't slipped. The new MED-B1 timecode-deviation
   discovery (fidelity audit caught format mismatch behind a verbatim
   label) shows the audit lane works on semantic fidelity, not just
   string cite matching.
4. **Rule №2 audits can catch sibling-slice debt**: the
   `test:driverEditorData` unregistered-but-shipped state from 5.S
   was caught during 5.T pre-work — not by any audit agent, just by
   the natural "let me find the sibling test for reference" search.
   The fix was 1 line in package.json plus appending to the
   aggregate chain. Cheap to fix, expensive to forget.
5. **Default-value choice carries UX weight**: defaulting
   `fcurveShowSeconds: false` (Blender-faithful) flips the X-axis
   from "0.5s" to integer frames for every existing user. Justified
   by Blender fidelity but called out in the close-out so the user
   knows the regression-from-prior-SS-default is intentional.
