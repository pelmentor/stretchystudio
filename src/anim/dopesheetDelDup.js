// @ts-check

/**
 * Dopesheet delete + duplicate ops — Animation Phase 6 Slice 6.D.
 *
 * Pure mutation helpers for the Delete + Shift+D gestures in the
 * Dopesheet. Companion to `dopesheetGrab.js` (Slice 6.C, modal grab)
 * — Shift+D = duplicate + auto-enter grab (Blender's
 * `ACTION_OT_duplicate_move` macro pattern).
 *
 * # What this slice ports
 *
 * Blender's `ACTION_OT_delete` + `ACTION_OT_duplicate` operators
 * dispatched from the SpaceAction (Dopesheet). Reference path:
 *
 *   - **Keymap** at
 *     `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:2703-2704`:
 *
 *     ```py
 *     ("action.delete",         {"type": 'DEL', "value": 'PRESS'},
 *                               {"properties": [("confirm", False)]}),
 *     ("action.duplicate_move", {"type": 'D',   "value": 'PRESS', "shift": True}, None),
 *     ```
 *
 *   - **Delete operator** at
 *     `reference/blender/source/blender/editors/space_action/action_edit.cc:1210-1225`
 *     (`ACTION_OT_delete`). Calls `delete_action_keys` at `:1118-1170`
 *     which loops visible filtered FCurves and per fcurve calls
 *     `BKE_fcurve_delete_keys_selected` at
 *     `reference/blender/source/blender/blenkernel/intern/fcurve.cc:1757-1784`.
 *     The kernel walks `bezt[]` and removes every entry where
 *     `bezt->f2 & SELECT` (the CENTER bit) via memmove + totvert--.
 *     Handle-only selections (`f1` / `f3` without `f2`) are NOT
 *     deleted — matches the Graph Editor's V-menu separate "clear
 *     handles" path. Blender additionally:
 *
 *     1. Clears `fcu->active_keyframe_index` if the deleted key was
 *        the active one (`fcurve.cc:1768-1770`).
 *     2. Calls `BKE_fcurve_is_empty(fcu)` after the per-key loop and,
 *        if true, removes the entire FCurve via
 *        `ED_anim_ale_fcurve_delete` (`action_edit.cc:1154-1157`).
 *
 *     SS already ships the per-fcurve delete primitive as
 *     `deleteKeyforms` in `graphEditOps.js:599-623` — the SS impl
 *     mirrors the center-only / handles-untouched contract. Slice
 *     6.D re-uses it; this module owns the multi-fcurve dispatch
 *     equivalent to Blender's `delete_action_keys` wrapper.
 *
 *     **SS DEVIATION 7 (Phase 6) — Empty-fcurve auto-removal NOT
 *     shipped**: Blender's `BKE_fcurve_is_empty` → `ED_anim_ale_fcurve_delete`
 *     unhooks the FCurve from the Action when its last keyform goes
 *     away. SS keeps empty fcurves in `action.fcurves[]` (matches the
 *     existing behaviour of `deleteKeyforms` + the rest of the SS
 *     animation kernel which tolerates zero-keyform fcurves — the
 *     channel sidebar shows them as empty so the user can re-insert
 *     keys without losing the channel registration). Honest deviation
 *     per Rule №2.
 *
 *   - **Duplicate operator** at `action_edit.cc:1097-1110`
 *     (`ACTION_OT_duplicate`). Calls `duplicate_action_keys` at
 *     `:1034-1073` which loops visible filtered FCurves and per
 *     fcurve calls `duplicate_fcurve_keys` at
 *     `reference/blender/source/blender/editors/animation/keyframes_general.cc:62-95`.
 *     The kernel walks `bezt[]` and, for each `bezt[i].f2 & SELECT`:
 *
 *     1. Allocates a new array of size `totvert + 1`.
 *     2. Copies entries `[0..i]` from old to new, then re-copies
 *        `bezt[i]` at position `i+1`, then copies `[i+1..totvert)`.
 *        Result: duplicate inserted IMMEDIATELY AFTER the original.
 *     3. Frees old array, reassigns `bezt`.
 *     4. **Deselects** the original at index `i`
 *        (`BEZT_DESEL_ALL(&fcu->bezt[i])`).
 *     5. Increments `i++` so the inner loop now points at the copy.
 *     6. **Selects** the copy
 *        (`BEZT_SEL_ALL(&fcu->bezt[i])`).
 *     7. Loop `i++` advances past the copy.
 *
 *     Net effect: every previously-selected keyform has a duplicate
 *     inserted right after it; the selection now points exclusively at
 *     the duplicates (originals are deselected).
 *
 *   - **Shift+D macro** at
 *     `reference/blender/source/blender/editors/space_action/action_ops.cc:80-89`:
 *
 *     ```cpp
 *     ot = WM_operatortype_append_macro("ACTION_OT_duplicate_move",
 *                                       "Duplicate",
 *                                       "Make a copy of all selected keyframes and move them",
 *                                       OPTYPE_UNDO | OPTYPE_REGISTER);
 *     WM_operatortype_macro_define(ot, "ACTION_OT_duplicate");
 *     otmacro = WM_operatortype_macro_define(ot, "TRANSFORM_OT_transform");
 *     RNA_enum_set(otmacro->ptr, "mode", ed::transform::TFM_TIME_TRANSLATE);
 *     RNA_boolean_set(otmacro->ptr, "use_duplicated_keyframes", true);
 *     ```
 *
 *     `ACTION_OT_duplicate_move` is a 2-step MACRO: first runs
 *     `ACTION_OT_duplicate`, then immediately invokes
 *     `TRANSFORM_OT_transform mode=TFM_TIME_TRANSLATE
 *     use_duplicated_keyframes=true`. The user sees a single Shift+D
 *     gesture but the editor enters the grab modal pre-targeted at
 *     the brand-new duplicates. SS mirrors this in
 *     `DopesheetEditor.jsx` by running `applyDuplicateKeyforms` +
 *     `remapHandlesAfterTranslate` (re-targeting the selection store
 *     at the duplicates) + then programmatically entering the 6.C
 *     grab modal at the cursor's current position.
 *
 * # Pure-ops contract (matches Slice 6.C `dopesheetGrab.js`)
 *
 * Two helpers split by mutation scope, same shape as 6.C:
 *
 *   1. `applyDeleteKeyforms(action, handles)` — IMMER-FRIENDLY
 *      mutator. Walks every fcurveId in `handles`; for each, calls
 *      `deleteKeyforms` with the selection map; collects per-fcurve
 *      `Map<oldIdx, newIdx | -1>` remaps. Returns `{ remaps, changed }`.
 *      Caller passes `remaps` to `remapHandlesAfterTranslate` (from
 *      `dopesheetGrab.js`) — the remap shape is IDENTICAL (deleted
 *      entries marked -1; selection entries pointing at -1 get
 *      dropped). The same composition works.
 *
 *   2. `applyDuplicateKeyforms(action, handles)` — IMMER-FRIENDLY
 *      mutator. Walks every fcurveId in `handles`; for each, walks
 *      the SELECTED center keyforms in ASCENDING index order and
 *      inserts a duplicate immediately after each, re-targeting the
 *      remap to point at the DUPLICATE position. The original is NOT
 *      removed from the keyforms array but is no longer in the
 *      selection (the remap entry for oldIdx points at the duplicate
 *      newIdx; `remapHandlesAfterTranslate` puts the selection at the
 *      duplicate; the original at its new shifted index is not
 *      mentioned in the input handles so it stays unselected). Returns
 *      `{ remaps, changed }`.
 *
 *   3. `wouldDeleteKeyformsChange(handles)` / `wouldDuplicateKeyformsChange(handles)`
 *      — cheap predicates. Both return true iff handles contains at
 *      least one entry with `.center === true`. Mirrors Blender's
 *      pre-op `count` check; SS uses for the keymap handler's early-
 *      return + the menu's enabled-state gate.
 *
 * # Why the split from `graphEditOps.js#deleteKeyforms`
 *
 * `deleteKeyforms` operates on ONE fcurve. The dopesheet operates on
 * the full action — many fcurves at once. The dispatch wrapper at
 * this layer:
 *
 *   - Walks `action.fcurves[]`.
 *   - For each fcurve that has any selection (handles.get(fc.id) !==
 *     undefined), calls the per-fcurve kernel.
 *   - Collects per-fcurve remaps into the outer
 *     `Map<fcurveId, Map<oldIdx, newIdx | -1>>` shape that
 *     `remapHandlesAfterTranslate` consumes.
 *
 * Mirrors Blender's `delete_action_keys` (`action_edit.cc:1118-1170`)
 * / `duplicate_action_keys` (`action_edit.cc:1034-1073`) wrappers.
 *
 * @module anim/dopesheetDelDup
 */

