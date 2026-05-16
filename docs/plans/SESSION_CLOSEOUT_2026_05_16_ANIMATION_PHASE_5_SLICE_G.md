# Animation Phase 5 Slice 5.G — Close-out (2026-05-16)

**Scope:** Channel mute (`FCURVE_MUTED` port). Schema field + eval gates +
sidebar mute toggle + greyed render. Sister to Slice 5.F's selection
split — both surface per-FCurve channel-list metadata.

## Commits

```
df1db91 fix(audit): Animation Phase 5 Slice 5.G dual-audit sweep — 2 HIGH-A + 1 MED-A + 1 HIGH-B + 1 MED-B
acda4f6 feat(anim): Animation Phase 5 Slice 5.G — channel mute (FCURVE_MUTED)
```

20 commits ahead of `origin/master`.

## What shipped

### New schema field

`fcurve.mute: boolean` — sparse (missing == `false`). Per Rule №2 no
migration ships: `isFCurveMuted` collapses tri-state to clean boolean.

### Pure helper module

[src/anim/fcurveMute.js](../../src/anim/fcurveMute.js) — ~140 LOC after
audit-fix:

- `isFCurveMuted(fcurve): boolean` — strict `=== true` check.
- `toggleFCurveMute(action, fcurveId): { mutedNow }` — single-curve XOR.

Module header documents Blender provenance: `is_fcurve_evaluatable`
(`evaluation.cc:95-111`), `BKE_animsys_eval_driver` (`anim_sys.cc:4302`),
`graph_draw.cc:1190-1194`, `anim_channels_defines.cc:1124-1125`,
`rna_fcurve.cc:2690`. Also documents the SS-deferred group-mute
(`AGRP_MUTED`) gap pending FCurveGroup datablock.

### Eval gates — caller-side pattern (Blender's `is_fcurve_evaluatable`)

Per Blender's pattern, the gate lives at the caller (the for-loop or
op kernel), NOT inside `evaluateFCurve`. `evaluateFCurve` stays a pure
value function so the Graph Editor render path can still sample muted
curves (drawn greyed). Wired sites:

