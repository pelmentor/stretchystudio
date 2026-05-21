// @ts-check

/**
 * Modifier type registry.
 *
 * Phase D-3a + D-3b of the V2 plan. Mirrors Blender's
 * `BKE_modifier.hh:236-260` ModifierTypeInfo dispatch table — each
 * modifier kind exposes a `deformVerts(modifier, ctx, mesh, positions)`
 * callback that the GEOMETRY_EVAL_DEFORMED kernel invokes per mesh.
 *
 * # Mode-flag enablement
 *
 * `isModifierEnabled(modifier, requiredMode)` plays the role of Blender's
 * `BKE_modifier_is_enabled` (declared `BKE_modifier.hh:480`, defined
 * `blenkernel/intern/modifier.cc`). The `requiredMode` is the eval
 * context's mode bitmask:
 *
 *   - viewport tick: `MODE_REALTIME`
 *   - export bake:   `MODE_RENDER`
 *   - mesh edit:     `MODE_EDITMODE`
 *
 * A modifier is enabled iff `(modifier.mode & requiredMode) !== 0`
 * AND `modifier.enabled !== false`. NOTE the bit test is ANY-bit
 * (`& !== 0`), whereas Blender uses ALL-bits (`(md->mode & required) ==
 * required`). The two AGREE for every caller here because all required
 * masks are single-bit (REALTIME or RENDER or EDITMODE, never combined);
 * if a multi-bit mask is ever passed, switch to `=== requiredMode` to
 * stay faithful. Audit Gap C is pinned by the `MODE_RENDER`-only test in
 * `test_modifierTypeInfo.mjs`.
 *
 * # Phase D-3b deformer kinds
 *
 * - `warp` — bilinear FFD via `evalWarpKernelCubism`. Reads the leaf
 *   warp's GRID_LIFT_TO_PARENT (canvas-px lifted grid) from
 *   `ctx.outputs`; one bilinear lookup gives canvas-final positions
 *   and the iterator breaks (matches `chainEval.evalArtMeshFrame`'s
 *   Phase 3 collapse). Falls back to the per-frame KEYFORM_EVAL grid
 *   if the lift is unavailable (broken chain), continuing iteration.
 * - `rotation` — affine via the rotation's MATRIX_BUILD matrix.
 *   Canvas-final matrices (Cubism Setup port from chainEval.js's
 *   `getRotationSetup`) collapse the chain (`isCanvasFinal: true`);
 *   local matrices continue iterating.
 *
 * # Return shape
 *
 * `deformVerts` returns `{positions, isCanvasFinal}`. The iterator
 * (`kernels/geometry.js`) breaks on `isCanvasFinal: true` to match
 * chainEval's chain-collapse semantics.
 *
 * @module anim/modifierTypeInfo
 */

import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
} from '../store/migrations/v21_modifier_mode_flags.js';
import { evalWarpKernelCubism } from '../io/live2d/runtime/evaluator/cubismWarpEval.js';
import { applyMat3ToPoint } from '../io/live2d/runtime/evaluator/rotationEval.js';
import { modifierRefId } from '../store/warpLatticeAccess.js';
import { OperationCode, NodeType } from './depgraph/types.js';

/**
 * @typedef {object} ModifierEvalContext
 * @property {object} project
 * @property {Map<string, any>} outputs - depgraph outputs keyed by op.name
 * @property {Map<string, number>} [paramOverrides]
 * @property {number} [requiredMode] - bitmask: REALTIME | RENDER | EDITMODE
 *
 * @typedef {object} ModifierTypeInfo
 * @property {string} name
 * @property {(modifier: object, ctx: ModifierEvalContext, mesh: object, positions: Float32Array) => {positions: Float32Array, isCanvasFinal: boolean}} deformVerts
 *
 * @typedef {object} ModifierRecord
 * @property {string} type
 * @property {string} deformerId
 * @property {boolean} [enabled]
 * @property {number} [mode]
 * @property {boolean} [showInEditor]
 * @property {boolean} [synthetic]
 */