import { deleteKeyforms } from './graphEditOps.js';
import { recalcKeyformHandles } from './fcurveHandles.js';

/**
 * @typedef {{ center: boolean, left: boolean, right: boolean }} HandleParts
 * @typedef {Map<string, Map<number, HandleParts>>} SelectedHandlesMap
 *
 * @typedef {{
 *   time: number,
 *   value: number,
 *   handleLeft?: { time: number, value: number },
 *   handleRight?: { time: number, value: number },
 *   handleType?: { left: string, right: string },
 *   interpolation?: string,
 *   flag?: number,
 * }} Keyform
 *
 * @typedef {{
 *   id: string,
 *   keyforms: Keyform[],
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurves: FCurveLike[],
 *   duration?: number,
 * }} ActionLike
 *
 * @typedef {Map<string, Map<number, number>>} DelDupRemaps
 *   Outer Map keyed by fcurveId; inner Map keyed by OLD keyform
 *   index; value is the NEW keyform index after the op (or -1 if the
 *   keyform was deleted). Same shape as 6.C's `TranslateRemaps`, so
 *   `remapHandlesAfterTranslate` in `dopesheetGrab.js` consumes
 *   either result with no change.
 *
 * @typedef {{ remaps: DelDupRemaps, changed: boolean }} DelDupResult
 */

