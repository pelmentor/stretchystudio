# Animation Phase 5 — Slice 5.AA close-out

**Date**: 2026-05-17
**Commits**: `0dddf3e` (substrate) → `ae04653` (audit-fix sweep) → (this doc)
**Path #15 from Phase 5 queue** — *SS keymap-preset selector* — SHIPPED.

> **Note on skipping #13/#14**: Path #13 (Phase 2 owed-manual verification)
> is user-side-only (visual inspection in Cubism Viewer + UI K-hotkey),
> not autonomously ship-able. Path #14 (Phase 3 F-Curve modifiers,
> full phase) is multi-week scope. Per `feedback_dont_ask_keep_shipping`,
> skipped both to ship #15 in one slice.

## What the path was

> "SS keymap-preset selector — Slice 5.K MED-A1 documented that
> industry-compatible keymap remaps select-all to Ctrl+A / Ctrl+Shift+A
> / Ctrl+I but is 'not wired today (SS hasn't adopted the industry
> keymap variant elsewhere either)'. Close that gap."
> — from Slice 5.Y close-out queued paths (carried forward from 5.K)

## What shipped

Ports Blender's Edit → Preferences → Keymap dropdown. Supports the
same two presets Blender ships by default:

  - `'default'`              → `keymap_data/blender_default.py`
  - `'industry_compatible'`  → `keymap_data/industry_compatible_data.py`

Switching at runtime swaps the binding map consulted by the pure
helper `resolveSelectAllAction(preset, e)`. First call site wired:
the FCurveEditor select-all triplet (sidebar + graph regions).

| Capability | Where |
|------------|-------|
| `preferencesStore.keymapPreset` scalar slot (`'default'` \| `'industry_compatible'`) + setter | `src/store/preferencesStore.js` (KMP_KEY const + slot + setter; init+setter route through `coerceKeymapPreset`) |
| Pure resolver module + KEYMAP_PRESETS / KEYMAP_PRESET_DEFAULT constants + coerceKeymapPreset | `src/anim/keymapPresets.js` (NEW, ~190 LOC post-audit-fix) |
| `resolveSelectAllAction(preset, e) → 'toggle' \| 'add' \| 'clear' \| 'invert' \| null` | same — treats macOS Cmd as Ctrl-equivalent (web/DOM convention, NOT Blender port) |
| FCurveEditor sidebar branch: 12 lines of inline modifier checks → single `resolveSelectAllAction` call | `FCurveEditor.jsx` ~line 2480 |
| FCurveEditor graph branch: same collapse + new `'add'` arm (IC: Ctrl+A → unconditional select-all, no toggle) | `FCurveEditor.jsx` ~line 2520 |
| Tests: keymapPresets (44 → 45 post-LOW-1), preferencesStore (+6 5.AA assertions) | `scripts/test/test_keymapPresets.mjs` (NEW), `test_preferencesStore.mjs` |
| `package.json`: registered `test:fcurveBoxSelect` (missed in 5.Y) + `test:keymapPresets`; both in aggregate `test` chain | |

## Substrate (`0dddf3e`)

| File | Status | Role |
|------|--------|------|
| `src/anim/keymapPresets.js` | NEW (~150 LOC substrate, ~190 post-fix) | Pure resolver module + module header with Blender provenance |
| `scripts/test/test_keymapPresets.mjs` | NEW | 44 assertions (substrate) → 45 (post-audit-fix LOW-1) |
| `src/store/preferencesStore.js` | refactored | KMP_KEY const + JSDoc + slot + setter |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | refactored | Import + sidebar branch (collapsed 12 lines → 8) + graph branch (collapsed 18 lines → 14 with new 'add' arm) |
| `scripts/test/test_preferencesStore.mjs` | + 6 assertions | Coverage for new slot + setter |
| `package.json` | + 2 entries | `test:fcurveBoxSelect` (missed in 5.Y) + `test:keymapPresets` |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 3   | 3   | 6     |
| Blender fidelity | 2    | 3   | 3   | 8     |
| **Combined**     | **2** | **6** | **6** | **14** |

**Fab streak HELD** (zero fab cites — last break 5.Y). Both HIGH
findings were **semantic-deviation-not-flagged-as-deviation**, fixable
via JSDoc edits without behavior change. Same pattern as 5.W's two
HIGH findings (also semantic overclaims of real cites, not fabs).

## Audit-fix sweep (`ae04653`)

All HIGH + all MED + 3 of 5 LOW addressed.

### Blender-fidelity findings

