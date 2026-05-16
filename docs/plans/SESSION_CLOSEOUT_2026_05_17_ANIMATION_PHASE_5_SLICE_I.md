# Session Close-Out — Animation Phase 5 Slice 5.I (2026-05-17 evening)

Persistent `fcurve.hide` schema field — replaced FCurveEditor's
local-React `useState(new Set())` hidden-curve tracking with a
persisted boolean on each FCurve datablock. Sister to the
mute/selected/active triad from Slices 5.F/G/H.

## Commits

| SHA       | Subject                                                                                          |
|-----------|--------------------------------------------------------------------------------------------------|
| `3ae1486` | feat(anim): Animation Phase 5 Slice 5.I — persistent fcurve.hide (FCURVE_VISIBLE negative)       |
| `53e2477` | fix(audit): Animation Phase 5 Slice 5.I dual-audit sweep — 2 MED-A + 1 MED-B + 1 LOW-B           |
| (this)    | docs(plan): Animation Phase 5 Slice 5.I close-out                                                |

29th audit-fix sweep across the V3 Blender Parity work.

## What shipped

### `src/anim/fcurveVisible.js` (NEW, ~165 LOC)

Sparse-field helper, byte-for-byte structural mirror of
`src/anim/fcurveMute.js`:

```js
export function isFCurveHidden(fcurve) {
  return !!(fcurve && fcurve.hide === true);
}

export function toggleFCurveHidden(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { hiddenNow: false };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { hiddenNow: false };
  fc.hide = !isFCurveHidden(fc);
  return { hiddenNow: fc.hide === true };
}
```

Field naming follows Blender's Python RNA: `fcurve.hide` (negative of
the FCURVE_VISIBLE bit, via `RNA_def_property_boolean_negative_sdna`).
Sparse storage per Rule №2 — no migration ships because
missing-→-visible already reads correctly.

### `src/anim/fcurve.js` typedef extension

Added `[hide]` property with full Blender provenance citation
(DNA enum + RNA name + default behavior + editor-only gate).

### `src/v3/editors/fcurve/FCurveEditor.jsx` wiring

- Removed `const [hidden, setHidden] = useState(new Set())`.
- `visible` memo now: `decoded.filter((d) => !isFCurveHidden(d.fcurve))`
  with `[decoded]` dep (audit-fix MED-A1 added the dep-array
  justification comment).
