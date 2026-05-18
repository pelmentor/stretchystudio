# Session Closeout — Animation Phase 4 Slice 4.D.2 (NLAEditor drag interactions)

**Date:** 2026-05-19
**Branch:** master (148 commits ahead of origin/master, +2 this slice)
**Schema:** v42 (no bump — UI-only slice)
**Status:** SHIPPED — substrate `151cea0` + audit-fix `35367c2`
**Phase 4:** 5/7 sub-slices complete (4.A + 4.B + 4.C + 4.D.1 + 4.D.2;
remaining 4.D.3 + 4.D.4 + 4.E + 4.F + 4.G)

---

## What 4.D.2 ships

Plan §4.D drag scope items:

1. ✅ Strip body drag → translates strip (preserves duration)
2. ✅ Strip left-edge drag (6px invisible handle) → resizes start
3. ✅ Strip right-edge drag (6px invisible handle) → resizes end
4. ✅ Track label-column vertical drag → reorders track stack
   (wired in audit-fix HIGH-A5 — substrate commit had imported but
   not wired)
5. ✅ ResizeObserver-driven timeline pxWidth via callback ref
   (audit-fix MED-A6 fixed empty→populated transition)
6. ✅ Live drag preview (strip/track visually follows pointer)
7. ✅ One undo snapshot per drag (commit on pointerup matches
   Blender modal-operator `OPTYPE_UNDO` per `nla_select.cc:584`)
8. ✅ Dual-pane drag-ownership gating via module-level Symbol
   (audit-fix MED-A7)

Concretely:

- **NEW [src/v3/editors/nla/nlaEditorOps.js](../../src/v3/editors/nla/nlaEditorOps.js)** (~310 LOC after audit-fix)
  — pure-function ops: `applyMoveStrip` / `applyResizeStripStart` /
  `applyResizeStripEnd` / `applyReorderTrack` + `would*Change`
  predicates + `pxDeltaToMs` / `pxToMs` helpers + `MIN_STRIP_MS`.

- **EDITED [src/v3/editors/nla/NLAEditor.jsx](../../src/v3/editors/nla/NLAEditor.jsx)** (~570 LOC after audit-fix)
  — full drag state machine, callback-ref ResizeObserver, dual-pane
  Symbol-gated commit, track + strip drag.

- **NEW [scripts/test/test_nlaEditorOps.mjs](../../scripts/test/test_nlaEditorOps.mjs)** (~330 LOC, 64 asserts across 18 sections)

## Cite-discipline arc

**HOLDS at 1 post-reset** ✅. All 4 Blender citations verified
byte-exact by fidelity audit; no fabs in this slice. The 4.D.1
audit-fix correction (`rna_nla.cc:32-61 rna_enum_nla_mode_blend_items`)
also verified byte-exact.

**Separate content-accuracy break** (HIGH-F1): the overlap rationale
in the original substrate commit mischaracterized SS's own evaluator
behavior. The cite-discipline streak counter is specifically for
Blender-citation fabs; the content-accuracy class is a sister
contract that this slice broke + fixed in the same audit-fix sweep.

Fab streak (Blender citations only): 5.P broke at 0 → 3.F HOLDS at 1
→ 3.G HOLDS at 2 → 4.A HOLDS at 3 → 4.B HOLDS at 4 → 4.C HOLDS at 5
→ **4.D.1 BROKE** → reset → **4.D.2 HOLDS at 1**.

## Dual-audit findings (commit `35367c2`)

### Architecture (1 HIGH Rule №1 + 2 MED + 2 LOW addressed)

- **HIGH-A5 (Rule №1)**: Track reorder claimed in scope, ops layer
  shipped + tested, JSX imported but no handler. **Fix**: wired
  TrackDragState + label-column onPointerDown + commit via
  `applyReorderTrack` inside `updateProject(recipe)`. Visual feedback
  + live ruler readout.

- **MED-A6**: ResizeObserver `useEffect([], [])` attached once on
  initial mount; empty→populated transition left observer attached
  to unmounted element. **Fix**: callback-ref pattern
  (`setContainerRef`) re-attaches automatically on every container
  mount/unmount.

- **MED-A7**: Dual-pane double-commit (both instances' document
  pointerup listeners fire commit). **Fix**: module-level Symbol
  `currentDragOwner` gates commit on instance identity.

