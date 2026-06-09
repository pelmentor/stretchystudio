// @ts-check

/**
 * FCurve -- Blender's per-property animation curve.
 *
 * Phase 5 scaffold. Loose port of Blender's `FCurve` struct in
 * `reference/blender/source/blender/makesdna/DNA_anim_types.h:341`.
 * An FCurve binds an RNA path to a list of keyframes; keyframe
 * interpolation today is linear-only.
 *
 * # Shape
 *
 *   {
 *     id:         string,
 *     rnaPath:    string,                 // resolves via anim/rnaPath.js
 *     arrayIndex: number?,                // for vector properties (rotation_euler[1] = Y)
 *     keyforms:   [{ time, value, type? }],
 *     driver?:    ChannelDriver,          // overrides keyframe eval when set
 *   }
 *
 * # Eval order
 *
 * Per Blender's animation eval (`evaluate_fcurve` /
 * `BKE_fcurve_driver_evaluate` in `fcurve.cc` and `fcurve_driver.cc`):
 *   1. Evaluate FCurve keyframes at `currentTime` → produces base value.
 *   2. If a Driver is attached, evaluate it AFTER step 1; its output
 *      OVERRIDES the keyframe value (DRIVER eval substitutes for
 *      keyframe eval entirely on a driver F-Curve in Blender, not
 *      mixes -- `influence` slider not modelled here yet).
 *   3. Apply mute / NLA / clamp options (deferred; SS doesn't have NLA).
 *
 * # Phase 2.A: BezTriple keyform shape (post-v39)
 *
 * Keyforms now carry the full Blender BezTriple record:
 *   { time, value,
 *     handleLeft:{time,value}, handleRight:{time,value},
 *     handleType:{left,right},
 *     interpolation,            // 'constant'|'linear'|'bezier'|<10 named easings>
 *     easeMode?, autoHandleType?, flag }
 *
 * Slice 2.C ships the full evaluator: cubic-bezier inversion via
 * Cardano's roots + per-keyform `handleLeft`/`handleRight` consumption,
 * and the 10 named easings (sine/quad/cubic/quart/quint/expo/circ/back/
 * bounce/elastic) × {in/out/inout} per Blender's `BLI_easing_*`
 * functions. The dispatch lives in
 * [fcurveEval.js](./fcurveEval.js)#evaluateBezTripleSegment so both
 * `evaluateFCurve` and `interpolateTrack` (animationEngine path) use
 * the same implementation.
 *
 * # Other Blender deviations still in flight
 * - Baked sample arrays (`fpt: FPoint[]` for imported motions) — SS
 *   doesn't ship these; every keyform is user-authored or migrated.
 *
 * # Phase 3: FModifier stack (post-v41)
 *
 * `FCurve.modifiers?: FModifier[]` shipped in Slice 3.A (schema v41).
 * Sparse field; missing or empty-array means "no modifiers". Six
 * modifier types documented in [fmodifiers.js](./fmodifiers.js):
 * cycles / noise / generator / limits / stepped / envelope. Evaluator
 * lands in Slice 3.B; UI in 3.C; exporter bake passes in 3.D / 3.E.
 *
 * @module anim/fcurve
 */

import { evaluateDriver } from './driver.js';
import { evaluateBezTripleSegment } from './fcurveEval.js';
import { recalcKeyformHandles } from './fcurveHandles.js';
import {
  getFCurveModifiers,
  evaluateTimeModifiers,
  evaluateValueModifiers,
} from './fmodifiers.js';

