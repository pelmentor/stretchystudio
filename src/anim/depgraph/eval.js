// @ts-check

/**
 * DepGraph eval pass.
 *
 * Phase D-2 of the V2 plan. Adapted from Blender's `deg_eval.cc:88-187`
 * (`reference/blender/source/blender/depsgraph/intern/eval/deg_eval.cc`):
 *
 *   1. Reset every operation: `numLinksPending = inlinks.length`,
 *      `scheduled = false`.
 *   2. Push every op with `numLinksPending == 0` into the ready queue.
 *   3. Pop one, dispatch its kernel by opcode. Store output in
 *      `ctx.outputs.set(op.name, value)`.
 *   4. Decrement every outlink's `to.numLinksPending`. When a downstream
 *      op hits zero pending, push it into the ready queue.
 *   5. Repeat until the queue is empty.
 *
 * # Differences from Blender
 *
 * - **Single-threaded.** Blender uses TBB to evaluate ops in parallel
 *   when their dependencies are satisfied. SS runs JS, single-threaded;
 *   the ready queue is a plain array.
 * - **Cyclic relations are skipped.** A relation tagged
 *   `RelationFlag.CYCLIC` does NOT contribute to `numLinksPending`. This
 *   prevents the cycle from blocking eval, at the cost of losing the
 *   driven value on that edge — same trade Blender makes when its cycle
 *   solver kills an edge.
 * - **No tagging system yet.** Phase D-1 / D-2 ships a "compile + eval"
 *   model: every eval starts fresh. Incremental tagging
 *   (`tagProjectMutation` → mark-and-sweep dirty subgraph) lands in a
 *   later sub-phase.
 *
 * @module anim/depgraph/eval
 */

import { OperationCode, OperationNode, RelationFlag } from './types.js';
import { kernelTimeTick }    from './kernels/time.js';
import { kernelParamEval }   from './kernels/param.js';
import { kernelFCurveEval }  from './kernels/fcurve.js';
import { kernelDriverEval }  from './kernels/driver.js';
import { kernelKeyformEval } from './kernels/keyform.js';
import { kernelMatrixBuild } from './kernels/matrix.js';
import { kernelGeometryEvalDeformed } from './kernels/geometry.js';
import { kernelGridLiftToParent } from './kernels/gridLift.js';
import { kernelRotationSetupProbe } from './kernels/rotationSetup.js';
import { kernelPhysicsEval } from './kernels/physics.js';
import { kernelAnimationTrackEval } from './kernels/animation.js';
import { kernelTransformCompose } from './kernels/transformCompose.js';

/**
 * Dispatch table — opcode → kernel function. Phase D-2 ships the four
 * simple ones. D-3a/b add deformer kernels; D-4 adds physics +
 * animation. Unmapped opcodes are no-ops at eval time (return
 * undefined).
 *
 * @type {Record<string, (op: import('./types.js').OperationNode, ctx: EvalContext) => any>}
 */
const KERNELS = {
  [OperationCode.TIME_TICK]:  kernelTimeTick,
  [OperationCode.PARAM_EVAL]: kernelParamEval,
  [OperationCode.FCURVE_EVAL]: kernelFCurveEval,
  [OperationCode.DRIVER_EVAL]: kernelDriverEval,
  // Phase D-4 — animation tracks no longer alias the FCurve kernel.
  // ANIMATION_TRACK_EVAL ports `computeParamOverrides` +
  // `computePoseOverrides` from `animationEngine.js:175-225`.
  [OperationCode.ANIMATION_TRACK_EVAL]: kernelAnimationTrackEval,
  // Phase D-3a — deformer kernels.
  [OperationCode.KEYFORM_EVAL]: kernelKeyformEval,
  [OperationCode.MATRIX_BUILD]: kernelMatrixBuild,
  [OperationCode.GEOMETRY_EVAL_DEFORMED]: kernelGeometryEvalDeformed,
  // Phase D-3b — lifted grid + FD-Jacobian probe.
  [OperationCode.GRID_LIFT_TO_PARENT]: kernelGridLiftToParent,
  [OperationCode.ROTATION_SETUP_PROBE]: kernelRotationSetupProbe,
  // Phase D-4 — physics.
  [OperationCode.PHYSICS_EVAL]: kernelPhysicsEval,
  // Phase 0.C — Object transform compose (constraints).
  [OperationCode.TRANSFORM_COMPOSE]: kernelTransformCompose,
};

