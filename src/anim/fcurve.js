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
 * # Deviations from Blender
 *
 * - Blender's FCurve stores keyframes as `BezTriple bezt[]` with
 *   left/right handle vectors per keyframe (full bezier interpolation,
 *   `eBezTriple_Interpolation` switching constant / linear / bezier /
 *   bounce / elastic / etc per-segment). SS today stores
 *   `keyforms[].{time, value, type?}` with `type ∈ {'linear', 'constant'}`
 *   only. Bezier-handle interpolation lands in Phase 5b along with the
 *   editor UI.
 * - Blender supports baked sample arrays (`fpt: FPoint[]`) for imported
 *   motions. SS doesn't -- every keyframe is user-edited.
 * - Blender's per-FCurve `modifiers: ListBaseT<FModifier>` (cyclic /
 *   noise / generator / envelope) isn't ported.
 *
 * @module anim/fcurve
 */

import { evaluateDriver } from './driver.js';

/**
 * @typedef {Object} Keyframe
 * @property {number} time      -- frame or seconds (caller decides; engine is unit-agnostic)
 * @property {number} value
 * @property {('linear'|'constant'|'bezier')} [type]   -- defaults 'linear'
 *
 * @typedef {Object} FCurve
 * @property {string} id
 * @property {string} rnaPath
 * @property {number} [arrayIndex]
 * @property {Keyframe[]} keyforms
 * @property {object} [driver]
 */

/**
 * Linear interpolation between two scalars.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t   -- 0..1
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

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
          const span = b.time - a.time;
          const t = span > 0 ? (time - a.time) / span : 0;
          if (a.type === 'constant') {
            baseValue = a.value;
          } else {
            baseValue = lerp(a.value, b.value, t);
          }
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
 * @param {Keyframe['type']} [type='linear']
 */
export function upsertKeyframe(fcurve, time, value, type = 'linear') {
  if (!fcurve) return;
  if (!Array.isArray(fcurve.keyforms)) fcurve.keyforms = [];
  const arr = fcurve.keyforms;
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i].time - time) < 1e-6) {
      arr[i] = { time, value, type };
      return;
    }
    if (arr[i].time > time) {
      arr.splice(i, 0, { time, value, type });
      return;
    }
  }
  arr.push({ time, value, type });
}
