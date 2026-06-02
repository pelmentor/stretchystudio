// @ts-check

/**
 * ROTATION_SETUP_PROBE kernel.
 *
 * Phase D-3b of the V2 plan. Ports `chainEval.js:getRotationSetup`
 * (lines 687-779) — the Cubism RotationDeformer_Setup port — into a
 * pure depgraph op.
 *
 * # What it does
 *
 * For a rotation deformer with a non-root parent, FD-probes the
 * parent's chain at the rotation's authored pivot to extract:
 *   - `canvasFinalPivot` = parent.eval(authoredPivot)
 *   - `probedAngleDeg`   = parent's local rotation at the pivot
 *
 * Bakes into:
 *   - `effectiveAngleDeg` = keyform.angle − probedAngleDeg
 *     (compensates parent's local rotation so authored angle stays
 *     meaningful in canvas-space)
 *   - `canvasFinalPivot`  becomes the matrix's translation column
 *
 * The MATRIX_BUILD kernel reads this setup and emits a canvas-final
 * 3×3 matrix; the chain walker breaks after applying it.
 *
 * Root-parented rotations don't probe — the authored pivot IS canvas-
 * px, no parent transform; setup carries authored values verbatim.
 *
 * # FD-probe ε
 *
 * Mirrors chainEval's parent-type-driven choice:
 *   - warp parent     → ε = 0.01   (input is [0..1] of warp's bbox)
 *   - rotation parent → ε = 1.0    (input is canvas-px from pivot)
 *
 * @module anim/depgraph/kernels/rotationSetup
 */

import { evalWarpKernelCubism } from '../../../io/live2d/runtime/evaluator/cubismWarpEval.js';
import { applyMat3ToPoint } from '../../../io/live2d/runtime/evaluator/rotationEval.js';
import {
  isWarpLatticeNode,
  isRotationDeformerNode,
  isChainDeformerNode,
} from '../../../store/warpLatticeAccess.js';
import { OperationCode, NodeType } from '../types.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {{canvasFinalPivot:[number,number], effectiveAngleDeg:number, scale:number, reflectX:boolean, reflectY:boolean, opacity:number} | null}
 */
export function kernelRotationSetupProbe(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const deformerId = idNode.idRef;
  const def = ctx.project?.nodes?.find((n) => n?.id === deformerId);
  if (!isRotationDeformerNode(def)) return null;

  // Read this rotation's per-frame keyform state.
  const keyformOp = op.owner.findOperation(OperationCode.KEYFORM_EVAL);
  if (!keyformOp) return null;
  const state = ctx.outputs.get(keyformOp.name);
  if (!state || state.kind !== 'rotation') return null;

  const angleDeg = (state.angle ?? 0) + (state.baseAngle ?? 0);
  const px = state.originX ?? 0;
  const py = state.originY ?? 0;

  // Root / non-deformer parent: pivot is already canvas-px.
  const parentId = typeof def.parent === 'string' ? def.parent : null;
  const parentNode = parentId
    ? ctx.project?.nodes?.find((n) => n?.id === parentId)
    : null;
  if (!isChainDeformerNode(parentNode)) {
    return {
      canvasFinalPivot: [px, py],
      effectiveAngleDeg: angleDeg,
      scale: state.scale ?? 1,
      reflectX: !!state.reflectX,
      reflectY: !!state.reflectY,
      opacity: state.opacity ?? 1,
    };
  }

  // FD probe at pivot.
  const isWarpParent = isWarpLatticeNode(parentNode);
  const eps = isWarpParent ? 0.01 : 1.0;
  const tmpC = /** @type {[number, number]} */ ([0, 0]);
  const tmpD = /** @type {[number, number]} */ ([0, 0]);

  evalChainAtPoint(ctx, parentNode, px, py, tmpC);
  const cx = tmpC[0];
  const cy = tmpC[1];
  evalChainAtPoint(ctx, parentNode, px, py + eps, tmpD);
  let dx = tmpD[0] - cx;
  let dy = tmpD[1] - cy;

  // Degenerate fallback: probe -Y if +Y had no response (mirrors
  // RotationDeformer_Setup IDA 0x7fff2b24e0c5).
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    evalChainAtPoint(ctx, parentNode, px, py - eps, tmpD);
    dx = -(tmpD[0] - cx);
    dy = -(tmpD[1] - cy);
  }

  let probedRad;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    probedRad = 0;
  } else {
    probedRad = Math.PI / 2 - Math.atan2(dy, dx);
    while (probedRad > Math.PI) probedRad -= 2 * Math.PI;
    while (probedRad <= -Math.PI) probedRad += 2 * Math.PI;
  }
  const probedAngleDeg = probedRad * 180 / Math.PI;

  return {
    canvasFinalPivot: [cx, cy],
    effectiveAngleDeg: angleDeg - probedAngleDeg,
    scale: state.scale ?? 1,
    reflectX: !!state.reflectX,
    reflectY: !!state.reflectY,
    opacity: state.opacity ?? 1,
  };
}