/**
 * Mode bitmask check per `BKE_modifier.hh:480` semantics.
 *
 * @param {ModifierRecord|null|undefined} modifier
 * @param {number} requiredMode - bitmask
 * @returns {boolean}
 */
export function isModifierEnabled(modifier, requiredMode) {
  if (!modifier) return false;
  if (modifier.enabled === false) return false;
  const mode = typeof modifier.mode === 'number'
    ? modifier.mode
    : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
  return (mode & requiredMode) !== 0;
}

/**
 * Warp deformVerts. Reads the leaf warp's lifted grid from
 * `ctx.outputs[<deformerId>/GEOMETRY/GRID_LIFT_TO_PARENT]`. If
 * present, one bilinear lookup gives canvas-final positions and we
 * signal `isCanvasFinal: true` (matches chainEval Phase 3 collapse).
 * If absent (broken chain), fall back to the per-frame KEYFORM_EVAL
 * grid and signal `isCanvasFinal: false` so the iterator continues.
 *
 * @type {ModifierTypeInfo['deformVerts']}
 */
function warpDeformVerts(modifier, ctx, _mesh, positions) {
  // v43 — a warp modifier is `{type:'lattice', objectId}`; the depgraph
  // deformer node is keyed by that object id. `deformerId` (legacy) still
  // resolves for any un-flipped/transient warp modifier.
  const refId = modifierRefId(modifier);
  const liftKey = `${refId}/${NodeType.GEOMETRY}/${OperationCode.GRID_LIFT_TO_PARENT}`;
  const lift = ctx.outputs?.get(liftKey);
  const nVerts = positions.length / 2;
  const out = new Float32Array(positions.length);
  if (lift?.lifted) {
    evalWarpKernelCubism(
      lift.lifted, lift.gridSize, lift.isQuad,
      positions, out, nVerts,
    );
    return { positions: out, isCanvasFinal: true };
  }
  // Fallback: unlifted KEYFORM_EVAL grid (broken chain).
  const keyKey = `${refId}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`;
  const keyState = ctx.outputs?.get(keyKey);
  if (keyState?.grid) {
    evalWarpKernelCubism(
      keyState.grid, keyState.gridSize,
      keyState.isQuadTransform === true,
      positions, out, nVerts,
    );
    return { positions: out, isCanvasFinal: false };
  }
  return { positions, isCanvasFinal: false };
}

/**
 * Rotation deformVerts. Reads the rotation's MATRIX_BUILD output and
 * applies it per-vertex. Canvas-final matrices (Cubism Setup) collapse
 * the chain.
 *
 * @type {ModifierTypeInfo['deformVerts']}
 */
function rotationDeformVerts(modifier, ctx, _mesh, positions) {
  const matKey = `${modifierRefId(modifier)}/${NodeType.GEOMETRY}/${OperationCode.MATRIX_BUILD}`;
  const matState = ctx.outputs?.get(matKey);
  if (!matState?.mat) {
    return { positions, isCanvasFinal: false };
  }
  const m = matState.mat;
  const len = positions.length;
  const out = new Float32Array(len);
  const tmp = /** @type {[number, number]} */ ([0, 0]);
  for (let i = 0; i < len; i += 2) {
    applyMat3ToPoint(m, positions[i], positions[i + 1], tmp);
    out[i] = tmp[0];
    out[i + 1] = tmp[1];
  }
  return { positions: out, isCanvasFinal: matState.isCanvasFinal === true };
}

/**
 * Registry of modifier kinds.
 *
 * @type {Record<string, ModifierTypeInfo>}
 */
export const MODIFIER_TYPES = {
  warp: {
    name: 'Warp',
    deformVerts: warpDeformVerts,
  },
  // v43 — a warp deformer is now a first-class Lattice object; the part's
  // modifier is `{type:'lattice', objectId}`. Same bilinear-FFD deform as a
  // legacy warp (the cage IS the control grid), so it aliases warpDeformVerts.
  lattice: {
    name: 'Lattice',
    deformVerts: warpDeformVerts,
  },
  rotation: {
    name: 'Rotation',
    deformVerts: rotationDeformVerts,
  },
};

export {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
};
