# Animation Phase 5 — Slice 5.Y close-out

**Date**: 2026-05-17
**Commits**: `11755e4` (substrate) → `2b1a31f` (audit-fix sweep) → (this doc)
**Path #12 from Phase 5 queue (NEW TOP per session-spanning 5.W→5.X close-out)** — *ANIM_OT_channels_select_box drag-rect on sidebar* — SHIPPED.

## What the path was

> "ANIM_OT_channels_select_box drag-rect on sidebar — closes 5.X Dev 2 + 4
> (the box-select active-restore pattern was the canonical SS-vs-Blender
> divergence flagged in 5.X close-out)."
> — Session-spanning close-out (3e5b74c), top queued path #12

## What shipped

A pure data-layer helper for drag-rect box-selection of channels in the
FCurveEditor sidebar, plus the DOM-side drag-rect FSM, hit-test, and
marquee overlay. Ports Blender's `ANIM_OT_channels_select_box` operator
(`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:3740-3760`).

| Capability | Source | Where |
|------------|--------|-------|
| `applyChannelBoxSelect(action, idsInRect, mode, ctx)` pure mutator | Mode triplet 'replace' / 'extend' / 'deselect' mirrors Blender keymap `:3865-3871` (plain / Shift / Ctrl on LMB drag) | `src/anim/fcurveBoxSelect.js` |
| `wouldChannelBoxSelectChange` preflight | Skip phantom `update()` per Slice 5.M pattern | same |
| Pre-clear cascade clears `fc.active` via `clearActiveFCurves` | Matches Blender's per-channel `anim_channels_select_set` ANIMTYPE_FCURVE case at `:723-734` (cascaded through `:728-732` "Only erase the ACTIVE flag when deselecting") | same — calls into Slice 5.X |
| Sidebar pointer-event FSM (idle → pressed → dragging) | 4px drag threshold approximates `U.drag_threshold_mouse` (default 3 in `DNA_userdef_types.h:1191`) | `FCurveEditor.jsx` Sidebar component |
| `data-fcurve-id` per-row attr for hit-test | `querySelectorAll('[data-fcurve-id]')` + `getBoundingClientRect()` Y-axis intersection | same |
| Click-suppression latch (`wasDragRef`) | Drag-then-click no longer double-fires | same |
| Marquee overlay (amber-300, fixed-positioned) | `pointer-events:none`, z-30 | same |
| Dispatcher `applyChannelBoxSelectOp` via `update(..., {skipHistory:true})` | Channel selection is view state (Slice 5.F/5.K convention) | same |

## Substrate (`11755e4`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveBoxSelect.js` | NEW (~290 LOC substrate, ~340 post-audit-fix) | Pure helper + preflight + module header with Blender provenance |
| `scripts/test/test_fcurveBoxSelect.mjs` | NEW | 66 assertions (substrate) → 71 (post-audit-fix M4) |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | refactored | Dispatcher, Sidebar drag-rect FSM, marquee overlay, per-row data-attr, click-suppression latch |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 4   | 2   | 6     |
| Blender fidelity | 1    | 2   | 3   | 6     |
| **Combined**     | **1** | **6** | **5** | **12** |

**Fab streak BROKE for the 3rd time** (5.P, 5.V, now 5.Y). 1 fab cite
(HIGH-A1: invented symbol `WM_GESTURE_DRAG_THRESHOLD`). All other 15
verified cites passed.

## Audit-fix sweep (`2b1a31f`)

All HIGH + all MED + LOW-2 + LOW-A1 addressed. LOW-1 (decoded dep), LOW-A2 (B-key wm_gesture_ops cite), and LOW-A3 (FCurveEditor cite span) acknowledged as no-action-needed for this slice.

### Architecture findings

**M1 — `applyChannelBoxSelectOp` passed raw `decoded` as `orderedIds`.**
The helper's documented Deviation 3 spec was "decoded filtered through
`isFCurveEffectivelyHidden`" but the dispatcher passed raw `decoded`,
which still includes hidden-but-rendered rows (sidebar shows them with
line-through + opacity:0.5 for the un-hide affordance). So a `replace`
drag-rect would clear `selected` on hidden rows. **Fix**: dispatcher
now filters `decoded` through `isFCurveEffectivelyHidden(d.fcurve,
liveAction)` before building `orderedIds`.