/**
 * Predicate: would delete/duplicate operations have any effect?
 * True iff `handles` contains at least one entry with `.center ===
 * true`. Mirrors Blender's pre-op count check
 * (`action_edit.cc:1037-1043` ANIMFILTER setup is followed by a
 * per-fcurve loop that no-ops on zero selected; the high-level
 * `actkeys_*_exec` returns OPERATOR_CANCELLED if `*_action_keys`
 * reports `false`).
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @returns {boolean}
 */
export function wouldDelDupChange(handles) {
  if (!handles || typeof handles.get !== 'function') return false;
  for (const sub of handles.values()) {
    if (!sub || typeof sub.values !== 'function') continue;
    for (const parts of sub.values()) {
      if (parts && parts.center === true) return true;
    }
  }
  return false;
}

/**
 * Apply Blender's `delete_action_keys` semantics to `action` for
 * every fcurveId in `handles`. Immer-friendly: mutates
 * `action.fcurves[i].keyforms` in place by replacing the array with
 * a filtered copy (delegating to `deleteKeyforms` from graphEditOps
 * which already implements the per-fcurve kernel).
 *
 * Per-fcurve behavior:
 *
 *   1. Delete every keyform whose `HandleParts.center === true` in
 *      the selection. Handle-only selections (`center === false`)
 *      leave the keyform intact, matching Blender's
 *      `BKE_fcurve_delete_keys_selected` `f2 & SELECT` gate
 *      (`fcurve.cc:1767`).
 *   2. Re-derive auto/aligned handles on the survivors via
 *      `recalcKeyformHandles` — Blender's
 *      `ANIM_animdata_update(ac, &anim_data)` at `action_edit.cc:1166`
 *      triggers `calchandles_fcurve_ex` via the per-ale update tag.
 *
 * SS DEVIATION 7 (Phase 6): SS does NOT remove an FCurve when its
 * last keyform is deleted (Blender's `BKE_fcurve_is_empty` →
 * `ED_anim_ale_fcurve_delete` path at `action_edit.cc:1154-1157`).
 * Empty fcurves remain in `action.fcurves[]` so the user can re-insert
 * keys without losing the channel registration. Honest deviation.
 *
 * Returns `{ remaps, changed }`:
 *
 *   - `remaps`: `Map<fcurveId, Map<oldIdx, newIdx | -1>>`. Caller
 *     passes this to `remapHandlesAfterTranslate` (from
 *     `dopesheetGrab.js`) to update the selection store ref.
 *   - `changed`: true if any keyform was actually deleted.
 *
 * **Throws Rule-№1** on bad input: missing action, non-array
 * `action.fcurves`. No silent fallback per
 * `feedback_no_crutches_rule_one`.
 *
 * @param {ActionLike} action
 * @param {SelectedHandlesMap | null | undefined} handles
 * @returns {DelDupResult}
 */
