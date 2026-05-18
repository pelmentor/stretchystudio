# Animation Phase 5 — Slice 5.EE close-out

**Date**: 2026-05-18
**Commits**: `433694d` (substrate) → `55b79c5` (audit-fix sweep) → (this doc)
**Path #42 from Phase 5 queue** — *Keyform-selection precondition on halo* — SHIPPED.

## What the path was

> "5.W-2 | Active-keyform halo doesn't enforce keyform-selection
> precondition (`graph_draw.cc:254`) | SS keyform selection lives in
> editor-local React; future cross-editor subscription or
> project-stored selection field"
> — from Slice 5.W close-out deviation list

## What shipped

Cross-editor publish/subscribe store for keyform-handle selection.
FCurveEditor (canonical owner of `selectedHandles` local React state)
publishes via `useEffect`; DopesheetEditor subscribes and gates the
active-keyform halo on the per-row center-bit-selected boolean. Closes
Slice 5.W-2 deviation by adding Blender's `bezt->f2 & SELECT` gate
from `graph_draw.cc:254` to SS's halo render path.

| Capability | Where |
|------------|-------|
| `useKeyformSelectionStore` Zustand store + `publishHandles(next)` + `__resetForTests` + pure `isKeyformCenterSelected(handles, fcurveId, keyformIdx)` helper | `src/store/keyformSelectionStore.js` (NEW, ~140 LOC post-fix) |
| Identity-stable setter (skips `set()` when ref-equal) | same |
| FCurveEditor publish via `useEffect` mirror (37 existing call sites untouched) | `FCurveEditor.jsx` ~line 645 |
| **Audit-fix HIGH-1**: cleanup return publishes empty Map on unmount | same |
| DopesheetEditor parent-level subscription + per-Row `isActiveKeyformSelected` prop | `DopesheetEditor.jsx` ~line 117, 152 |
| Row halo gate adds 3rd precondition (`bezt->f2 & SELECT` analog) | `DopesheetEditor.jsx` ~line 220 |
| 25 store assertions | `scripts/test/test_keyformSelectionStore.mjs` (NEW) |
| `package.json`: registered `test:keyformSelectionStore` + chain | |

## Substrate (`433694d`)

| File | Status | Role |
|------|--------|------|
| `src/store/keyformSelectionStore.js` | NEW (~120 LOC substrate, ~140 post-fix) | Zustand store + pure helper + module-header Blender provenance |
| `scripts/test/test_keyformSelectionStore.mjs` | NEW (25 assertions) | Default state, publishHandles replace + identity-stable skip, isKeyformCenterSelected guards + hit/miss + center-bit-only semantic + strict===true, __resetForTests |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | refactored | Import + publish useEffect mirror (zero touches to 37 existing setSelectedHandles call sites) |
| `src/v3/editors/dopesheet/DopesheetEditor.jsx` | refactored | Import + parent subscription + new Row prop + 3rd halo gate |
| `package.json` | +1 test entry + chain | |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 1    | 1   | 1   | 3     |
| Blender fidelity | 0    | 1   | 2   | 3     |
| **Combined**     | **1** | **2** | **3** | **6** |

**Fab streak HELD 6 slices in a row** post-5.Y break (5.W → 5.X →
5.AA → 5.BB → 5.DD → 5.EE). Zero fab cites.

The 1 HIGH was a REAL architectural bug (mirror staleness on
FCurveEditor unmount), not a documentation issue — caught by the
arch-audit agent's attention to React lifecycle.

## Audit-fix sweep (`55b79c5`)

All HIGH + all MED + 2 of 3 LOW addressed. LOW arch (`__resetForTests`
pattern) skipped — established convention across SS stores.

### Architecture HIGH-1 (real bug):

FCurveEditor's publish `useEffect` had no cleanup return. On unmount,
the Zustand store kept the last-published Map. If DopesheetEditor
stayed mounted alone in a split-view (e.g., user closed the FCurve
tab), it would read stale data and show halos for keyforms that
aren't actually selected in any live UI context.

**Fix**: the effect now returns `() => publishKeyformSelection(new Map())`.
The store's identity-different `set()` notifies subscribers in
lockstep with the unmount. Stale-data window closed.

### Architecture MED-1:

Added a comment block noting `publishKeyformSelection` is
identity-stable across renders (Zustand setter defined inside
`create()` is closure-stable at store construction). Documentation
gap — readers seeing `[selectedHandles, publishKeyformSelection]` in
deps might add a useless `useCallback` wrap.

