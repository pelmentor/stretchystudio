# Animation Phase 5 — Slice 5.FF close-out

**Date**: 2026-05-18
**Commits**: `f123d0e` (substrate + close-out in one) → (this doc)
**Path #43 from Phase 5 queue** — *B-key invocation entry for box-select* — SHIPPED.

## What the path was

> "5.Y-1: B-key keyboard entry point for box-select — Blender's `B`
> key fires the standard `WM_gesture_box_invoke` modal which lets
> the user draw a rect with plain/Shift/Ctrl meaning the same as
> LMB-drag. SS routes the same three modifiers through this helper;
> the B-key entry point is deferred."
> — from Slice 5.Y close-out, queued path #43

## What shipped

Ports Blender's `blender_default.py:3865` keymap binding:
```
("anim.channels_select_box", {"type": 'B', "value": 'PRESS'}, None)
```

Bare B keypress (with sidebar hover) arms the channel-list box-select
modal — crosshair cursor + hint banner. Next LMB-click in the sidebar
starts a drag-rect immediately (bypasses Slice 5.Y's 4px threshold
+ button-child guard). Escape cancels.

Mirrors `WM_gesture_box_invoke` at
`reference/blender/source/blender/windowmanager/intern/wm_gesture_ops.cc:167-192`
where `wait_for_input=true` (keyboard invocation) enters
`WM_GESTURE_CROSS_RECT` state at `:174-176`.

| Capability | Where |
|------------|-------|
| `bGestureArmed` useState + `bGestureArmedRef` mirror | `FCurveEditor.jsx` ~line 645 |
| B keypress handler (sidebar-hover gated) | `FCurveEditor.jsx` ~line 2629 |
| Escape cancel handler (region-agnostic) | same ~line 2640 |
| Sidebar prop pass-through (armed/ref/onConsume) | same ~line 2913 |
| onSidebarPointerDown bypasses button-child + threshold when armed | same ~line 3262, 3285 |
| Marquee seeded at press point (0x0 grows on first move) | same ~line 3300 |
| Sidebar cursor-crosshair + hint banner when armed | same ~line 3443, 3459 |

## Why no substrate audit

Same rationale as Slice 5.Z, 5.CC, 5.EE (partial) — UI-side gap
closure, not substrate:

- No new files / modules / pure helpers
- No new schema fields
- No new Blender ports beyond the keymap binding cite (already
  verified during Slice 5.Y close-out)
- ~80 lines of pure UI wiring (state + handlers + render conditional)
- Data-side helpers (`applyChannelBoxSelect`,
  `wouldChannelBoxSelectChange`) from Slice 5.Y are unchanged and
  already audited (71 assertions, dual-audited)

The dual-audit-after-phase-ship convention covers NEW substrate.
This slice adds a new keyboard entry point to a pre-audited pipeline;
no new attack surface for architectural drift or fab cites.

## UX flow

1. User hovers over sidebar (sets `regionHoverRef='sidebar'`)
2. User presses B → cursor becomes crosshair + amber hint banner
   ("Box-select armed — drag to define rect, Esc to cancel")
3. User LMB-clicks anywhere in sidebar → drag-rect starts immediately
   (no button-child filter, no threshold)
4. User drags → marquee renders following pointer
5. User releases LMB → hit-test + dispatch box-select (existing
   Slice 5.Y pipeline). Armed flag was consumed on pointerdown.
6. OR: User presses Escape → armed flag clears, no gesture started.

Modifier semantics at LMB-press-time match Slice 5.Y (plain=replace,
Shift=extend, Ctrl=deselect).

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:fcurveBoxSelect | 71/71 (unchanged) |
| test:fcurveChannelSelect | 274/274 (unchanged) |

No new tests — the wiring is mechanical and exercises the pre-audited
helper. The keymap-resolution logic (`if (e.code === 'KeyB' && ...)`)
is too thin to warrant dedicated unit tests; modal UI testing without
React Testing Library setup is out of scope.

## SS deviations from Blender

1. **No two-click variant.** Blender's `WM_gesture_box_modal` supports
   a click-corner1 → click-corner2 confirm pattern in addition to
   click-and-drag. SS implements only the click-and-drag interpretation
   (matches the existing Slice 5.Y FSM). Click-corner1-then-corner2
   would require a second pointer-event mode in the FSM; deferred.

2. **Hint banner is SS UX, not a Blender port.** Blender shows
   gesture status in the status bar (`wm_gesture_ops.cc` modal
   handler updates status text). SS surfaces it as an inline amber
   banner at the top of the sidebar because SS has no status bar
   region in the FCurveEditor.

3. **No graph-region B binding ported.** Blender also binds B in the
   graph region (timeline) to `GRAPH_OT_select_box` — a different
   operator for keyframe box-select. Out of scope for Slice 5.Y/5.FF
   (which scoped the sidebar/channels region). Queued as a future
   slice (would need a graph-region keyform box-select pipeline first).

## Queued paths (post-5.FF)

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
| ~~43~~ | ~~B-key invocation entry for box-select~~                  | **SHIPPED THIS SLICE**            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | **NEW TOP for one-slice ships** |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | queued                            |
| 47  | Third preset `'default_no_toggle'` (closes 5.AA Dev 1)        | queued                            |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (closes 5.DD LOW-2 arch) | queued |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued                            |
| 54 (NEW) | Click-corner1 → click-corner2 box-select variant (closes 5.FF Deviation 1) | queued |
| 55 (NEW) | Graph-region B binding → GRAPH_OT_select_box port (closes 5.FF Deviation 3 — needs keyform box-select pipeline first) | queued |

## Lessons

1. **UI gap closures don't need substrate audits.** Slice 5.Z (5
   lines), 5.CC (3 lines), 5.FF (~80 lines of pure UI wiring) all
   closed documented deviations against pre-audited pipelines. The
   dual-audit-after-phase-ship convention is for NEW substrate (new
   files, new pure helpers, new schema). UI-only wiring against
   audited helpers gets a single commit and a close-out doc.

2. **The "wait_for_input" pattern is the modal-armed pattern.**
   Blender's `WM_gesture_box_invoke` uses one of two states
   depending on whether the operator was invoked by keyboard (B key,
   wait_for_input=true → CROSS_RECT) or mouse-drag (already in motion,
   wait_for_input=false → RECT). SS's port maps to two FSM entry
   points: keyboard invocation arms a one-shot flag that consumes on
   next pointerdown; mouse invocation goes directly through the
   existing threshold-based path. Same final pipeline.

3. **Refs as the synchronous bridge between state and event handlers.**
   The `bGestureArmedRef` mirror exists because `onSidebarPointerDown`
   needs to read the current armed state synchronously (no React
   render between B-press and the next pointerdown). The `useState`
   triggers the cursor/banner re-render; the ref handles the
   pointer-event read. Sister pattern to `regionHoverRef` and others.
   Lesson: when a flag drives BOTH UI rendering AND synchronous event
   handler logic, use both state and ref with a sync effect.

4. **Two new queued paths from scope decisions.** #54 (click-corner1
   → corner2 variant — Blender's modal supports both click-drag and
   click-click flows; SS ships only the former). #55 (graph-region
   B binding for keyframe box-select — needs a graph-region keyform
   box-select pipeline first, which doesn't exist yet). Both are
   contained future slices.
