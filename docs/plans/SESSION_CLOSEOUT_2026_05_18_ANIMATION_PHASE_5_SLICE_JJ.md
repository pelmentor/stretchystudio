# Animation Phase 5 — Slice 5.JJ close-out

**Date**: 2026-05-18
**Commits**: `8006bde` (substrate + close-out in one) → (this doc)
**Path #56 from Phase 5 queue** — *`resolveHideRevealAction`* — SHIPPED.

## What the path was

> "56 (NEW from 5.II) | `resolveHideRevealAction` — default
> H/Shift+H/Alt+H vs IC Ctrl+H/Shift+H. Sister-pattern to 5.II"
> — from Slice 5.II close-out

Second extension of the resolver pattern after Slice 5.II's
channel-delete. Path #48 (the umbrella "wire more preset-aware
bindings") is now mostly closed for FCurveEditor's
channels + graph regions.

## Blender divergence verified

| Preset                | Hide selected | Hide unselected | Reveal |
|-----------------------|---------------|-----------------|--------|
| `default`             | H             | Shift+H         | Alt+H  |
| `default_no_toggle`   | H             | Shift+H         | Alt+H  |
| `industry_compatible` | Ctrl+H        | Shift+H         | Alt+H  |

Sources:
- `blender_default.py:1967` → `_template_items_hide_reveal_actions`
  at `:461-466`
- `industry_compatible_data.py:919-923`

**Shift+H and Alt+H are SHARED** across all 3 presets. Only "hide
selected" differs (bare H in default, Ctrl+H in IC). Sister-pattern
to Slice 5.II's channel-delete shape (DEL shared, X-vs-Backspace
divergent).

## What shipped

| Capability | Where |
|------------|-------|
| `resolveHideRevealAction(preset, e) → 'hide_selected' \| 'hide_unselected' \| 'reveal' \| null` | `src/anim/keymapPresets.js` ~line 300 |
| 27 new test assertions (115 total, was 88) | `scripts/test/test_keymapPresets.mjs` |
| FCurveEditor's 3-branch H-key ladder collapsed to single resolver dispatch | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 2776 |

## Implementation notes

1. **Short-circuit non-H presses** — `if (e.code !== 'KeyH') return null;`
   at the top. Avoids per-preset branching overhead for every
   keystroke.

2. **Shared bindings checked BEFORE preset split** — Alt+H and
   Shift+H are identical across all 3 presets. The resolver checks
   them first for clarity + minor perf.

3. **`'default_no_toggle'` inherits default hide/reveal** — sister
   to Slice 5.II's channel-delete inheritance. Only the select-all
   triplet differs between `'default'` and `'default_no_toggle'`
   per Slice 5.GG.

4. **macOS Cmd treated as Ctrl-equivalent** — per the Slice 5.AA
   HIGH-A2 audit deviation framing (web/DOM convention, NOT a
   Blender port; Blender keeps `KM_OSKEY` distinct from `KM_CTRL`).
   So Cmd+H on macOS in IC preset resolves to `'hide_selected'`.

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:keymapPresets | 115/115 (was 88; +27 5.JJ assertions) |
| test:fcurveChannelSelect | 274/274 (unchanged) |

## SS deviations from Blender

None new. This slice closes a documented preset divergence without
introducing new ones.

## Queued paths (post-5.JJ)

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
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (5.Y Dev 3)      | low-priority                      |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | **NEW TOP for one-slice ships** |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |
| 57  | Graph-region select_box B (default) vs Q (IC) keybinding      | queued (downstream of #55)        |

## Lessons

1. **The shared+divergent pattern repeats.** Slice 5.II
   (channel-delete: DEL shared, X-vs-Backspace divergent) and 5.JJ
   (hide/reveal: Shift+H + Alt+H shared, H-vs-Ctrl+H divergent)
   both have the same shape: some bindings are universal across
   presets, others differ. The resolver handles this cleanly by
   checking shared bindings FIRST, then per-preset split. Lesson:
   when porting Blender keymap families, identify shared bindings
   vs preset-divergent ones — share the common checks, branch only
   the divergent ones.

2. **Refactor + extend in the same slice keeps comments accurate.**
   The pre-5.JJ FCurveEditor handler had 3 separate `if (e.code ===
   'KeyH' && ...)` blocks with their own Blender citations. The
   resolver-driven dispatch collapses them to ONE block — and the
   comment above it now cites BOTH presets in a single table.
   Comments don't get stale because there's only one place to
   update. Lesson: when collapsing a ladder of similar conditions,
   the savings aren't just LOC — they're maintenance-cost
   reduction.

3. **7-slice gap-closure streak validates the resolver substrate
   investment.** Slice 5.AA (resolver substrate + dual-audit, 14
   findings) enabled 7 follow-up closures: 5.GG (third preset),
   5.HH (UI surface), 5.II (channel-delete), 5.JJ (hide/reveal),
   plus 3 sister-pattern slices (5.Z, 5.CC, 5.FF, 5.HH closures).
   Each ships as a single commit, no further audits needed.
   Lesson: a well-audited substrate is a productivity multiplier
   over time — measure ROI in slices-enabled, not LOC-shipped.

4. **Multi-binding-family resolver scale check.** keymapPresets.js
   now exports 3 resolvers: `resolveSelectAllAction`,
   `resolveChannelDeleteAction`, `resolveHideRevealAction`. Each is
   ~30 LOC. The module is ~370 LOC total. Still under the
   "consider splitting" threshold (~500 LOC) but worth monitoring.
   If 2+ more resolvers ship, splitting into per-family files might
   be worth a substrate slice. Lesson: track module growth across
   sister extensions; refactor when the file becomes harder to
   navigate than it was when the substrate shipped.
