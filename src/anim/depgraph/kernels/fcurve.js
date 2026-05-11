// @ts-check

/**
 * FCURVE_EVAL kernel.
 *
 * Phase D-2 of the V2 plan, post-v36 rewire. Evaluates a single FCurve
 * at `ctx.timeMs` and writes the result to `ctx.paramOverrides` so the
 * downstream PARAM_EVAL op picks it up.
 *
 * `evaluateFCurve` is unit-agnostic — it compares the supplied time to
 * `keyform.time` in whatever unit the caller chose. Per memory
 * `feedback_ms_canonical_animation_time.md`, the canonical animation
 * time across the eval substrate is **milliseconds**; keyforms are
 * stored in ms (post-v36 migration), so this kernel passes `ctx.timeMs`
 * verbatim. (The 2026-05-11 audit-fix sweep removed a leftover
 * `/ 1000` conversion that predated v36's ms-canonicalisation; with
 * the conversion in place, every FCURVE_EVAL evaluation returned the
 * first keyform value because seconds-shaped time always compared less
 * than the smallest ms-shaped keyform time.)
 *
 * The op's `tag` IS the fcurve's rnaPath (the build pass writes
 * `fc.rnaPath` as the op tag, since post-v36 the rnaPath IS the
 * canonical target identifier). The kernel locates the fcurve on
 * `ctx.action.fcurves[]` by exact rnaPath match and dispatches
 * `evaluateFCurve`.
 *
 * Adapted from Blender's `evaluate_fcurve`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc`).
 * SS treats every FCurve as a property override — there's no NLA
 * stack, no influence slider, no per-FCurve modifiers (those live in
 * V2 Phase D-4 via ANIMATION_TRACK_EVAL).
 *
 * @module anim/depgraph/kernels/fcurve
 */

import { evaluateFCurve } from '../../fcurve.js';
import { decodeFCurveTarget } from '../../animationFCurve.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number}
 */
export function kernelFCurveEval(op, ctx) {
  const tag = op.tag;
  if (!tag) return NaN;
  const fcurves = ctx.action?.fcurves ?? [];
  const fc = fcurves.find((f) => f?.rnaPath === tag);
  if (!fc) return NaN;
  const v = evaluateFCurve(fc, ctx.timeMs ?? 0, { project: ctx.project });
  if (typeof v === 'number' && Number.isFinite(v)) {
    const target = decodeFCurveTarget(fc);
    if (target?.kind === 'param') {
      ctx.paramOverrides?.set(target.paramId, v);
    }
    return v;
  }
  return NaN;
}
