// @ts-check

/**
 * Cubism eye-blink driver — byte-faithful port of `CubismEyeBlink` from
 * the Cubism Web Framework
 * (`CubismSdkForWeb-5-r.4/Framework/src/effect/cubismeyeblink.ts`).
 *
 * Drives `ParamEyeLOpen` / `ParamEyeROpen` (the `EyeBlink` parameter
 * group from a model3.json) on a four-state cycle:
 *
 *   Interval (eyes open, value = 1)
 *     ↓ when nextBlinkingTime expires
 *   Closing (value ramps 1 → 0 over closingSeconds)
 *     ↓ when ramp completes
 *   Closed  (value = 0 for closedSeconds)
 *     ↓
 *   Opening (value ramps 0 → 1 over openingSeconds)
 *     ↓ when ramp completes
 *   Interval — pick a fresh nextBlinkingTime
 *
 * Default constants match the Cubism Framework
 * (`cubismeyeblink.ts:13-16`):
 *   - closingSeconds         = 0.100   (eye-close ramp duration)
 *   - closedSeconds          = 0.050   (eyes held closed)
 *   - openingSeconds         = 0.150   (eye-open ramp duration)
 *   - blinkingIntervalSeconds = 4.0    (mean wait between blinks)
 *
 * Next-blink timing follows Cubism's `determineNextBlinkingTiming`:
 * `userTime + Math.random() * (2 * interval - 1)` — uniform draw in
 * `[userTime, userTime + 7s]` for the default 4 s interval. Mean wait
 * ≈ 3.5 s. A fresh draw runs at the end of every Opening pass.
 *
 * @module io/live2d/runtime/eyeBlink
 */

/** @typedef {'Interval' | 'Closing' | 'Closed' | 'Opening'} EyeBlinkState */

/** Default constants (from Cubism Framework). */
export const EYE_BLINK_DEFAULTS = Object.freeze({
  closingSeconds: 0.1,
  closedSeconds: 0.05,
  openingSeconds: 0.15,
  blinkingIntervalSeconds: 4.0,
});

/** Canonical Cubism EyeBlink parameter ids. Used when the project
 *  doesn't declare a `groups.EyeBlink` override. */
export const DEFAULT_EYE_BLINK_PARAM_IDS = Object.freeze([
  'ParamEyeLOpen',
  'ParamEyeROpen',
]);

export class EyeBlinkDriver {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.closingSeconds]
   * @param {number} [opts.closedSeconds]
   * @param {number} [opts.openingSeconds]
   * @param {number} [opts.blinkingIntervalSeconds]
   * @param {() => number} [opts.random]   - inject for deterministic tests
   */
  constructor(opts = {}) {
    this._closingSeconds = opts.closingSeconds ?? EYE_BLINK_DEFAULTS.closingSeconds;
    this._closedSeconds = opts.closedSeconds ?? EYE_BLINK_DEFAULTS.closedSeconds;
    this._openingSeconds = opts.openingSeconds ?? EYE_BLINK_DEFAULTS.openingSeconds;
    this._blinkingIntervalSeconds =
      opts.blinkingIntervalSeconds ?? EYE_BLINK_DEFAULTS.blinkingIntervalSeconds;
    this._random = typeof opts.random === 'function' ? opts.random : Math.random;

    /** @type {EyeBlinkState} */
    this._state = 'Interval';
    this._userTimeSeconds = 0;
    this._stateStartTimeSeconds = 0;
    this._nextBlinkingTime = this._determineNextBlinkingTiming();
  }

  /** Re-arm to the start of an Interval. Call when toggling the driver
   *  back on after it was idle (e.g. switching INTO Live Preview). */
  reset() {
    this._state = 'Interval';
    this._userTimeSeconds = 0;
    this._stateStartTimeSeconds = 0;
    this._nextBlinkingTime = this._determineNextBlinkingTiming();
  }

  /**
   * Advance the state machine and return the eye-open value (0 = fully
   * closed, 1 = fully open).
   *
   * @param {number} deltaTimeSeconds
   * @returns {number}
   */
  tick(deltaTimeSeconds) {
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      deltaTimeSeconds = 0;
    }
    this._userTimeSeconds += deltaTimeSeconds;
    let t = 0;
    let parameterValue = 1;

    switch (this._state) {
      case 'Closing':
        t = (this._userTimeSeconds - this._stateStartTimeSeconds) / this._closingSeconds;
        if (t >= 1) {
          t = 1;
          this._state = 'Closed';
          this._stateStartTimeSeconds = this._userTimeSeconds;
        }
        parameterValue = 1 - t;
        break;
      case 'Closed':
        t = (this._userTimeSeconds - this._stateStartTimeSeconds) / this._closedSeconds;
        if (t >= 1) {
          this._state = 'Opening';
          this._stateStartTimeSeconds = this._userTimeSeconds;
        }
        parameterValue = 0;
        break;
      case 'Opening':
        t = (this._userTimeSeconds - this._stateStartTimeSeconds) / this._openingSeconds;
        if (t >= 1) {
          t = 1;
          this._state = 'Interval';
          this._nextBlinkingTime = this._determineNextBlinkingTiming();
        }
        parameterValue = t;
        break;
      case 'Interval':
      default:
        if (this._nextBlinkingTime < this._userTimeSeconds) {
          this._state = 'Closing';
          this._stateStartTimeSeconds = this._userTimeSeconds;
        }
        parameterValue = 1;
        break;
    }
    return parameterValue;
  }

  /** Read the state machine's current label (mostly for tests). */
  get state() {
    return this._state;
  }

  /** @returns {number} */
  _determineNextBlinkingTiming() {
    const r = this._random();
    return this._userTimeSeconds + r * (2 * this._blinkingIntervalSeconds - 1);
  }
}

/**
 * Resolve which parameter ids the blink driver should write to. Reads
 * the model3.json `Groups` table convention (`groups.EyeBlink: [ids]`)
 * if the project carries it; otherwise falls back to the canonical
 * `[ParamEyeLOpen, ParamEyeROpen]`.
 *
 * @param {object} project
 * @returns {string[]}
 */
export function resolveEyeBlinkParamIds(project) {
  const grp = project?.groups?.EyeBlink;
  if (Array.isArray(grp) && grp.length > 0 && grp.every((id) => typeof id === 'string')) {
    return grp.slice();
  }
  return DEFAULT_EYE_BLINK_PARAM_IDS.slice();
}