export function applyDeleteKeyforms(action, handles) {
  if (!action || typeof action !== 'object') {
    throw new Error('applyDeleteKeyforms: action must be a non-null object');
  }
  if (!Array.isArray(action.fcurves)) {
    throw new Error('applyDeleteKeyforms: action.fcurves must be an array');
  }
  /** @type {DelDupRemaps} */
  const remaps = new Map();
  if (!handles || typeof handles.get !== 'function' || handles.size === 0) {
    return { remaps, changed: false };
  }
  let anyChanged = false;
  for (const fc of action.fcurves) {
    if (!fc || typeof fc.id !== 'string') continue;
    const sub = handles.get(fc.id);
    if (!sub || typeof sub.get !== 'function' || sub.size === 0) continue;
    if (!Array.isArray(fc.keyforms) || fc.keyforms.length === 0) continue;
    // Audit-fix Slice 6.D MED-A1: pre-filter the selection map to ONLY
    // in-bounds center=true entries before delegating to
    // `graphEditOps.deleteKeyforms`. Mirrors the OOB-guard already in
    // `applyDuplicateKeyforms`. Pre-fix, an OOB index in the selection
    // (e.g. idx 5 in a 1-keyform fcurve) would slip past the
    // delegate's `toDelete.has(i)` check (since the array loop never
    // visits index 5) but still produce a non-empty remap of survivor
    // positions, which previously was silently swallowed by a
    // "length-unchanged → continue" check. Per Rule №1, no silent
    // fallback: pre-filter at the contract boundary instead.
    /** @type {Map<number, import('./graphEditOps.js').SelectionParts>} */
    const filteredSel = new Map();
    for (const [kfIdx, parts] of sub.entries()) {
      if (typeof kfIdx !== 'number' || kfIdx < 0 || kfIdx >= fc.keyforms.length) {
        continue;
      }
      if (parts && parts.center === true) filteredSel.set(kfIdx, parts);
    }
    if (filteredSel.size === 0) continue;
    // Snapshot pre-delete length to invariant-check the delegate.
    const before = fc.keyforms.length;
    // graphEditOps.deleteKeyforms returns the per-fcurve remap and
    // mutates `fc.keyforms` in place. After our pre-filter, every
    // entry in `filteredSel` is in-bounds + center=true, so the
    // delegate is guaranteed to shrink the array.
    const fcRemap = deleteKeyforms(fc, filteredSel);
    if (fcRemap.size === 0) continue;   // defensive — shouldn't fire
    // Rule №1 throw: with the pre-filter in place, length-unchanged
    // is now a true invariant violation in the delegate.
    if (fc.keyforms.length === before) {
      throw new Error(
        `applyDeleteKeyforms: invariant violated for fc.id=${fc.id} — `
        + `non-empty remap (${fcRemap.size}) but keyforms array `
        + `length unchanged (${before})`,
      );
    }
    anyChanged = true;
    remaps.set(fc.id, fcRemap);
    // Settle auto/aligned handles against the new neighbour topology.
    // Blender's `ANIM_animdata_update` at action_edit.cc:1166 triggers
    // `calchandles_fcurve_ex` via the ANIM_UPDATE_DEFAULT tag.
    recalcKeyformHandles(fc.keyforms);
  }
  return { remaps, changed: anyChanged };
}

