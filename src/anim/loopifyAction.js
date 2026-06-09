// @ts-check

/**
 * loopifyAction — snap every fcurve in an Action so it wraps seamlessly
 * at t=0 ↔ t=action.duration.
 *
 * Per fcurve, two continuity conditions are enforced:
 *   1. value(t=D) = value(t=0)            — position continuous across the wrap.
 *   2. slope(t=D-) = slope(t=0+)          — velocity continuous across the wrap.
 *
 * Implementation:
 *   - If there's no keyform at t≈D, insert one (so the encoder emits a
 *     terminal segment that lands exactly on the loop boundary).
 *   - Set endKf.value = startKf.value.
 *   - Compute startKf's outgoing slope from `handleRight`, then build
 *     endKf.handleLeft so its INCOMING slope matches. Mark the handles
 *     `free` so `recalcKeyformHandles` doesn't clobber the pin (same
 *     pattern used in `motionLib.genSine` after the 2026-06-09 bezier-
 *     handle-preservation fix).
 *
 * Skipped fcurves: < 2 keyforms (nothing to pin) and curves with no
 * action.duration. Driver-only fcurves (no keyforms) are skipped silently.
 *
 * The closest Blender analogue is the F-Curve "Cycles" modifier
 * (`source/blender/animrig/intern/fcurve.cc` + `MOD_GENERATOR`), which
 * extrapolates instead of editing the curve. SS's loopify EDITS the
 * curve so the result is loop-safe even after export to motion3.json
 * (Cubism honours per-frame keyform data, not SS modifier metadata).
 *
 * @module anim/loopifyAction
 */

import { recalcKeyformHandles } from './fcurveHandles.js';
import { makeBezTripleKeyform } from './animationFCurve.js';

/** Time-equality epsilon (canonical ms — matches insertKeyframe.js). */
const TIME_EPSILON_MS = 0.5;

/**
 * Mutate `action` (or an immer draft of one) so every fcurve loops.
 *
 * @param {object} action - must carry { duration, fcurves[] }
 * @returns {{processed: number, skipped: number, inserted: number}}
 */
export function loopifyAction(action) {
  const result = { processed: 0, skipped: 0, inserted: 0 };
  if (!action || !Array.isArray(action.fcurves)) return result;
  if (!Number.isFinite(action.duration) || action.duration <= 0) return result;

  const D = action.duration;

  for (const fc of action.fcurves) {
    if (!fc || !Array.isArray(fc.keyforms) || fc.keyforms.length < 2) {
      result.skipped++;
      continue;
    }

    fc.keyforms.sort((a, b) => a.time - b.time);
    const startKf = fc.keyforms[0];
    let endKf = fc.keyforms[fc.keyforms.length - 1];

    if (Math.abs(endKf.time - D) > TIME_EPSILON_MS) {
      const fresh = makeBezTripleKeyform({
        time: D,
        value: startKf.value,
        interpolation: 'bezier',
      });
      if (!fresh) { result.skipped++; continue; }
      fc.keyforms.push(fresh);
      endKf = fresh;
      result.inserted++;
    }

    endKf.value = startKf.value;

    const hR = startKf.handleRight;
    const startSlope = (hR && Number.isFinite(hR.time) && Number.isFinite(hR.value)
                        && hR.time !== startKf.time)
      ? (hR.value - startKf.value) / (hR.time - startKf.time)
      : 0;

    const prevKf = fc.keyforms[fc.keyforms.length - 2];
    const dt = Math.max(1, (endKf.time - prevKf.time) / 3);

    endKf.handleLeft = {
      time: endKf.time - dt,
      value: endKf.value - startSlope * dt,
    };
    endKf.handleType = {
      left: 'free',
      right: endKf.handleType?.right ?? 'auto',
    };
    endKf.interpolation = 'bezier';

    startKf.handleLeft = {
      time: startKf.time - dt,
      value: startKf.value - startSlope * dt,
    };
    startKf.handleType = {
      left: 'free',
      right: startKf.handleType?.right ?? 'auto',
    };

    recalcKeyformHandles(fc.keyforms);

    result.processed++;
  }

  return result;
}
