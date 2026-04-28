// @ts-check

/**
 * v3 Phase 0F.7 - Time / frame math helpers (Pillar A).
 *
 * Three tiny pure utilities that previously lived in TimelinePanel
 * but are also useful in animation / motion / physics code that
 * currently re-implements them inline. Extracting once means future
 * callers don't have to remember the conventions:
 *
 *   - frame = round(ms * fps / 1000)         (ms → frame index)
 *   - ms    = frame * 1000 / fps             (frame index → ms)
 *   - fps and frame are >= 0; rounding is "round half away from zero"
 *     because Math.round behaves that way for positive numbers and
 *     negative ms shouldn't reach this code in practice.
 *
 * @module lib/timeMath
 */

/**
 * Clamp a number to `[min, max]`. NaN inputs return `min` for safety.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * Convert milliseconds to a frame index at the given `fps`. fps is
 * floored to at least 1 to avoid divide-by-zero when the animation
 * is being initialised.
 *
 * @param {number} ms
 * @param {number} fps
 * @returns {number}
 */
export function msToFrame(ms, fps) {
  return Math.round((ms / 1000) * Math.max(1, fps));
}

/**
 * Convert a frame index to milliseconds at the given `fps`. Same
 * fps floor as `msToFrame` above.
 *
 * @param {number} frame
 * @param {number} fps
 * @returns {number}
 */
export function frameToMs(frame, fps) {
  return (frame / Math.max(1, fps)) * 1000;
}
