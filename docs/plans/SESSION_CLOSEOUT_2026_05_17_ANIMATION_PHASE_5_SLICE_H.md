# Animation Phase 5 Slice 5.H — Close-out (2026-05-17)

**Scope:** Active keyform (`BKE_fcurve_active_keyframe_index` port).
Schema field + may_activate click gate + caller-side tracking through
sort/merge/delete + TH_VERTEX_ACTIVE-equivalent halo. Sister to
Slice 5.F (channel selection) + 5.G (mute) as a per-FCurve sparse
field.

## Commits

```
11abfa3 fix(audit): Animation Phase 5 Slice 5.H dual-audit sweep — 3 HIGH-A + 1 HIGH-B + 3 MED
c9523c1 feat(anim): Animation Phase 5 Slice 5.H — active keyform (BKE_fcurve_active_keyframe_index)
```

23 commits ahead of `origin/master`.

## What shipped

### New schema field

`fcurve.activeKeyformIndex: number` — sparse integer (missing == NONE,
sentinel `-1` for `FCURVE_ACTIVE_KEYFORM_NONE`). Per Rule №2 no
migration ships; the reader collapses tri-state to the sentinel.

### Pure helper module

[src/anim/fcurveActiveKeyform.js](../../src/anim/fcurveActiveKeyform.js)
— ~260 LOC:

- `FCURVE_ACTIVE_KEYFORM_NONE` — sentinel (-1).
- `getActiveKeyformIndex(fcurve)` — bounds-checked reader (OOB → NONE).
- `setActiveKeyform(action, fcurveId, index|null)` — writer; OOB/null/
  non-integer → clears via `delete fc.activeKeyformIndex` (sparse, no
  `-1` written).
- `clearActiveKeyform(action, fcurveId)` — convenience.
- `captureActiveKeyformObject(fcurve)` — pre-op snapshot of the
  BezTriple object reference (immer preserves identity through drafts).
- `relocateActiveKeyformByObject(action, fcurveId, capturedObj)` —
  post-op `indexOf` re-find; deleted obj → clears.
- `remapActiveKeyform(action, fcurveId, remap)` — index-based remap
  for the delete operator's `Map<oldIdx, newIdx|-1>` shape.

Module header documents Blender provenance:
`DNA_anim_types.h:362-370` (field), `DNA_anim_enums.h:299-300`
(sentinel), `BKE_fcurve.hh:391-397` (accessors), `fcurve.cc:794-813`
(set body), `fcurve.cc:815-831` (get body), `fcurve.cc:1313-1320`
(sort tracking), `fcurve.cc:1768-1770` (delete-clear),
`graph_select.cc:1789-1797` (may_activate gate), `graph_draw.cc:241-262`
(active-vertex render), `graph_draw.cc:338-368`
(active-handle-vertices render).

### Eval-gate placement — caller-side per Blender's pattern

Same as mute (Slice 5.G), the active-keyform tracking lives at the
caller's loops, not inside `evaluateFCurve`. The helper module stays
pure-data; the editor wires capture/relocate around every reorder /
delete / merge site.

### Wired call sites (8 total)

1. **FCurveEditor click handler — diamond hit** (`FCurveEditor.jsx:864-887`)
   — may_activate gate per `graph_select.cc:1789-1797`, gated on
   `subPrevEntry.center` (center-only, audit-fix MED-B3).
2. **FCurveEditor click handler — handle hit** (`FCurveEditor.jsx:791-823`)
   — may_activate gate, per-side `wasAlreadySelected` check (audit-fix
   HIGH-B1 — was entirely missing pre-fix).
3. **FCurveEditor single-keyform-drag onMove** — per-tick sort tracking.
4. **FCurveEditor single-keyform-drag cleanup** — pre-merge capture +
   post-merge relocate.
5. **FCurveEditor bulk modal-grab onMove** — per-tick sort tracking.
6. **FCurveEditor bulk modal-grab cleanup** — pre-merge + post-merge.
7. **FCurveEditor bulk modal-grab revert (Esc)** — pre-revert-sort
   capture + post-sort relocate (audit-fix HIGH-A1).
