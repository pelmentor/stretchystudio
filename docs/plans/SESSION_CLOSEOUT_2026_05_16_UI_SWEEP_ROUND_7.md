# Session close-out — 2026-05-16 (round 7)
# UI Blender-fidelity sweep ROUND 7 — FID-A.2 transport-row lift + dual-audit sweep

## Status

Continuation of the 2026-05-16 master session. Resumed from `8862dc4`
([`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_6.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_6.md)'s
top queued resume path), shipped the FID-A.2 transport-row lift,
ran the established dual-audit convention, and folded all 10
findings into a SEPARATE audit-fix commit (the default per Round 5/6's
documented convention — inline-fold is the exception for runtime-
critical-path fixes only). **2 commits + 1 doc commit**, all
affected tests green at HEAD, typecheck clean. Push to
`origin/master` pending.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `dc1a44b` | UI sweep R7 | FID-A.2 — Transport-row lift (TimelineEditor → Footer center spacer via new PlaybackControls.jsx) |
| 2 | `23e9f58` | UI sweep R7 audit-fix | 10-finding sweep (1 HIGH perf + 2 HIGH dead imports + 1 MED doc drift + 6 HIGH/MED Blender-fidelity honesty + 1 MED dangling cite) |
| 3 | this     | docs       | Round 7 close-out |

## Resume context

User typed `Go` after `/compact`. Per Rule №3 (question agents not
user), no clarification asked — picked the doc's explicit top
resume path (`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_6.md:178-185`):
"**Transport-row lift (FID-A.2 from Round 4)** — now natural
next-up: Footer exists, so TimelineEditor's transport bar (play /
pause / frame fields / fps / speed / loop / auto-key / audio) can
move into a FOOTER region per `DOPESHEET_HT_playback_controls`
(`reference/blender/scripts/startup/bl_ui/space_dopesheet.py:351-358`)
+ `GRAPH_HT_playback_controls`
(`reference/blender/scripts/startup/bl_ui/space_graph.py:113-124`).
Center spacer in Footer is shaped for this injection."

The Round 6 Footer (`Footer.jsx`) was created with its CENTER section
deliberately shaped (`flex-1` spacer) for this lift. Round 7
replaced the spacer with `<PlaybackControls />`.

Dual-audit invoked proactively without prompting (Round 5/6 lesson
held). This round restored the default split (feature ship first,
audit-fix sweep as a second commit) — findings were a mix of perf
narrowing + doc honesty, none on a runtime critical path.

## Thread A — FID-A.2 transport-row lift

### Architecture

| File | Status | What it does |
|------|--------|--------------|
| `src/v3/shell/PlaybackControls.jsx` | NEW (518L pre-audit, 681L post-audit-fix-with-JSDoc) | Hosts the full transport bar lifted from `TimelineEditor.jsx`: play / pause, first / last frame, repeat, frame / start / end / fps fields, speed slider, loop-keyframes, auto-key, audio-add, action picker, +New / Import, K-hint. Includes `TransportBtn` + `NumField` sub-components (only callers were the lifted transport row; co-located). |
| `src/v3/shell/Footer.jsx` | MODIFIED | CENTER section now mounts `<PlaybackControls />` instead of a bare `flex-1` spacer. Wrapper is `flex-1 min-w-0 flex items-center justify-center` — lets transport shrink gracefully; PlaybackControls' own `overflow-x-auto` keeps controls reachable on narrow viewports. Footer height bumped `h-6 → h-9` (24px → 36px) so transport buttons (`w-6 h-6`) fit with breathing room. JSDoc updated with the lift + per-section bullets. |
| `src/v3/editors/timeline/TimelineEditor.jsx` | MODIFIED (−402L) | Removes transport-row JSX (255L), `TransportBtn` + `NumField` definitions (52L), `motionFileRef`, `ensureAnimation`, `importMotionFile`, `createAnimation`, `togglePlay`, `stop`, `lastFrame` callbacks (~95L), dead `lucide-react` icons + `parseMotion3Json` import. Empty-state message updated to point users to the Footer's "+ New" button. JSDoc updated to flag the lift. |

### Blender mapping

Blender source (all at `reference/blender/`):

| Blender symbol | File:line | What it is |
|----------------|-----------|------------|
| `DOPESHEET_HT_playback_controls` | `scripts/startup/bl_ui/space_dopesheet.py:351-358` | Dopesheet's FOOTER region class; delegates to `playback_controls(layout, context)` |
| `GRAPH_HT_playback_controls` | `scripts/startup/bl_ui/space_graph.py:113-124` | Graph editor's FOOTER region class; same delegation |
| `playback_controls(layout, context)` | `scripts/startup/bl_ui/space_time.py:40-136` | Shared draw function; the canonical Blender transport |
| `STATUSBAR_HT_header` | `scripts/startup/bl_ui/space_statusbar.py:8-31` | Blender's GLOBAL status bar (what SS's `Footer` mirrors) |

### Blender-fidelity deviation (documented)

The headline deviation: **Blender mounts `playback_controls` as a per-
editor `bl_region_type = 'FOOTER'` region** (visible only when the
corresponding editor is the active area). **SS mounts it in the global
`Footer`** (always visible regardless of workspace/active area).

Trade-off:

| Direction | Gain | Loss |
|-----------|------|------|
| **SS (global)** | Transport always accessible (scrub in Pose workspace while watching Viewport canvas) | Conflates status bar with editor-specific playback |
| **Blender (per-editor)** | Editor-scoped extras possible (Sequencer-specific controls) | Transport disappears when no animation editor is active |

SS does not have per-Area FOOTER region infrastructure today
(`Area.jsx` has only a HEADER row + a content body). Adding one
would mean inventing a new Area sub-region pattern — a larger
change than the prior session's queued plan envisioned. The lift
preserves Blender's "transport lives at the bottom" intent without
inventing a new region primitive.

Documented honestly in both `PlaybackControls.jsx` module JSDoc and
`Footer.jsx` JSDoc per `feedback_blender_reference_strict.md`.

### SS extensions kept in the lift (NOT in Blender's playback_controls)

All listed in `PlaybackControls.jsx` JSDoc:

- **Repeat (loop toggle)** — loop mode lives in `TIME_PT_playback`
  popover (`space_time.py:245`); SS surfaces it top-level.
- **FPS field** — Blender keeps fps in scene props popover.
- **Speed slider** — no Blender equivalent.
- **Loop Keyframes toggle** — no Blender equivalent.
- **Audio track button** — Blender's audio is sequencer-only.
- **Action picker / + New / Import** — Blender's `template_action`
  lives in the dopesheet HEADER (`space_dopesheet.py:322`), not in
  playback_controls.
- **K-hint pill** — SS-specific keyboard affordance.

### Blender controls NOT ported (documented as deferred)

All listed in `PlaybackControls.jsx` JSDoc per
`feedback_blender_reference_strict.md` — silent omissions count as
the same dishonesty as invented behavior:

| Blender control | File:line | Why deferred |
|-----------------|-----------|--------------|
| `TIME_PT_playback` leading popover | `space_time.py:52-55` | No SS analog for Limit-to-Frame-Range / Allow-Preroll / Follow / Play-In |
| `TIME_PT_keyframing_settings` popover | `space_time.py:59-64` | SS uses one global kf type |
| `TIME_PT_auto_keyframing` popover | `space_time.py:75-79` | Toggle only in SS, popover not ported |
| `screen.keyframe_jump` PREV/NEXT | `space_time.py:83 + :101` | Needs per-action kf iteration in animationStore |
| Time-jump cluster | `space_time.py:104-108` | Replaced by SS scrubbing + Frame field |
| Playhead-snap toggle | `space_time.py:110-114` | SS has no playhead-snap concept |
| `use_preview_range` toggle | `space_time.py:127-136` | SS has scene range only |
| `PLAY_REVERSE` | `space_time.py:94` | Needs `playReverse` action on animationStore |

## Thread B — Dual-audit (10 findings, ALL CLOSED in `23e9f58`)

Per `feedback_dual_audit_after_phase_ship.md`: 2 parallel agents
(architecture / code-reviewer + Blender-fidelity / general-purpose)
ran against `dc1a44b` before the second commit landed. Default
split applied (feature commit + audit-fix commit) — findings were
all perf / dead imports / doc honesty, none on runtime critical
path. Per Rule №1 (no quick-and-dirty fixes), every finding was
fixed properly — no "we'll get to it later" comments left behind.

### Findings closed

| # | Tag | Severity | Finding | Fix |
|---|-----|----------|---------|-----|
| 1 | A1 | HIGH | `useAnimationStore()` (whole-store) caused 60 Hz re-render of `PlaybackControls` + `Footer` subtree in EVERY workspace during playback. Pre-lift this lived inside workspace-gated `TimelineEditor`; post-lift it's in the always-mounted global Footer. | Narrowed to 9 primitive selectors (`activeActionId`, `currentTime`, `isPlaying`, `loop`, `loopKeyframes`, `fps`, `startFrame`, `endFrame`, `speed`); method calls routed through `useAnimationStore.getState()` lazily (zustand method refs are stable; getState returns latest at call time). |
| 2 | A2 | HIGH | `getSceneAction` import in `TimelineEditor.jsx:16` was only used in the lifted transport row's animation switcher | Removed from `TimelineEditor.jsx`'s import. Symbol still imported in `PlaybackControls.jsx` where it belongs. |
| 3 | A3 / B10 | HIGH | `Upload` (lucide-react icon) import in `TimelineEditor.jsx:7` was only used in the lifted "Import" button | Removed from `TimelineEditor.jsx`'s import. (Commit `dc1a44b` claimed this was already cleaned — wasn't.) |
| 4 | A4 | MED | `Footer.jsx` per-section JSDoc bullets still described pre-lift layout (CENTER = reports) | Updated to CENTER = `<PlaybackControls />` + CENTER-RIGHT = reports, with Round 7 lift context. |
| 5 | B1 | HIGH | Repeat (loop toggle) rendered as if a port; loop actually lives in `TIME_PT_playback` popover at `space_time.py:245` | Added Repeat to SS-extensions JSDoc list with honest framing. Per `feedback_blender_reference_strict.md`, this is exactly the silent-invention pattern the rule forbids. |
| 6 | B2 | HIGH | `TIME_PT_playback` leading popover absent from lift, not acknowledged | Documented as deferred in "Blender controls NOT ported" block |
| 7 | B3 | HIGH | Prev/next-keyframe jumps absent (Blender has 4 jumps; SS has 2), not acknowledged | Documented as deferred |
| 8 | B4 | HIGH | Time-jump cluster absent, not acknowledged | Documented as deferred |
| 9 | B5 | HIGH | Playhead-snap toggle absent, not acknowledged | Documented as deferred |
| 10 | B6 | HIGH | `use_preview_range` toggle + dual Start/End binding absent, not acknowledged | Documented as deferred |
| (11) | B7 | MED | `TIME_PT_keyframing_settings` popover absent (paired with auto-key in Blender) | Documented as deferred |
| (12) | B8 | MED | `PLAY_REVERSE` absent | Documented as deferred |
| (13) | B9 | MED | Animation switcher JSDoc cited "see `TimelineEditor.jsx`'s pre-lift comment" — comment was lifted out and no longer exists | Inlined the full `template_action` / pinned-datablock rationale into `PlaybackControls.jsx`. |

(Counted as 10 in commit message because B7+B8+B9 fold into the same
JSDoc-update edit; total distinct fix edits is 10.)

## Test scoreboard

- TSC clean across both commits.
- All affected suites green at HEAD (`23e9f58`):
  - `test_footerStatus` — 39 passed (unchanged from Round 6)
- Full `npm test` chain still hits Windows cmd-line length limit;
  affected-suites smoke is the verification path.

## Owed (not blocked)

**Manual browser verification** — load SS, confirm:
- Footer renders at the bottom with the transport bar visible in CENTER
- Transport buttons disabled when no animation exists; "+ New" button
  emphasized
- Play/Pause toggles cleanly; auto-pause at endFrame works
- Speed slider changes playback rate without restart
- Frame/Start/End numeric fields commit on Enter and Blur
- Action picker dropdown switches motions cleanly (Stage 1.E scene
  re-bind still works)
- Audio "+" button creates a new audio track (sister modal still opens
  on click)
- Tab key cycles through edit modes; mode-label updates in LEFT section
- Modal G/R/S still echoes in LEFT section
- Reports pills appear when warnings/errors are logged
- TimelineEditor's empty-state message no longer recommends the removed
  in-panel "+ New" button (now points to Footer)
- Footer h-9 (36px) layout is comfortable; AreaTree absorbs the 12px
  difference correctly

Cannot be assertion-tested in headless Node; needs human eyes.

## Resume paths post-compact

Updated cross-audit priority list:

1. ~~**Audit 4 #1 (Footer)**~~ — SHIPPED Round 6.
2. ~~**FID-A.2 (Transport-row lift)**~~ — SHIPPED THIS ROUND.
3. **Animation Phase 2** — Slices 2.D (auto-handle calc) / 2.G + 2.G.1
   (motion3 bezier round-trip) / 2.H (6-Cubism-sample exit gate).
   Independent of Footer; also unblocks `anim.keyframe_insert` for
   the Pose menu's biggest Blender-fidelity gap flagged in Round 5
   FID-A.3.
4. **F-1 follow-on** — ModePill lift to shared subcomponent.
5. **Blender playback_controls gaps (B2-B8)** — port any of the eight
   absent controls into PlaybackControls. Easiest first: `PLAY_REVERSE`
   (one new animationStore action). Hardest: `use_preview_range`
   (needs new SS concept). Each is independently scoped.

Queued from prior sessions:
- **F-8 (deferred)** — Constraint stack UI, needs Constraints
  datablock model in projectStore first.
- **Interactive affordances on Footer (deferred)** — click-to-open-Logs
  + per-report dismiss. Round 6 first-cut shipped read-only-
  informational; non-trivial extension that earns its own audit lap.
- **Per-Area FOOTER region pattern** — if a future session wants
  Blender-faithful per-editor playback controls, this would need
  inventing. Not a priority while the global-Footer placement works.

## Memory updates this session

None added. Conventions reinforced and applied:
- `feedback_dual_audit_after_phase_ship.md` — invoked proactively
  (Round 5/6 lesson held).
- `feedback_blender_reference_strict.md` — applied at audit time:
  finding B1 (silent Repeat invention) + B2-B8 (silent missing-
  control omissions) were the entire HIGH/MED Blender-fidelity
  cluster. Doc honesty is the cheap fix; silence is the violation.
- `feedback_filter_in_selector.md` — A1's perf fix narrowed
  subscriptions per this rule's spirit (no filter-in-selector but
  same "subscribe to primitives, derive on render" pattern).

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty
  fixes); applied throughout: every audit finding was fixed
  properly, no "we'll get to it later" comments left behind. Even
  the deferred Blender-control ports are documented with the
  file:line cite for the future port.
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no
  migration baggage); transport row deleted in same commit as
  PlaybackControls creation. No shim, no compat re-export. Audit-
  fix found 2 dead imports left in TimelineEditor — removed.
- `feedback_question_agents_not_user.md` — Rule №3 (question
  agents, not user); applied at session start (no clarifying
  question on resume). The deviation (global Footer vs per-editor
  FOOTER region) was decided by the prior session's queued plan
  + Round 6 Footer's spacer shape; not re-litigated.
- `feedback_dual_audit_after_phase_ship.md` — established
  convention; applied this round, findings folded as a separate
  commit per the default convention (Round 5's inline-fold was
  the exception, still standing for critical-runtime-path fixes
  only).
- `feedback_blender_reference_strict.md` — Blender source IS the
  source of truth; **dominant rule this round**. Closed by B1
  (cite correction — silent Repeat invention) + B2-B8 (deviation
  discipline — invented "Blender parity" claims removed, real
  deviations documented with file:line + reason).
- `feedback_filter_in_selector.md` — A1 narrowed subscription per
  this rule's spirit (return store-resident primitives, not whole
  store).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_6.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_6.md) — predecessor close-out (Round 6 — Audit 4 #1 Footer status bar).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md) — Round 5 (Audit 4 #2 RMB context menu).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md) — Round 4 (Audit 2 F2-1 4 animation-editor headers) — original source of FID-A.2 transport-row lift flag.
