// @ts-check

/**
 * Insert Keyframe kernel + keying-set operator -- Phase 7.B substrate.
 *
 * Port target: Blender's Insert Keyframe operator (the `I`-key).
 * Slice 7.A shipped the registry; this slice ships the kernel that
 * WRITES keys using a registry entry. The UI surface (I-menu) is 7.C;
 * autokey integration is 7.D.
 *
 * # Blender reference (re-OPENED per memory rule 9 -- 7.A lesson:
 * per-cite re-opening is mandatory, not optional. Each cite below was
 * opened in this slice's authoring session, not re-quoted from drafts.)
 *
 *   - `reference/blender/source/blender/makesdna/DNA_anim_enums.h:500-525`
 *     `enum eInsertKeyFlags : short`. SS adopts a subset:
 *     `NOFLAGS=0`, `NEEDED=(1<<0)`, `REPLACE=(1<<4)`,
 *     `AVAILABLE=(1<<10)`. The bit values mirror Blender so the union
 *     is forward-compatible if SS later adds MATRIX/FAST/CYCLE_AWARE.
 *   - `reference/blender/source/blender/editors/animation/keyframing.cc:177-240`
 *     `insert_key_with_keyingset` -- the operator's kernel entry. Pulls
 *     `cfra` from the scene + delegates to `animrig::apply_keyingset`
 *     (`:198`). SS analog: `applyKeyingSet(project, setId, objectIds,
 *     time, flags)` -- caller (UI layer) supplies time + selection.
 *   - `reference/blender/source/blender/editors/animation/keyframing.cc:410-426`
 *     `insert_key_exec` resolves the active keying set via
 *     `ANIM_keyingset_get_from_enum_type(scene, type)` and falls back
 *     to `insert_key(C, op)` when no set is active. SS analog: when
 *     `setId === null`, the UI must pick a default (7.C territory).
 *   - `reference/blender/source/blender/animrig/intern/keyingsets.cc:411-466`
 *     `apply_keyingset(C, sources, ks, mode, cfra)`. Loops over
 *     `ks->paths` and calls `insert_key_to_keying_set_path` per path
 *     (`:459`). Returns total channels keyed (`:464`); SS returns an
 *     aggregate result with per-channel statuses for UI feedback.
 *   - `reference/blender/source/blender/animrig/intern/keyingsets.cc:294-405`
 *     `insert_key_to_keying_set_path`. Resolves group name (`:312-322`),
 *     resolves array_index (`:327-346`), then per array_index calls
 *     `insert_keyframes(bmain, &id_rna_pointer, group, paths, ...,
 *     anim_eval_context, keytype, path_insert_key_flags)` (`:368-375`).
 *     SS has no array_index concept (DEV 21), so the loop collapses
 *     to a single insert per path.
 *   - `reference/blender/source/blender/animrig/ANIM_keyingsets.hh:85-89`
 *     `enum class ModifyKeyMode { INSERT = 0, DELETE_KEY }` --
 *     `apply_keyingset` is bidirectional. SS Phase 7.B ships INSERT
 *     only; DELETE is the Alt+I path (deferred to 7.C / 7.E).
 *
 * # Result enum -- per-channel insertion status
 *
 * Blender uses `CombinedKeyingResult` / `SingleKeyingResult` from
 * `animrig::insert_key_internal::SingleKeyingResult` (declared in
 * `source/blender/animrig/ANIM_keyframing.hh`). SS adopts a simpler
 * string-status shape with similar coverage:
 *
 *   - `'inserted'`        -- new keyform added to existing fcurve
 *   - `'replaced'`        -- existing keyform at this time replaced
 *   - `'created-fcurve'`  -- new fcurve created with single keyform
 *   - `'skipped-needed'`  -- INSERTKEY_NEEDED set, current value
 *                            already matches (within VALUE_EPSILON)
 *   - `'skipped-replace'` -- INSERTKEY_REPLACE set, no existing key
 *                            at this time
 *   - `'skipped-available'` -- INSERTKEY_AVAILABLE set, no fcurve
 *                              exists for this path
 *   - `'skipped-no-action'` -- owner object has no
 *                              `node.animData.actionId`
 *   - `'skipped-invalid-path'` -- rnaPath couldn't be decoded
 *   - `'skipped-non-finite'` -- current value is NaN/Infinity
 *
 * # SS DEVIATIONS new this slice (26-29)
 *
 *   - DEV 26 -- VALUE_EPSILON = 1e-4 for INSERTKEY_NEEDED comparison.
 *     Blender `BLI_math_base_inline.c` `compare_ff` default is also
 *     1e-4. Match-for-match.
 *   - DEV 27 -- TIME_EPSILON_MS = 0.5 ms for "is there already a key
 *     at this time?" check. Same value as Slice 6.C DEV 6 merge
 *     epsilon (per SS canonical-ms time discipline; Blender uses
 *     0.01f frames per BKE_fcurve.hh:217).
 *   - DEV 28 -- `__params__` and `__scene__` paths route to the
 *     `__scene__` pseudo-Object's animData.actionId. Blender stores
 *     scene-level fcurves directly on `Scene.animation_data`; SS's
 *     `__scene__` is the analog (Phase 1 Stage 1.D pseudo-Object).
 *     Object-owned paths route to `node.animData.actionId` as
 *     expected.
 *   - DEV 29 -- `INSERTKEY_REPLACE` SUPPRESSES creation but does NOT
 *     imply `INSERTKEY_AVAILABLE`. Blender's enum comment at
 *     `DNA_anim_enums.h:522` says "AVAILABLE is implied by REPLACE";
 *     SS treats them as orthogonal because the SS error reporting is
 *     more granular per-channel (REPLACE without existing key
 *     produces `skipped-replace`; AVAILABLE without fcurve produces
 *     `skipped-available`). Behavior is equivalent (neither flag
 *     creates new fcurves) but the result-status distinguishes the
 *     skip reason for UI clarity.
 *
 * @module anim/insertKeyframe
 */

