// @ts-check

/**
 * PHYSICS_EVAL kernel.
 *
 * Phase D-4 of the V2 plan. One PHYSICS_EVAL op per physics rule; each
 * op's `tag` is the rule id. The kernel runs `tickPhysics` for that
 * single rule and writes its output paramValues into
 * `ctx.paramOverrides`, where downstream PARAM_EVAL ops pick it up.
 *
 * # State
 *
 * Physics is stateful — pendulum velocities, accumulators, etc. The
 * caller passes `ctx.physics = { state, paramSpecs, dtSeconds }` so
 * the kernel can mutate `state` in place across frames. Per Audit
 * Gap B: the gate test runs `tickPhysics` for 60 frames at fixed dt
 * to warm the state before comparing outputs to the chainEval
 * reference.
 *
 * # Single-rule dispatch
 *
 * `tickPhysics` is built to process an array of rules. For the
 * depgraph we slice the rule array down to ONE rule per call so the
 * topology can fire physics ops independently — this matches Blender's
 * per-cache pattern (`build_object_pointcache`).
 *
 * @module anim/depgraph/kernels/physics
 */

import { tickPhysics } from '../../../io/live2d/runtime/physicsTick.js';
import { gatherPhysicsRules } from '../../../io/live2d/rig/physicsConfig.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {{stepsApplied: number, outputsChanged: number} | null}
 */
export function kernelPhysicsEval(op, ctx) {
  const ruleId = op.tag;
  if (!ruleId) return null;
  const physics = /** @type {any} */ (ctx).physics;
  if (!physics?.state) return null;
  // v50 (2026-06-08): rules live as per-node physicsModifier entries.
  // Gather-and-find rather than carry a global field. gatherPhysicsRules
  // is O(N nodes * M modifiers) but only runs once per physics op fire,
  // which is fine for the depgraph's per-op tick budget.
  const rule = gatherPhysicsRules(ctx.project ?? {}).find((r) => r?.id === ruleId);
  if (!rule) return null;

  // Build a paramValues bag from ctx.paramOverrides (the upstream
  // PARAM_EVAL ops have populated it). tickPhysics mutates this map in
  // place; copy back into paramOverrides on return.
  /** @type {Record<string, number>} */
  const paramValues = {};
  for (const inp of rule.inputs ?? []) {
    if (typeof inp?.paramId !== 'string') continue;
    const v = ctx.paramOverrides?.get(inp.paramId);
    paramValues[inp.paramId] = typeof v === 'number' ? v : 0;
  }
  for (const out of rule.outputs ?? []) {
    if (typeof out?.paramId !== 'string') continue;
    const v = ctx.paramOverrides?.get(out.paramId);
    paramValues[out.paramId] = typeof v === 'number' ? v : 0;
  }

  const result = tickPhysics(
    physics.state,
    [rule],
    paramValues,
    physics.paramSpecs ?? new Map(),
    physics.dtSeconds ?? 0,
  );

  // Write outputs back to overrides so downstream PARAM_EVAL picks them up.
  for (const out of rule.outputs ?? []) {
    if (typeof out?.paramId !== 'string') continue;
    const v = paramValues[out.paramId];
    if (typeof v === 'number' && Number.isFinite(v)) {
      ctx.paramOverrides?.set(out.paramId, v);
    }
  }
  return result;
}
