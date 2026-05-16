// @ts-check

/**
 * Per-FCurve "driver locked" gate for the Graph Editor (Animation
 * Phase 5 Slice 5.D).
 *
 * When an FCurve has a Driver attached, keyframe values are OVERRIDDEN
 * by the driver expression's output (see `evaluateFCurve` step 2 at
 * [fcurve.js](./fcurve.js)#evaluateFCurve). Editing keyforms is therefore
 * meaningless while the driver is active; this module is the single
 * source-of-truth for the "is this curve driver-locked" question.
 *
 * Mirrors Blender's pattern at
 * `reference/blender/source/blender/editors/space_graph/graph_buttons.cc:227`
 * (`rna_col.enabled_set((fcu->flag & FCURVE_DISABLED) != 0)`) -- the
 * "active driver" condition gates the per-handle edit availability AND
 * the channel-row tint. SS keeps a single boolean (`!!fcurve.driver`)
 * rather than Blender's flag bit because there's no "driver attached but
 * disabled" intermediate state in the SS schema.
 *
 * The "(D)" badge + "Clear Driver" button + edit-disabled state are all
 * surfaced through this module; the FCurveEditor consults `hasDriver`
 * before every drag-start + every per-curve operator iteration.
 *
 * @module anim/driverGate
 */

/**
 * Whether the given fcurve has an active Driver attached. A driver
 * object with no type/expression is still treated as present (an empty
 * driver still overrides keyframe eval to NaN via `evaluateDriver`'s
 * default branch -- and Blender's "Driver" channel toggle gates the
 * row regardless of whether the expression is valid).
 *
 * @param {{driver?: unknown}|null|undefined} fcurve
 * @returns {boolean}
 */
export function hasDriver(fcurve) {
  return !!(fcurve && fcurve.driver);
}

/**
 * Remove the driver from an fcurve in place. Mutates the passed-in
 * fcurve (designed for use inside `updateProject((p) => ...)` immer
 * drafts). Idempotent -- returns false when no driver was attached.
 *
 * Mirrors Blender's "Clear Driver" right-click action at
 * `ANIM_OT_driver_button_remove` (the actual driver removal clears
 * the channel's `driver` pointer + frees the ChannelDriver struct);
 * SS just drops the optional `driver` field since there's no separate
 * allocation to free.
 *
 * @param {{driver?: unknown}|null|undefined} fcurve
 * @returns {boolean} true if a driver was removed; false if none was attached
 */
export function clearDriver(fcurve) {
  if (!fcurve || !fcurve.driver) return false;
  delete fcurve.driver;
  return true;
}