**HIGH-A1 — Toggle-branch framed as Blender default.** Module JSDoc
claimed "blender_default.py — historical Blender bindings (A toggles
selection, Alt+A deselects, Ctrl+I inverts)". But Blender's
out-of-the-box default-config (`blender_default.py:115`
`use_select_all_toggle=False`) emits A → SELECT (`:423`), Alt+A →
DESELECT (`:424`), Ctrl+I → INVERT (`:425`), A_DOUBLE_CLICK →
DESELECT (`:426`). The toggle branch at `:435-439` is opt-in. SS
picks toggle because FCurveEditor's pre-5.AA behavior was already
toggle-on-A — but that's an SS deviation, not Blender default.
**Fix**: rewrote "Why two presets" section with explicit deviation
header + future-byte-faithful escape hatch (third preset
`'default_no_toggle'` or sub-preference).

**HIGH-A2 — metaKey-as-Ctrl framed as Blender port.** Claimed "macOS
Cmd treated as Ctrl-equivalent" as if it mirrored Blender. Actually
Blender keeps `KM_CTRL` and `KM_OSKEY` distinct
(`wm_event_system.cc:2470-2471`). SS's collapse is a web/DOM
convention (Cmd-as-Ctrl is the established cross-platform shortcut
idiom in browser apps). **Fix**: rewrote EventLikeKeyState `metaKey`
property doc + resolver JSDoc to flag as SS web-ergonomics deviation.

**MED-A1+A2 — Cite range too broad.** `:420-439` is the whole
`_template_items_select_actions` function spanning 3 config branches
(no-toggle `:422-427`, legacy `:430-433`, toggle `:435-439`). SS only
mirrors the toggle branch. **Fix**: narrowed cite to `:435-439`
(toggle branch only) in both module JSDoc and resolver inline comment;
added per-line cites for individual bindings (`:436` `:437` `:438`).

**MED-B1 — Vague directory pointer.** preferencesStore JSDoc cited
the `keymap_data/` directory. **Fix**: narrowed to two specific
.py files + user-facing dropdown source
(`scripts/presets/keyconfig/Blender.py`).

**LOW-A1 — A_DOUBLE_CLICK omission undocumented.** Blender's no-toggle
branch also binds A_DOUBLE_CLICK → DESELECT (`:426`). SS omits this
because web KeyboardEvent has no clean keyboard-double-press semantic
— Blender's row only fires from mouse double-click on macOS anyway.
**Fix**: documented in module JSDoc.

**LOW-A2 (no action)** — duplicate of arch MED-2; addressed by single
coercion site fix.

**LOW-A3 (no action)** — line-wrap note for `:964-965` cite. Cite
itself is accurate; the note would add minor clarity but isn't
load-bearing.

### Architecture findings

**MED-1 — Graph branch's toggle uses different selection scope.** The
'toggle' arm uses `selectionRef.current.size` (keyform-handle count)
as the "any selected" signal — STRUCTURALLY DIFFERENT from the
sidebar's `applyChannelSelectAll(action, 'toggle', ctx)` which scans
channel-level selection. Pre-existing by design (two regions operate
on distinct selection states), but not flagged in the comment block.
**Fix**: added explicit note.

**MED-2 + fidelity LOW-A2 — Three independent coercion sites.** Setter
inline ternary, init inline ternary, and `coerceKeymapPreset` resolver
helper all coerced independently. Adding a third preset later would
require updating three sites. **Fix**: setter + init now route through
`coerceKeymapPreset`; adding a preset requires only updating
`KEYMAP_PRESETS` + `coerceKeymapPreset` in `keymapPresets.js`;
preferencesStore.js stays untouched.

**MED-3 — Graph branch 4-arm if-chain.** Each arm had its own
`preventDefault()` + `return`. **Fix**: collapsed to single null-gate
matching the sidebar branch's shape so adding new actions requires
editing one dispatch table.

**LOW-1 — Test asymmetry.** IC block tested only `Ctrl+I` for invert
while default block tested both `Ctrl+I` and `Cmd+I`. **Fix**: added
`Cmd+I (macOS) → invert` IC assertion. 45 total (was 44).

**LOW-2 (no action)** — localStorage namespace check (already
consistent with `v3.prefs.*` convention).

**LOW-3 (no action)** — `getState()` per-keypress pattern is the
established convention (matches `numericInputAdvanced` at line ~1649),
synchronous and race-free.

## SS deviations from Blender (formally documented this slice)

1. **Default preset picks toggle branch (not no-toggle default).**
   Mirrors pre-5.AA FCurveEditor behavior. Future-byte-faithful path:
   third preset `'default_no_toggle'` or sub-preference wiring
   `use_select_all_toggle` through.

