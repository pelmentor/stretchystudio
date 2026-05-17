# Animation Phase 5 — Slice 5.W close-out

**Date**: 2026-05-17  
**Commits**: `7573c49` (substrate) → `caf2d1f` (audit-fix sweep) → (this doc)  
**Path #10 from Phase 5 queue** — *DopesheetEditor row-state styling* — SHIPPED.

## What the path was

> "DopesheetEditor row-state styling — mute-row + active-keyform-row + hide-row."
> (from Slice 5.J close-out's queued-paths list, carried forward through 5.K → 5.V)

DopesheetEditor (sister to FCurveEditor; read-only keyform density
visualiser) reflects per-row state computed from the FCurve substrate
shipped in earlier slices:

| Row state | Source | Visual treatment |
|-----------|--------|------------------|
| Effective mute (per-fcurve OR group cascade from 5.V) | `isFCurveEffectivelyMuted(fc, action)` | Label `italic opacity-60` + diamonds drop to 0.4 alpha |
| Effective hide (per-fcurve OR group cascade from 5.V) | `isFCurveEffectivelyHidden(fc, action)` | Row filtered out of rendered list entirely |
| Active keyform pin (per-curve, Slice 5.H) gated by active channel | `fc.activeKeyformIndex` + `pickActiveFCurve(action, selection)` | Pale-yellow ring + amber-300 fill diamond; rendered LAST so it sits on top |

## Substrate (`7573c49`)

| File | Status | Role |
|------|--------|------|
| `src/v3/editors/dopesheet/dopesheetRows.js` | NEW | Pure `buildDopesheetRows(action, project) → DopesheetRow[]` |
| `src/v3/editors/dopesheet/DopesheetEditor.jsx` | refactored | Imports from new module; Row applies per-row state classes |
| `scripts/test/test_dopesheetRows.mjs` | NEW | 41 assertions (substrate ship) |
| `package.json` | + `test:dopesheetRows` | Registered + appended to aggregate `test` chain |

## Dual audit (parallel general-purpose agents)

Both audits returned 0 fab cites — pre-verify discipline held for the
2nd slice in a row after the 5.V break (lesson 1 from
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICES_T_U_V.md`).

| Lane          | HIGH | MED | LOW | Total |
|---------------|------|-----|-----|-------|
| Architecture  | 1    | 4   | 4   | 9     |
| Blender fidelity | 2 | 3   | 2   | 7     |
| **Combined**  | **3** | **7** | **6** | **16** |

(MED-3 of the fidelity audit is Slice 5.V territory inherited here;
deferred to a future 5.V owner sweep with a documented note in
the close-out — not patched in this slice's scope.)

## Audit-fix sweep (`caf2d1f`)

All HIGH addressed. All MED addressed except MED-3 (deferred — see above).
All LOW addressed. Summary:

### Fidelity findings

**HIGH-1 — mute styling cite overreach.** `graph_draw.cc:1190-1194`
styles the GRAPH curve stroke; `keyframes_draw.cc` has no mute branch
(alpha-dim there is for `channel_locked` / PROTECTED only, per `:215`).
SS's pip alpha-dim is SS-original UX, not a Blender port. JSDoc
rewritten as Deviation 1 (closure: not planned; sister styling in
FCurveEditor justifies the visual signal).

**HIGH-2 — active-keyform halo lacked `FCURVE_ACTIVE` per-channel gate.**
Blender's `draw_fcurve_active_vertex` at `graph_draw.cc:244` early-
returns when `!(fcu->flag & FCURVE_ACTIVE)`. SS pre-fix showed the
halo on EVERY row carrying `activeKeyformIndex` — and
`setActiveKeyform` doesn't clear sibling fcurves' indices, so clicking
keys on multiple fcurves in FCurveEditor would light up multiple halos
in DopesheetEditor. Fixed by extracting `pickActiveFCurve(action,
selection)` to a shared module and gating the halo on
`pickActiveFCurve(action, selection)?.id === row.fcurveId`. This is
SS's stand-in for Blender's `FCURVE_ACTIVE` until Phase 5 path #11
ships the persisted per-fcurve flag.

**MED-1 — hide-filter cite was Graph Editor's flag, not Action Editor's.**
Blender's `space_action/action_draw.cc` has ZERO references to
`FCURVE_VISIBLE`; the flag is owned by the Graph Editor only. SS
deviates by design (no sidebar / no un-hide affordance in DopesheetEditor).
Reframed as Deviation 3.

**MED-2 — `ED_add_fcurve_channel` cite tightened.** Blender's function
precomputes ONLY `channel_locked`; mute and active-keyform are
re-derived at draw time. SS adopts the SEPARATION pattern but
precomputes more flags (architectural improvement, not literal port).
JSDoc rewritten.

**MED-3 — Slice 5.V territory (deferred).** `isFCurveEffectivelyHidden`
cascade cite lives in `anim_filter.cc:1547`, not `anim_sys.cc:347-352`.
Documented here for a future 5.V owner sweep; not patched in 5.W's
scope.

### Architecture findings

**H1 — `useMemo` deps too broad.** `useMemo(() => buildDopesheetRows(action,
project), [action, project])` would rebuild the row list on ANY project
mutation (wizard, vertex paint, etc.). Narrowed to slices the builder
actually reads: `[projectNodes, projectActions]` (action memo), then
`[projectNodes, projectParameters]` (builder memo), then `[action,
selection]` (picker memo). Restored sister narrowing pattern.

**M1 — silent-coerce phantom keyforms.** `kf?.time ?? 0` would silently
render bad upstream data as phantom diamonds at t=0. Per Rule №1 (no
silent fallbacks), filter now drops non-numeric/non-finite times.

**M2 — `orderedIndices` extracted as pure `getKeyformRenderOrder`.**
Z-order logic was buried in a Row `useMemo`; extracted for unit-test
coverage (12 new assertions across identity / active-last / OOB /
non-integer / empty cases).

**M4 — O(G) group lookup per fcurve.** `isFCurveEffectivelyMuted` /
`isFCurveEffectivelyHidden` each scan `action.groups[]`; for N fcurves
× 2 helpers, that's 2N×G per build. Collapsed to O(1) via pre-built
local `groupById` Map in `buildDopesheetRows`. Cascade semantics
unchanged; coverage verified.

**L1 — unused re-export removed.** `FCURVE_ACTIVE_KEYFORM_NONE`
re-exported but never consumed; deleted per Rule №2.

**L2 — `formatValue` null/undefined.** Now renders as the project's
empty-value glyph (`—`) instead of literal `"null"`/`"undefined"`.

**L3 — React key collision.** Pre-fix the `${kindPrefix}:${nodeId|paramId}[:property]`
key silently deduped rows with the same target. New key uses
`fcurveId`; pathological duplicate-id case logs `logger.warn` + drops
second row (per Rule №1 — no silent fallbacks).

**L4 — sister-inconsistency note added.** DopesheetEditor's dot doesn't
branch on isHidden because hidden rows never reach the renderer.

## Files (cumulative both commits)

| File | New | Modified |
|------|-----|----------|
| `src/anim/fcurvePicker.js` | ✓ |  |
| `src/v3/editors/fcurve/FCurveEditor.jsx` |  | ✓ (pickFCurve aliased to pickActiveFCurve) |
| `src/v3/editors/dopesheet/dopesheetRows.js` | ✓ (~300 LOC final) |  |
| `src/v3/editors/dopesheet/DopesheetEditor.jsx` |  | ✓ (refactored) |
| `scripts/test/test_dopesheetRows.mjs` | ✓ (66 assertions final, was 41 at substrate) |  |
| `scripts/test/test_fcurvePicker.mjs` | ✓ (14 assertions) |  |
| `package.json` |  | ✓ (2 new test entries) |

## SS deviations documented this slice (3 new — cumulative 45 across Phase 5)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.W-1 | Muted dopesheet rows alpha-dim (Blender's action editor doesn't) | None planned — sister styling in FCurveEditor justifies the signal |
| 5.W-2 | Active-keyform halo doesn't enforce keyform-selection precondition (`graph_draw.cc:254`) | SS keyform selection lives in editor-local React; future cross-editor subscription or project-stored selection field |
| 5.W-3 | Hidden curves filtered from dopesheet (Blender's action editor keeps them) | None planned — DopesheetEditor has no sidebar / no un-hide affordance |

## Self-deferred items inherited but NOT closed this slice

- **Slice 5.V Dev 5** (auto-group on fcurve add) — queued path #33
- **Slice 5.V Dev 6** (group-flush helper) — queued path #34
- **Fidelity MED-3** (Slice 5.V hide cascade cite) — deferred to future 5.V owner sweep

## Test additions

| Suite | Assertions added (cumulative) |
|-------|------------------------------:|
| `test_dopesheetRows.mjs` | 0 → 41 (substrate) → 66 (audit-fix +25) |
| `test_fcurvePicker.mjs` | 0 → 14 (audit-fix new) |
| **Total new this slice** | **80** |

## Pre-/post-slice state

| | Pre-5.W | Post-5.W |
|---|---------|----------|
| commits ahead of origin/master | 64 | 67 (post-close-out commit) |
| Schema version | 40 | 40 (no migration) |
| Aggregate `test` length | (extant) | + `test:dopesheetRows` + `test:fcurvePicker` |
| Documented SS deviations cumulative | 42 (Phase 5) | 45 (Phase 5) |
| Fab streak | reset at 5.V | 1 (5.W held) |

## Queued resume paths (after 5.W)

| #   | Path                                                          | Status                            |
|-----|---------------------------------------------------------------|-----------------------------------|
| 1-9 | Earlier slices (5.L → 5.V)                                    | SHIPPED                           |
| 10  | DopesheetEditor row-state styling                             | **SHIPPED in 5.W (this slice)**   |
| 11  | Per-fcurve ACTIVE slot                                        | **NEW TOP** (closes 5.W Dev 2 indirectly + retires pickActiveFCurve compat shim) |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar              | queued                            |
| 13  | Phase 2 owed-manual verification                              | queued                            |
| 14  | **Phase 3 — F-Curve modifiers** (full phase)                  | queued                            |
| 15  | SS keymap-preset selector                                     | queued                            |
| 16  | Hide/reveal toast notifications                               | queued                            |
| 17  | Sidebar focus tracking for region-aware keys                  | queued                            |
| 18  | Popup-menu primitive                                          | queued                            |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port)                    | queued                            |
| 20  | N-panel collapse-state persistence + multi-panel host         | queued                            |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE`        | queued                            |
| 22  | Pre-verify cite discipline workflow item                      | queued                            |
| 23-27 | Driver polish (5.S devs)                                    | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6 + fcurveMute Dev 3)      | queued                            |
| 35  | Group-children select operator (Shift+Ctrl+click)             | queued                            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2 — needs F-Curve mods) | queued (downstream of #14)   |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39 (NEW) | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)     | queued (1-line JSDoc fix)         |

## Lessons

1. **Audit lesson — fidelity cites overstate provenance even when "real".**
   Both HIGH findings in this slice were SEMANTIC overclaims, not fab
   cites. The lines I quoted are real; what they prove is narrower than
   the surrounding text implied. Going forward: when a JSDoc cite says
   "mirrors", verify the structural claim matches what the cited code
   actually does, not just that the symbol exists. "Exists" is the floor,
   "does the same thing" is the bar.

2. **HIGH-2 — extracting shared helpers is cheaper than duplicating.**
   The HIGH-2 fix required DopesheetEditor to know which fcurve is
   "active" (gate for halo). The cleanest path was extracting
   `pickActiveFCurve` from FCurveEditor's local helper to a shared
   module. ~50 LOC + a tiny test, no behavior change in FCurveEditor.
   When path #11 lands, both editors retire this helper together.

3. **Audit-fix pattern stability — 7 commits in 2 days hit zero fabs
   when held strictly.** 5.S/T/U held; 5.V broke (3 fabs); 5.W held
   again. The pattern: small slices ~hold automatically; substrate
   slices need explicit per-cite Read tool verification. The 5.V
   lesson generalizes.
