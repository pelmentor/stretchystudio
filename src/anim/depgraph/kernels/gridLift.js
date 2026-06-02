// @ts-check

/**
 * GRID_LIFT_TO_PARENT kernel.
 *
 * Phase D-3b of the V2 plan. Ports `chainEval.js:_computeLiftedGrid`
 * (the per-frame lift) + `selectRigSpec.js:_liftWarpToCanvasAtRest`
 * (the rest lift) into a pure depgraph op.
 *
 * # Input
 *
 *   ctx.outputs[<deformer>/GEOMETRY/KEYFORM_EVAL] — warp's per-frame
 *     interpolated grid (in deformer-local frame, NOT yet lifted).
 *   ctx.outputs[<parent>/GEOMETRY/GRID_LIFT_TO_PARENT] — parent warp's
 *     lifted grid (canvas-px), or null when parent is root / non-warp.
 *   ctx.outputs[<parent>/GEOMETRY/MATRIX_BUILD] — parent rotation's
 *     matrix, when parent is a rotation deformer.
 *
 * # Output
 *
 *   { lifted: Float64Array, gridSize, isQuad, bbox: {minX, minY, maxX, maxY} }
 *
 * The lifted grid is in canvas-px (composed through every ancestor
 * warp/rotation). Downstream ROTATION_SETUP_PROBE uses it to FD-probe
 * the rotation's pivot; downstream warp deformVerts uses it as the
 * single bilinear lookup target for the part's verts.
 *
 * # Chain composition (matches chainEval._computeLiftedGrid:484-577)
 *
 * 1. Root parent → grid IS canvas-px; copy directly.
 * 2. Warp parent → bilinear-warp every grid CP through parent's
 *    lifted grid (Phase 3 lifted grid IS canvas-px), break.
 * 3. Rotation parent (legacy local matrix) → apply matrix to every
 *    CP, continue walking up.
 * 4. Rotation parent (canvas-final matrix) → apply matrix, break.
 *
 * @module anim/depgraph/kernels/gridLift
 */

import { logger } from '../../../lib/logger.js';
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
 * @returns {{lifted: Float64Array, gridSize: {rows: number, cols: number}, isQuad: boolean, bbox: {minX: number, minY: number, maxX: number, maxY: number}} | null}
 */