2. **metaKey treated as Ctrl-equivalent.** Browser DOM convention,
   not Blender's KM_CTRL/KM_OSKEY distinction. Cross-platform web
   shortcut ergonomics; macOS users get the same bindings without
   per-platform branching at the call site.

3. **A_DOUBLE_CLICK omitted from default preset.** Web KeyboardEvent
   has no clean keyboard-double-press semantic; Blender's row only
   fires from mouse double-click on macOS anyway.

4. **No UI affordance for switching presets yet.** Preference reachable
   only via `usePreferencesStore.getState().setKeymapPreset(...)` from
   dev console. A Preferences panel is queued for a future slice.

5. **No `OPTYPE_UNDO` snapshot.** Inherited from Slice 5.F/5.K
   convention — channel selection is view state, not document state.

## Queued paths (post-5.AA)

Carrying forward + reordered. Top for next "Go": **#35 — Group-children
select operator (Shift+Ctrl+click)** — concrete, closes a 5.V deferral.

| Path | Title | Status |
|------|-------|--------|
| 13  | Phase 2 owed-manual verification                              | USER-SIDE (visual inspection in Cubism Viewer + UI K-hotkey) |
| 14  | Phase 3 — F-Curve modifiers (full phase, ~weeks)              | queued                            |
| ~~15~~ | ~~SS keymap-preset selector~~                              | **SHIPPED THIS SLICE**            |
| 16-27 | (other Phase 5 polish + carry-overs)                        | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| 35  | Group-children select operator (Shift+Ctrl+click)             | **NEW TOP for one-slice ships**   |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 40  | `applyChannelSelect.change_active=true` branch (closes 5.X Dev 1) | queued                        |
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | queued                            |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |
| 43  | B-key invocation entry for box-select (closes 5.Y Dev 1)      | queued                            |
| 44  | Split `ctx` into `preClearIds` + `inRectIds` (closes 5.Y Dev 3) | queued                          |
| 46 (NEW) | Preferences panel UI surface (closes 5.AA Dev 4 — surfaces keymap switch + future preference toggles) | queued |
| 47 (NEW) | Third preset `'default_no_toggle'` OR sub-preference for `use_select_all_toggle` (closes 5.AA Dev 1) | queued |
| 48 (NEW) | Wire more preset-aware bindings to the resolver pattern: box-select, delete, hide/reveal | queued |

## Lessons

1. **Fab streak held at substrate volume.** Slice 5.AA shipped 8+
   Blender cites across module JSDoc + inline comments + preferencesStore
   + FCurveEditor wires; the fidelity audit verified every one against
   the reference clone with no fab. Sister-pattern to 5.W/5.X (both
   held streak with all-real cites + semantic-overclaim HIGH findings).
   Lesson: pre-verify per-cite discipline scales when the cites are
   load-bearing — the 5.Y break was a single throw-away constant name,
   not a load-bearing cite.

2. **Semantic-deviation-not-flagged-as-deviation is a recurring HIGH
   pattern.** Slice 5.W audit: 2 HIGH = semantic overclaims of real
   cites (not fabs). Slice 5.X audit: 1 HIGH = same. Slice 5.AA
   audit: 2 HIGH = same. Three slices in a row, the same pattern.
   Lesson: when writing a module-header section that names a Blender
   default behavior, explicitly check whether SS matches that default
   or deviates from it. If deviates, FLAG IT in the same paragraph,
   not in a separate "Deviations" section that readers might miss.

3. **Substrate slice with infrastructure value > narrow feature
   slice.** Slice 5.AA added one preference + one resolver module +
   wired one binding family — but the resolver module is reusable for
   every future preset-aware binding family (box-select, delete,
   hide/reveal, etc.). Cost-to-value-over-time ratio favors substrate
   that enables follow-on work over narrow feature ships.

4. **The dispatcher's `getState()` pattern beats subscription for
   per-event reads.** `numericInputAdvanced` (Slice 5.U), `keymapPreset`
   (5.AA), and probably every future per-event preference read should
   use `usePreferencesStore.getState().X` inline in the handler. No
   ref, no subscription, no closure capture — synchronous, race-free,
   and picks up live changes (devtools, second tab) without restart.

5. **Skipping user-blocked paths is the right call when shipping
   autonomously.** Path #13 (Phase 2 manual verification) sat at the
   top of the queue for 3 slices in a row. Per
   `feedback_dont_ask_keep_shipping`, the right move was to skip it
   and ship #15. The user gets the choice of when to do the manual
   verification asynchronously; autonomous progress doesn't stall on
   user-side blockers.