/**
 * Walk the parent chain at a single point. Mirrors chainEval's
 * `evalChainAtPoint:605-648` — for each ancestor:
 *   - warp → bilinear-warp via lifted grid; BREAK if lift exists.
 *   - rotation → apply matrix; BREAK if canvas-final.
 *
 * @param {import('../eval.js').EvalContext} ctx
 * @param {object} startParent - the FIRST deformer node in the walk
 * @param {number} x
 * @param {number} y
 * @param {[number, number]} out
 */
// CUBISM-PORT-007 (R4) — hoist the per-call Float32Array(2) scratch
// buffers to module scope. Pre-fix every evalChainAtPoint call (twice
// per rotation deformer per frame for the FD probe, plus once more on
// the degenerate branch) allocated two fresh 2-element typed arrays;
// 30 rotation deformers × 60Hz = ~3600 allocations/second purely for
// 2-byte scratch. Kernels run single-threaded per tick so the shared
// buffers are safe.
const _inBuf = new Float32Array(2);
const _outBuf = new Float32Array(2);
function evalChainAtPoint(ctx, startParent, x, y, out) {
  let cx = x, cy = y;
  let cur = startParent;
  let safety = 32;
  const inBuf = _inBuf;
  const outBuf = _outBuf;
  const tmp = /** @type {[number, number]} */ ([0, 0]);
  while (cur && safety-- > 0) {
    if (!isChainDeformerNode(cur)) break;

    if (isWarpLatticeNode(cur)) {
      const liftKey = `${cur.id}/${NodeType.GEOMETRY}/${OperationCode.GRID_LIFT_TO_PARENT}`;
      const lift = ctx.outputs.get(liftKey);
      if (lift?.lifted) {
        inBuf[0] = cx; inBuf[1] = cy;
        evalWarpKernelCubism(
          lift.lifted, lift.gridSize, lift.isQuad,
          inBuf, outBuf, 1,
        );
        cx = outBuf[0]; cy = outBuf[1];
        break;
      }
      // Fallback: unlifted current-frame grid. Read from KEYFORM_EVAL.
      const keyKey = `${cur.id}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`;
      const keyState = ctx.outputs.get(keyKey);
      if (keyState?.grid) {
        inBuf[0] = cx; inBuf[1] = cy;
        evalWarpKernelCubism(
          keyState.grid, keyState.gridSize,
          keyState.isQuadTransform === true,
          inBuf, outBuf, 1,
        );
        cx = outBuf[0]; cy = outBuf[1];
      }
    } else if (isRotationDeformerNode(cur)) {
      const matKey = `${cur.id}/${NodeType.GEOMETRY}/${OperationCode.MATRIX_BUILD}`;
      const matState = ctx.outputs.get(matKey);
      if (matState?.mat) {
        applyMat3ToPoint(matState.mat, cx, cy, tmp);
        cx = tmp[0]; cy = tmp[1];
        if (matState.isCanvasFinal) break;
      }
    }
    const nextId = typeof cur.parent === 'string' ? cur.parent : null;
    if (!nextId) break;
    cur = ctx.project?.nodes?.find((n) => n?.id === nextId);
  }
  out[0] = cx;
  out[1] = cy;
}
