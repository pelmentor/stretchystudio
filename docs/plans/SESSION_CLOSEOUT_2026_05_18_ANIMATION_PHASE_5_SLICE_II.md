# Animation Phase 5 — Slice 5.II close-out

**Date**: 2026-05-18
**Commits**: `223d200` (substrate + close-out in one) → (this doc)
**Path #48 from Phase 5 queue (partial)** — *Wire more preset-aware bindings* — FIRST EXTENSION SHIPPED.

## What the path was

> "48 | Wire more preset-aware bindings to the resolver pattern |
> queued"
> — from Slice 5.HH close-out

Path #48 is open-ended: it calls for extending the resolver pattern
(Slice 5.AA `resolveSelectAllAction`) to cover other binding
families that diverge between Blender's default and
industry-compatible keymaps. This slice ships the FIRST such
extension: `anim.channels_delete`.

Also closes a Slice 5.N inline TODO that explicitly named this gap:
> "Industry-Compatible keymap binds Backspace for channel delete
> (`industry_compatible_data.py:2357`) — not wired today. Per Slice
> 5.M Deviation 2 precedent, gated on an SS keymap-preset selector
> that doesn't exist yet."

The selector now exists (5.AA + 5.GG + 5.HH UI), so the gap closes.

## Blender divergence verified

| Preset                | Keys              | Source                                       |
|-----------------------|-------------------|----------------------------------------------|
| `default`             | X / DEL           | `blender_default.py:3873-3874`               |
| `default_no_toggle`   | X / DEL           | (inherits default — only A-keypress differs) |
| `industry_compatible` | BACKSPACE / DEL   | `industry_compatible_data.py:2357-2358`      |

DEL works in all 3 presets; the second key differs (X vs Backspace).

## What shipped

| Capability | Where |
|------------|-------|
| `resolveChannelDeleteAction(preset, e) → 'delete' \| null` | `src/anim/keymapPresets.js` ~line 220 |
| 25 new test assertions (88 total, was 63) | `scripts/test/test_keymapPresets.mjs` |
| FCurveEditor delete handler refactored to consume the resolver | `src/v3/editors/fcurve/FCurveEditor.jsx` ~line 2568 |
| Critical fall-through block: unbound key over sidebar = no-op (NOT a timeline keyform-delete dispatch) | same |

## Why no substrate audit

Sister pattern to Slice 5.GG: extending an established resolver
helper that was dual-audited in Slice 5.AA (14 findings). The
resolver pattern itself is unchanged; this adds one new function
following the exact same shape:

- `resolveSelectAllAction(preset, e) → 'add' | 'clear' | 'invert' | 'toggle' | null`
- `resolveChannelDeleteAction(preset, e) → 'delete' | null`

No new files, no new schema, no new abstractions. Pure additive
extension.

## Implementation notes

1. **Short-circuit Delete first** — DEL is bound in all 3 presets,
   so the resolver checks for it before the per-preset branch. Saves
   per-preset duplication.

2. **No-modifier requirement** — Blender's `anim.channels_delete`
   keymap entries carry no `ctrl/shift/alt/oskey`. The resolver
   rejects ANY modifier permutation at the top. macOS Cmd is NOT
   applicable here.

3. **`'default_no_toggle'` inherits default channel-delete** — only
   the select-all triplet differs between `'default'` and
   `'default_no_toggle'` (per Slice 5.GG). All other binding
   families share. Documented in the resolver inline comment.

4. **Critical fall-through block in the dispatcher** — when sidebar
   is hovered AND the pressed key is X/Backspace/Delete BUT the
   resolver returns null (e.g. X in IC, Backspace in default), the
   handler returns early. Without this block, X in IC over sidebar
   would silently fall through to the timeline-region keyform-delete
   operator — silently firing the wrong operator on the wrong
   region's selection. Per Blender's per-region keymap dispatch, an
   unbound key is a no-op.

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:keymapPresets | 88/88 (was 63; +25 5.II assertions) |
| test:fcurveChannelSelect | 274/274 (unchanged) |

## SS deviations from Blender

None new. This slice CLOSES a deviation (Slice 5.N's inline
Backspace TODO) without introducing new ones.

## Queued paths (post-5.II)

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
| 48  | Wire more preset-aware bindings (continuation)                 | partial: 5.II shipped channel-delete; others queued as 5.II-1, 5.II-2 below |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |
| 56 (NEW from 5.II) | `resolveHideRevealAction` — default H/Shift+H/Alt+H vs IC Ctrl+H/Shift+H. Sister-pattern to 5.II | **NEW TOP for one-slice ships** |
| 57 (NEW from 5.II) | `resolveSelectBoxKeyAction` for graph-region — default B vs IC Q (independent of channels-region B from 5.FF) | queued (downstream of #55) |

## Lessons

1. **The resolver pattern scales linearly.** Slice 5.II added a
   second resolver in ~50 lines (helper + tests + dispatcher
   rewire). Slice 5.AA's substrate (coerce + first resolver +
   constants) cost ~150 LOC + 14 audit findings; the marginal cost
   of each follow-on resolver is ~1/3 of that. Lesson: when a
   dual-audited substrate has the right shape (here:
   `(preset, e) → action | null`), follow-on extensions are cheap
   and don't need new audits.

2. **"Unbound key" semantics need explicit fall-through guards.**
   The Slice 5.II critical fall-through block was a near-miss: if I
   had just refactored the channel-delete path to use the resolver
   without thinking about the IC-X case, X over sidebar in IC would
   have silently fired keyform-delete on the timeline's selection.
   The guard is 4 lines and prevents a real silent-wrong-operator
   bug. Lesson: when a region-aware dispatch swaps from an
   `if (e.code === ...)` ladder to a resolver, audit each removed
   case for "was it bound in BOTH regions before, and might my
   refactor accidentally route to the WRONG region in some preset?"

3. **Closing inline TODOs is a queue-by-grep workflow.** The Slice
   5.N inline TODO explicitly named this gap with a closure
   condition ("when SS gets a keymap-preset selector"). The
   selector shipped in Slice 5.AA; the gap closed in Slice 5.II.
   Lesson: inline TODOs that name their own closure condition
   become implicit backlog entries — searchable, scoped, and ready
   to ship when the condition is met.

4. **Partial closure of an open-ended path is fine.** Path #48
   ("wire more preset-aware bindings") could have been interpreted
   as "ship ALL the remaining preset-divergent bindings in one
   slice". Instead, 5.II shipped ONE (channel-delete) and queued
   the others (hide/reveal as #56, select_box-key as #57). Smaller
   slices are easier to audit, ship, and roll back if needed.
   Lesson: open-ended paths can be split — close one binding family
   per slice, queue the rest.