### Fidelity MED-1: view-range gate documented (Deviation 5.EE-2)

Blender's `draw_fcurve_active_vertex` has a 4th gate at
`graph_draw.cc:251` (view-range cull). SS omits it because the
dopesheet row track is DOM-based (`overflow:hidden` auto-culls
off-screen keyforms via CSS), not a pixel-renderer. Off-track
diamonds invisible regardless of halo state. Documented as
Deviation 5.EE-2.

### Fidelity LOW-1: "3 bits" → "3 eBezTriple_Flag fields"

Blender's `f1/f2/f3` are multi-bit enums
(`BEZT_FLAG_SELECT | BEZT_FLAG_TEMP_TAG | ...`). SS's boolean collapse
is correct in the SELECT-bit scope, but the prior "3 bits" framing
was imprecise. Rewrote.

### Fidelity LOW-2: persistence cite

Added concrete cite for "Blender BezTriple selection persists":
`BKE_fcurve_blend_write_data` at `fcurve.cc:2581-2586` (write) +
`:2625-2629` (read). Strengthens Deviation 5.EE-1.

## SS deviations from Blender

1. **5.EE-1**: Keyform selection NOT persisted across save/load.
   Blender's BezTriple `f1/f2/f3` bits ARE persisted. Closing this
   would require either lifting state into the action draft (37+
   FCurveEditor writer touches) OR persisting the Map separately
   (save/load schema additions). Deferred.

2. **5.EE-2**: View-range halo gate (`graph_draw.cc:251`) omitted.
   SS's DOM-based dopesheet auto-culls off-screen keyforms via CSS;
   the gate is functionally redundant in SS's render model.

3. **Boolean collapse of multi-bit enum** — SS models only the SELECT
   bit; doesn't track BEZT_FLAG_TEMP_TAG or other transient bits.
   Equivalent for halo-gate purposes.

## Queued paths (post-5.EE)

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
| ~~42~~ | ~~Keyform-selection precondition on halo~~                 | **SHIPPED THIS SLICE**            |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | **NEW TOP for one-slice ships**   |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | queued                            |
| 47  | Third preset `'default_no_toggle'` (closes 5.AA Dev 1)        | queued                            |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (closes 5.DD LOW-2 arch) | queued |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53 (NEW) | Persist keyform selection to action draft (closes 5.EE-1 — Blender BezTriple `f1/f2/f3` parity) | queued (substrate scope — touches 37 writer sites in FCurveEditor or adds save/load schema) |

## Lessons

1. **Fab streak HELD 6 in a row.** 5.W/X/AA/BB/DD/EE all held. The
   per-cite verification discipline scales — even at substrate slice
   volume with 4-6 Blender cites per module header, the pre-verify
   step catches any drift before commit.

2. **React lifecycle bugs are a different audit category than
   semantic-port bugs.** Slice 5.EE's HIGH was a `useEffect` cleanup
   miss — visible only in the split-view / unmount scenario. The arch-
   audit agent's attention to React lifecycle (rather than Blender
   semantics) caught it. Lesson: when a slice has a "cross-component
   communication" aspect, the arch audit should explicitly include
   mount/unmount/remount lifecycle reasoning, not just data-flow
   correctness.

3. **Mirror pattern is the right answer when one editor owns state
   and others read it.** Full state lift would have touched 37+
   FCurveEditor call sites — high churn for zero observable benefit
   at the owner. The mirror via `useEffect` is 6 lines + 1 import +
   1 cleanup, achieves the same cross-editor visibility, and keeps
   the owner code intact. Lesson: "lift state to the store" isn't
   always the right answer; "publish state to a mirror store" is
   often better when ownership stays put.

4. **Identity-stable setter from Zustand `create()` is closure-
   stable.** Zustand defines setters inside the `create((set) => ({...}))`
   factory; they're created once at store construction. Having them
   in `useEffect` deps is a no-op for re-run frequency. SS's
   sister-pattern stores (preferencesStore, etc.) all use this
   pattern. Worth noting in the JSDoc when it appears in deps so
   readers don't add unnecessary `useCallback` wraps.

5. **The 4th gate question.** When porting a Blender draw function
   with multiple early-return gates, enumerate ALL of them and
   document any SS skips. Slice 5.EE omitted Blender's `:251`
   view-range gate; the audit caught it and we added Deviation
   5.EE-2. Without that documentation, a future reader might add the
   gate back unaware that SS's render model makes it redundant.