import { evaluateFCurve } from './fcurve.js';
import { evaluateRnaPath } from './rnaPath.js';
import { collectChannels, getKeyingSet } from './keyingSets.js';
import {
  decodeFCurveTarget,
  buildParamFCurve,
  buildNodeFCurve,
  makeBezTripleKeyform,
} from './animationFCurve.js';
import { recalcKeyformHandles } from './fcurveHandles.js';

/**
 * Insert-keyframe flag bitset. Subset of Blender's `eInsertKeyFlags`
 * (DNA_anim_enums.h:500-525); bit values mirror Blender so the union
 * is forward-compatible.
 */
export const INSERTKEY_FLAGS = Object.freeze({
  NOFLAGS: 0,
  NEEDED: 1 << 0,
  REPLACE: 1 << 4,
  AVAILABLE: 1 << 10,
});

/** Value-equality epsilon for INSERTKEY_NEEDED (DEV 26 -- matches Blender `compare_ff`). */
const VALUE_EPSILON = 1e-4;

/** Time-equality epsilon for "existing key at this time?" check (DEV 27 -- SS canonical ms). */
const TIME_EPSILON_MS = 0.5;

/**
 * Resolve which Action a given rnaPath should write to. Object-owned
 * paths use `node.animData.actionId`; `__params__` and `__scene__`
 * paths route to the `__scene__` pseudo-Object (DEV 28). Returns the
 * action object, or `null` if no action is bound.
 *
 * @param {object} project
 * @param {string} rnaPath
 * @returns {{action: object, ownerNodeId: string} | null}
 */
