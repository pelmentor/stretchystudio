# Animation Phase 5 — Slice 5.HH close-out

**Date**: 2026-05-18
**Commits**: `ca11206` (substrate + close-out in one) → (this doc)
**Path #46 from Phase 5 queue** — *Preferences panel UI surface* — SHIPPED.

## What the path was

> "46 | Preferences panel UI surface (closes 5.AA Dev 4) | queued"
> — from Slice 5.AA close-out

Slice 5.AA Dev 4 read:
> "No UI affordance for switching presets yet. Preference reachable
> only via `usePreferencesStore.getState().setKeymapPreset(...)` from
> dev console. A Preferences panel is queued for a future slice."

## What shipped

Adds a "Keymap preset" Section to the existing PreferencesModal
(between "Keyboard" and "Language"). Surfaces all 3 presets shipped
in Slices 5.AA + 5.GG via a Select dropdown + explanatory note.

| Capability | Where |
|------------|-------|
| Section JSX with Select + note | `src/v3/shell/PreferencesModal.jsx` after the Keyboard section |
| Subscribe to `keymapPreset` + `setKeymapPreset` | same |
| Import `KEYMAP_PRESETS` from helper | same |
| 5 new EN i18n strings (label + 3 options + note) | `src/i18n/index.js` |
| 5 new RU translations | `src/i18n/locales/ru.js` (matches user's Russian-speaking locale per project memory) |

## Why no substrate audit

Same convention as Slice 5.Z, 5.CC, 5.FF, 5.GG: gap closure against
pre-audited helpers + an existing UI surface.

- The keymap-preset substrate (helper, coerce, resolver, store
  integration) is pre-audited (Slice 5.AA dual-audit, 14 findings
  all closed).
- The PreferencesModal is an established UI surface with the
  Section/Select/note pattern (mlEnabled, useNumericInputAdvanced,
  Language all follow this shape).
- No new modules, no new pure helpers, no new schema fields.
- Pure additive UI wiring (~40 lines including i18n).

## UX flow

1. User opens Preferences (existing entry point — modal already
   triggered from somewhere in the shell).
2. Scrolls to the new "Keymap preset" Section between "Keyboard"
   and "Language".
3. Picks one of three options from the Select dropdown.
4. The setter (`setKeymapPreset`) writes through the single-coercion
   point + persists to localStorage (`v3.prefs.keymapPreset`).
5. Next keypress in FCurveEditor reads the new preset value via
   `usePreferencesStore.getState().keymapPreset` (no React
   subscription needed; established pattern from 5.AA).

## UI labels

| Preset value          | EN label                          | RU label                            |
|-----------------------|-----------------------------------|-------------------------------------|
| `default`             | Blender Default (toggle)          | Blender по умолчанию (с toggle)     |
| `default_no_toggle`   | Blender Default (no toggle)       | Blender по умолчанию (без toggle)   |
| `industry_compatible` | Industry Compatible               | Industry Compatible                 |

Note (EN): "Controls the channels-region select-all triplet (A /
Alt+A / Ctrl+I in the F-Curve sidebar). 'Toggle' matches SS's
pre-2026-05 behavior; 'no toggle' is Blender's byte-faithful
out-of-box default; 'Industry Compatible' mirrors Maya-style Ctrl+A
bindings."

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:keymapPresets | 63/63 (unchanged) |
| test:preferencesStore | 62/62 (unchanged) |

This slice adds UI only; the behavioral substrate is pre-audited and
fully tested. No new test file — the UI itself is a manual-test
surface (a dropdown that writes to a pre-tested setter).

## Queued paths (post-5.HH)

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
| 48  | Wire more preset-aware bindings to the resolver pattern        | **NEW TOP for substrate-style ships** (would extend `keymapPresets.js` resolver pattern to box-select, delete, hide/reveal, etc.) |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |

## Lessons

1. **Existing UI surfaces compound.** PreferencesModal was already
   restored in v3 Phase 1H and gained the AI/Input sections in
   Slice 5.U. Adding the 3-preset Keymap selector took ~40 lines
   total because the Section/Select pattern was established — no
   new component scaffolding needed. Lesson: invest in shared UI
   surfaces (modals, panels) when first added; downstream additions
   ride the convention.

2. **i18n at point-of-add is cheaper than i18n later.** Slice 5.HH
   added 5 EN + 5 RU strings at the same time. If i18n were
   deferred, future translators would have to hunt through diffs to
   find the strings. The marginal cost of adding RU alongside EN is
   ~5 minutes; the cost of doing it later is unpredictable. Lesson:
   when a project already has translations for sibling strings, add
   the new translation in the same commit as the new EN string.

3. **The 5-slice gap-closure streak (5.Z/5.CC/5.FF/5.GG/5.HH) shows
   the substrate investment paid off.** Slice 5.AA shipped the
   resolver substrate + dual-audited (14 findings). The 4 follow-up
   gap closures (5.GG third preset, 5.HH UI surface) plus 2
   sister-pattern slices closed Slice 5.AA's queued deviations
   without any further substrate work. Lesson: a well-audited
   substrate is a multiplier on follow-up productivity.

4. **i18n labels for enum values should be SS-friendly, not
   verbatim Blender enum names.** "Blender Default (toggle)" reads
   better than "default". "Blender Default (no toggle)" reads
   better than "default_no_toggle". The internal enum stays
   programmer-readable; the UI labels are human-readable. Lesson:
   user-facing labels and internal enum values are two different
   things; map between them at the i18n layer.
