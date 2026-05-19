// @ts-check

/**
 * Dopesheet modal-grab ops — Animation Phase 6 Slice 6.C.
 *
 * Pure mutation helpers for the G-keypress modal-grab gesture in the
 * Dopesheet. Companion to `dopesheetSelectOps.js` + `dopesheetBoxSelect.js`
 * which own the SELECTION side; this module owns the TRANSLATION side.
 *
 * # What this slice ports
 *
 * Blender's `TRANSFORM_OT_translate` in TFM_TIME_TRANSLATE mode invoked
 * from the SpaceAction (Dopesheet) area. Reference path:
 *
 *   - `TransConvertType_Action` dispatch table at
 *     `reference/blender/source/blender/editors/transform/transform_convert_action.cc:1404-1409`
 *     — wires `createTransActionData` / `recalcData_actedit` /
 *     `special_aftertrans_update__actedit` for SpaceAction transforms.
 *
 *   - `createTransActionData` at `transform_convert_action.cc:646-985`
 *     walks visible FCurves, counts selected BezTriples (`count_fcurve_keys`),
 *     and builds the TransData2D array with three (x,y) pairs per key:
 *     `td2d->loc` (center), `td2d->h1` (left handle), `td2d->h2` (right
 *     handle), plus initial-position siblings `td->iloc` / `td2d->ih1` /
 *     `td2d->ih2`.
 *
 *   - `recalcData_actedit` at `transform_convert_action.cc:987-1078` runs
 *     per pointer-move during the modal. The CRITICAL line is
 *     `transform_convert_flush_handle2D(td, td2d, 0.0f)` at
 *     `transform_convert_action.cc:1030` — `y_fac = 0.0f` means time-
 *     translate is X-only (no value change). It also force-clamps
 *     `td->loc[1] = td->iloc[1]` on the line above so any accidental Y
 *     drift gets snapped back. This is the byte-faithful "constrain Y"
 *     contract that SS mirrors below.
 *
 *   - `transform_convert_flush_handle2D` at
 *     `reference/blender/source/blender/editors/transform/transform_convert.cc:1267-1285`
 *     is the handle-shift primitive:
 *
 *     ```cpp
 *     float delta_x = td->loc[0] - td->iloc[0];
 *     float delta_y = (td->loc[1] - td->iloc[1]) * y_fac;
 *     if ((td->flag & TD_MOVEHANDLE1) && td2d->h1) {
 *       td2d->h1[0] = td2d->ih1[0] + delta_x;
 *       td2d->h1[1] = td2d->ih1[1] + delta_y;
 *     }
 *     if ((td->flag & TD_MOVEHANDLE2) && td2d->h2) {
 *       td2d->h2[0] = td2d->ih2[0] + delta_x;
 *       td2d->h2[1] = td2d->ih2[1] + delta_y;
 *     }
 *     ```
 *
 *     The handles get the SAME X-delta as the center. This is what
 *     "preserves the bezier shape" — the in/out tangent angles stay
 *     constant relative to the moved center. SS's `shiftKeyformTime`
 *     below mirrors this exactly: `time` / `handleLeft.time` /
 *     `handleRight.time` all add the same `deltaMs`.
 *
 *   - `special_aftertrans_update__actedit` at
 *     `transform_convert_action.cc:1203-1400` runs ONCE on modal commit
 *     (LMB / Enter), NOT on cancel. The relevant branch for ANIMCONT_ACTION
 *     is `:1273-1295`, gated on `(saction->flag & SACTION_NOTRANSKEYCULL)
 *     == 0 && ((canceled == 0) || (duplicate))` — i.e. on a non-canceled
 *     commit (or on a canceled duplicate, irrelevant for plain grab),
 *     call `posttrans_action_clean` at `:1177-1201`.
 *
 *   - `posttrans_action_clean` at `transform_convert_action.cc:1177-1201`
 *     calls `BKE_fcurve_merge_duplicate_keys(fcu, SELECT, false)` per
 *     visible FCurve. SS already ships this primitive as
 *     `mergeDuplicateTimeKeys` in `graphEditOps.js:669-733` (Slice 5.W,
 *     audit-fix HIGH-B3 2026-05-16 — selected key at LOWEST cluster
 *     index wins and overwrites unselected duplicates). 6.C reuses it
 *     verbatim for the post-commit cleanup.
 *
 *   - Implicit post-commit step: Blender's BezTriple array is kept
 *     sorted-by-time as an invariant of `BKE_fcurve_merge_duplicate_keys`
 *     (and the upstream `calchandles_fcurve` path). SS re-sorts
 *     explicitly via `fcurve.keyforms.sort((a,b) => a.time - b.time)`
 *     and runs `recalcKeyformHandles` to re-derive auto/aligned handles
 *     against the new neighbour topology.
 *
 * # Pure-ops contract (matches dopesheetSelectOps / dopesheetBoxSelect)
 *
 * Two helpers split by mutation scope:
 *
 *   1. `applyTimeTranslate(action, handles, deltaMs)` — IMMER-FRIENDLY
 *      mutator. Walks every fcurveId in `handles` where at least one
 *      entry has `.center === true`; shifts time on selected keyform's
 *      center + both handles. Sorts. Calls `mergeDuplicateTimeKeys` for
 *      the Blender-faithful selected-wins-on-collision step. Recalcs
 *      auto/aligned handles. Returns `{ remaps, changed }` where
 *      `remaps` is `Map<fcurveId, Map<oldIdx, newIdx | -1>>` (-1 means
 *      the keyform was merged away). Caller passes `remaps` to
 *      `remapHandlesAfterTranslate` to update the selection store
 *      outside the immer recipe.
 *
 *   2. `remapHandlesAfterTranslate(handles, remaps)` — PURE. Returns a
 *      new SelectedHandlesMap with each entry's index updated through
 *      its fcurve's remap. Drops entries whose new index is -1.
 *      Identity-stable: same ref if remaps is empty or every entry maps
 *      identity-wise.
 *
 *   3. `wouldTimeTranslateChange(handles, deltaMs)` — PREDICATE. Returns
 *      true iff `deltaMs !== 0` AND `handles` contains at least one
 *      entry with `.center === true`. Cheap pre-check for the caller to
 *      skip the no-op early on every pointer-move frame.
 *
 * # Why the split
 *
 * Selection state lives in `keyformSelectionStore` (Zustand, OUTSIDE
 * immer). Action state lives in `projectStore.project` (Zustand-with-
 * immer). Both must be updated atomically for the grab gesture to look
 * coherent, but they have different mutation contracts: immer wants the
 * action mutated in place; the selection store wants a new Map ref.
 * Splitting the op lets the caller bridge that:
 *
 *   ```js
 *   updateProject((project) => {
 *     const action = project.actions.find(a => a.id === activeActionId);
 *     if (!action) return;
 *     const { remaps, changed } = applyTimeTranslate(action, handles, deltaMs);
 *     if (changed) capturedRemaps = remaps;   // smuggle out
 *   });
 *   if (capturedRemaps) {
 *     setKeyformSelectionHandles(prev =>
 *       remapHandlesAfterTranslate(prev, capturedRemaps));
 *   }
 *   ```
 *
 * # SS DEVIATIONS (Phase 6 numbering — cumulative)
 *
 * - **DEV 4** — Time-translate is INTEGER-MS in SS, FLOAT-FRAME in
 *   Blender. Blender's TFM_TIME_TRANSLATE accumulates fractional frames
 *   and only rounds to integer in `recalcData_actedit` for the grease-
 *   pencil branch (`transform_convert_action.cc:1034-1041` —
 *   `round_fl_to_int` is grease-pencil-only). SS's canonical
 *   animation time is ms (per `feedback_ms_canonical_animation_time`),
 *   no sub-ms precision. The deltaMs is rounded to an integer before
 *   being applied. UX consequence: at 60fps the smallest meaningful
 *   step is ~16.7ms; SS quantizes to 1ms, finer than the per-frame
 *   grid. Honest deviation; matches SS's canonical time unit.
 *
 * - **DEV 5** — Snap-to-frame NOT shipped in 6.C; Blender's snap is
 *   `transform_snap_anim_flush_data` at `transform_convert_action.cc:1024`,
 *   gated on `t->tsnap.flag & SCE_SNAP`. The SS scrubber doesn't yet
 *   surface a snap toggle. Scope-deferred to 6.C.1 polish slice if/when
 *   snap UI ships. Honest deviation per Rule №2 (no migration baggage:
 *   declare deferrals as numbered SS DEVIATIONS, not "TODO later"
 *   comments).
 *
 * @module anim/dopesheetGrab
 */

