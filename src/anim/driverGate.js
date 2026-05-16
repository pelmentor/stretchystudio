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
 * # Why a per-curve gate at all (SS deviation from Blender)
 *
 * Blender's transform pipeline does NOT skip driven channels. The whole
 * file `reference/blender/source/blender/editors/transform/transform_convert_graph.cc`
 * contains zero `fcu->driver` checks; its `EDITABLE_FCU` macro
 * (`reference/blender/source/blender/editors/include/ED_anim_api.hh:490`,
 * `((fcu)->flag & FCURVE_PROTECTED) == 0`) gates on `FCURVE_PROTECTED`
 * (`reference/blender/source/blender/makesdna/DNA_anim_enums.h:311`,
 * "Keyframes (beztriples) cannot be edited") -- NOT on driver presence.
 *
 * The reason Blender doesn't need a per-channel driver gate: it splits
 * driver editing into its OWN editor mode (`SIPO_MODE_DRIVERS` at
 * `reference/blender/source/blender/editors/space_graph/space_graph.cc:244`)
 * so drivers and keyframe-curves never coexist in the same Graph Editor
 * session. SS merges the two modes into one editor (see FCurveEditor.jsx
 * file-header "Deviations from Blender" -> "Banner mode-split"), so the
 * per-curve `hasDriver` skip is the cost of that UX merge -- it
 * synthesizes the channel separation Blender achieves structurally.
 *
 * Note: `FCURVE_DISABLED` (`DNA_anim_enums.h:322`) is a SEPARATE flag
 * meaning "RNA path cannot be resolved" -- conflating it with driver
 * presence is wrong; this header used to do so (Slice 5.D audit-fix
 * HIGH-B1, 2026-05-16).
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
 * # Architectural deviation from Blender
 *
 * Blender's "Clear Driver" right-click action invokes
 * `remove_driver_button_exec` at
 * `reference/blender/source/blender/editors/animation/drivers.cc:1070`,
 * which delegates to `ANIM_remove_driver` at `drivers.cc:511-544`.
 * `ANIM_remove_driver` does NOT just drop a `driver` pointer -- it
 * removes the entire FCurve from `adt->drivers` via
 * `BLI_remlink(&adt->drivers, fcu); BKE_fcurve_free(fcu);` (drivers.cc:525-526).
 *
 * That works in Blender because driver-FCurves live in a SEPARATE
 * `ListBase` from keyframe-FCurves (`AnimData::drivers` vs
 * `AnimData::action->curves`), and a driver-FCurve has no role outside
 * being the driver -- its `keyframes[]` array exists for the rare case
 * of mixing driven + scripted overrides but is generally empty.
 *
 * SS keeps a single `fcurve.keyforms[]` plus an optional `fcurve.driver`
 * on the SAME object -- the driver acts as an optional override layer
 * on a regular keyform-bearing fcurve. Clearing the driver leaves the
 * keyform-bearing fcurve in place so the user can resume editing
 * keyforms (which the banner's "Clear Driver" button exists to enable);
 * deleting the whole fcurve here would erase user-authored keyforms.
 *
 * The follow-on if SS ever ports Blender's split: introduce a separate
 * `actions[].drivers[]` ListBase alongside `actions[].fcurves[]`, and
 * have `clearDriver` remove the entry from `drivers[]` entirely. That's
 * deferred (see FCurveEditor.jsx file-header "Deviations from Blender").
 *
 * Slice 5.D audit-fix HIGH-B3 (2026-05-16) corrected the prior comment
 * which claimed Blender just "clears the channel's `driver` pointer +
 * frees the ChannelDriver struct" -- the actual Blender path frees the
 * whole driver-FCurve.
 *
 * @param {{driver?: unknown}|null|undefined} fcurve
 * @returns {boolean} true if a driver was removed; false if none was attached
 */
export function clearDriver(fcurve) {
  if (!fcurve || !fcurve.driver) return false;
  delete fcurve.driver;
  return true;
}
