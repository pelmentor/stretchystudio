# Session Close-out — Animation Phase 6 Slice 6.C (Modal grab G key)

**Session date:** 2026-05-19 (continuation; same-day as 6.A+6.B)
**Branch:** master (173 commits ahead of origin/master; +3 this slice)
**Schema:** v42 (no bump — UI substrate only)
**Status:** Slice 6.C SHIPPED.
**Phase 6 status:** 6.A + 6.B + 6.C SHIPPED; 6.D + 6.E +
6.F + 6.G remain.

---

## What this slice shipped

### Substrate

**`src/anim/dopesheetGrab.js`** (NEW, ~360 LOC after audit-fix):

- `applyTimeTranslate(action, handles, deltaMs)` — immer-friendly
  mutator. Shifts `kf.time` + `handleLeft.time` + `handleRight.time`
  by same delta (Blender parity at `transform_convert.cc:1267-1285`);
  sorts; calls `mergeDuplicateTimeKeys` which AVERAGES selected values
  per `fcurve.cc:1801-1916`; recalcs handles. Returns
  `{ remaps: Map<fcurveId, Map<oldIdx, newIdx|-1>>, changed }`.
  Throws Rule №1 on bad input.
- `remapHandlesAfterTranslate(handles, remaps)` — pure. Updates
  selection-store entries through fcurve remaps; identity-stable when
  no entry moved.
- `wouldTimeTranslateChange(handles, deltaMs)` — predicate.
  Short-circuits on first center=true.

### UI surface

`src/v3/editors/dopesheet/DopesheetEditor.jsx`:

- G keypress → modal entry (gated on center-selected count > 0,
  mirroring Blender's `count_fcurve_keys` pre-modal check at
  `transform_convert_action.cc:271-303` invoked from `:702`).
- Window mousemove during grab → updates deltaMs preview using
  px→ms scale captured at entry (`tickAreaScaleRef`).
- LMB or Enter → commit via `updateProject((project) => {
    applyTimeTranslate(project.actions.find(...), handles, dMs);
  })` then `remapHandlesAfterTranslate` on the selection store.
- RMB or Escape → cancel (no mutation — preview was overlay-only;
  cancel is just `setGrabState(null)` + `grabActiveRef.current =
  false`).