**M2 — Multi-touch hijack.** Second touch (different pointerId, same
button=0) overwrote the active drag session; move/up events filtered
by pointerId then dropped the first finger's events silently, leaving
the marquee orphaned on touch devices. **Fix**: early guard
`if (dragSessionRef.current !== null) return;` at top of
`onSidebarPointerDown`.

**M3 — `wasDragRef` latch leak across early returns.** Latch reset
lived AFTER the early-return guards (`button !== 0`, button-child
detection). A stale latch from a prior drag could survive across
pointerdowns that bailed, suppressing the next legitimate row click.
**Fix**: hoisted `wasDragRef.current = false` to the TOP of
`onSidebarPointerDown`, before every early return.

**M4 — Test gap: active-clear-only mutation.** Setter returns
`changed=false` when only the active flag was cleared (no `selected`
flips). Integration test's `eq(predicted, r.changed)` comparator was
too narrow — it would fail on the active-clear-only path. **Fix**:
added the scenario (a unselected+active, no idsInRect, mode=replace)
and tightened the comparator to `r.changed || r.clearedActive`. Now
71 total assertions (was 66).

**L2 — Hit-test comment didn't document collapsed-group exclusion.**
Added a paragraph explaining that collapsed-group rows render `null`
→ no `[data-fcurve-id]` element in DOM → naturally excluded from the
`querySelectorAll` (matches Blender's `ANIMFILTER_LIST_VISIBLE` at
`:3594`), and that effectively-hidden rows DO render in DOM but get
filtered out via the dispatcher's `orderedIds` (M1 fix).

**L1 (no action) — `decoded` dep broader than needed in the
`applyChannelBoxSelectOp` useCallback.** Same pattern as sister
`applyChannelSelectAllOp` (Slice 5.K) and other dispatchers. Could
add `decodedIds` memo to narrow, but would diverge from established
sister convention — deferred until a Phase-5-wide narrowing pass
visits all channel-op dispatchers together.

### Blender-fidelity findings

**HIGH-A1 (FAB) — `WM_GESTURE_DRAG_THRESHOLD` does NOT exist in
Blender source.** Grep across the entire `source/blender` tree
returned zero hits for that symbol. The real mechanism:
`DNA_userdef_types.h:1191` defines `char drag_threshold_mouse = 3;`
(user pref), and `WM_event_drag_threshold` at
`wm_event_query.cc:407-427` fetches it per-event and scales by
`UI_SCALE_FAC`. **Fix**: comment rewritten to cite the real symbols
and frame SS's hardcoded 4px as an approximation (1px above
Blender's default; browser has no UserPref hook).