/**
 * @typedef {Object} HandlePoint
 * @property {number} time
 * @property {number} value
 *
 * @typedef {Object} Keyframe
 * @property {number} time
 * @property {number} value
 * @property {HandlePoint} [handleLeft]
 * @property {HandlePoint} [handleRight]
 * @property {{left:string, right:string}} [handleType]
 * @property {('constant'|'linear'|'bezier'|'sine'|'quad'|'cubic'|'quart'|'quint'|'expo'|'circ'|'back'|'bounce'|'elastic')} [interpolation]
 * @property {('auto'|'in'|'out'|'inout')} [easeMode]
 * @property {('normal'|'locked_final')} [autoHandleType]
 * @property {number} [flag]
 *
 * @typedef {Object} FCurve
 * @property {string} id
 * @property {string} rnaPath
 * @property {number} [arrayIndex]
 * @property {Keyframe[]} keyforms
 * @property {object} [driver]
 * @property {boolean} [selected] - Slice 5.F: per-FCurve "channel
 *   selected" flag, independent of the "active FCurve" concept (resolved
 *   from the global selectionStore). Sparse; missing means `false`.
 *   Mirrors Blender's `FCURVE_SELECTED` bit
 *   (`DNA_anim_enums.h:303-310`). Mutated via `applyChannelSelect` in
 *   `anim/fcurveChannelSelect.js`.
 * @property {boolean} [mute] - Slice 5.G: per-FCurve mute flag.
 *   Sparse; missing means `false`. Mirrors Blender's `FCURVE_MUTED` bit
 *   (`DNA_anim_enums.h:303-314`); RNA name `mute` (`rna_fcurve.cc:2690`).
 *   Read via `isFCurveMuted`, toggled via `toggleFCurveMute` in
 *   `anim/fcurveMute.js`. Eval-side gate lives at the caller
 *   (`evaluateActionFCurves`, `kernelFCurveEval`) per Blender's
 *   `is_fcurve_evaluatable` pattern; `evaluateFCurve` itself stays a
 *   pure value function so the Graph Editor render path can still
 *   sample muted curves (drawn greyed).
 * @property {number} [activeKeyformIndex] - Slice 5.H: per-FCurve
 *   active-keyform index. Mirrors Blender's `active_keyframe_index`
 *   on the FCurve struct (`DNA_anim_types.h:362-370`); sentinel
 *   "none" is missing-or-`-1` (`FCURVE_ACTIVE_KEYFRAME_NONE` at
 *   `DNA_anim_enums.h:299-300`). Sparse; missing means NONE. Read via
 *   `getActiveKeyformIndex`, written via `setActiveKeyform` in
 *   `anim/fcurveActiveKeyform.js`. The "must-be-selected" invariant
 *   (Blender's `BLI_assert_msg` in `BKE_fcurve_active_keyframe_set`)
 *   is enforced at the FCurveEditor click site since SS's keyform
 *   selection lives in the editor-local `selectedHandles` Map.
 * @property {boolean} [hide] - Slice 5.I: per-FCurve hide flag
 *   (negative of Blender's `FCURVE_VISIBLE` bit at
 *   `DNA_anim_enums.h:303-305`; RNA name `fcurve.hide` via
 *   `RNA_def_property_boolean_negative_sdna` at `rna_fcurve.cc:2696-2697`).
 *   Sparse; missing means `false` = visible (matches Blender's
 *   `BKE_fcurve_create` default `FCURVE_VISIBLE | FCURVE_SELECTED` at
 *   `animrig/intern/fcurve.cc:62`). Read via `isFCurveHidden`, toggled
 *   via `toggleFCurveHidden` in `anim/fcurveVisible.js`. Editor-only
 *   gate (matches Blender's `is_fcurve_evaluatable` at
 *   `evaluation.cc:95-111` which checks only mute) — hidden curves
 *   still drive their bound properties at eval time.
 * @property {import('./fmodifiers.js').FModifier[]} [modifiers] -- Phase 3
 *   Slice 3.A (schema v41): per-FCurve FModifier stack. Mirrors Blender's
 *   `FCurve.modifiers: ListBaseT<FModifier>` at `DNA_anim_types.h:353`
 *   (the field; `struct FCurve {` opens at `:341`). Sparse; missing or
 *   empty-array means "no modifiers". See
 *   [fmodifiers.js](./fmodifiers.js) for the FModifier typedef +
 *   per-type data shapes. Evaluator lands in Slice 3.B.
 */

/**
 * Evaluate an FCurve at a given time. Returns the interpolated keyframe
 * value, or, if a Driver is attached and its expression resolves, the
 * driver output (which overrides keyframes per Blender's eval order).
 *
 * Empty keyframes list returns `0` (matches Blender's "default value"
 * fallback for unkeyed curves). For times outside the keyframe range,
 * extrapolation is constant -- the first or last keyframe value.
 *
 * @param {FCurve|null|undefined} fcurve
 * @param {number} time
 * @param {object} [evalContext] -- passed through to the driver eval (project, currentValues)
 * @returns {number}
 */
