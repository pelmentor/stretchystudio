/**
 * v2 R6 — Chain composition: walk an art mesh's parent chain, compose
 * each deformer's transform, and produce final canvas-px vertex
 * positions ready for the renderer.
 *
 * The integration point: pulls together cellSelect / warpEval /
 * rotationEval / artMeshEval into one driver. Replaces the R0
 * hardcoded translation in the CanvasViewport tick.
 *
 * Algorithm (per art mesh):
 *
 *   1. `cellSelect` + `evalArtMesh` resolve the art mesh's own
 *      keyforms → vertex positions in its parent's localFrame.
 *
 *   2. Walk up the parent chain, lazily evaluating each parent
 *      deformer's keyforms (cached per-deformer per-frame). For each
 *      parent:
 *
 *        - Warp deformer: each vertex (currently in this warp's
 *          normalized-0to1 domain) is mapped via `bilinearFFD` to
 *          this warp's localFrame (= the next parent's domain).
 *
 *        - Rotation deformer: each vertex (currently in this
 *          rotation's pivot-relative domain) is mapped via the
 *          deformer's mat3 to its localFrame.
 *
 *   3. Stop when the parent is `'root'` — positions are now canvas-px.
 *
 * Output is a fresh `Float32Array` per art mesh; the deformer state
 * cache is allocated per-evaluation so callers can call `evalRig` in
 * a tick and trust that no state leaks across frames.
 *
 * @module io/live2d/runtime/evaluator/chainEval
 */

import { cellSelect } from './cellSelect.js';
import { evalArtMesh } from './artMeshEval.js';
import { evalWarpGrid, bilinearFFD } from './warpEval.js';
import { evalRotation, buildRotationMat3, applyMat3ToPoint } from './rotationEval.js';
import { findDeformer } from '../../rig/rigSpec.js';

/**
 * @typedef {Object} ArtMeshFrame
 * @property {string} id                     - artMesh.id (= partId)
 * @property {Float32Array} vertexPositions  - canvas-px, length = 2*N
 * @property {number} opacity                - 0..1
 * @property {number} drawOrder              - integer
 */

/**
 * Evaluate every art mesh in the rig under the current paramValues.
 *
 * @param {import('../../rig/rigSpec.js').RigSpec} rigSpec
 * @param {Object<string, number>} paramValues
 * @returns {ArtMeshFrame[]}
 */
export function evalRig(rigSpec, paramValues) {
  if (!rigSpec || !Array.isArray(rigSpec.artMeshes)) return [];
  const cache = new DeformerStateCache(rigSpec, paramValues);
  const out = [];
  for (const meshSpec of rigSpec.artMeshes) {
    const frame = evalArtMeshFrame(meshSpec, rigSpec, paramValues, cache);
    if (frame) out.push(frame);
  }
  return out;
}

/**
 * Evaluate a single art mesh + walk its parent chain.
 *
 * @param {import('../../rig/rigSpec.js').ArtMeshSpec} meshSpec
 * @param {import('../../rig/rigSpec.js').RigSpec} rigSpec
 * @param {Object<string, number>} paramValues
 * @param {DeformerStateCache} cache
 * @returns {ArtMeshFrame|null}
 */
export function evalArtMeshFrame(meshSpec, rigSpec, paramValues, cache) {
  if (!meshSpec) return null;

  // Step 1: art mesh keyforms.
  const meshCell = cellSelect(meshSpec.bindings ?? [], paramValues ?? {});
  const meshState = evalArtMesh(meshSpec, meshCell);
  if (!meshState) return null;

  // Float32Array carries through the chain. We re-allocate per parent
  // step rather than mutate in-place so input arrays (the keyforms'
  // immutable position blobs) stay untouched.
  let positions = meshState.vertexPositions;

  // Step 2: walk parent chain.
  let parent = meshSpec.parent;
  let safety = 32; // hard guard against cycle bugs
  while (parent && parent.type !== 'root' && safety-- > 0) {
    if (!parent.id) break;
    const parentSpec = findDeformer(rigSpec, parent.id);
    if (!parentSpec) break; // unknown parent → terminate chain (best effort)

    const state = cache.getState(parentSpec);
    if (!state) {
      parent = parentSpec.parent;
      continue;
    }

    if (state.kind === 'warp') {
      const next = new Float32Array(positions.length);
      const tmp = [0, 0];
      for (let i = 0; i < positions.length; i += 2) {
        bilinearFFD(state.grid, state.gridSize, positions[i], positions[i + 1], tmp);
        next[i] = tmp[0];
        next[i + 1] = tmp[1];
      }
      positions = next;
    } else if (state.kind === 'rotation') {
      const m = state.mat;
      const next = new Float32Array(positions.length);
      const tmp = [0, 0];
      for (let i = 0; i < positions.length; i += 2) {
        applyMat3ToPoint(m, positions[i], positions[i + 1], tmp);
        next[i] = tmp[0];
        next[i + 1] = tmp[1];
      }
      positions = next;
    }

    parent = parentSpec.parent;
  }

  return {
    id: meshSpec.id,
    vertexPositions: positions,
    opacity: meshState.opacity,
    drawOrder: meshState.drawOrder,
  };
}

/**
 * Per-evaluation cache: each parent deformer is evaluated once per
 * frame regardless of how many child art meshes share it. State is a
 * tagged union — `{kind:'warp', grid, gridSize}` or
 * `{kind:'rotation', mat}` — so the chain walker can dispatch with a
 * single switch.
 */
class DeformerStateCache {
  constructor(rigSpec, paramValues) {
    this._rigSpec = rigSpec;
    this._paramValues = paramValues ?? {};
    this._byId = new Map();
  }

  getState(spec) {
    if (!spec?.id) return null;
    const cached = this._byId.get(spec.id);
    if (cached !== undefined) return cached;

    const cell = cellSelect(spec.bindings ?? [], this._paramValues);
    let state = null;
    if (Array.isArray(spec.keyforms) && spec.keyforms.length > 0) {
      // Discriminate warp vs rotation by checking for a position grid.
      const first = spec.keyforms[0];
      if (first?.positions) {
        const grid = evalWarpGrid(spec, cell);
        if (grid) state = { kind: 'warp', grid, gridSize: spec.gridSize };
      } else if (first && (typeof first.angle === 'number' || typeof first.originX === 'number')) {
        const r = evalRotation(spec, cell);
        if (r) state = { kind: 'rotation', mat: buildRotationMat3(r) };
      }
    }
    this._byId.set(spec.id, state);
    return state;
  }
}