1. [src/anim/animationFCurve.js:362-374](../../src/anim/animationFCurve.js#L362)
   — `evaluateActionFCurves` for-loop continue.
2. [src/anim/depgraph/kernels/fcurve.js:44-66](../../src/anim/depgraph/kernels/fcurve.js#L44)
   — `kernelFCurveEval` early NaN return.
3. **Audit-fix HIGH-A1** —
   [src/renderer/animationEngine.js:222 + 269](../../src/renderer/animationEngine.js#L222)
   — `computePoseOverrides` + `computeParamOverrides` (THE viewport
   tick path; pre-fix the slice's UI flag had zero effect on live
   playback).
4. **Audit-fix HIGH-A2** —
   [src/anim/depgraph/kernels/animation.js:46-55](../../src/anim/depgraph/kernels/animation.js#L46)
   — `kernelAnimationTrackEval` (depgraph's `ANIMATION_TRACK_EVAL` op).

Drivers transitively gated: skipping the whole `evaluateFCurve` call
stops the inline `evaluateDriver` step (matches Blender's
`BKE_animsys_eval_driver` mute check).

### Undo policy

Mute IS in the undo history (unlike Slice 5.F's selection). Blender
records `ANIM_OT_channels_setting_toggle` with
`OPTYPE_REGISTER | OPTYPE_UNDO` at `anim_channels_edit.cc:3105`. SS
matches by calling `update(recipe)` WITHOUT `skipHistory:true`.

### UI wiring

[src/v3/editors/fcurve/FCurveEditor.jsx](../../src/v3/editors/fcurve/FCurveEditor.jsx):

- `onToggleMute` useCallback (no `skipHistory:true` — see above).
- Sidebar row: speaker icon button between hide-eye and color swatch.
- Muted rows: italic + 60% opacity label, dimmed color swatch.
- SVG curve path: neutral grey (`hsl(0 0% 55%)`) at 0.35α when muted.
- Canvas diamonds + handles: 0.4× multiplicative alpha when muted
  (still clickable — mute is data-only, Blender allows editing muted
  curve keyforms).

### Test suite

[scripts/test/test_fcurveMute.mjs](../../scripts/test/test_fcurveMute.mjs)
— 38 assertions:

- `isFCurveMuted` sparse-field invariant (7 cases).
- `toggleFCurveMute` sparse→ON, true→OFF, false→ON, peer isolation.
- Guards (null action, null fcurves array, unknown id, null entries).
- `evaluateActionFCurves` eval-gate skip behaviour (baseline, single-
  muted, all-muted).
- Driver gate: unmuted-positive-control + muted-negative-case
  (post-MED-A3 fix: prior `type: 'AVERAGE'` was vacuous).
- `kernelFCurveEval` eval-gate skip + toggle round-trip.

## Dual-audit pass (2 HIGH-A + 1 MED-A + 1 HIGH-B + 1 MED-B; +3 unverifiable/non-issues)

| Finding | Severity | What | Fix |
|---|---|---|---|
| HIGH-A1 | real | `animationEngine.computePoseOverrides`/`computeParamOverrides` were the PRIMARY viewport-tick eval paths; ungated on mute. UI flag had no effect on live playback. | Added `isFCurveMuted` gate to both for-loops |
| HIGH-A2 | real | `kernelAnimationTrackEval` (depgraph ANIMATION_TRACK_EVAL op) was the sister of `kernelFCurveEval` and was missed | Added gate after fcurve lookup |
| MED-A3 | real | Driver test used `type: 'AVERAGE'` (uppercase) — falls through to `default: NaN` without calling `resolveVariables`. Vacuous regression coverage. | Fixed to `type: 'avg'`, moved getter onto `target.rnaPath` (the field actually read), added unmuted positive control |
| HIGH-B1 | real | All 4 citations pointed at `evaluation.cc:345-356`; function lives at `:95-111`. Line 345 is in different file `blenkernel/intern/anim_sys.cc` with materially different body (checks `FCURVE_DISABLED + AGRP_MUTED`). | Corrected all 4 citations; SS's mute-only gating actually MATCHES the `:95` copy more faithfully than the `:345` copy |
| MED-B2 | real | SS doesn't implement group-level `AGRP_MUTED` short-circuit. Non-issue today (no FCurveGroup datablock), but would silently persist. | Documented as SS-deferred section in helper module header pending Dopesheet channel-grouping phase |
| graph_draw.cc unverifiable | n/a | Reference clone doesn't include `space_graph/` subtree, so the specific 1190-1194 line range can't be byte-verified | Citation left in place; semantic claim (TH_HEADER+50 grey) is consistent with other channels-defines + Python API conventions |
| FCURVE_DISABLED not ported | n/a | `evaluation.cc:95` copy explicitly excludes the `DISABLED` check per issue #135666; SS filters unresolvable curves at decode time | Documented in helper header |
| Sidebar icon convention | n/a | SS uses 🔇/🔊 emoji; Blender uses interface_icons | Acceptable — SS uses emoji throughout the sidebar |

### Cross-verification (citation discipline — pattern from Slice 5.D/E/F)

Read every Blender citation on disk before applying audit fixes:

1. `DNA_anim_enums.h:303-314` — `FCURVE_MUTED = (1 << 4)` at line 313. ✅
2. `evaluation.cc:95-111` — `is_fcurve_evaluatable`, mute-only check. ✅
3. `anim_sys.cc:345-356` — separate file/copy, checks `FCURVE_DISABLED + AGRP_MUTED`. Confirmed mis-cited; corrected.
4. `anim_sys.cc:4302` — `BKE_animsys_eval_driver` mute gate. ✅
5. `anim_channels_defines.cc:1124-1125` — `ACHANNEL_SETTING_MUTE ↔ FCURVE_MUTED`. ✅
6. `rna_fcurve.cc:2690-2691` — RNA property `mute` mapped to `FCURVE_MUTED`. ✅
7. `anim_channels_edit.cc:3105` — `ANIM_OT_channels_setting_toggle` with `OPTYPE_REGISTER | OPTYPE_UNDO`. ✅
8. `graph_draw.cc:1190-1194` — not in clone (space_graph/ subtree absent). Marked unverifiable.

Pattern continues: Slice 5.D caught 3 fabrications, Slice 5.E caught 0,
Slice 5.F caught 4 pre-audit, Slice 5.G caught 1 (the off-by-file
`:345-356` citation) — never trust a citation that hasn't been Read on
disk.

## Tests passing at `df1db91`

| Suite | Count | Notes |
|---|---|---|
| test:fcurveMute | 38/38 | new this slice; +1 vs `acda4f6` (added unmuted-driver positive control) |
| test:fcurveChannelSelect | 50/50 | Slice 5.F |
| test:fcurveEval | 35/35 | regression |
| test:fcurveHandles | 35/35 | regression |
| test:animFCurveBridge | 52/52 | regression |
| test:graphEditOps | 115/115 | regression |
| test:fcurveDriverGate | 21/21 | regression |
| test:animationEngine | 61/61 | regression (load-bearing — covers the HIGH-A1 gates) |
| test:actionExportMotion3 | 39/39 | regression (proves export is unaffected — exports still write muted curves, Blender does too) |
| **Total** | **446** | tsc --noEmit clean |

## SS-deferred (do not re-open without surfacing)

- **Group-level mute (`AGRP_MUTED`)** — pending FCurveGroup datablock
  in a future Dopesheet phase. Documented as MED-B2 in helper header
  so it surfaces if anything stumbles into channel-grouping work.
- **Dopesheet muted-row styling** — DopesheetEditor doesn't yet
  surface mute state visually. Slice 5.G shipped Graph-Editor-only
  styling. If/when dopesheet grows fcurve rows, mirror the
  italic+dim+grey treatment.
- **`FCURVE_DISABLED`** — Blender's flag for "rnaPath fails to
  resolve". SS reaches the same outcome by filtering at
  `decodeAllFCurves` time, so the explicit bit is redundant today.

## Owed manual browser verification

User-side verification flows (don't claim done from tests alone):

1. **Mute toggles**: speaker icon flips between 🔊 ↔ 🔇 on click, row goes italic+dim.
2. **Render**: muted curve draws in neutral grey, diamonds + handles fade to ~40% alpha.
3. **Eval**: muted body-warp param visibly stops driving the live viewport (mute the `BodyAngleX` curve; head should freeze).
4. **Driver-attached + muted**: a curve with a driver, when muted, neither evaluates keyforms NOR fires its driver.
5. **Undo**: Ctrl+Z after mute toggle restores the prior unmuted state (selection, by contrast, is NOT in undo).
6. **Save+load**: project saved with muted curves, reloaded, mute state preserved.
7. **Sparse-field load**: a pre-Slice 5.G save (v39 without `mute` field) loads with no muted curves, no errors.
8. **Sidebar click discipline**: mute button click doesn't trigger row's channel-select; hide button preserves the same isolation.
9. **Active curve + mute**: muting the active curve still draws grey (mute wins over active highlight per slice comment).
10. **Mute the only curve in an action**: no crashes; bound parameter retains prior value.
11. **Mute a driver-only curve (keyforms empty)**: driver doesn't fire; downstream parameter keeps prior value.
12. **Channel-list click on muted row**: still becomes active + selected (mute doesn't affect interaction, only eval+render).

## Queued resume paths (priority order)

1. **Active-keyform field + highlight** — `BKE_fcurve_active_keyframe_index` parity, `TH_VERTEX_ACTIVE`. Sister to mute/selected as a per-FCurve sparse field.
2. **Persistent `fcurve.visible` schema field** — replace local-React `hidden` Set with persisted boolean. Mirror of mute/selected/active triad.
3. **`SELECT_EXTEND_RANGE` (Ctrl+click range select)** — Slice 5.F's biggest deferral. Port with the auto-downgrade gate at `anim_channels_edit.cc:4517-4522`.
4. **Bulk channel-select operators** — `ANIM_OT_channels_select_all` (A/Alt+A) — natural consumer for the new selected + mute schema fields.
5. **Operators-on-selected-channels** — bulk mute / unmute / delete via Channel menu — exercises both Slice 5.F + 5.G.
6. **Footer wiring for fcurve channel state** — surface selected-count + muted-count in the editor footer. Combine with Slice 5.E modal-status footer hook.
7. **Driver variable list / expression editor** — Slice 5.D's biggest deferral.
8. **`SIPO_DRAWTIME` seconds-vs-frames display toggle** — MED-B2 from Slice 5.E.
9. **`USER_FLAG_NUMINPUT_ADVANCED` preference + auto-enable** — MED-B1 from Slice 5.E.
10. **Group-level mute (`AGRP_MUTED`)** — gated on FCurveGroup datablock landing in a Dopesheet phase. MED-B2 from this slice.
11. **DopesheetEditor mute-row styling** — when dopesheet surfaces fcurve rows.
12. **Phase 2 owed-manual verification** — live recording bezier export, Hiyori round-trip.
13. **Phase 3 — F-Curve modifiers** — Cycles / Noise / Generator / Envelope.