function resolveTargetAction(project, rnaPath) {
  if (!project || typeof rnaPath !== 'string') return null;
  // Use decodeFCurveTarget's regexes against a fake fcurve to extract
  // the object id. Reusing the canonical decoder keeps the rnaPath
  // grammar single-sourced (animationFCurve.js:283-291).
  const decoded = decodeFCurveTarget(/** @type {any} */ ({ rnaPath }));
  if (!decoded) return null;
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const actions = Array.isArray(project.actions) ? project.actions : [];
  /** @type {string} */
  let ownerNodeId;
  if (decoded.kind === 'param') {
    ownerNodeId = '__scene__';
  } else {
    ownerNodeId = decoded.nodeId === '__scene__' ? '__scene__' : decoded.nodeId;
  }
  const node = nodes.find((n) => n?.id === ownerNodeId);
  if (!node) return null;
  const actionId = node.animData?.actionId;
  if (!actionId) return null;
  const action = actions.find((a) => a?.id === actionId);
  if (!action) return null;
  return { action, ownerNodeId };
}

/**
 * Construct a fresh fcurve for a given rnaPath, seeded with a single
 * keyform at (time, value). Returns null if rnaPath grammar is
 * unrecognised.
 */
function buildFCurveForPath(rnaPath, time, value) {
  const decoded = decodeFCurveTarget(/** @type {any} */ ({ rnaPath }));
  if (!decoded) return null;
  const kf = { time, value };
  if (decoded.kind === 'param') return buildParamFCurve(decoded.paramId, [kf]);
  return buildNodeFCurve(decoded.nodeId, decoded.property, [kf]);
}

/**
 * Find an existing keyform in an fcurve at `time` (within
 * TIME_EPSILON_MS), or return -1. Linear scan -- the keyform array is
 * sorted by time so a binary search would be faster, but Phase 7.B
 * keeps the substrate simple; existing eval-side binary search
 * (`fcurve.js`) is the perf path.
 */
function findKeyformAt(keyforms, time) {
  if (!Array.isArray(keyforms)) return -1;
  for (let i = 0; i < keyforms.length; i++) {
    const kf = keyforms[i];
    if (kf && Math.abs(kf.time - time) <= TIME_EPSILON_MS) return i;
  }
  return -1;
}

/**
 * Insert / replace a single keyform at `(time, value)` in an action's
 * fcurve at `rnaPath`. Caller is inside an immer recipe; this mutates
 * the action draft in place. Returns the per-channel status.
 *
 * Note: this is the per-path workhorse; `applyKeyingSet` orchestrates
 * the set-level walk.
 *
 * @param {object} action -- immer draft
 * @param {string} rnaPath
 * @param {number} time
 * @param {number} value
 * @param {number} flags
 * @returns {{
 *   status: 'inserted'|'replaced'|'created-fcurve'|'skipped-needed'|'skipped-replace'|'skipped-available'|'skipped-non-finite',
 *   fcurveId?: string,
 *   keyformIndex?: number,
 * }}
 */
