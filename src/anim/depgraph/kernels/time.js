// @ts-check

/**
 * TIME_TICK kernel.
 *
 * Phase D-2 of the V2 plan. Mirrors Blender's
 * `TimeSourceNode::tag_update` + the time-source eval flow
 * (`reference/blender/source/blender/depsgraph/intern/node/deg_node_time.cc`).
 *
 * SS keeps it simple: the kernel returns `ctx.timeMs` (the playhead
 * value supplied by the caller, in milliseconds). Downstream
 * FCURVE_EVAL / ANIMATION_TRACK_EVAL kernels read `ctx.timeMs`
 * directly (converting to seconds at the motion3.json boundary when
 * needed), so this kernel mostly exists for graph-shape symmetry —
 * it's the source of every animation-driven cascade.
 *
 * @module anim/depgraph/kernels/time
 */

/**
 * @param {import('../types.js').OperationNode} _op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number}
 */
export function kernelTimeTick(_op, ctx) {
  return ctx.timeMs;
}