**MED-A1+A2 — scope-conflation in module-header Deviation 3.**
Original framing claimed "`box_select_anim_channels` walks
`anim_channels_for_selection`" — but `box_select_anim_channels` calls
`ANIM_animdata_filter` DIRECTLY with its own filter set
(`ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_VISIBLE |
ANIMFILTER_LIST_CHANNELS` at `:3594`), while
`anim_channels_for_selection` (defn at `:523-534`) uses a DIFFERENT
filter (`ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_CHANNELS` — note
the explicit comment at `:528`: "no list visible, otherwise, we get
dangling"). So Blender has TWO scopes:

- Pre-clear scope (`anim_channels_for_selection`) INCLUDES
  collapsed-group fcurves.
- In-rect-loop scope (inline `:3594`) EXCLUDES them.

SS folds both into a single `ctx.orderedIds` matching the narrower
in-rect scope (don't clear stuff the user can't see). **Fix**:
Deviation 3 rewritten to acknowledge both scopes, document SS's
narrower-on-purpose pre-clear, and spell out the future
byte-faithful-port path (split `ctx` into `preClearIds` + `inRectIds`).

**LOW-A1 — cite `:823` was the call-site, not the definition.**
Changed module header to cite `:523-534` (defn of
`anim_channels_for_selection`) + `:821-826` (call-site inside
`ANIM_anim_channels_select_set`).

**LOW-A2, LOW-A3 (no action)** — minor cite enrichments not blocking
fidelity; deferred.

### SS deviations from Blender (new this slice)

1. **'deselect' mode literal-Blender behavior** — Ctrl+drag clears the
   entire visible scope (pre-clear runs because keymap doesn't pass
   `extend=True`; in-rect CLEAR loop is then a no-op). Faithfully ported
   the surprising UX rather than silently fixing it. Per Rule №1.

2. **No `OPTYPE_UNDO` snapshot** — channel selection is view state
   (Slice 5.F/5.K convention); `skipHistory:true`.

3. **Two distinct Blender scopes folded into one `ctx.orderedIds`** —
   SS matches the narrower in-rect-loop scope for both pre-clear and
   in-rect-loop; collapsed-group fcurves are preserved in SS where
   Blender would clear them. Intentional UX choice. Future byte-faithful
   slice could split the contract.

4. **Hit-test lives in the caller, not the helper** — keeps the helper
   pure (no JSDOM needed) and the DOM concern (`getBoundingClientRect`,
   Y-axis intersection) stays in the React layer.

5. **4px drag threshold (vs Blender's default 3)** — SS hardcodes 4
   because browsers have no `U.drag_threshold_mouse` equivalent.

## Queued paths (post-5.Y)

Carrying forward + reordered. New top: **#13 — Phase 2 owed-manual
verification** (carries forward from session-spanning 5.W→5.X
close-out).

| Path | Title | Status |
|------|-------|--------|
| 13  | Phase 2 owed-manual verification                              | NEW TOP                           |
| 14  | Phase 3 — F-Curve modifiers (full phase)                      | queued                            |
| 15  | SS keymap-preset selector                                     | queued                            |
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
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | queued (downstream of 5.K rewire) |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |
| 43 (NEW) | B-key invocation entry for box-select (the gesture-modal half) | queued (closes 5.Y Dev 1)   |
| 44 (NEW) | Split `ctx` into `preClearIds` + `inRectIds` for byte-faithful pre-clear scope (closes 5.Y Dev 3) | queued |
| 45 (NEW) | `applyChannelSelectAllOp` wire `clearActive` through `setActiveFCurve`/`clearActiveFCurves` (closes Slice 5.K MED-A1, opened by 5.X) | queued |

## Lessons

1. **Fab streak broke a 3rd time — pre-verify per-cite even for
   single-line claims.** Slice 5.V (3 fabs in substrate), 5.W + 5.X
   held, 5.Y broke with 1 fab. The pattern: substrate slices with high
   cite volume are most at risk. The 5.Y fab was a single throw-away
   constant name in a UI comment, not a substrate Blender API call —
   easier to wave through, harder to catch in pre-verify. Lesson:
   single-line cites get the same per-cite verification discipline as
   substrate cites, no exceptions.

2. **Two-scope ports need explicit dual citation.** The Deviation 3
   conflation arose from treating "scope" as a single concept when
   Blender actually uses two. The fix wasn't a behavior change — SS's
   narrower scope was the right UX call — but the documentation was
   wrong, and a future reader would be misled. Lesson: when porting a
   Blender operator that calls more than one filter helper, document
   ALL filter scopes explicitly, even if SS collapses them.

3. **Sister-code consistency keeps drift in check.**
   `applyChannelBoxSelectOp` was modeled directly on
   `applyChannelSelectAllOp` (same dep pattern, same skipHistory
   convention). MED-1 surfaced the dispatcher's spec divergence
   (broader scope than the helper documented) — easy to fix because
   the sister was the reference. Lesson: when adding a new dispatcher
   in a sister family, copy the family's pattern explicitly and audit
   for spec-vs-implementation drift right after.

4. **Click-suppression latches need TOP-OF-FUNCTION reset.** MED-3 was
   a latch that lived past its useful life because the reset was after
   early returns. Lesson: any one-shot UI latch should reset
   unconditionally at the start of the handler that's expected to
   consume it, BEFORE any branching.

5. **Multi-touch is a real concern on Windows tablet/Surface.** MED-2
   was a desktop-tablet trap — the second touch could orphan the
   marquee with no way to dismiss. The fix is a 1-line early guard; the
   bug existed because the FSM was designed for single-pointer mental
   model. Lesson: pointer-event FSMs should be explicit about
   multi-pointer policy (ignore, queue, or hijack) in the type
   declaration of the session ref.
