// @ts-check

/**
 * `finiteOr(v, fallback)` — return `v` if it is a finite number, else `fallback`.
 *
 * # Why this exists
 *
 * `??` only triggers on `null`/`undefined`, so `?? 0` lets NaN flow through
 * unchanged. `|| 0` triggers on falsy values (0 itself, '', undefined, NaN)
 * but silently collapses NaN and 0 into the same fallback. Both patterns are
 * RULE-№1 violations documented in `feedback_typeof_nan_is_number` (commit
 * `7ae01e4`). A NaN that slips through cascades into NaN matrices →
 * invisible/huge geometry (Shelby invisible-bones class, commit `94ae9f5`).
 *
 * `Number.isFinite` is the canonical sanitiser: returns true only for finite
 * numbers (false for NaN, ±Infinity, and any non-number type).
 *
 * # When to use
 *
 * At kernel boundaries where upstream data MAY be poisoned but downstream
 * math MUST produce a finite result (matrix builders, skinning, transforms).
 *
 * The rigInvariantCheck framework (I-7 / I-12..I-15) is the loud-detector
 * for upstream NaN at Init Rig time. This guard is the runtime safety net
 * so the viewport stays usable while the upstream is being fixed — NOT a
 * substitute for fixing the upstream.
 *
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
export function finiteOr(v, fallback) {
  return Number.isFinite(v) ? /** @type {number} */ (v) : fallback;
}
