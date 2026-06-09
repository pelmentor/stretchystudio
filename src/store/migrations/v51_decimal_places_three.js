// @ts-check

/**
 * v51 — bump stored `parameter.decimalPlaces` from 1 → 3 for continuous
 * params (standard / bone / rotation_deformer roles).
 *
 * # Why this exists
 *
 * Pre-v51 `paramSpec.buildParameterSpec` hardcoded `decimalPlaces: 1` for
 * every non-toggle param it synthesised (Live2D-standard params like
 * ParamBreath / ParamAngleX, bone-rotation params, and rotation-deformer
 * group params). Cubism's moc3 runtime QUANTIZES every parameter value
 * to its `decimal_places` precision before evaluating warps and rotations.
 * With `decimalPlaces = 1`, a [0, 1] range param has only 11 discrete
 * states — Cubism's smooth-sine default drivers (CubismBreath:
 * `0.5 + 0.5 * sin(2π·t / 3.2345)`) then visibly STAIR through those
 * states, worst at the extremes where the sine derivative is near zero
 * and the same quantized value persists for several frames.
 *
 * The user shipped this saga the long way: 8 rounds of bezier-handle
 * juggling in motion3 emission (rounds 1-6), then a switch to LINEAR
 * motion segments (round 7), then a definitive isolation by exporting
 * a moc3 with 0 animations and seeing CubismBreath's own sine driver
 * still stairs at extremes (round 8). The motion emission was a
 * red herring — the bug was the quantization grain in the moc3 binary.
 *
 * Hiyori (the reference) uses `decimal_places = 3` for every continuous
 * param (33 states in [0, 1]) — visually smooth.
 *
 * # What this does
 *
 * Walks `project.parameters[]` and, for every entry whose `role` is one
 * of `{standard, bone, rotation_deformer}` with `decimalPlaces < 3`,
 * bumps `decimalPlaces` to 3. Leaves `opacity` / `variant` roles alone
 * (those ARE 0/1 toggles where decimalPlaces=1 is correct).
 *
 * Params with no `role` field (very old stored projects) are bumped too,
 * with `ParamOpacity` whitelisted as the known toggle. Other id-based
 * heuristics aren't applied — at worst a legacy variant param gets
 * decimalPlaces=3, which is harmless (still a fade between 0 and 1).
 *
 * @param {*} project
 */
export function migrateDecimalPlacesThree(project) {
  const params = project?.parameters;
  if (!Array.isArray(params)) return project;
  const BUMP_ROLES = new Set(['standard', 'bone', 'rotation_deformer']);
  const TOGGLE_ROLES = new Set(['opacity', 'variant']);
  for (const p of params) {
    if (!p || typeof p !== 'object') continue;
    const dp = Number.isFinite(p.decimalPlaces) ? p.decimalPlaces : 1;
    if (dp >= 3) continue;
    const role = p.role;
    if (TOGGLE_ROLES.has(role)) continue;
    if (BUMP_ROLES.has(role) || role == null) {
      if (p.id === 'ParamOpacity') continue;
      p.decimalPlaces = 3;
    }
  }
  return project;
}