/**
 * @typedef {object} EvalContext
 * @property {object}  project    - projectStore.project snapshot
 * @property {number}  time       - current playhead time (seconds)
 * @property {Map<string, number>} [paramOverrides] - per-param overrides
 *   that take precedence over `project.parameters[i].default`. Drivers
 *   write here so downstream PARAM_EVAL ops pick up the override.
 * @property {Map<string, any>} outputs - per-op output store, keyed by
 *   `op.name`. Populated by the eval pass.
 * @property {object} [animation] - active animation clip; FCurve kernel
 *   resolves its tracks here.
 * @property {number} [requiredMode] - Modifier mode bitmask (REALTIME |
 *   RENDER | EDITMODE). Default REALTIME (viewport tick). Export bake
 *   passes RENDER. See `anim/modifierTypeInfo.js` `isModifierEnabled`.
 * @property {{state: object, paramSpecs: Map<string, {min:number, max:number, default:number}>, dtSeconds: number}} [physics]
 *   Physics state + spec/dt for PHYSICS_EVAL kernel. Per Audit Gap B:
 *   the state must be warmed (60 frames) before its outputs are
 *   compared to chainEval reference.
 * @property {Map<string, Map<string, number>>} [poseOverrides]
 *   Pose track overrides keyed by `nodeId → {property → value}`. Phase
 *   D-5+ wires part TRANSFORM ops to read these.
 */

/**
 * Evaluate every op in the graph in topological order.
 *
 * @param {import('./types.js').DepGraph} graph
 * @param {Omit<EvalContext, 'outputs'> & { outputs?: EvalContext['outputs'] }} ctxIn
 * @returns {EvalContext}
 */
export function evalDepGraph(graph, ctxIn) {
  /** @type {EvalContext} */
  const ctx = {
    project: ctxIn.project,
    time: ctxIn.time ?? 0,
    paramOverrides: ctxIn.paramOverrides ?? new Map(),
    outputs: ctxIn.outputs ?? new Map(),
    animation: ctxIn.animation,
    requiredMode: ctxIn.requiredMode,
    physics: ctxIn.physics,
    poseOverrides: ctxIn.poseOverrides ?? new Map(),
  };

  // Reset op state. Skip cyclic relations when computing pending count.
  /** @type {import('./types.js').OperationNode[]} */
  const allOps = graph.allOperations();
  for (const op of allOps) {
    let pending = 0;
    for (const r of op.inlinks) {
      if ((r.flag & RelationFlag.CYCLIC) !== 0) continue;
      pending++;
    }
    op.numLinksPending = pending;
    op.scheduled = false;
  }

  /** @type {import('./types.js').OperationNode[]} */
  const ready = [];
  for (const op of allOps) {
    if (op.numLinksPending === 0) {
      ready.push(op);
      op.scheduled = true;
    }
  }

  let evaluatedCount = 0;
  while (ready.length > 0) {
    const op = ready.shift();
    if (!op) break;
    const kernel = op.evaluate ?? KERNELS[op.opcode];
    let result;
    if (kernel) {
      try {
        result = kernel(op, ctx);
      } catch {
        // Kernel error → store NaN/undefined; downstream may fall back.
        result = undefined;
      }
    }
    ctx.outputs.set(op.name, result);
    evaluatedCount++;
    for (const r of op.outlinks) {
      if ((r.flag & RelationFlag.CYCLIC) !== 0) continue;
      const next = r.to;
      // Only OperationNodes participate in the eval dispatch.
      if (!(next instanceof OperationNode)) continue;
      next.numLinksPending--;
      if (next.numLinksPending === 0 && !next.scheduled) {
        ready.push(next);
        next.scheduled = true;
      }
    }
  }

  // Note: evaluatedCount < allOps.length means the graph has unbroken
  // cycles or unschedulable ops. Callers can compare to detect.
  return ctx;
}
