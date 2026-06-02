// @ts-check

/**
 * MATRIX_BUILD kernel.
 *
 * Phase D-3a / D-3b of the V2 plan. Builds the 3×3 affine matrix for a
 * rotation deformer:
 *
 *   - **Canvas-final** (D-3b path): when ROTATION_SETUP_PROBE has
 *     produced `{canvasFinalPivot, effectiveAngleDeg}`, build a matrix
 *     whose translation IS the canvas-final pivot and whose rotation
 *     IS the FD-probe-compensated `effectiveAngleDeg`. The chain
 *     walker BREAKS after applying this matrix (`isCanvasFinal: true`).
 *   - **Local fallback** (D-3a path): when no Setup output is available
 *     (e.g. root-parented rotation that didn't probe), build a local
 *     matrix from KEYFORM_EVAL output's `{angle, originX, originY}`.
 *     The chain walker continues iterating.
 *
 * Mirrors the matrix construction in `chainEval.js` rotation branch.
 * The Cubism Setup form lands at `chainEval.js:687-779`.
 *
 * # Input
 *
 *   ctx.outputs[<KEYFORM_EVAL>]        — local angle / pivot
 *   ctx.outputs[<ROTATION_SETUP_PROBE>] — canvas-final pivot / effective angle (when present)
 *
 * # Output
 *
 *   {
 *     kind: 'rotation',
 *     mat: Float64Array(9),  // column-major affine
 *     pivot: [tx, ty],
 *     scale, opacity,
 *     isCanvasFinal: boolean,
 *   }
 *
 * @module anim/depgraph/kernels/matrix
 */

import { OperationCode, NodeType } from '../types.js';
import { finiteOr } from '../../../lib/finiteOr.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {object|null}
 */
export function kernelMatrixBuild(op, ctx) {
  const comp = op.owner;
  if (!comp || comp.type !== NodeType.GEOMETRY) return null;
  const keyformOp = comp.findOperation(OperationCode.KEYFORM_EVAL);
  if (!keyformOp) return null;
  const state = ctx.outputs.get(keyformOp.name);
  if (!state || state.kind !== 'rotation') return null;
  // D-3b: prefer Setup output (canvas-final).
  const setupOp = comp.findOperation(OperationCode.ROTATION_SETUP_PROBE);
  const setup = setupOp ? ctx.outputs.get(setupOp.name) : null;
  if (setup && Array.isArray(setup.canvasFinalPivot)) {
    return buildCanvasFinalMat3(setup);
  }
  return buildLocalMat3(state);
}

/**
 * Build a 3×3 column-major affine using ROTATION_SETUP_PROBE output.
 * Translation is the canvas-final pivot (from FD probe), rotation is
 * the keyform angle MINUS parent's local rotation at the pivot.
 *
 * @param {{canvasFinalPivot: [number, number], effectiveAngleDeg: number, scale: number, reflectX: boolean, reflectY: boolean, opacity: number}} setup
 * @returns {{kind: 'rotation', mat: Float64Array, pivot: [number, number], scale: number, opacity: number, isCanvasFinal: boolean}}
 */
export function buildCanvasFinalMat3(setup) {
  const scale = finiteOr(setup.scale, 1);
  const theta = finiteOr(setup.effectiveAngleDeg, 0) * Math.PI / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const sx = scale * (setup.reflectX ? -1 : 1);
  const sy = scale * (setup.reflectY ? -1 : 1);
  const tx = finiteOr(setup.canvasFinalPivot[0], 0);
  const ty = finiteOr(setup.canvasFinalPivot[1], 0);
  // Row-major (matches applyMat3ToPoint):
  //   | a -b tx |
  //   | d  e ty |
  //   | 0  0  1 |
  const mat = new Float64Array(9);
  mat[0] = c * sx;  mat[1] = -s * sy; mat[2] = tx;
  mat[3] = s * sx;  mat[4] =  c * sy; mat[5] = ty;
  mat[6] = 0;       mat[7] =  0;      mat[8] = 1;
  return {
    kind: 'rotation',
    mat,
    pivot: [tx, ty],
    scale,
    opacity: finiteOr(setup.opacity, 1),
    isCanvasFinal: true,
  };
}

/**
 * Build a 3×3 row-major affine matrix M = T(originX, originY) ·
 * R(angle+baseAngle) · S(scale, ±reflect). Layout matches
 * `applyMat3ToPoint` in `rotationEval.js:152`:
 *
 *     | a  b  tx |     m[0] m[1] m[2]
 *     | d  e  ty |  =  m[3] m[4] m[5]
 *     | 0  0  1  |     m[6] m[7] m[8]
 *
 * @param {{angle: number, originX: number, originY: number, scale: number, opacity: number, baseAngle: number, reflectX: boolean, reflectY: boolean}} state
 * @returns {{kind: 'rotation', mat: Float64Array, pivot: [number, number], scale: number, opacity: number, isCanvasFinal: boolean}}
 */
function buildLocalMat3(state) {
  const scale = finiteOr(state.scale, 1);
  const theta = (finiteOr(state.angle, 0) + finiteOr(state.baseAngle, 0)) * Math.PI / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const sx = scale * (state.reflectX ? -1 : 1);
  const sy = scale * (state.reflectY ? -1 : 1);
  const tx = finiteOr(state.originX, 0);
  const ty = finiteOr(state.originY, 0);
  const mat = new Float64Array(9);
  mat[0] = c * sx;  mat[1] = -s * sy; mat[2] = tx;
  mat[3] = s * sx;  mat[4] =  c * sy; mat[5] = ty;
  mat[6] = 0;       mat[7] =  0;      mat[8] = 1;
  return {
    kind: 'rotation',
    mat,
    pivot: [tx, ty],
    scale,
    opacity: finiteOr(state.opacity, 1),
    isCanvasFinal: false,
  };
}
