// @ts-check

/**
 * Animation Phase 5 Slice 5.G — Channel mute helper.
 *
 * Pure mutation helper for the per-FCurve `mute` boolean — Blender's
 * `FCURVE_MUTED` bit (`DNA_anim_enums.h:303-314`). Independent from
 * `FCURVE_SELECTED` (channel selection, Slice 5.F) and `FCURVE_VISIBLE`
 * (Graph Editor row eye-toggle, still local-React in SS).
 *
 * # Blender semantics ported
 *
 * The flag has two distinct caller sites:
 *
 *   - **Eval gate** — `is_fcurve_evaluatable` at
 *     `reference/blender/source/blender/animrig/intern/evaluation.cc:345-356`
 *     returns `false` when `fcu->flag & (FCURVE_MUTED | FCURVE_DISABLED)`,
 *     short-circuiting the entire `calculate_fcurve` path. The animation
 *     evaluator (`animsys_eval_fcurves`, `evaluate_action_fcurves`) walks
 *     each curve and SKIPS muted curves — the bound property keeps its
 *     prior value rather than getting overwritten with anything.
 *
 *     Driver evaluation gates the same way at
 *     `blenkernel/intern/anim_sys.cc:916` and `:4302`
 *     (`BKE_animsys_eval_driver`) — a muted driver curve doesn't fire.
 *     Important: SS's `evaluateFCurve` calls `evaluateDriver` inline as
 *     step 2, so caller-side gating (skipping the whole `evaluateFCurve`
 *     call) correctly stops driver firing without per-driver plumbing.
 *
 *   - **Render hint** — `graph_draw.cc:1190-1194` greys the F-Curve
 *     stroke (`immUniformThemeColorShade(TH_HEADER, 50)`) when the curve
 *     OR its containing channel group is muted. SS's Graph Editor port
 *     surfaces this via the decoded row's `isMuted` flag; muted curves
 *     still draw (greyed) instead of being hidden.
 *
 *   - **Channel sidebar setting** — `anim_channels_defines.cc:1124-1125`
 *     wires `ACHANNEL_SETTING_MUTE` ↔ `FCURVE_MUTED` for the F-Curve
 *     channel type. The Python API spells it `fcurve.mute` per RNA
 *     (`rna_fcurve.cc:2690-2691`), which is the field name SS adopts.
 *
 * # Eval gate placement — at the caller, not inside evaluateFCurve
 *
 * `evaluateFCurve(fc, time)` returns a number; "muted → skip evaluation"
 * is NOT representable as a return value (returning 0 silently corrupts
 * the bound parameter, returning NaN works but is a sideband signal
 * downstream callers wouldn't otherwise produce). Per Blender's pattern,
 * the right place to gate is in the caller's iteration:
 *
 *   for (const fc of action.fcurves) {
 *     if (isFCurveMuted(fc)) continue;
 *     const v = evaluateFCurve(fc, t);
 *     ...
 *   }
 *
 * That's what `evaluateActionFCurves` (animationFCurve.js) and
 * `kernelFCurveEval` (depgraph/kernels/fcurve.js) do post-Slice 5.G.
 *
 * `evaluateFCurve` itself stays unit-of-evaluation pure: given an fcurve
 * + time, it computes the value. Mute is a higher-level eval-plan
 * concern (which curves participate in this frame's update). The
 * separation also keeps `evaluateFCurve` usable for the Graph Editor
 * render path, which DOES want to sample muted curves (so they draw
 * greyed in the plot — Blender does the same).
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `fcurve.mute` is a sparse
 * boolean: missing in v39-and-older saves, treated as `false` by
 * `isFCurveMuted`. Per `feedback_no_migration_baggage_rule_two`, a
 * v40 migration writing `mute: false` onto every fcurve would be pure
 * noise — the reader collapses tri-state (`true` / `false` / missing)
 * into a clean boolean already.
 *
 * Mute IS in the project undo history (unlike Slice 5.F's selection
 * field): it changes which curves actually drive properties, so it's
 * data not view state. Blender records mute toggles in the undo stack
 * for the same reason. The sidebar mute click calls `update(recipe)`
 * without `skipHistory:true`.
 *
 * @module anim/fcurveMute
 */

/**
 * Read accessor for `FCURVE_MUTED`.
 *
 * Strict `=== true` check: defensive against accidental writes of
 * `1`/`"yes"`/non-boolean truthy values that aren't part of the
 * contract. Mirrors `isFCurveSelected` (Slice 5.F).
 *
 * @param {object|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveMuted(fcurve) {
  return !!(fcurve && fcurve.mute === true);
}

/**
 * Toggle the per-FCurve mute bit in-place.
 *
 * Mirrors Blender's `ACHANNEL_SETTING_TOGGLE` write through
 * `acf_fcurve_setting_flag` (returns `FCURVE_MUTED`) → caller does
 * `fcu->flag ^= FCURVE_MUTED`. Single-curve operation: no peer
 * interaction (unlike Slice 5.F's 'replace' branch, which clears
 * peers).
 *
 * Returns the post-toggle value so the caller can update local state
 * (button label, tooltip) without re-reading the fcurve.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId
 * @returns {{ mutedNow: boolean }}
 */
export function toggleFCurveMute(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { mutedNow: false };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { mutedNow: false };
  fc.mute = !isFCurveMuted(fc);
  return { mutedNow: fc.mute === true };
}
