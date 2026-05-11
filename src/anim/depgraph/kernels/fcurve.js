// @ts-check

/**
 * FCURVE_EVAL kernel.
 *
 * Phase D-2 of the V2 plan, post-v36 rewire. Evaluates a single FCurve
 * at the current `ctx.timeMs` (converted to seconds at the call site —
 * `evaluateFCurve` is the motion3.json boundary that consumes seconds)
 * and writes the result to `ctx.paramOverrides` so the downstream
 * PARAM_EVAL op picks it up.
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
  const timeSeconds = (ctx.timeMs ?? 0) / 1000;
  const v = evaluateFCurve(fc, timeSeconds, { project: ctx.project });
  if (typeof v === 'number' && Number.isFinite(v)) {
    const target = decodeFCurveTarget(fc);
    if (target?.kind === 'param') {
      ctx.paramOverrides?.set(target.paramId, v);
    }
    return v;
  }
  return NaN;
}