function insertKeyformAtInAction(action, rnaPath, time, value, flags) {
  if (!Number.isFinite(value)) return { status: 'skipped-non-finite' };
  if (!action || !Array.isArray(action.fcurves)) {
    // Action shape is malformed; treat as no-fcurve case.
    if (flags & INSERTKEY_FLAGS.AVAILABLE) return { status: 'skipped-available' };
    if (flags & INSERTKEY_FLAGS.REPLACE) return { status: 'skipped-replace' };
    return { status: 'skipped-available' };
  }
  // Find or create fcurve.
  let fc = action.fcurves.find((/** @type {any} */ f) => f?.rnaPath === rnaPath);
  if (!fc) {
    if (flags & INSERTKEY_FLAGS.AVAILABLE) return { status: 'skipped-available' };
    if (flags & INSERTKEY_FLAGS.REPLACE) return { status: 'skipped-replace' };
    // Create fresh fcurve with single keyform.
    const fresh = buildFCurveForPath(rnaPath, time, value);
    if (!fresh) return { status: 'skipped-available' }; // unparseable path
    action.fcurves.push(fresh);
    return { status: 'created-fcurve', fcurveId: fresh.id, keyformIndex: 0 };
  }
  // INSERTKEY_NEEDED check (skip if eval-at-time already matches value).
  // Blender semantic: REPLACE overrides NEEDED (DNA_anim_enums.h:510-511).
  if ((flags & INSERTKEY_FLAGS.NEEDED) && !(flags & INSERTKEY_FLAGS.REPLACE)) {
    const current = evaluateFCurve(fc, time);
    if (Number.isFinite(current) && Math.abs(current - value) <= VALUE_EPSILON) {
      return { status: 'skipped-needed', fcurveId: fc.id };
    }
  }
  // Find existing keyform at this time.
  const existingIdx = findKeyformAt(fc.keyforms, time);
  if (existingIdx >= 0) {
    // Replace value. Preserve handles where possible; auto-handles will
    // re-derive via recalcKeyformHandles. (We DO replace handles when
    // the new value diverges; the existing handle vectors target the
    // old value and would be wrong post-replace.)
    const kf = fc.keyforms[existingIdx];
    kf.value = value;
    kf.handleLeft = { time: kf.time, value };
    kf.handleRight = { time: kf.time, value };
    recalcKeyformHandles(fc.keyforms);
    return { status: 'replaced', fcurveId: fc.id, keyformIndex: existingIdx };
  }
  // REPLACE flag + no existing key = skip (don't create).
  if (flags & INSERTKEY_FLAGS.REPLACE) {
    return { status: 'skipped-replace', fcurveId: fc.id };
  }
  // Insert new keyform, sorted by time.
  const fresh = makeBezTripleKeyform({ time, value, interpolation: 'bezier' });
  if (!fresh) return { status: 'skipped-non-finite' };
  // Default to auto handles so neighbour-aware recalc fills them.
  fresh.handleType = { left: 'auto', right: 'auto' };
  // Insertion sort by time (most actions have a small keyform count;
  // splice cost stays trivial).
  let insertIdx = fc.keyforms.length;
  for (let i = 0; i < fc.keyforms.length; i++) {
    if (fc.keyforms[i].time > time) {
      insertIdx = i;
      break;
    }
  }
  fc.keyforms.splice(insertIdx, 0, fresh);
  recalcKeyformHandles(fc.keyforms);
  return { status: 'inserted', fcurveId: fc.id, keyformIndex: insertIdx };
}

/**
 * Walk a keying set + insert/replace keys per channel at `time`.
 * The caller is inside an immer recipe; project is the draft.
 *
 * @param {object} project -- immer draft
 * @param {string} setId -- keying-set id (built-in or user-defined)
 * @param {string[]} objectIds -- selection scope passed to collectChannels
 * @param {number} time -- canonical ms
 * @param {number} [flags] -- INSERTKEY_FLAGS bitset (default NOFLAGS)
 * @param {{ resolveValue?: (rnaPath: string) => number | undefined }} [options]
 *   -- `resolveValue` is the runtime value resolver. Defaults to
 *      `evaluateRnaPath(project, path)` which works for non-__params__
 *      paths; the UI (7.C) should pass a resolver that reads the live
 *      paramValuesStore for __params__ paths.
 * @returns {{
 *   count: number,
 *   results: Array<{ path: string, status: string, fcurveId?: string, ownerNodeId?: string }>,
 *   skippedNoAction: number,
 *   skippedInvalidPath: number,
 * }}
 */
