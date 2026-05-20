// @ts-check

/**
 * KEYFORM_EVAL kernel.
 *
 * Phase D-3a of the V2 plan. Evaluates a deformer's keyform stack at
 * the current parameter values, producing the deformer's per-frame
 * "rest output" — for warps that's the interpolated grid; for
 * rotations it's `{angle, originX, originY, scale, opacity}`.
 *
 * Mirrors the per-deformer state computation in `chainEval.js:90-200`
 * + `selectRigSpec.js`, but as a pure depgraph op rather than a
 * stateful cache build.
 *
 * # Inputs
 *
 * - `op.owner.owner.idRef` is the deformer node id.
 * - `ctx.paramOverrides` resolves the binding-input parameter values.
 *
 * # Output
 *
 * Stored in `ctx.outputs[op.name]`:
 *
 *   warp:     { kind: 'warp', grid: number[], gridSize: {rows, cols}, isQuadTransform: boolean, opacity: number }
 *   rotation: { kind: 'rotation', angle, originX, originY, scale, opacity, baseAngle, reflectX, reflectY }
 *
 * Phase D-3a output is the LOCAL state — NOT lifted to canvas-px and
 * NOT FD-probed for canvas-final rotation pivot. Those land in D-3b
 * via GRID_LIFT_TO_PARENT and ROTATION_SETUP_PROBE.
 *
 * @module anim/depgraph/kernels/keyform
 */

import { cellSelect } from '../../../io/live2d/runtime/evaluator/cellSelect.js';
import {
  isWarpLatticeNode,
  isRotationDeformerNode,
  isChainDeformerNode,
} from '../../../store/warpLatticeAccess.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {object|null}
 */
export function kernelKeyformEval(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const deformerId = idNode.idRef;
  const project = ctx.project;
  const def = project?.nodes?.find((n) => n?.id === deformerId);
  if (!isChainDeformerNode(def)) return null;

  // Resolve binding-input param values from ctx.paramOverrides (which
  // PARAM_EVAL kernels populated upstream). For the test/no-override
  // path, fall back to project.parameters[i].default.
  /** @type {Record<string, number>} */
  const paramValues = {};
  for (const b of def.bindings ?? []) {
    if (!b?.parameterId) continue;
    const ov = ctx.paramOverrides?.get(b.parameterId);
    if (typeof ov === 'number' && Number.isFinite(ov)) {
      paramValues[b.parameterId] = ov;
      continue;
    }
    const p = project.parameters?.find((p) => p?.id === b.parameterId);
    paramValues[b.parameterId] = typeof p?.default === 'number' ? p.default : 0;
  }

  const cell = cellSelect(def.bindings ?? [], paramValues);
  if (isWarpLatticeNode(def)) {
    return interpolateWarpState(def, cell);
  }
  if (isRotationDeformerNode(def)) {
    return interpolateRotationState(def, cell);
  }
  return null;
}

/**
 * Linear-blend the warp deformer's keyform grids by cell weights.
 *
 * @param {object} def
 * @param {{indices: number[], weights: number[]}} cell
 * @returns {{kind: 'warp', grid: Float64Array, gridSize: {rows: number, cols: number}, isQuadTransform: boolean, opacity: number}|null}
 */
function interpolateWarpState(def, cell) {
  const keyforms = Array.isArray(def.keyforms) ? def.keyforms : [];
  if (keyforms.length === 0) return null;
  const gridSize = def.gridSize ?? { rows: 5, cols: 5 };
  const len = (keyforms[0].positions?.length) ?? 0;
  if (len === 0) return null;
  const grid = new Float64Array(len);
  let opacity = 0;
  for (let i = 0; i < cell.indices.length; i++) {
    const w = cell.weights[i];
    if (w === 0) continue;
    const kf = keyforms[cell.indices[i]];
    if (!kf || !Array.isArray(kf.positions)) continue;
    for (let j = 0; j < len && j < kf.positions.length; j++) {
      grid[j] += w * kf.positions[j];
    }
    opacity += w * (typeof kf.opacity === 'number' ? kf.opacity : 1);
  }
  return {
    kind: 'warp',
    grid,
    gridSize,
    isQuadTransform: def.isQuadTransform === true,
    opacity,
  };
}

/**
 * Linear-blend the rotation deformer's keyform tuple by cell weights.
 *
 * @param {object} def
 * @param {{indices: number[], weights: number[]}} cell
 * @returns {{kind: 'rotation', angle: number, originX: number, originY: number, scale: number, opacity: number, baseAngle: number, reflectX: boolean, reflectY: boolean}|null}
 */
function interpolateRotationState(def, cell) {
  const keyforms = Array.isArray(def.keyforms) ? def.keyforms : [];
  if (keyforms.length === 0) return null;
  let angle = 0, originX = 0, originY = 0, scale = 0, opacity = 0;
  let reflectX = false, reflectY = false;
  for (let i = 0; i < cell.indices.length; i++) {
    const w = cell.weights[i];
    if (w === 0) continue;
    const kf = keyforms[cell.indices[i]];
    if (!kf) continue;
    angle    += w * (typeof kf.angle    === 'number' ? kf.angle    : 0);
    originX  += w * (typeof kf.originX  === 'number' ? kf.originX  : 0);
    originY  += w * (typeof kf.originY  === 'number' ? kf.originY  : 0);
    scale    += w * (typeof kf.scale    === 'number' ? kf.scale    : 1);
    opacity  += w * (typeof kf.opacity  === 'number' ? kf.opacity  : 1);
    if (kf.reflectX === true) reflectX = true;
    if (kf.reflectY === true) reflectY = true;
  }
  return {
    kind: 'rotation',
    angle, originX, originY, scale, opacity,
    baseAngle: typeof def.baseAngle === 'number' ? def.baseAngle : 0,
    reflectX, reflectY,
  };
}