- `toggleHidden` callback rewritten to write through `update()` (no
  `skipHistory:true` — hide IS in undo, mirrors Slice 5.G's mute).
- Sidebar `hidden` prop dropped; row reads `isFCurveHidden(d.fcurve)`
  directly.

### `scripts/test/test_fcurveVisible.mjs` (NEW)

49 assertions covering: sparse-default, strict-equality guards,
toggle round-trip, per-curve isolation, sister-field independence
(mute/selected/active preserved through hide/unhide cycles),
JSON round-trip semantic, visible-list filter integration, and
(audit-fix MED-A2) multi-action isolation.

### `package.json`

Added `test:fcurveVisible` script and wired into the `test`
aggregate chain between `test:fcurveActiveKeyform` and
`test:weightPaintBlur`.

## Dual-audit results

| Audit             | HIGH | MED | LOW | Fabrications |
|-------------------|------|-----|-----|--------------|
| Architecture (A)  | 0    | 2   | 0   | n/a          |
| Blender-fidelity (B) | 0 | 1   | 1   | **0**        |
| **Combined**      | 0    | 3   | 1   | 0            |

All four findings applied in commit `53e2477`:

### MED-A1 (architecture) — `visible` memo dep documentation
`[decoded]` dep is correct because immer structural sharing
propagates `fc.hide` mutation through `action.fcurves` → outer
`decoded` memo → prop → `Plot`'s `visible` memo. Inline comment
added so a future reader doesn't collapse the dep thinking it's
redundant.

### MED-A2 (architecture) — multi-action isolation test
Added a 4-assertion block verifying toggling hide on an fcurve in
action A doesn't affect a same-`id` fcurve in action B. Isolation
is architecturally guaranteed by the helper signature; test now
pins it. 45 → 49 assertions.

### MED-B1 (Blender-fidelity) — deferred-operators inventory
Three FCURVE_VISIBLE write paths added to `fcurveVisible.js`'s
"SS-deferred operators" section:
- `GRAPH_OT_hide` (H, Shift+H — `graph_ops.cc:226-337`)
- `GRAPH_OT_reveal` (Alt+H — `graph_ops.cc:341-419`)
- `setflag_anim_channels` with `ACHANNEL_SETTING_VISIBLE` (channel-
  group flushing — gated on FCurveGroup datablock; sister to the
  `AGRP_MUTED` gap already in `fcurveMute.js`)

### LOW-B1 (Blender-fidelity) — sidebar-still-shows-row note
One paragraph added explaining hidden curves remain in the sidebar
(so the user can click the eye to un-hide). Matches Blender's
intentional omission of `ANIMFILTER_CURVE_VISIBLE` from
`ANIMFILTER_LIST_CHANNELS`.

## Citation cross-verification ledger (9/9 verified, 0 fabrications)

| #  | SS claim                                                          | Blender source                                          | Verified |
|----|-------------------------------------------------------------------|---------------------------------------------------------|----------|
| 1  | `FCURVE_VISIBLE = (1 << 0)`                                       | `DNA_anim_enums.h:303-305`                              | ✅       |
| 2  | `fcurve.hide` via NEGATIVE_sdna                                   | `rna_fcurve.cc:2696-2697`                               | ✅       |
| 3  | `ACHANNEL_SETTING_VISIBLE` → `FCURVE_VISIBLE` wire                | `anim_channels_defines.cc:1130-1131`                    | ✅       |
| 4  | rect_alpha 0.3 dim                                                | `anim_channels_defines.cc:5267-5269`                    | ✅       |
| 5  | `ANIMFILTER_CURVE_VISIBLE` gate                                   | `anim_filter.cc:1287-1288`                              | ✅       |
| 6  | `visibility_matters` second loop                                  | `anim_filter.cc:1441`                                   | ✅       |
| 7  | `ANIM_OT_channels_setting_toggle` `OPTYPE_UNDO`                   | `anim_channels_edit.cc:3105`                            | ✅       |
| 8  | `deselect_all_fcurves(hide=true)` composite path                  | `anim_channels_edit.cc:5411-5428`                       | ✅       |
| 9  | `BKE_fcurve_create` default `FCURVE_VISIBLE \| FCURVE_SELECTED`   | `animrig/intern/fcurve.cc:62`                           | ✅       |

Fabrication tally across the Phase 5 slices: 5.D=3, 5.E=0, 5.F=4,
5.G=1, 5.H=0, **5.I=0**. Clean-streak preserved.

## Behavior parity vs Blender (confirmed clean)

1. **Default = visible** — SS sparse-missing-→-false-→-visible ≡
   Blender's `FCURVE_VISIBLE | FCURVE_SELECTED` set at FCurve
   creation. No migration writes a default `hide:` field.

2. **Per-row toggle doesn't auto-clear sister fields** —
   `toggleFCurveHidden` only flips `hide`; matches Blender's
   `ANIM_OT_channels_setting_toggle` per-flag write semantics.
   The composite `deselect_all_fcurves(hide=true)` operator
   (cleared SELECTED+ACTIVE) is documented as deferred.

3. **Editor-only — does NOT gate eval** — verified BOTH copies
   of `is_fcurve_evaluatable` (`evaluation.cc:95-111` and
   `anim_sys.cc:345-356`); neither checks visibility. SS's
   `evaluateActionFCurves` and `kernelFCurveEval` correctly
   evaluate hidden curves.

4. **Sidebar row persists; only plot/hit-test filters** — SS maps
   sidebar from `decoded` (full), plot+hits from `visible`
   (filtered). Matches Blender's deliberate
   `ANIMFILTER_LIST_CHANNELS` design.

5. **Render dim ↔ Blender dim** — SS's color-square
   `opacity: isHidden || isMuted ? 0.3 : 1` matches Blender's
   `rect_alpha = (FCURVE_VISIBLE) ? 1 : 0.3f` for the color-band.
   Label `opacity-50 line-through` is documented SS UX extension
   (consistent with Slice 5.F's house-style accent tint).

6. **Eye-button stops propagation** — SS `e.stopPropagation()` on
   the eye button prevents the row's channel-select onClick.
   Matches Blender's `uiBut` widget architecture where the eye is
   a setting widget, not a row-click target.

## SS-deferred Blender operators (documented in helper header)

- `GRAPH_OT_hide` / `GRAPH_OT_reveal` (H / Shift+H / Alt+H keybinds)
- `setflag_anim_channels` channel-group flushing
- `deselect_all_fcurves(hide=true)` composite

All deferred to a future "Graph Editor keymap parity" or bulk-
channel-operators slice.

## Owed manual browser verification (15 flows)

Persistence-focused verifications that unit tests can't cover:

1. **Hide a curve → close tab → reopen** — eye-toggle state survives
   FCurveEditor unmount. (Was the bug this slice fixes.)
2. **Hide a curve → save project → close → load** — hide state
   round-trips through `.stretch` save/load.
3. **Hide a curve → switch active Action → switch back** — hide
   state preserved across action swap.
4. **Hide a curve → undo** — hide reverts to visible (since
   write goes through `update()` without `skipHistory:true`).
5. **Hide a curve → redo** — hide re-applies.
6. **Hide a curve → mute the same curve** — both flags persist
   independently; sidebar shows both glyph states.
7. **Hide a curve → select another curve in sidebar** — selection
   change doesn't affect hide state (sister-field independence).
8. **Hide a curve → click its row** — channel-select fires
   (`onApplyChannelClick`); hide state preserved.
9. **Hide a curve → set active keyform on a peer** — hide + active
   keyform coexist; both persist.
10. **Hide a curve that's currently active (had been activated
    before hide)** — curve stops drawing but the "active" pip in
    the sidebar persists (matches Blender per-row toggle semantics).
11. **Hide a curve → animation playback continues to apply its
    value to the bound property** — eval not gated by hide.
12. **Hide all curves → empty plot, sidebar full** — `visible.length
    === 0` empty-state vs `decoded.length === 0` empty-state are
    distinct conditions.
13. **Hide a curve → modal grab on a peer's keyform** — modal
    iterates `visible`, doesn't touch hidden curves.
14. **Hide a curve → box-select across the plot** — box-select
    iterates `visible`, doesn't add hidden-curve keyforms to the
    selection.
15. **Hide a curve while Driver Banner is open for it** — banner
    state preserved; curve stops plotting but the driver editor
    affordance (if any) remains.

## Tests passing

| Suite                        | Assertions | Status |
|------------------------------|------------|--------|
| test:fcurveVisible (NEW)     | 49         | ✅     |
| test:fcurveMute              | 38         | ✅     |
| test:fcurveChannelSelect     | 50         | ✅     |
| test:fcurveActiveKeyform     | 62         | ✅     |
| test:fcurveEval              | 35         | ✅     |
| test:fcurveHandles           | 35         | ✅     |
| test:animFCurveBridge        | 52         | ✅     |
| test:graphEditOps            | 115        | ✅     |
| test:projectRoundTrip        | 41         | ✅     |
| **Total (impacted)**         | **517**    | ✅     |

`tsc --noEmit` clean.

## Queued resume paths (next /compact)

Updated from `docs/plans/SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_H.md`:

1. **`SELECT_EXTEND_RANGE` (Ctrl+click range select)** — Slice 5.F's
   biggest deferral. Auto-downgrade gate at
   `anim_channels_edit.cc:4517-4522`.
2. **Bulk channel-select operators** — `ANIM_OT_channels_select_all`
   (now relevant since Slice 5.I shipped hide; pairs with multi-
   select for "select all then hide unselected").
3. **`GRAPH_OT_hide` / `GRAPH_OT_reveal` keymap parity** —
   newly-promoted from Slice 5.I MED-B1 inventory. H / Shift+H /
   Alt+H bulk hide operators. Depends on bulk channel-select.
4. **Operators-on-selected-channels** — bulk mute/unmute/delete/
   hide once channel multi-select is in.
5. **Footer wiring for fcurve channel state** — selected-count +
   muted-count + hidden-count + active-keyform-info.
6. **N-panel active-keyform numerical editor** — Blender's
   `graph_buttons.cc` per-keyform inline edit.
7. **Driver variable list / expression editor** — Slice 5.D's
   biggest deferral.
8. **`SIPO_DRAWTIME` seconds-vs-frames toggle** — MED-B2 from
   Slice 5.E.
9. **`USER_FLAG_NUMINPUT_ADVANCED`** — MED-B1 from Slice 5.E.
10. **Group-level mute (`AGRP_MUTED`) + group-level hide** —
    gated on FCurveGroup datablock. Sister to the
    `setflag_anim_channels with ACHANNEL_SETTING_VISIBLE` flushing
    gap documented in Slice 5.I.
11. **DopesheetEditor row-state styling** — mute-row + active-
    keyform-row + hide-row visual treatment (sidebar already
    matches; the Dopesheet tabular view needs the same).
12. **Phase 2 owed-manual verification** — bezier export, Hiyori
    round-trip.
13. **Phase 3 — F-Curve modifiers** — Cycles/Noise/Generator/
    Envelope.