/**
 * Apply Blender's `duplicate_fcurve_keys` semantics to `action` for
 * every fcurveId in `handles`. Immer-friendly: mutates
 * `action.fcurves[i].keyforms` in place by inserting a duplicate
 * after each selected center keyform.
 *
 * Per-fcurve behavior (mirrors `keyframes_general.cc:62-95`):
 *
 *   1. Walk selected center indices in ASCENDING order.
 *   2. For each selected oldIdx, allocate a duplicate of the keyform
 *      (deep-copy of `time` / `value` / `handleLeft` / `handleRight`
 *      / `handleType` / `interpolation` / `flag`).
 *   3. Insert the duplicate at position `oldIdx + 1 + dupCountSoFar`
 *      (`dupCountSoFar` is the number of duplicates already inserted
 *      in this fcurve from PREVIOUS iterations of the ascending walk —
 *      each insertion shifts subsequent indices up by 1).
 *   4. Record the remap: `oldIdx → newIdxOfDuplicate` (the duplicate's
 *      final position in the post-insert array).
 *   5. Re-derive auto/aligned handles via `recalcKeyformHandles`.
 *
 * The remap is `Map<oldIdx, newIdxOfDuplicate>` (NO -1 entries — every
 * selected keyform survives + gets a duplicate). When
 * `remapHandlesAfterTranslate` consumes this remap, the selection
 * shifts to point at the DUPLICATES (because the input handles' keys
 * are the originals' indices, replaced by the duplicates' indices).
 * The originals are left in `keyforms[]` but no longer in the
 * selection store — mirroring (but not byte-exactly, see SS DEVIATION
 * 10 below) Blender's `BEZT_DESEL_ALL(original) + BEZT_SEL_ALL(copy)`
 * pair at `keyframes_general.cc:87-91`.
 *
 * **SS DEVIATION 10 (audit-fix Slice 6.D MED-F1)**: Blender's
 * `BEZT_SEL_ALL(copy)` FORCE-SETS all three selection bits (f1/f2/f3
 * = left handle / center / right handle) on the duplicate, REGARDLESS
 * of the original's partial-bit state. SS's `applyDuplicateKeyforms`
 * carries the original's `HandleParts` (`{center, left, right}`)
 * verbatim onto the duplicate's new index via `remapHandlesAfterTranslate`.
 * If the user had a partial selection on the original (e.g. `center=true,
 * left=true, right=false`), the duplicate inherits the same partial
 * profile in SS but would be all-bits-on in Blender. Under realistic
 * SS dopesheet UX (tick-click + box-select both set all three bits in
 * lockstep — see `dopesheetSelectOps.js` HandleParts payload comment),
 * `parts.center === true` almost always co-occurs with `parts.left ===
 * true && parts.right === true`, so the divergence is invisible. But
 * it's a real semantic difference; honest deviation per Rule №2. To
 * close the gap, the caller would need to override the duplicate's
 * HandleParts to `{center: true, left: true, right: true}` post-remap
 * — declined for 6.D because the existing remap-pipeline shape is
 * shared with delete + translate which DON'T force-set bits, and
 * adding a per-op selection-override branch would split the contract.
 *
 * SS-specific detail: Blender's duplicate inserts at position `i+1`
 * (immediately after the original in the same iteration), but SS's
 * pre-sort-then-insert pattern means we must compute the SHIFT from
 * earlier duplicates. Equivalent net result; SS uses an explicit
 * accumulator `dupCountSoFar` because the ASCENDING walk over the
 * SELECTION map's keys (which may not be contiguous) needs to track
 * how many earlier insertions occurred to land each duplicate at the
 * correct position.
 *
 * Auto-enter grab modal (Shift+D macro at
 * `action_ops.cc:80-89` — `ACTION_OT_duplicate_move` = duplicate then
 * TFM_TIME_TRANSLATE with `use_duplicated_keyframes=true`) is the
 * CALLER's responsibility — this pure op only does the duplicate.
 * `DopesheetEditor.jsx` wires the macro by chaining `apply*` +
 * `remapHandlesAfterTranslate` + entering the 6.C grab modal.
 *
 * **Throws Rule-№1** on bad input: missing action, non-array
 * `action.fcurves`. No silent fallback per
 * `feedback_no_crutches_rule_one`.
 *
 * @param {ActionLike} action
 * @param {SelectedHandlesMap | null | undefined} handles
 * @returns {DelDupResult}
 */
