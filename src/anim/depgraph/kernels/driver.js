// @ts-check

/**
 * DRIVER_EVAL kernel.
 *
 * Phase D-2 of the V2 plan. Evaluates a parameter's driver expression
 * AFTER the FCurve has set the keyframe value, then OVERRIDES it.
 * Drivers in Blender always win over keyframes — this matches
 * `BKE_fcurve_driver_evaluate` in
 * `reference/blender/source/blender/blenkernel/intern/fcurve_driver.cc:1188`,
 * where the driver result substitutes for the F-Curve value entirely
 * (the `influence` mix slider isn't ported yet; see
 * `src/anim/driver.js` doc header).
 *
 * The op's `tag` holds the target paramId. The driver itself lives on
 * `project.parameters[i].driver` — the kernel resolves it lazily at
 * eval time so freshly-edited drivers pick up without rebuilding the
 * graph (build-pass topology already includes the var → driver edges,
 * which is the only graph-shape concern; expression edits are pure
 * eval-payload changes).
 *
 * @module anim/depgraph/kernels/driver
 */

import { evaluateDriver } from '../../driver.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number}
 */
export function kernelDriverEval(op, ctx) {
  const targetId = op.tag;
  if (!targetId) return NaN;
  const param = ctx.project?.parameters?.find((p) => p?.id === targetId);
  if (!param?.driver) return NaN;
  const value = evaluateDriver(param.driver, { project: ctx.project });
  if (typeof value === 'number' && Number.isFinite(value)) {
    ctx.paramOverrides?.set(targetId, value);
    return value;
  }
  return NaN;
}