export function evaluateFCurve(fcurve, time, evalContext = {}) {
  if (!fcurve) return 0;
  const keyforms = Array.isArray(fcurve.keyforms) ? fcurve.keyforms : [];
  const modifiers = getFCurveModifiers(fcurve);

  // Step 1: time-modifying modifier pass.
  // Reverse-walks the modifier stack (last -> first) per Blender's
  // `evaluate_time_fmodifiers` at `fmodifier.cc:1490-1548`. Cycles +
  // Limits + Stepped contribute; Noise + Generator + Envelope are
  // value-only and skipped. Scratch carries Cycles' `cycyofs` to the
  // value pass; indexed by modifier array position.
  const { effectiveTime, scratch } = modifiers.length > 0
    ? evaluateTimeModifiers(modifiers, fcurve, time)
    : { effectiveTime: time, scratch: null };

  // Step 2: keyframe sample at effectiveTime.
  let baseValue = 0;
  if (keyforms.length === 0) {
    baseValue = 0;
  } else if (keyforms.length === 1) {
    baseValue = keyforms[0].value;
  } else {
    // Find the bracketing keyframes via binary search. Pre-fix this was
    // a linear scan with a "today's curves are 2-5 keyforms typically"
    // comment; record-mode action capture (post-2026-06-09) emits one
    // keyform per driver per frame, so a 240-frame action has ~240
    // keyforms per driver fcurve. Linear scan averaged N/2 = 120
    // comparisons per eval × 13 drivers × per-render-tick. Binary search
    // brings each eval to O(log K) ≈ 8 comparisons; mirrors what
    // `interpolateTrack` (animationEngine path) already does.
    if (effectiveTime <= keyforms[0].time) {
      baseValue = keyforms[0].value;
    } else if (effectiveTime >= keyforms[keyforms.length - 1].time) {
      baseValue = keyforms[keyforms.length - 1].value;
    } else {
      let lo = 0;
      let hi = keyforms.length - 2;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keyforms[mid + 1].time <= effectiveTime) lo = mid + 1;
        else hi = mid;
      }
      // Slice 2.C: full BezTriple evaluator — bezier (cubic-bezier
      // inversion + value sampling), 10 named easings, plus the
      // legacy linear/constant. Mirrors Blender's
      // `fcurve_eval_keyframes_interpolate` (fcurve.cc:2026).
      baseValue = evaluateBezTripleSegment(keyforms[lo], keyforms[lo + 1], effectiveTime);
    }
  }

  // Step 3: value-modifying modifier pass.
  // Forward-walks the modifier stack (first -> last) per Blender's
  // `evaluate_value_fmodifiers` at `fmodifier.cc:1550-1595`.
  const modifiedValue = modifiers.length > 0
    ? evaluateValueModifiers(modifiers, fcurve, baseValue, effectiveTime, scratch)
    : baseValue;

  // Step 4: driver override.
  // Per Blender's eval order, drivers REPLACE keyframe-based output
  // entirely; modifier output is the "keyframe-based" half of that
  // distinction, so the driver wins over the modifier-composed value
  // when it resolves.
  if (fcurve.driver) {
    try {
      const driverValue = evaluateDriver(fcurve.driver, evalContext);
      if (Number.isFinite(driverValue)) return driverValue;
    } catch {
      // Driver errors fall back to modifier-composed value -- Blender's behaviour.
    }
  }
  return modifiedValue;
}

/**
 * Insert or update a keyframe at `time`. Sorted-insert so the
 * `keyforms[]` invariant (sorted-by-time) holds.
 *
 * @param {FCurve} fcurve
 * @param {number} time
 * @param {number} value
 * @param {('linear'|'constant'|'bezier')} [interpolation='linear']
 */
export function upsertKeyframe(fcurve, time, value, interpolation = 'linear') {
  if (!fcurve) return;
  if (!Array.isArray(fcurve.keyforms)) fcurve.keyforms = [];
  const arr = fcurve.keyforms;
  // BezTriple shape with vector handles at the keyform position.
  // Slice 2.D's auto-handle calculator runs against bezier-typed
  // handles; vector handles produce straight-line segments regardless.
  const handleType = interpolation === 'bezier'
    ? { left: 'auto', right: 'auto' }
    : { left: 'vector', right: 'vector' };
  const kf = {
    time, value,
    handleLeft: { time, value },
    handleRight: { time, value },
    handleType,
    interpolation,
    flag: 0,
  };
  let inserted = false;
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i].time - time) < 1e-6) {
      arr[i] = kf;
      inserted = true;
      break;
    }
    if (arr[i].time > time) {
      arr.splice(i, 0, kf);
      inserted = true;
      break;
    }
  }
  if (!inserted) arr.push(kf);

  // Slice 2.D — reify handles for the inserted key + its neighbours.
  // Blender mirrors this via BKE_fcurve_handles_recalc after every
  // ANIM_OT_keyframe_insert (`reference/blender/source/blender/editors/
  // animation/keyframing.cc` → `BKE_fcurve_handles_recalc`). Without this
  // the new key would carry zero-length default handles, leaking through
  // to exporter (Slice 2.G) + UI (Phase 5 Graph Editor).
  recalcKeyformHandles(arr);
}
