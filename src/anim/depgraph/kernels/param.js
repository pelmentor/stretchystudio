// @ts-check

/**
 * PARAM_EVAL kernel.
 *
 * Phase D-2 of the V2 plan. Reads the current value for a parameter,
 * applying overrides from upstream FCURVE_EVAL / DRIVER_EVAL /
 * ANIMATION_TRACK_EVAL / PHYSICS_EVAL ops in priority order:
 *
 *   1. `ctx.paramOverrides.get(paramId)` — caller-supplied or upstream-
 *      written override (drivers + physics + tracks all write here).
 *   2. `paramValuesStore` value (browser runtime) OR
 *      `project.parameters[i].default` (test runtime / pre-tick state).
 *
 * The kernel writes its result to `ctx.outputs` keyed by op.name AND
 * also to `ctx.paramOverrides.set(paramId, value)` so a downstream
 * caller (or a downstream kernel that doesn't traverse outlinks)
 * picks up the resolved value via the override map.
 *
 * Adapted from Blender's `BKE_animsys_evaluate_animdata` end-state —
 * the property's RNA setter writes the final keyframe-or-driver value
 * back to the property struct
 * (`reference/blender/source/blender/blenkernel/intern/anim_sys.cc`).
 *
 * @module anim/depgraph/kernels/param
 */

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number}
 */
export function kernelParamEval(op, ctx) {
  const paramId = op.tag;
  if (!paramId) return 0;
  // 1. Override map (driver / fcurve / track / physics writes here).
  const override = ctx.paramOverrides?.get(paramId);
  if (typeof override === 'number' && Number.isFinite(override)) {
    ctx.outputs.set(op.name, override);
    return override;
  }
  // 2. Project default (test path).
  const params = ctx.project?.parameters ?? [];
  for (const p of params) {
    if (p?.id === paramId) {
      const v = typeof p.default === 'number' ? p.default : 0;
      ctx.paramOverrides?.set(paramId, v);
      return v;
    }
  }
  return 0;
}