export function kernelGridLiftToParent(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const deformerId = idNode.idRef;
  const def = ctx.project?.nodes?.find((n) => n?.id === deformerId);
  if (!isWarpLatticeNode(def)) return null;

  // Read this warp's per-frame keyform state (the un-lifted grid).
  const keyformOp = op.owner.findOperation(OperationCode.KEYFORM_EVAL);
  if (!keyformOp) return null;
  const state = ctx.outputs.get(keyformOp.name);
  if (!state || state.kind !== 'warp') return null;

  const grid = state.grid;            // current-frame grid (deformer-local)
  const gridSize = state.gridSize;
  const nPts = (gridSize.rows + 1) * (gridSize.cols + 1);

  // Root / non-deformer parent: grid is already canvas-px (warp.localFrame === 'canvas-px').
  if (!def.parent || typeof def.parent !== 'string') {
    return makeLiftedResult(grid, gridSize, state.isQuadTransform === true);
  }
  const parentId = def.parent;
  const parentNode = ctx.project?.nodes?.find((n) => n?.id === parentId);
  // BUG-04 closure 2026-06-02: distinguish dangling parent reference from
  // legitimate part/group parent. Pre-fix the `!isChainDeformerNode`
  // branch silently treated BOTH as "canvas-px passthrough" — when the
  // parent ID pointed at a DROPPED rotation deformer (FaceRotation orphan
  // in Shelby bug-04), the warp's deformer-local grid (pivot-relative
  // canvas-px in FaceParallax's case) was passed through AS-IF it were
  // canvas-px, producing 250k-px output drift for face-region parts.
  // A null parentNode + non-empty parentId IS a structural bug; surface
  // it via logger.error (per [[no-crutches-rule-one]]) so the operator
  // sees the dangling reference instead of a silent corruption.
  if (parentNode == null) {
    logger.error('gridLift',
      `warp "${def.id ?? '?'}" references parent id="${parentId}" but no node with that id exists in project.nodes — dangling reference, likely an orphaned/dropped deformer. Returning un-lifted grid; result will be in this warp's deformer-local frame, NOT canvas-px. Fix the orphan-prune step so parents of warp/rotation nodes are preserved`);
    return makeLiftedResult(grid, gridSize, state.isQuadTransform === true);
  }
  if (!isChainDeformerNode(parentNode)) {
    // Parent is a part/group — treat as canvas-px passthrough.
    return makeLiftedResult(grid, gridSize, state.isQuadTransform === true);
  }

  // Walk parent chain.
  let positions = new Float64Array(nPts * 2);
  for (let i = 0; i < nPts * 2; i++) positions[i] = grid[i];
  let curId = parentId;
  let safety = 32;
  const tmp = [0, 0];
  while (curId && safety-- > 0) {
    const cur = ctx.project?.nodes?.find((n) => n?.id === curId);
    if (!isChainDeformerNode(cur)) break;

    if (isWarpLatticeNode(cur)) {
      // Phase 3 — apply parent's lifted-grid bilinear, BREAK.
      const parentLiftOp = findOpForDeformer(ctx, curId, OperationCode.GRID_LIFT_TO_PARENT);
      if (!parentLiftOp) break;
      const parentLift = ctx.outputs.get(parentLiftOp.name);
      if (!parentLift?.lifted) break;
      const vertsIn = new Float32Array(nPts * 2);
      for (let i = 0; i < nPts * 2; i++) vertsIn[i] = positions[i];
      const vertsOut = new Float32Array(nPts * 2);
      evalWarpKernelCubism(
        parentLift.lifted,
        parentLift.gridSize,
        parentLift.isQuad,
        vertsIn,
        vertsOut,
        nPts,
      );
      for (let i = 0; i < nPts * 2; i++) positions[i] = vertsOut[i];
      break;
    }

    if (isRotationDeformerNode(cur)) {
      const matrixOp = findOpForDeformer(ctx, curId, OperationCode.MATRIX_BUILD);
      if (!matrixOp) break;
      const matrixState = ctx.outputs.get(matrixOp.name);
      if (!matrixState?.mat) break;
      const m = matrixState.mat;
      for (let i = 0; i < nPts; i++) {
        applyMat3ToPoint(m, positions[i * 2], positions[i * 2 + 1], tmp);
        positions[i * 2] = tmp[0];
        positions[i * 2 + 1] = tmp[1];
      }
      // Canvas-final rotation collapses the chain.
      if (matrixState.isCanvasFinal) break;
      curId = typeof cur.parent === 'string' ? cur.parent : null;
      continue;
    }

    break;
  }

  return makeLiftedResult(positions, gridSize, state.isQuadTransform === true);
}

/**
 * @param {Float64Array} positions
 * @param {{rows: number, cols: number}} gridSize
 * @param {boolean} isQuad
 */
function makeLiftedResult(positions, gridSize, isQuad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i], y = positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    lifted: positions instanceof Float64Array ? positions : Float64Array.from(positions),
    gridSize,
    isQuad,
    bbox: { minX, minY, maxX, maxY },
  };
}

/**
 * Find the OperationNode for a given deformer id + opcode by walking
 * the graph map exposed via ctx.outputs keys. Cheaper than hitting the
 * project nodes again — we exploit the fact that op names follow the
 * `${idRef}/${componentType}/${opcode}` shape.
 *
 * @param {import('../eval.js').EvalContext} ctx
 * @param {string} deformerId
 * @param {string} opcode
 * @returns {{name: string} | null}
 */
function findOpForDeformer(ctx, deformerId, opcode) {
  const expected = `${deformerId}/${NodeType.GEOMETRY}/${opcode}`;
  if (ctx.outputs.has(expected)) return { name: expected };
  return null;
}
