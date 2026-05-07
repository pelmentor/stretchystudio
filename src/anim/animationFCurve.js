// @ts-check

/**
 * Phase 5 — Bridge SS animation tracks to FCurve evaluation.
 *
 * Today's animation engine (`renderer/animationEngine.js`) interpolates
 * `track.keyframes[]` directly via `interpolateTrack`. The Phase 5
 * scaffold ports Blender's FCurve evaluator (`anim/fcurve.js`) which
 * expects `{ keyforms, rnaPath, driver? }` shape. This module is the
 * conversion + evaluation layer: it adapts SS tracks to FCurves so the
 * new evaluator can consume them without touching today's hot path.
 *
 * # Track shape (SS today)
 *
 *   { nodeId, property, paramId?, keyframes: [{ time, value, easing? }] }
 *
 * # FCurve shape (Blender-port)
 *
 *   { id, rnaPath, arrayIndex?, keyforms: [{ time, value, type? }], driver? }
 *
 * # Conversion
 *
 *   - SS time is in MS; FCurve time stays in whatever unit the
 *     keyframes carry. We don't rescale.
 *   - SS easing values ('linear', 'ease-in', 'ease-out', 'ease-both',
 *     'constant', 'hold') collapse to FCurve's 'linear' | 'constant'
 *     pair. Anything that isn't 'constant' / 'hold' becomes 'linear'.
 *   - SS `paramId` becomes the rnaPath `__params__['<id>']` so the
 *     existing `evaluateRnaPath` resolver finds it.
 *   - SS node-targeted track (`{ nodeId, property }`) becomes the rnaPath
 *     `objects['<nodeId>'].<property>` so future readers can resolve via
 *     `evaluateRnaPath` (today's chainEval doesn't use the rnaPath
 *     resolver — that's the conservative scope of this phase).
 *
 * # Driver attachment
 *
 *   FCurves can carry a per-curve `driver`. SS tracks today don't.
 *   The conversion preserves the slot via `track.driver` if present;
 *   absent otherwise.
 *
 * @module anim/animationFCurve
 */

import { evaluateFCurve } from './fcurve.js';

/**
 * @typedef {Object} SsTrack
 * @property {string} [nodeId]
 * @property {string} [paramId]
 * @property {string} [property]
 * @property {Array<{time:number, value:number, easing?:string}>} keyframes
 * @property {object} [driver]
 *
 * @typedef {Object} FCurveLite
 * @property {string} id
 * @property {string} rnaPath
 * @property {Array<{time:number, value:number, type?:('linear'|'constant'|'bezier')}>} keyforms
 * @property {object} [driver]
 */

const HOLD_EASINGS = new Set(['constant', 'hold']);

/**
 * Convert one SS track to an FCurve. Returns null when the track has
 * no keyframes (FCurves with empty keyforms eval to 0 — usually not
 * what the caller wants).
 *
 * @param {SsTrack} track
 * @returns {FCurveLite|null}
 */
export function trackToFCurve(track) {
  if (!track) return null;
  if (!Array.isArray(track.keyframes) || track.keyframes.length === 0) return null;
  let rnaPath;
  let id;
  if (typeof track.paramId === 'string' && track.paramId.length > 0) {
    // Synthetic `__params__` object surfaces the param-values map per
    // `anim/rnaPath.js` (see `objects['__params__'].values[<id>]`).
    rnaPath = `objects['__params__'].values['${track.paramId}']`;
    id = `param:${track.paramId}`;
  } else if (typeof track.nodeId === 'string' && track.nodeId.length > 0
    && typeof track.property === 'string' && track.property.length > 0) {
    rnaPath = `objects['${track.nodeId}'].${track.property}`;
    id = `${track.nodeId}.${track.property}`;
  } else {
    return null;
  }
  const keyforms = track.keyframes
    .filter((kf) => typeof kf?.time === 'number' && typeof kf?.value === 'number')
    .map((kf) => ({
      time: kf.time,
      value: kf.value,
      type: /** @type {'linear'|'constant'} */ (HOLD_EASINGS.has(kf.easing) ? 'constant' : 'linear'),
    }));
  if (keyforms.length === 0) return null;
  /** @type {FCurveLite} */
  const fcurve = { id, rnaPath, keyforms };
  if (track.driver && typeof track.driver === 'object') {
    fcurve.driver = track.driver;
  }
  return fcurve;
}

/**
 * Convert all tracks of an animation to FCurves. Skips tracks that
 * have no usable keyframes.
 *
 * @param {{ tracks: SsTrack[] }|null|undefined} animation
 * @returns {FCurveLite[]}
 */
export function tracksToFCurves(animation) {
  if (!animation || !Array.isArray(animation.tracks)) return [];
  const out = [];
  for (const t of animation.tracks) {
    const fc = trackToFCurve(t);
    if (fc) out.push(fc);
  }
  return out;
}

/**
 * Evaluate an animation's tracks via the FCurve evaluator and return a
 * map of `rnaPath → value`. Mirrors `computePoseOverrides` /
 * `computeParamOverrides` from `renderer/animationEngine.js` but routes
 * through the Blender-port evaluator. Pure: no mutation.
 *
 * Drivers attached to FCurves are evaluated in the same pass and
 * override the keyframe value (Blender's behaviour). The `evalContext`
 * is forwarded to `evaluateFCurve` so drivers can resolve variables
 * via `evaluateRnaPath`.
 *
 * @param {{ tracks: SsTrack[] }|null|undefined} animation
 * @param {number} time
 * @param {object} [evalContext] - { project, currentValues } passed to drivers
 * @returns {Map<string, number>}
 */
export function evaluateAnimationFCurves(animation, time, evalContext = {}) {
  const out = new Map();
  const fcurves = tracksToFCurves(animation);
  for (const fc of fcurves) {
    const v = evaluateFCurve(fc, time, evalContext);
    if (Number.isFinite(v)) out.set(fc.rnaPath, v);
  }
  return out;
}