- **LOW-A8**: JSX preview used literal `1` for min-strip clamp
  instead of importing `MIN_STRIP_MS`. **Fix**: imported + referenced.

- **LOW-A9**: Dead `applyReorderTrack` import. Auto-fixed by HIGH-A5.

### Fidelity (1 HIGH content + 2 MED addressed)

- **HIGH-F1 (content accuracy)**: Module-level "no-overlap" rationale
  claimed "higher-track strip wins at the overlap region via the
  bottom-to-top stack walk" — wrong. SS's evaluator goes through
  `applyBlendMode` uniformly; only upper REPLACE with influence=1
  fully occludes lower. **Fix**: rewrote rationale to accurately
  describe `evaluateNla` behavior + documented the audit-fix correction.

- **MED-F1**: Drag-handle width 6px not documented as SS-original.
  Blender has no separate edge-resize hitbox (uses transform modal).
  **Fix**: module JSDoc now cites `nla_select.cc:280-285` strip-pick
  tolerance ±7px + notes SS adds the hitbox as mouse-first UX.

- **MED-F2**: One-undo-per-drag pattern cite missing. **Fix**: cited
  Blender's modal-operator `OPTYPE_UNDO` pattern per
  `nla_select.cc:584`.

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_nlaEditorOps.mjs (NEW this slice) | n/a | 64 | +64 |

**New Phase 4 cumulative assertions: 185 (v42) + 86 (nlaEval) +
75 (nlaTweakMode) + 56 (nlaEditorData) + 64 (nlaEditorOps) = 466.**

## Files touched (commits `151cea0` + `35367c2`)

| File | Purpose |
|------|---------|
| src/v3/editors/nla/nlaEditorOps.js | NEW — pure-function drag ops + helpers |
| src/v3/editors/nla/NLAEditor.jsx | substantial rewrite + audit-fix |
| scripts/test/test_nlaEditorOps.mjs | NEW — 64 asserts across 18 sections |
| package.json | test:nlaEditorOps wiring |

## SS deviations (Phase 4 cumulative now 10; +2 this slice)

This slice introduces **2 new** documented SS deviations:

9. **No overlap enforcement** (`nlaEditorOps.js:36-67`). Blender's
   `nlastrip_fix_resize_overlaps` (nla.cc:1616+) shifts neighbor
   strips on resize; SS does not. Overlapping strips are
   evaluator-valid via `applyBlendMode`.

10. **6px edge-resize hitbox is SS-original**. Blender's NLA editor
    has no equivalent — resize via transform modal (G/S keys).

Inherited from 4.A/4.B/4.C/4.D.1 unchanged: 8 deviations.

## Plan-doc + MEMORY updates

- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4 ship-status
  banner: "5/7 sub-slices SHIPPED"; cite-discipline "HOLDS at 1
  post-reset".
- `MEMORY.md` `project_blender_parity_plans_in_flight` index entry
  updated with 4.D.2 details.

## Top queued path next

**Slice 4.D.3 — affordances** (~2 days projected):

- Per-track Mute/Solo toggle clickable indicators (replace 4.D.1
  read-only letter badges)
- Per-strip blend-mode dropdown (uses `BLENDMODE_LABELS` from 4.D.1
  + Slice 4.A's `NLA_BLEND_MODES`)
- "Edit Action" button per strip → calls Slice 4.C `enterTweakMode`
- "Exit Tweak" button at the group header when in tweak mode →
  calls Slice 4.C `exitTweakMode`
- Per-strip influence slider (0..1)
- Letter badges (S/M/P/D) → Lucide icons per audit-fix 4.D.1 MED-F1
  re-litigation gate

Slice 4.D.3 finally wires the Slice 4.C tweak-mode helpers into the
UI surface. After 4.D.3, the tweak-mode workflow is end-to-end
user-driven.

---

**Commits this slice (2):**
- `151cea0` — feat(anim): Phase 4 Slice 4.D.2 — NLAEditor drag
  interactions
- `35367c2` — fix(audit): Phase 4 Slice 4.D.2 audit-fix — 1 HIGH
  Rule№1 + 1 HIGH content + 4 MED + 2 LOW; cite-discipline holds at 1

**Phase 4 progress: 5/7 sub-slices.**

**Closes:** 0 grievances (UI-only; full Phase 4 closes 1 grievance
— "no NLA stack"). Strip + track drag now end-to-end user-driven;
ready for 4.D.3 affordances layer.