- Tick clicks + box-select pointerdowns + B-key arming all
  suppressed during grab via `grabActiveRef.current` early-returns
  (audit-fix HIGH-A2 added the eager-flip pattern so the suppression
  contract holds across the commit's synchronous tail).
- Ghost translucent diamonds render at `kf.time + grabDeltaMs` for
  every selected center-keyform; status pill `Grab: +Nms · LMB/Enter
  commit · RMB/Esc cancel`.

### Refs added

- `grabStateRef` (mirror of grabState for stale-closure-free reads
  inside the listeners-mount effect's commit handler).
- `grabActiveRef` (boolean mirror of `grabState !== null` for
  suppression gates in handleTickClick + handleTrackPointerDown).
- `lastPointerXRef` (track-area-local px; updated on every
  onPointerMove; used as the G-key anchor).
- `tickAreaScaleRef` (`{tickAreaWidth, duration}` snapshot captured
  at grab entry; window-level mousemove uses this for px→ms
  conversion without re-querying the DOM).
- `rowsRef` + `durationRef` (mirrors for `handleTrackPointerUp`
  identity stability — audit-fix MED-A1).

---

## Cite-discipline arc

| Cite | Verified |
|------|----------|
| `transform_convert_action.cc:1404-1409` (dispatch table) | YES |
| `transform_convert_action.cc:646-985` (createTransActionData) | YES |
| `transform_convert_action.cc:987-1078` (recalcData_actedit) | YES |
| `transform_convert_action.cc:1030` (flush call w/ y_fac=0) | YES |
| `transform_convert_action.cc:1028` (constrain-Y line above) | CORRECTED phrasing ("two lines above") |
| `transform_convert.cc:1267-1285` (flush primitive) | YES |
| `transform_convert_action.cc:1203-1400` (special_aftertrans) | YES |
| `transform_convert_action.cc:1177-1201` (posttrans_action_clean) | YES |
| `transform_convert_action.cc:1395` (ANIM_editkeyframes_refresh) | YES |
| `transform_convert_action.cc:271-303` (count_fcurve_keys) | NEW (replaces conflated `:646-985` cite) |
| `transform_convert_action.cc:431` (TD_MOVEHANDLE1|2 set) | NEW (added for handle-shift justification) |
| `fcurve.cc:1801-1916` (BKE_fcurve_merge_duplicate_keys) | NEW (replaces `:669-733` self-cite) |
| `fcurve.cc:1859-1862` (avg formula) | NEW |
| `fcurve.cc:1887` (avg write) | NEW |
| `BKE_fcurve.hh:217` (BEZT_BINARYSEARCH_THRESH = 0.01f) | NEW (replaces FAB `0.00002 s`) |
| `blender_default.py:2718-2719` (G keymap binding) | CORRECTED (was FAB `:2716-2717 transform.translate`) |

**Pre-audit:** 14 cites; **3 FAB** (HIGH-F1 keymap, HIGH-F2 merge
semantics, HIGH-F3 inherited threshold) + 1 phrasing loose.

**Post-audit:** all cites byte-verified. **Cite-discipline BROKE at
3 (fab) — 5-SLICE FAB STREAK** (4.D.4 → 4.E → 6.A → 6.B → 6.C).

Streak arc:
- 5.P broke at 0 → reset
- 3.F-4.C HOLDS at 5 → 4.D.1 BROKE → reset
- 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 → 4.D.4 BROKE at 2 → reset
- 4.E BROKE at 2 → reset → 4.F clean
- 6.A BROKE at 2 → reset
- 6.B BROKE at 1 → reset
- **6.C BROKE at 3 → reset** (1 keymap fab + 1 paraphrase elision +
  1 INHERITED fab from graphEditOps.js sister module)

**Pattern observation across the 5-slice streak (4.D.4 / 4.E / 6.A /
6.B / 6.C):** the `feedback_byte_verify_behavior_cites` workflow
(declared after 6.B) was INSUFFICIENT for 6.C. The `[VERIFY]` marker
pattern works for cites I'm composing fresh, but it doesn't catch:

1. **Keymap fabs driven by pattern memory** — "Blender G key in
   animation editors fires `transform.translate`" is true for graph
   editor / 3D viewport, FALSE for dopesheet (which uses the generic
   `transform.transform mode='TIME_TRANSLATE'`). Pattern memory said
   "translate"; I confirmed the file existed but didn't read the
   actual binding string.

2. **Inherited fabs from sister modules** — graphEditOps.js's
   docstring at `:662-663` carried `BEZT_BINARYSEARCH_THRESH =
   0.00002 s` since Slice 5.W (vintage). 6.C re-quoted it for the
   epsMs context. The CONSUMER cite is verified against the SOURCE
   cite, but the SOURCE cite was never re-verified against Blender.
   This is the same shape as
   `feedback_check_plan_against_impl_on_consumption` but applied
   to SUBSTRATE cites instead of plan claims.

3. **Paraphrase elision** — "selected wins on collision" is a true
   half-statement (unselected do get deleted) but elides the
   averaging step (selected values average → lowest survivor). The
   docstring needed BOTH facts to be honest; I shipped just the
   easier half.

The mitigation insight worth recording: when CONSUMING a previously-
shipped substrate's cites, RE-VERIFY against Blender even when the
cite is already in-tree. The 5-slice streak isn't about laziness
on individual cites; it's about TRUST IN SISTER MODULES being
unjustified when those modules themselves were shipped without the
byte-verify workflow.

---

## Audit findings rolled up (sweep #73)

| Audit | HIGH | MED | LOW | CITE FABS |
|-------|------|-----|-----|-----------|
| Architecture | 2 (dep array + eager suppression flip) | 1 (pointerUp identity stability) | 1 (test §17 doc + header) | 0 |
| Blender fidelity | 1 (CITE FAB count = 3) | 0 | 2 (cite tightening + handle-flag cite) | **3** |

All findings addressed in same-day audit-fix commit `f82e670`.

---

## SS deviations (3 new this slice; Phase-6-cumulative 6)

- **DEV 4 (Phase 6)** — Time-translate is INTEGER-MS in SS
  (`Math.round(deltaMs)` quantize). Blender accumulates fractional
  frames. Matches SS canonical animation time per
  `feedback_ms_canonical_animation_time`.
- **DEV 5 (Phase 6)** — Snap-to-frame NOT shipped; Blender's snap
  is gated on `t->tsnap.flag & SCE_SNAP` at
  `transform_convert_action.cc:1023-1025`. SS scrubber doesn't yet
  surface a snap toggle; deferred to 6.C.1 polish slice. Honest
  deviation per Rule №2.
- **DEV 6 (Phase 6)** — Merge-duplicate epsilon is `0.5 ms` (SS)
  vs Blender's `BEZT_BINARYSEARCH_THRESH = 0.01f` frames (defined at
  `BKE_fcurve.hh:217`). At 60fps Blender = 0.167 ms; at 24fps =
  0.417 ms. SS's 0.5 ms is ~3× coarser at 60fps; matches typical
  pointer-drag overshoot under integer-ms-quantized time. Promoted
  from CITE FAB (the previous `0.00002 s` claim was invented) to
  honest deviation.

---

## Rule №1 catches surfaced this slice

1. **Architecture HIGH-A1** — Listeners-mount effect dep included
   `activeActionId` + `updateProject`. Pre-fix, a mid-grab
   `activeActionId` flip would tear down + re-register listeners,
   and the new commit closure would target the new actionId while
   the user was still mid-translate against the OLD action. Fixed
   by narrowing to `[grabState !== null]` + capturing activeActionId
   in the closure at grab-entry time.

2. **Architecture HIGH-A2** — `setGrabState(null)` is React-async-
   batched; the useEffect mirror that resets
   `grabActiveRef.current = false` ran on the NEXT render. Any
   handler firing synchronously between setGrabState and the mirror
   would still see `grabActiveRef.current === true`. Fixed by
   eagerly flipping `grabActiveRef.current = false` at commit() and
   cancel() entry, closing the synchronous-tail window.

3. **Fidelity HIGH-F1** — Pre-fix docstring CITE FAB on G keymap:
   cited `blender_default.py:2716-2717 transform.translate` — both
   the line range AND the operator name were wrong. Real binding at
   `:2718-2719` is `transform.transform` with
   `mode='TIME_TRANSLATE'`. Fixed cite + operator + documented as
   audit-trail in the Slice 6.C block.

4. **Fidelity HIGH-F2** — Pre-fix merge-semantics docstring claimed
   "selected wins at LOWEST cluster index and OVERWRITES unselected
   duplicates". The OVERWRITES claim is incomplete — Blender's
   `BKE_fcurve_merge_duplicate_keys` actually AVERAGES selected
   values into the lowest-index survivor (`fcurve.cc:1859-1862`
   computes; `:1887` writes); unselected are unconditionally
   deleted (`:1902`). SS impl already averaged correctly
   (`graphEditOps.js:701-705`); only the 6.C docstring lied. Fixed
   with byte-cited semantics.

5. **Fidelity HIGH-F3** — Pre-fix INHERITED CITE FAB:
   `graphEditOps.js:662-663` claimed `BEZT_BINARYSEARCH_THRESH =
   0.00002 s` since Slice 5.W. Real value at `BKE_fcurve.hh:217` is
   `0.01f` FRAMES (with inline comment noting raise from 0.00001).
   Wrong VALUE + wrong UNITS. Fixed at source (graphEditOps.js)
   + consumer (dopesheetGrab.js) + promoted the implicit deviation
   to honest SS DEVIATION 6.

6. **Architecture MED-A1** — `handleTrackPointerUp` had
   `[boxDrag, rows, duration, setKeyformSelectionHandles]` deps —
   recreated on every parent render. Aligned with 6.B HIGH-A1
   pattern: now reads boxDrag via functional setBoxDrag snapshot-
   and-clear; rows + duration via new `rowsRef`/`durationRef`
   refs mirrored by `useEffect`s; dep narrowed to
   `[setKeyformSelectionHandles]` (stable).

---

## Test counts

| File | Pre-slice | Post-slice |
|------|-----------|------------|
| `test_dopesheetGrab.mjs` | 0 | 70 |
| `test_keyformSelectionStore.mjs` | 25 (broken — stale publishHandles ref) | 25 (fixed) |

All sibling NLA / FCurve / Keyform / Dopesheet test suites still
green (verified via full sweep — fcurveActive, fcurveBoxSelect,
fcurveChannelSelect, fcurveEval, fcurveGroups, fcurveModifiers*,
keyform*, nla* incl. test_nlaEval/test_nlaEditorOps/test_nlaTweakMode/
test_nlaEditorData, test_bakeNla, test_dopesheetSelectOps,
test_dopesheetBoxSelect, test_graphEditOps, test_fmodifiers).
Typecheck clean.

---

## Commits this slice (2)

```
98b8a2a feat(anim): Phase 6 Slice 6.C — Dopesheet modal grab (G key time-translate)
f82e670 fix(audit): Phase 6 Slice 6.C audit-fix — 3 HIGH-F cite fabs + 2 HIGH-A bugs + 1 MED-A + LOW polish + 1 new SS DEV
```

(+1 docs commit shipping this close-out + plan banner + MEMORY.)

---

## Top queued path next

**Slice 6.D — Delete (Delete key) + Duplicate (Shift+D) selected
ticks.**

Per plan §6.B operator table: `dopesheet.delete | Delete | Delete
selected` + `dopesheet.duplicate | Shift+D | Duplicate selection
(modal grab)`. Mirrors Blender's `ACTION_OT_delete` + `ACTION_OT_duplicate`
which:

- Delete: walks selected keys per visible FCurve; calls
  `BKE_fcurve_delete_key` (already exists in SS as
  `deleteKeyforms` in `graphEditOps.js`). Handle settling +
  selection cleanup.
- Duplicate: copies selected keys to new entries IMMEDIATELY in
  the same fcurves (Blender's `ACTION_OT_duplicate` does
  `duplicate_action_keys` then auto-enters TFM_TIME_TRANSLATE with
  T_DUPLICATED_KEYFRAMES flag set). SS can reuse 6.C's
  `applyTimeTranslate` modal directly — the only new piece is the
  pre-modal duplicate step.

SS will need:

- A pure `applyDeleteKeyforms(action, handles)` returning
  `{ remaps, changed }` symmetric to `applyTimeTranslate`'s contract.
- A pure `applyDuplicateKeyforms(action, handles)` returning
  `{ remaps, changed }` — copies selected keys, returns new-indices
  remap so the selection updates to point at the DUPLICATES (not
  the originals).
- DopesheetEditor wires Delete keydown → `applyDeleteKeyforms`;
  Shift+D keydown → `applyDuplicateKeyforms` + auto-enter grab modal
  (6.C reuse).

After 6.D:
- **6.E** — Column copy/paste (Ctrl+C / Ctrl+V)
- **6.F** — Per-channel mute (M) + solo (Ctrl+Alt+M)
- **6.G** — Test sweep + Phase 6 exit gate

---

## Pre-compact state (snapshot)

- **Branch**: master, 173 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit this close-out + plan banner +
  MEMORY
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A + 6.B + 6.C SHIPPED (3/7 slices);
  6.D-6.G remain (~2 days estimated)
- **Tests added this slice**: 70 new asserts (test_dopesheetGrab);
  all sibling suites green; typecheck clean
- **Audit sweep this slice**: #73: 2 HIGH-A + 1 MED-A + 1 LOW-A +
  3 HIGH-F (cite fabs) + 2 LOW-F (cite tightening); all addressed
- **Cite-discipline**: BROKE at 3 (fab) on 6.C substrate, RESET to 0
  after audit-fix. 5-slice fab streak driving meta-feedback:
  `feedback_byte_verify_behavior_cites` workflow needs an
  "RE-VERIFY SOURCE cites when re-quoting from sister modules"
  extension.
- **SS deviations (Phase 6)**: 6 cumulative (DEV 1 Ctrl+LMB rebind;
  DEV 2 inclusive bounds; DEV 3 axis-range deferred; DEV 4 integer-ms
  quantize; DEV 5 snap deferred; DEV 6 merge epsilon)
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G