import { recalcKeyformHandles } from './fcurveHandles.js';
import { mergeDuplicateTimeKeys } from './graphEditOps.js';

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
 * @typedef {Map<string, Map<number, number>>} TranslateRemaps
 *   Outer Map keyed by fcurveId; inner Map keyed by OLD keyform index;
 *   value is the NEW keyform index after the translate (or -1 if the
 *   keyform was merged away by `mergeDuplicateTimeKeys`).
 *
 * @typedef {{ remaps: TranslateRemaps, changed: boolean }} TranslateResult
 */

/**
 * Predicate: would a time-translate of `deltaMs` change any state?
 * Returns false (caller can skip) when `deltaMs` is zero OR the handles
 * map has no entry with a selected center bit. Cheap O(K) walk where
 * K is the number of selected fcurves (typically 1-10), short-circuits
 * on first center=true.
 *
 * Mirrors Blender's `count_fcurve_keys` (`transform_convert_action.cc:
 * `:646-985` create path) implicit pre-check: if `count == 0` after the
 * loop, `createTransActionData` returns early without entering modal
 * mode. SS's modal entry already gates on this — `wouldTimeTranslateChange`
 * is a per-frame guard for the preview math.
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {number} deltaMs
 * @returns {boolean}
 */
export function wouldTimeTranslateChange(handles, deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return false;
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
 * Apply a time-translate to every selected keyform in `action`.
 * **Immer-friendly**: mutates `action.fcurves[i].keyforms[j]` in place.
 * Designed to be called inside `updateProject((project) => { ... })`.
 *
 * Per-keyform mutation (Blender parity at `transform_convert.cc:1267-
 * 1285`):
 *
 *   - `kf.time += deltaMsInt`
 *   - `kf.handleLeft.time += deltaMsInt` (if handleLeft present)
 *   - `kf.handleRight.time += deltaMsInt` (if handleRight present)
 *
 * Values are NOT touched (TFM_TIME_TRANSLATE has y_fac=0 per
 * `transform_convert_action.cc:1030`).
 *
 * Post-translate per fcurve:
 *
 *   1. Sort `keyforms[]` by time (preserves the SS invariant — Blender
 *      gets this for free from BKE_fcurve_merge_duplicate_keys; SS
 *      runs it explicitly).
 *   2. Call `mergeDuplicateTimeKeys(fc, perFcurveSelection)` — Blender's
 *      `posttrans_action_clean` → `BKE_fcurve_merge_duplicate_keys`
 *      step. Selected keys at the LOWEST cluster index survive;
 *      duplicates get culled.
 *   3. Call `recalcKeyformHandles(keyforms)` — Blender's
 *      `ANIM_editkeyframes_refresh` at `transform_convert_action.cc:1395`
 *      re-derives auto/aligned handles against the new neighbour
 *      topology.
 *
 * Returns `{ remaps, changed }`:
 *
 *   - `remaps`: `Map<fcurveId, Map<oldIdx, newIdx | -1>>`. Caller
 *     passes this to `remapHandlesAfterTranslate` to update the
 *     selection store ref.
 *   - `changed`: true if any keyform was actually mutated. False
 *     short-circuits the caller's selection update.
 *
 * **Throws Rule-№1** on bad input: non-finite deltaMs, missing action,
 * non-array `action.fcurves`. No silent fallback per
 * `feedback_no_crutches_rule_one`.
 *
 * @param {ActionLike} action
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {number} deltaMs
 * @returns {TranslateResult}
 */
export function applyTimeTranslate(action, handles, deltaMs) {
  if (!action || typeof action !== 'object') {
    throw new Error('applyTimeTranslate: action must be a non-null object');
  }
  if (!Array.isArray(action.fcurves)) {
    throw new Error('applyTimeTranslate: action.fcurves must be an array');
  }
  if (!Number.isFinite(deltaMs)) {
    throw new Error('applyTimeTranslate: deltaMs must be a finite number');
  }
  /** @type {TranslateRemaps} */
  const remaps = new Map();
  if (!handles || typeof handles.get !== 'function' || handles.size === 0) {
    return { remaps, changed: false };
  }
  // SS DEVIATION 4: quantize to integer ms per
  // feedback_ms_canonical_animation_time. Blender accumulates fractional
  // frames; SS canonicalizes to ms-integer here.
  const deltaMsInt = Math.round(deltaMs);
  if (deltaMsInt === 0) {
    return { remaps, changed: false };
  }
  let anyChanged = false;
  for (const fc of action.fcurves) {
    if (!fc || typeof fc.id !== 'string') continue;
    const sub = handles.get(fc.id);
    if (!sub || typeof sub.get !== 'function' || sub.size === 0) continue;
    if (!Array.isArray(fc.keyforms) || fc.keyforms.length === 0) continue;
    // Collect indices with center=true. Skip if no center bits — extend/
    // subtract selections without center are no-op for grab (Blender's
    // `count_fcurve_keys` predicate is `bezt->f2 & SELECT`, the center
    // bit; left/right-only handles aren't TFM_TIME_TRANSLATE targets).
    /** @type {number[]} */
    const targetIdxs = [];
    for (const [kfIdx, parts] of sub.entries()) {
      if (typeof kfIdx !== 'number' || kfIdx < 0 || kfIdx >= fc.keyforms.length) {
        continue;
      }
      if (parts && parts.center === true) targetIdxs.push(kfIdx);
    }
    if (targetIdxs.length === 0) continue;
    // Snapshot pre-shift identity of each keyform so we can build the
    // remap after the sort. We tag each keyform with a transient id
    // via a Map keyed by reference. Per-call only; no schema pollution.
    /** @type {Map<Keyform, number>} */
    const preIdx = new Map();
    for (let i = 0; i < fc.keyforms.length; i++) {
      preIdx.set(fc.keyforms[i], i);
    }
    // Shift center + both handles by the same delta. Mirrors
    // `transform_convert_flush_handle2D` at `transform_convert.cc:
    // :1277-1284` (delta_x applied to both h1 + h2 unconditionally
    // when TD_MOVEHANDLE1/2 flags are set — for time-translate from
    // dopesheet, both handles are always considered moved with their
    // center, since the user thinks "drag the keyframe" not "drag
    // just the center").
    for (const kfIdx of targetIdxs) {
      const kf = fc.keyforms[kfIdx];
      kf.time += deltaMsInt;
      if (kf.handleLeft) kf.handleLeft.time += deltaMsInt;
      if (kf.handleRight) kf.handleRight.time += deltaMsInt;
    }
    anyChanged = true;
    // Sort keyforms by time. Stable-tie via index preservation isn't
    // critical here because `mergeDuplicateTimeKeys` resolves ties
    // deterministically next.
    fc.keyforms.sort((a, b) => a.time - b.time);
    // Build post-sort remap by walking the snapshot Map.
    /** @type {Map<number, number>} */
    const sortRemap = new Map();
    for (let newIdx = 0; newIdx < fc.keyforms.length; newIdx++) {
      const oldIdx = preIdx.get(fc.keyforms[newIdx]);
      if (typeof oldIdx === 'number') sortRemap.set(oldIdx, newIdx);
    }
    // Build the per-fcurve selection (HandleParts shape) the
    // mergeDuplicateTimeKeys op expects, indexed by POST-SORT
    // positions. We need to track which post-sort entries were
    // selected so the merge picks the right survivor.
    /** @type {Map<number, HandleParts>} */
    const postSortSelection = new Map();
    for (const [oldIdx, parts] of sub.entries()) {
      if (typeof oldIdx !== 'number') continue;
      const newIdx = sortRemap.get(oldIdx);
      if (typeof newIdx === 'number') postSortSelection.set(newIdx, parts);
    }
    // Merge duplicates — selected wins at the LOWEST cluster index
    // (per `graphEditOps.js:669-733` Blender-faithful semantics).
    // Returns Map<postSortIdx, postMergeIdx | -1>.
    const mergeRemap = mergeDuplicateTimeKeys(fc, postSortSelection, 0.5);
    // Compose the two remaps: oldIdx → postSortIdx → postMergeIdx.
    /** @type {Map<number, number>} */
    const composed = new Map();
    for (const [oldIdx, postSortIdx] of sortRemap.entries()) {
      const finalIdx = mergeRemap.get(postSortIdx);
      composed.set(oldIdx, typeof finalIdx === 'number' ? finalIdx : -1);
    }
    remaps.set(fc.id, composed);
    // Settle auto/aligned handles against the new topology. Blender
    // calls ANIM_editkeyframes_refresh → BKE_fcurve_handles_recalc
    // unconditionally at `transform_convert_action.cc:1395`; SS mirrors.
    recalcKeyformHandles(fc.keyforms);
  }
  return { remaps, changed: anyChanged };
}

/**
 * Pure remap of the selection map after a `applyTimeTranslate` mutation.
 * Returns a NEW SelectedHandlesMap with each entry's keyform index
 * updated through its fcurve's remap. Drops entries whose new index is
 * -1 (merged-away by `mergeDuplicateTimeKeys`).
 *
 * **Identity-stable** when no entry actually moved: returns the same
 * `handles` ref when `remaps` is empty OR every (oldIdx → newIdx) pair
 * is an identity map (i.e. nothing was sorted-into-a-new-position AND
 * nothing was merged away). This matches the no-op contract of the
 * sister `applyTickSelect*` / `applyBoxSelect` ops.
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {TranslateRemaps} remaps
 * @returns {SelectedHandlesMap}
 */
export function remapHandlesAfterTranslate(handles, remaps) {
  const baseHandles = handles ?? new Map();
  if (!remaps || remaps.size === 0) return baseHandles;
  let anyChange = false;
  /** @type {SelectedHandlesMap} */
  const next = new Map();
  for (const [fcurveId, sub] of baseHandles.entries()) {
    const fcRemap = remaps.get(fcurveId);
    if (!fcRemap || fcRemap.size === 0) {
      next.set(fcurveId, sub);
      continue;
    }
    /** @type {Map<number, HandleParts>} */
    const nextSub = new Map();
    for (const [oldIdx, parts] of sub.entries()) {
      const newIdx = fcRemap.get(oldIdx);
      if (typeof newIdx !== 'number') {
        // Not in remap → entry unaffected (e.g. a fcurve in the
        // selection that had no center bit — shouldn't appear in
        // remaps, but defensive on the contract).
        nextSub.set(oldIdx, parts);
        continue;
      }
      if (newIdx === -1) {
        anyChange = true;
        continue;   // merged away — drop
      }
      if (newIdx !== oldIdx) anyChange = true;
      nextSub.set(newIdx, parts);
    }
    if (nextSub.size === 0) {
      // All entries for this fcurve were merged away — drop the outer
      // entry too. Matches `applyBoxSelect` subtract-empties-sub contract.
      anyChange = true;
      continue;
    }
    next.set(fcurveId, nextSub);
  }
  return anyChange ? next : baseHandles;
}