8. **FCurveEditor delete-keyforms operator** — `remapActiveKeyform`
   (index-based via the deleteKeyforms remap).
9. **FCurveEditor snap-to-frame operator** — pre-snap+sort+merge
   capture, post-pass relocate.
10. **TimelineEditor drag-sort onMove** — per-tick sort across ALL
    fcurves (audit-fix HIGH-A3).
11. **TimelineEditor bulk delete** — pre-filter capture + post-filter
    relocate (audit-fix HIGH-A2 site 1).
12. **TimelineEditor single-keyform delete** — same pattern (audit-fix
    HIGH-A2 site 2).

### Render — three-condition gate per `graph_draw.cc:241-262`

`drawKeyframes` extended with `activeKfIdx` param. Active-keyform halo
drawn AFTER the regular diamond pass (so muted alpha doesn't dim it).
`drawHandles` extended with the same `activeKfIdx` param for the
sister `draw_fcurve_active_handle_vertices` port (audit-fix MED-B2).

Three-condition gate (audit-fix MED-B1):
1. `d.fcurve.id === activeFCurveId` (channel-active).
2. `getActiveKeyformIndex(d.fcurve) !== NONE`.
3. `subEntry.center === true` — Blender's `bezt->f2 & SELECT`, NOT
   `BEZT_ISSEL_ANY`. The halo signals N-panel numerical editability;
   showing it for tangent-only selection would mislead.

### Undo policy

Active-keyform IS in undo history (matches Blender — active is data,
not view state). Click setter calls `update(recipe)` without
`skipHistory:true`. The capture/relocate sites inside `onMove`
ticks all run in `skipHistory:true` because they're consequences
of the ongoing drag, not user actions.

### Test suite

[scripts/test/test_fcurveActiveKeyform.mjs](../../scripts/test/test_fcurveActiveKeyform.mjs)
— 62 assertions:

- Sentinel + sparse-field invariant (7 cases).
- `getActiveKeyformIndex` bounds + null/undefined/non-integer/OOB.
- `setActiveKeyform` valid + OOB-clears (sparse, no `-1` written) +
  null-clears + unknown-id no-op + null-action guard.
- `clearActiveKeyform` writes sentinel, removes field.
- `captureActiveKeyformObject` + `relocateActiveKeyformByObject`
  through sort + delete + unknown-id.
- `remapActiveKeyform` shift / delete-clear / same-idx-no-write /
  missing-active / unknown-id / null-action.
- E2E simulation: click → sort-past → relocate finds new index.
- Audit-fix regressions (+3): HIGH-A2 obj-survives-filter,
  HIGH-A2 obj-deleted-clears-field, HIGH-A3 drag-past tracking.

## Dual-audit pass (3 HIGH-A + 1 HIGH-B + 3 MED-B)

| Finding | Severity | What | Fix |
|---|---|---|---|
| HIGH-A1 | real | Modal-grab `revert()` sorted keyforms after restoring times without active tracking; field stayed at drag-final index pointing at wrong object post-revert | Capture/relocate pair around the revert sort |
| HIGH-A2 | real | TimelineEditor's two delete sites (`TimelineEditor.jsx:1072+1149`) used `fc.keyforms = filter(...)` without updating active. Active obj deleted left the field pointing at a wrong-or-deleted kf | Pre-filter capture + post-filter relocate (deleted-obj → indexOf=-1 → field clears) |
| HIGH-A3 | real | TimelineEditor per-tick drag-sort at `TimelineEditor.jsx:828` ran `forEach(f => f.keyforms.sort(...))` without active tracking; halo jumped each pointer-move tick when dragged kf crossed neighbor | Capture/relocate per fcurve inside the forEach |
| HIGH-B1 | real | Handle-dot click path returned without firing may_activate. Per `graph_select.cc:1789-1797` Blender's gate fires for ALL bezt hits (key, left, right). Dragging a bezier handle left the halo pinned on a stale keyform | Per-handle may_activate at the handle-pick site with per-side `already_selected` check |
| MED-B1 | real | Render condition (3) was `center||left||right`; Blender's `graph_draw.cc:254` tests ONLY `f2 & SELECT` (center). Showing halo for tangent-only selection was misleading | Render gate now `subEntry.center` only |
| MED-B2 | real | `draw_fcurve_active_handle_vertices` (`graph_draw.cc:338-368`) had no SS port; active kf's handle dots got no outline | `drawHandles` gained `activeKfIdx` + pale-yellow outline ring on left/right handle dots per Blender's per-side conditions |
| MED-B3 | real | Diamond `wasAlreadySelected` checked any of center/left/right; Blender's per-handle `already_selected` is per-side. For diamond hit (= `NEAREST_HANDLE_KEY`), only f2 matters | Restricted to `subPrevEntry.center` / `subNextEntry.center` |

### Cross-verification (citation discipline)

All 10 Blender citations read on disk **before** applying audit
verdicts. **Zero fabrications** this slice — cleanest run since
Slice 5.E. (Pattern: 5.D caught 3, 5.E caught 0, 5.F caught 4,
5.G caught 1, 5.H caught 0.)

| # | Citation | Verified |
|---|---|---|
| 1 | `DNA_anim_types.h:362-370` — `active_keyframe_index` field | ✅ |
| 2 | `DNA_anim_enums.h:299-300` — `FCURVE_ACTIVE_KEYFRAME_NONE = -1` | ✅ |
| 3 | `BKE_fcurve.hh:391-397` — accessor declarations | ✅ |
| 4 | `fcurve.cc:794-813` — `BKE_fcurve_active_keyframe_set` body | ✅ |
| 5 | `fcurve.cc:815-831` — `BKE_fcurve_active_keyframe_index` body | ✅ |
| 6 | `fcurve.cc:1313-1320` — adjacent-swap sort tracking | ✅ |
| 7 | `fcurve.cc:1768-1770` — delete-clear inline | ✅ |
| 8 | `graph_select.cc:1789-1797` — may_activate gate | ✅ |
| 9 | `graph_draw.cc:241-262` — `draw_fcurve_active_vertex` (TH_VERTEX_ACTIVE) | ✅ |
| 10 | `graph_draw.cc:338-368` — `draw_fcurve_active_handle_vertices` | ✅ |

## Tests passing at `11abfa3`

| Suite | Count | Notes |
|---|---|---|
| test:fcurveActiveKeyform | 62/62 | new this slice; +3 vs `c9523c1` (audit-fix regressions) |
| test:fcurveMute | 38/38 | Slice 5.G regression |
| test:fcurveChannelSelect | 50/50 | Slice 5.F regression |
| test:fcurveEval | 35/35 | regression |
| test:fcurveHandles | 35/35 | regression |
| test:animFCurveBridge | 52/52 | regression |
| test:graphEditOps | 115/115 | regression |
| test:fcurveDriverGate | 21/21 | regression |
| test:animationEngine | 61/61 | regression |
| test:actionExportMotion3 | 39/39 | export unaffected by sparse-field (matches Blender — exports retain active field) |
| test:projectRoundTrip | 41/41 | save/load preserves sparse field |
| **Total** | **549** | tsc --noEmit clean |

## SS-deferred (do not re-open without surfacing)

- **Group-level active-keyform per-channel** — pending FCurveGroup
  datablock. Blender's `BKE_fcurve_active_keyframe_index` is per-FCurve;
  no group-level mirror needed.
- **`SELECT_EXTEND_RANGE` interaction with active-keyform** — pending
  the larger range-select work (queued #3).
- **`USER_ANIM_ONLY_SHOW_SELECTED_CURVE_KEYS` preference** — Blender's
  pref to hide non-selected curves entirely. Doesn't affect active-
  keyform semantics; SS already shows all visible curves.
- **N-panel numerical editor for the active keyform** — Blender's
  `graph_buttons.cc` surfaces `time`, `value`, `handle_left`, etc. for
  the active keyform. SS's keyform editor already supports inline edit
  via the keyform editor panel but doesn't auto-focus the active one.
  Future polish.

## Owed manual browser verification

User-side verification flows (don't claim done from tests alone):

1. **Diamond click sets halo**: click a keyform → pale-yellow halo ring
   appears around the diamond.
2. **Shift+click on second keyform**: halo stays on the first (active
   was set, second click `wasAlreadySelected=false` but already-active
   leaves the first as active per may_activate gate).
3. **Click already-selected-and-active**: halo doesn't move (gate
   correctly skips re-set).
4. **Click on context-curve keyform (non-active channel)**: channel
   elevates AND halo moves to the new keyform.
5. **Bezier handle drag**: halo moves to the dragged keyform (HIGH-B1
   verification — pre-fix the halo would stay stale).
6. **Modal G (grab) commit**: halo follows the dragged keyform to its
   new position.
7. **Modal G then Esc (revert)**: halo returns to the original keyform
   (HIGH-A1 verification — pre-fix it would stick to the drag-final
   position even though the keyform was reverted).
8. **Delete the active keyform**: halo disappears (field cleared).
9. **Delete a non-active keyform with lower time**: halo stays on the
   correct keyform (index shifted via remap).
10. **Timeline delete with Graph Editor open**: same as 8+9 but via
    Timeline (HIGH-A2 verification).
11. **Timeline drag a keyform past a neighbor**: halo stays on the
    correct keyform throughout the drag (HIGH-A3 verification —
    pre-fix the halo would jump each tick).
12. **Render gate — tangent-only selection on active**: select only a
    bezier handle of the active keyform → halo DISAPPEARS (MED-B1
    verification — pre-fix it would stay).
13. **Active handle outline**: select a bezier handle of the active
    keyform → that handle dot gets a pale-yellow ring (MED-B2 verification).
14. **Undo**: Ctrl+Z after click-set-active restores the prior active
    state (mute IS in undo history).
15. **Save+load**: project saved with active-keyform set on a curve,
    reloaded, halo re-appears on the same keyform (sparse field
    survives roundtrip).

## Queued resume paths (priority order)

1. **Persistent `fcurve.visible` schema field** — replace local-React
   `hidden` Set with persisted boolean. Mirror of mute/selected/active
   triad.
2. **`SELECT_EXTEND_RANGE` (Ctrl+click range select)** — Slice 5.F's
   biggest deferral. Port with the auto-downgrade gate at
   `anim_channels_edit.cc:4517-4522`.
3. **Bulk channel-select operators** — `ANIM_OT_channels_select_all`
   (A/Alt+A).
4. **Operators-on-selected-channels** — bulk mute / unmute / delete
   via Channel menu — exercises both Slice 5.F + 5.G.
5. **Footer wiring for fcurve channel state** — surface selected-count
   + muted-count + active-keyform-info in the editor footer.
6. **N-panel active-keyform numerical editor** — Blender's
   `graph_buttons.cc` per-keyform inline edit; SS partly has this in
   the keyform editor panel but doesn't auto-focus the active one.
7. **Driver variable list / expression editor** — Slice 5.D's biggest
   deferral.
8. **`SIPO_DRAWTIME` seconds-vs-frames display toggle** — MED-B2 from
   Slice 5.E.
9. **`USER_FLAG_NUMINPUT_ADVANCED` preference + auto-enable** — MED-B1
   from Slice 5.E.
10. **Group-level mute (`AGRP_MUTED`)** — gated on FCurveGroup
    datablock landing in a Dopesheet phase. MED-B2 from Slice 5.G.
11. **DopesheetEditor mute-row + active-keyform-row styling** —
    when dopesheet surfaces fcurve rows.
12. **Phase 2 owed-manual verification** — live recording bezier
    export, Hiyori round-trip.
13. **Phase 3 — F-Curve modifiers** — Cycles / Noise / Generator /
    Envelope.