export function applyDuplicateKeyforms(action, handles) {
  if (!action || typeof action !== 'object') {
    throw new Error('applyDuplicateKeyforms: action must be a non-null object');
  }
  if (!Array.isArray(action.fcurves)) {
    throw new Error('applyDuplicateKeyforms: action.fcurves must be an array');
  }
  /** @type {DelDupRemaps} */
  const remaps = new Map();
  if (!handles || typeof handles.get !== 'function' || handles.size === 0) {
    return { remaps, changed: false };
  }
  let anyChanged = false;
  for (const fc of action.fcurves) {
    if (!fc || typeof fc.id !== 'string') continue;
    const sub = handles.get(fc.id);
    if (!sub || typeof sub.get !== 'function' || sub.size === 0) continue;
    if (!Array.isArray(fc.keyforms) || fc.keyforms.length === 0) continue;
    // Collect selected center indices in ASCENDING order (Blender
    // walks i=0..totvert, so order is implicit). The Map's insertion
    // order is NOT guaranteed to be ascending, so sort explicitly.
    /** @type {number[]} */
    const selectedIdxs = [];
    for (const [kfIdx, parts] of sub.entries()) {
      if (typeof kfIdx !== 'number' || kfIdx < 0 || kfIdx >= fc.keyforms.length) {
        continue;
      }
      if (parts && parts.center === true) selectedIdxs.push(kfIdx);
    }
    if (selectedIdxs.length === 0) continue;
    selectedIdxs.sort((a, b) => a - b);
    // Build the new array by walking the old + injecting duplicates
    // after each selected index. Mirrors Blender's per-key
    // `memcpy + memcpy(self at i+1) + memcpy(rest)` allocation pattern
    // at keyframes_general.cc:77-79, but expressed as a single pass
    // since we have the selection up front (Blender allocates a fresh
    // array PER selected key; SS allocates once).
    /** @type {Keyform[]} */
    const next = [];
    /** @type {Map<number, number>} */
    const fcRemap = new Map();
    let selectedCursor = 0;
    for (let oldIdx = 0; oldIdx < fc.keyforms.length; oldIdx++) {
      const kf = fc.keyforms[oldIdx];
      next.push(kf);
      // Is this oldIdx in our ascending selectedIdxs list?
      if (selectedCursor < selectedIdxs.length
          && selectedIdxs[selectedCursor] === oldIdx) {
        // Insert a duplicate immediately after. Deep-copy time/value
        // + handles + handleType (handleType is an object; mutating
        // it on one keyform would surprise on the other).
        const dup = {
          time:  kf.time,
          value: kf.value,
          handleLeft:  kf.handleLeft  ? { ...kf.handleLeft }  : undefined,
          handleRight: kf.handleRight ? { ...kf.handleRight } : undefined,
          handleType:  kf.handleType  ? { ...kf.handleType }  : undefined,
          interpolation: kf.interpolation,
          flag: kf.flag,
        };
        next.push(dup);
        // The duplicate's NEW index = current next.length - 1 (after
        // we just pushed it). The remap points oldIdx → that.
        fcRemap.set(oldIdx, next.length - 1);
        selectedCursor++;
        anyChanged = true;
      }
    }
    if (fcRemap.size === 0) continue;   // defensive
    fc.keyforms = next;
    remaps.set(fc.id, fcRemap);
    // Settle auto/aligned handles. The duplicate sits ON TOP of the
    // original (same time), so the post-insert array temporarily has
    // a same-time cluster — recalcKeyformHandles must tolerate this.
    // It does: the bezier-handle calculator uses time-deltas, and
    // zero-delta neighbours produce zero-length handles which are
    // benign until the user drags the duplicates apart (which is
    // exactly what the auto-enter grab modal does next, mirroring
    // Blender's `ACTION_OT_duplicate_move` macro). Blender ALSO has
    // this transient same-time cluster (the macro chain TFM_TIME_TRANSLATE
    // step at action_ops.cc:85-87 fires immediately after the duplicate),
    // so the temporary state is parity, not an SS-only oddity.
    recalcKeyformHandles(fc.keyforms);
  }
  return { remaps, changed: anyChanged };
}
