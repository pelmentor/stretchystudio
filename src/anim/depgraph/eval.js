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

import { logger } from '../../lib/logger.js';
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
import { kernelArtMeshEval } from './kernels/artMesh.js';

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
  // Phase 0.D.0 — production-shape art-mesh frame eval.
  [OperationCode.ART_MESH_EVAL]: kernelArtMeshEval,
};

/**
 * @typedef {object} EvalContext
 * @property {object}  project    - projectStore.project snapshot
 * @property {number}  timeMs     - current playhead time, milliseconds.
 *   Phase 0.0 declared ms canonical throughout the eval substrate;
 *   seconds appear only at the motion3.json + physics dt boundaries
 *   (per `feedback_ms_canonical_animation_time` memory). Kernels that
 *   need seconds compute `timeMs / 1000` at the call site.
 * @property {Map<string, number>} [paramOverrides] - per-param overrides
 *   that take precedence over `project.parameters[i].default`. Drivers
 *   write here so downstream PARAM_EVAL ops pick up the override.
 * @property {Map<string, any>} outputs - per-op output store, keyed by
 *   `op.name`. Populated by the eval pass.
 * @property {object} [action] - active action datablock; FCurve and
 *   ANIMATION_TRACK_EVAL kernels resolve their fcurves here.
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
 * @property {Map<string, object>} [_artMeshByIdCache] - kernel-private
 *   per-eval `nodeId → projectNode` index built lazily by
 *   `kernelArtMeshEval` so each part's bone-post-chain pass doesn't
 *   re-scan `project.nodes`. Populated on first part eval; reset every
 *   time `evalDepGraph` makes a fresh ctx.
 * @property {Record<string, number>} [_paramValuesCache] - kernel-private
 *   per-eval `paramId → currentValue` snapshot computed from
 *   `project.parameters[i].default` overlaid with `ctx.paramOverrides`.
 *   Populated lazily by `kernelArtMeshEval`'s first invocation; reused
 *   by every subsequent part. Shaved per-frame O(parts × params)
 *   allocation + iteration on heavy rigs (~8k property writes / frame
 *   on Kora-scale models).
 * @property {Map<string, Float32Array>} [_artMeshBoneWorldCache] -
 *   kernel-private per-eval `boneId → WORLD matrix` cache. Same
 *   lifetime as `_artMeshByIdCache`. Mirrors the per-frame cache the
 *   renderer rebuilds via `computeBoneWorldMatrices` outside the
 *   depgraph.
 * @property {Map<string, {lifted: Float64Array, gridSize: object, isQuad: boolean}|null>} [_perPartWarpLiftCache] -
 *   kernel-private per-eval cache of per-part lifted warp grids, keyed by
 *   `warpId|chainAbove-signature`. Populated lazily by `kernelArtMeshEval`
 *   when a part disables a mid-stack modifier so its effective chain-above
 *   diverges from the warp's global `def.parent` chain (the GRID_LIFT_TO_PARENT
 *   op only composes the global chain). Parts sharing the same divergent
 *   chain compose once. Mirrors chainEval's `_liftedByChainKey`.
 * @property {Map<string, {mat: Float64Array, isCanvasFinal: boolean}|null>} [_perPartRotMatCache] -
 *   kernel-private per-eval cache of per-part canvas-final ROTATION matrices,
 *   keyed by `rotationId|chainAbove-signature`. The rotation analogue of
 *   `_perPartWarpLiftCache`: populated by `computePerPartRotationCanvasFinal`
 *   when a part disables an ancestor so the leaf rotation's pivot must be
 *   re-probed through the effective chain instead of the global
 *   ROTATION_SETUP_PROBE / MATRIX_BUILD (which bake the global `def.parent`
 *   chain). Parts sharing the same divergent chain compose once.
 * @property {Map<string, Float64Array|null>} [_restGridCache] -
 *   kernel-private per-eval cache of warp/lattice REST control grids (via
 *   `getWarpRestGrid`), keyed by deformer id. Used to compose a DISABLED warp
 *   at rest (frame-preserving pass-through) instead of excluding it (which
 *   collapses the part's frame and flings it off-canvas).
 * @property {Map<string, object>|null} [rigArtMeshById] - optional
 *   selectRigSpec `artMeshes[]` indexed by part id. When present, the
 *   ART_MESH_EVAL kernel sources its keyform-blend input (reprojected
 *   keyforms + bindings) from here instead of raw `mesh.runtime`, so
 *   modifier-toggle reprojection (selectRigSpec `needsReproject`) is
 *   honoured. Null → kernel uses `mesh.runtime`.
 * @property {Set<string>} [artMeshBboxTrace] - I-20 (rigInvariantCheck)
 *   opt-in: when populated, `kernelArtMeshEval` captures per-step bbox
 *   for parts whose id is in the set. Used by the framework to re-eval
 *   I-9 offenders with tracing on, so the offending modifier step gets
 *   named in the violation log. Diagnostic-only — leave undefined for
 *   production eval.
 * @property {Map<string, Array<{label:string, minX:number, minY:number, maxX:number, maxY:number}>>} [artMeshBboxTraceResults] -
 *   I-20 trace output; populated by `kernelArtMeshEval` when
 *   `artMeshBboxTrace` is set. Each entry is the per-step bbox trace
 *   for the matching part.
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
    timeMs: ctxIn.timeMs ?? 0,
    paramOverrides: ctxIn.paramOverrides ?? new Map(),
    outputs: ctxIn.outputs ?? new Map(),
    action: ctxIn.action,
    requiredMode: ctxIn.requiredMode,
    physics: ctxIn.physics,
    poseOverrides: ctxIn.poseOverrides ?? new Map(),
    rigArtMeshById: ctxIn.rigArtMeshById ?? null,
    boneMirrorByParam: ctxIn.boneMirrorByParam ?? null,
    artMeshBboxTrace: ctxIn.artMeshBboxTrace,
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
  /** @type {Set<string>} */
  const failedOpcodes = new Set();
  // Head-pointer dequeue. `Array.shift()` is O(N) per call — for a graph
  // of ~800 ops that's ~640k array-element shifts per eval, dominating
  // the eval loop. With a head pointer the dequeue is O(1) and the
  // queue still grows by push() as downstream ops unlock.
  let readyHead = 0;
  while (readyHead < ready.length) {
    const op = ready[readyHead++];
    if (!op) break;
    const kernel = op.evaluate ?? KERNELS[op.opcode];
    let result;
    if (kernel) {
      try {
        result = kernel(op, ctx);
      } catch (e) {
        // Per RULE-№1: do not silently swallow. Surface to in-app Logs panel
        // so the failing op is named. Dedupe per opcode-per-eval so a
        // per-frame failing kernel does not flood the ring buffer.
        const opcodeName = String(op.opcode);
        if (!failedOpcodes.has(opcodeName)) {
          failedOpcodes.add(opcodeName);
          const errMsg = /** @type {any} */ (e)?.message ?? String(e);
          logger.error(
            'depgraph',
            `kernel ${opcodeName} (op="${op.name}") threw: ${errMsg}`,
            { opcode: opcodeName, opName: op.name, err: String(e) }
          );
        }
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