export function applyKeyingSet(project, setId, objectIds, time, flags, options) {
  if (!project) throw new Error('applyKeyingSet: project required');
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    throw new Error('applyKeyingSet: time must be a finite number (ms)');
  }
  const set = getKeyingSet(project, setId);
  if (!set) throw new Error(`applyKeyingSet: unknown keying set '${setId}'`);
  const ids = Array.isArray(objectIds) ? objectIds : [];
  const f = typeof flags === 'number' ? flags : INSERTKEY_FLAGS.NOFLAGS;
  const resolve = options?.resolveValue ?? ((path) => /** @type {number|undefined} */ (evaluateRnaPath(project, path)));
  const channels = collectChannels(project, set, ids);
  /** @type {Array<{path:string, status:string, fcurveId?:string, ownerNodeId?:string}>} */
  const results = [];
  let count = 0;
  let skippedNoAction = 0;
  let skippedInvalidPath = 0;
  for (const ch of channels) {
    const path = ch.path;
    const target = resolveTargetAction(project, path);
    if (!target) {
      // Either path doesn't decode OR owner has no animData.actionId.
      // Distinguish for diagnostics: probe decodeFCurveTarget.
      const decoded = decodeFCurveTarget(/** @type {any} */ ({ rnaPath: path }));
      if (!decoded) {
        results.push({ path, status: 'skipped-invalid-path' });
        skippedInvalidPath += 1;
      } else {
        results.push({ path, status: 'skipped-no-action' });
        skippedNoAction += 1;
      }
      continue;
    }
    const currentValue = resolve(path);
    if (!Number.isFinite(currentValue)) {
      results.push({ path, status: 'skipped-non-finite', ownerNodeId: target.ownerNodeId });
      continue;
    }
    const r = insertKeyformAtInAction(target.action, path, time, /** @type {number} */ (currentValue), f);
    results.push({ path, status: r.status, fcurveId: r.fcurveId, ownerNodeId: target.ownerNodeId });
    if (r.status === 'inserted' || r.status === 'replaced' || r.status === 'created-fcurve') {
      count += 1;
    }
  }
  return { count, results, skippedNoAction, skippedInvalidPath };
}

/**
 * Pure predicate -- would `applyKeyingSet(...)` cause any mutation?
 * Cheaper than running the full op + checking count; useful for
 * disabling the I-menu button when nothing would happen.
 *
 * Note: this DOES read evaluator state (calls `resolveValue` per
 * channel + evaluates fcurves for the NEEDED check), but performs no
 * mutation -- safe to call outside an immer recipe.
 *
 * @param {object} project
 * @param {string} setId
 * @param {string[]} objectIds
 * @param {number} time
 * @param {number} [flags]
 * @param {{ resolveValue?: (rnaPath: string) => number | undefined }} [options]
 * @returns {boolean}
 */
export function wouldApplyKeyingSetChange(project, setId, objectIds, time, flags, options) {
  if (!project || typeof time !== 'number' || !Number.isFinite(time)) return false;
  const set = getKeyingSet(project, setId);
  if (!set) return false;
  const ids = Array.isArray(objectIds) ? objectIds : [];
  const f = typeof flags === 'number' ? flags : INSERTKEY_FLAGS.NOFLAGS;
  const resolve = options?.resolveValue ?? ((path) => /** @type {number|undefined} */ (evaluateRnaPath(project, path)));
  const channels = collectChannels(project, set, ids);
  for (const ch of channels) {
    const target = resolveTargetAction(project, ch.path);
    if (!target) continue;
    const currentValue = resolve(ch.path);
    if (!Number.isFinite(currentValue)) continue;
    const fc = target.action.fcurves?.find((/** @type {any} */ x) => x?.rnaPath === ch.path);
    if (!fc) {
      // No fcurve: would create unless AVAILABLE/REPLACE suppresses.
      if (f & INSERTKEY_FLAGS.AVAILABLE) continue;
      if (f & INSERTKEY_FLAGS.REPLACE) continue;
      return true;
    }
    // NEEDED + value matches → no change.
    if ((f & INSERTKEY_FLAGS.NEEDED) && !(f & INSERTKEY_FLAGS.REPLACE)) {
      const current = evaluateFCurve(fc, time);
      if (Number.isFinite(current) && Math.abs(current - /** @type {number} */ (currentValue)) <= VALUE_EPSILON) continue;
    }
    const existingIdx = findKeyformAt(fc.keyforms, time);
    if (existingIdx >= 0) {
      // Replace would change value if currentValue differs from existing.
      const kf = fc.keyforms[existingIdx];
      if (Math.abs(kf.value - /** @type {number} */ (currentValue)) > VALUE_EPSILON) return true;
      continue;
    }
    // No existing key: would insert unless REPLACE suppresses.
    if (f & INSERTKEY_FLAGS.REPLACE) continue;
    return true;
  }
  return false;
}
