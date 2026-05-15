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
 * - Per-FCurve `modifiers: ListBaseT<FModifier>` (cyclic, noise,
 *   generator, envelope) — Phase 3 of the Animation Blender-Parity Plan.
 *
 * @module anim/fcurve
 */

import { evaluateDriver } from './driver.js';
import { evaluateBezTripleSegment } from './fcurveEval.js';

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
  // Step 1: keyframe-driven base value.
  const keyforms = Array.isArray(fcurve.keyforms) ? fcurve.keyforms : [];
  let baseValue = 0;
  if (keyforms.length === 0) {
    baseValue = 0;
  } else if (keyforms.length === 1) {
    baseValue = keyforms[0].value;
  } else {
    // Find the bracketing keyframes via linear scan (binary search is
    // cheap upgrade later; today's curves are 2-5 keyforms typically).
    if (time <= keyforms[0].time) {
      baseValue = keyforms[0].value;
    } else if (time >= keyforms[keyforms.length - 1].time) {
      baseValue = keyforms[keyforms.length - 1].value;
    } else {
      for (let i = 0; i < keyforms.length - 1; i++) {
        const a = keyforms[i];
        const b = keyforms[i + 1];
        if (time >= a.time && time <= b.time) {
          // Slice 2.C: full BezTriple evaluator — bezier (cubic-bezier
          // inversion + value sampling), 10 named easings, plus the
          // legacy linear/constant. Mirrors Blender's
          // `fcurve_eval_keyframes_interpolate` (fcurve.cc:2026).
          baseValue = evaluateBezTripleSegment(a, b, time);
          break;
        }
      }
    }
  }

  // Step 2: driver override.
  if (fcurve.driver) {
    try {
      const driverValue = evaluateDriver(fcurve.driver, evalContext);
      if (Number.isFinite(driverValue)) return driverValue;
    } catch {
      // Driver errors fall back to keyframe value -- Blender's behaviour.
    }
  }
  return baseValue;
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
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i].time - time) < 1e-6) {
      arr[i] = kf;
      return;
    }
    if (arr[i].time > time) {
      arr.splice(i, 0, kf);
      return;
    }
  }
  arr.push(kf);
}
