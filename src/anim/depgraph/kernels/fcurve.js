// @ts-check

/**
 * FCURVE_EVAL kernel.
 *
 * Phase D-2 of the V2 plan. Evaluates a single FCurve at the current
 * `ctx.timeMs` (converted to seconds at the call site — `evaluateFCurve`
 * is the motion3.json boundary that consumes seconds) and writes the
 * result to `ctx.paramOverrides` so the downstream PARAM_EVAL op picks
 * it up.
 *
 * The op's `tag` carries the binding identity — for animation tracks
 * the convention is `<targetId>/<property>` (matches the
 * ANIMATION_TRACK_EVAL tag from `build.js`). The kernel locates the
 * track on `ctx.animation.tracks[]` and dispatches `evaluateFCurve`.
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

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number}
 */
export function kernelFCurveEval(op, ctx) {
  const tag = op.tag;
  if (!tag) return NaN;
  const slash = tag.indexOf('/');
  const targetId = slash >= 0 ? tag.slice(0, slash) : tag;
  const property = slash >= 0 ? tag.slice(slash + 1) : 'value';
  const tracks = ctx.animation?.tracks ?? [];
  const fcurve = tracks.find((t) =>
    t?.targetId === targetId && (t.property ?? 'value') === property);
  if (!fcurve) return NaN;
  const timeSeconds = (ctx.timeMs ?? 0) / 1000;
  const v = evaluateFCurve(fcurve, timeSeconds, { project: ctx.project });
  if (typeof v === 'number' && Number.isFinite(v)) {
    ctx.paramOverrides?.set(targetId, v);
    return v;
  }
  return NaN;
}
