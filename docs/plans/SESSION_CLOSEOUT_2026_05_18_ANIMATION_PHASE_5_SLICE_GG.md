# Animation Phase 5 — Slice 5.GG close-out

**Date**: 2026-05-18
**Commits**: `1a36987` (substrate + close-out in one) → (this doc)
**Path #47 from Phase 5 queue** — *Third preset `'default_no_toggle'`* — SHIPPED.

## What the path was

> "47 | Third preset `'default_no_toggle'` (closes 5.AA Dev 1) | queued"
> — from Slice 5.AA close-out

Slice 5.AA's HIGH-A1 audit-fix surfaced the deviation: the `'default'`
preset's A → TOGGLE mapping was framed as "Blender out-of-the-box
default", but Blender's actual out-of-the-box default-config
(`blender_default.py:115` `use_select_all_toggle=False`) emits A →
SELECT, not TOGGLE. The toggle branch at `:435-439` is opt-in. SS
chose toggle as default for UX discoverability; the byte-faithful
alternative was queued as path #47.

## What shipped

Third preset slot `'default_no_toggle'` that maps the
`blender_default.py:422-427` no-toggle branch:
- A → ADD (Blender `:423` SELECT_ADD)
- Alt+A → CLEAR (Blender `:424` SELECT_DESELECT)
- Ctrl+I → INVERT (Blender `:425` SELECT_INVERT)
- A_DOUBLE_CLICK (`:426`) omitted (web has no clean
  keyboard-double-press semantic)

| Capability | Where |
|------------|-------|
| `KeymapPreset` typedef extended to 3 values | `src/anim/keymapPresets.js` line 105 |
| `KEYMAP_PRESETS` constant: 3 entries | same ~line 125 |
| `coerceKeymapPreset` accepts new value | same ~line 145 |
| New `'default_no_toggle'` branch in resolver | same ~line 195 |
| Module header rewritten "Why two presets" → "Why three presets" with explicit SS-deviation framing | same ~line 20-70 |
| 18 new test assertions covering preset constants + coerce + resolver branches + critical differentiator block | `scripts/test/test_keymapPresets.mjs` |
| preferencesStore JSDoc updated to list 3 presets + source line ranges | `src/store/preferencesStore.js` |

## Why no substrate audit

Same convention as Slice 5.Z, 5.CC, 5.FF: **gap closure against
pre-audited helper**.

- Slice 5.AA's dual-audit (14 findings, both HIGH semantic-deviation-not-flagged-as-deviation
  fixes) covered the resolver's structure, cite discipline, and
  dispatcher wiring.
- This slice EXTENDS the resolver with one new preset branch +
  updates the enum. No new files, no new module, no schema changes,
  no behavior change for existing call sites.
- The single-coercion-point pattern (`coerceKeymapPreset`)
  established in 5.AA audit-fix MED-2 means the new preset value
  propagates automatically through `preferencesStore.setKeymapPreset`
  + init without any code changes there.

## UX semantic differentiators

| Preset                | A key   | Alt+A   | Ctrl+I   | Ctrl+A    | Ctrl+Shift+A |
|-----------------------|---------|---------|----------|-----------|--------------|
| `default`             | TOGGLE  | CLEAR   | INVERT   | (unbound) | (unbound)    |
| `default_no_toggle`   | ADD     | CLEAR   | INVERT   | (unbound) | (unbound)    |
| `industry_compatible` | (unbound)| (unbound)| INVERT  | ADD       | CLEAR        |

The critical differentiator is the bare A keypress: `default` toggles,
`default_no_toggle` selects-all unconditionally (matches Blender
out-of-box), `industry_compatible` doesn't bind bare A at all.

## Tests

| Test | Pass/Fail |
|------|-----------|
| test:keymapPresets | 63/63 (was 45; +18 5.GG assertions) |
| test:preferencesStore | 62/62 (unchanged — single coercion point) |

## SS deviations from Blender

No new deviations. This slice CLOSES a deviation (5.AA Dev 1) by
providing the byte-faithful third preset. The `'default'` preset
continues to be SS's UX-discoverable default (now documented
explicitly as an SS UX choice rather than misframed as Blender
out-of-box).

## Queued paths (post-5.GG)

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
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (5.Y Dev 3)      | low-priority (SS narrower scope is intentional UX) |
| 46  | Preferences panel UI surface (closes 5.AA Dev 4)              | **NEW TOP for one-slice ships** (would surface the keymapPreset toggle to users) |
| 48  | Wire more preset-aware bindings to the resolver pattern        | queued                            |
| 49  | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | queued |
| 50  | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap)              | queued                            |
| 51  | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | queued                        |
| 52  | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | queued                            |
| 53  | Persist keyform selection to action draft (closes 5.EE-1)     | queued (substrate scope)          |
| 54  | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | queued                            |
| 55  | Graph-region B binding → GRAPH_OT_select_box port (5.FF Dev 3)| queued (needs keyform box-select pipeline first) |

## Lessons

1. **Single-coercion-point pays dividends.** Slice 5.AA arch audit
   MED-2 caught 3 independent coercion sites and consolidated them
   into one (`coerceKeymapPreset`). Slice 5.GG adds a third preset
   value by changing ONLY that one helper + the resolver branch.
   Zero touches to the store body. Lesson: when an enum-coercion
   pattern surfaces, consolidate even if there are only 2 values
   today — the marginal cost is tiny; the marginal benefit on the
   next addition is real.

2. **Gap closures keep compounding.** Slice 5.AA shipped + audited
   the resolver substrate; 5.GG ships path #47 in ~30 minutes with
   no audit needed because the substrate's contract was
   established. The pre-audited substrate becomes a reusable
   foundation for future small additions — the value-over-time
   from the original substrate ship continues to compound.

3. **Documented deviations are queue entries.** Slice 5.AA Dev 1
   was documented in the close-out as deviation #1 with a closure
   condition ("third preset `'default_no_toggle'` or sub-preference
   wiring `use_select_all_toggle` through"). Slice 5.GG executed
   that exact closure. Lesson: when a deviation list entry has a
   concrete closure condition, treat it as a backlog item — the
   condition IS the spec.

4. **Critical differentiator tests prevent silent regressions.**
   The test block at the end (`default` vs `default_no_toggle` on
   plain A) explicitly asserts the only divergent binding between
   the two presets. If a future refactor accidentally collapses
   the two branches, the test fails loudly. Lesson: when two
   presets/modes differ in ONE specific way, write a test that
   explicitly asserts the divergence — not just the per-preset
   behavior.
