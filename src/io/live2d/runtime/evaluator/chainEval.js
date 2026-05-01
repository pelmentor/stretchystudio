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
import { evalWarpGrid } from './warpEval.js';
import { evalWarpKernelCubism } from './cubismWarpEval.js';
import { evalRotation, applyMat3ToPoint } from './rotationEval.js';
import { buildRotationMat3CubismAniso } from './cubismRotationEval.js';

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
  // R10 — pre-build a deformer-id → spec map once per evalRig call so
  // the chain walk does O(1) lookups instead of double linear scans
  // through warpDeformers + rotationDeformers per parent step. With a
  // 30-mesh rig × 5-deep chain × 41 deformers, this saves ~6000 array
  // probes/frame at zero allocation cost.
  const deformerIndex = buildDeformerIndex(rigSpec);
  const out = [];
  for (const meshSpec of rigSpec.artMeshes) {
    const frame = evalArtMeshFrame(meshSpec, rigSpec, paramValues, cache, deformerIndex);
    if (frame) out.push(frame);
  }
  return out;
}

/** R10 — id → deformer spec map. Built once per evalRig call. */
function buildDeformerIndex(rigSpec) {
  const map = new Map();
  if (Array.isArray(rigSpec.warpDeformers)) {
    for (const d of rigSpec.warpDeformers) {
      if (d?.id) map.set(d.id, d);
    }
  }
  if (Array.isArray(rigSpec.rotationDeformers)) {
    for (const d of rigSpec.rotationDeformers) {
      if (d?.id) map.set(d.id, d);
    }
  }
  return map;
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
export function evalArtMeshFrame(meshSpec, rigSpec, paramValues, cache, deformerIndex) {
  if (!meshSpec) return null;

  // Step 1: art mesh keyforms.
  const meshCell = cellSelect(meshSpec.bindings ?? [], paramValues ?? {});
  const meshState = evalArtMesh(meshSpec, meshCell);
  if (!meshState) return null;

  // R10 — ping-pong buffer pool. The chain walk used to allocate a
  // fresh `Float32Array(positions.length)` per parent step (warp or
  // rotation). At Hiyori scale that's ~150 allocs/frame from this
  // path alone; we keep two buffers per call and swap them. The
  // mesh's keyform-output (meshState.vertexPositions) is fresh too,
  // so we use it as buffer A and never write back into the immutable
  // keyform blobs the evaluator returned.
  const len = meshState.vertexPositions.length;
  let bufA = meshState.vertexPositions;
  let bufB = null;  // lazy-alloc; only created if chain has ≥1 parent

  // Step 2: walk parent chain. `read` is the current input; `write`
  // is where we put output. After each step they swap.
  let parent = meshSpec.parent;
  let safety = 32; // hard guard against cycle bugs
  // Local reusable scratch — JIT keeps this on stack, no GC.
  const tmp0 = [0, 0];
  while (parent && parent.type !== 'root' && safety-- > 0) {
    if (!parent.id) break;
    const parentSpec = deformerIndex ? deformerIndex.get(parent.id) : null;
    if (!parentSpec) break; // unknown parent → terminate chain (best effort)

    const state = cache.getState(parentSpec);
    if (!state) {
      parent = parentSpec.parent;
      continue;
    }

    // Lazy-allocate the swap buffer the first time we need it.
    if (bufB === null) bufB = new Float32Array(len);
    const read = bufA;
    const write = bufB;

    if (state.kind === 'warp') {
      // Phase 1 port of Cubism's WarpDeformer_TransformTarget. See
      // src/io/live2d/runtime/evaluator/cubismWarpEval.js + the RE
      // findings in docs/live2d-export/CUBISM_WARP_PORT.md.
      //
      // INSIDE [0,1)²: triangle-split bilinear (default) or 4-point
      // bilinear if isQuadTransform=true.
      // OUTSIDE: edge-gradient extrapolation (Cubism continues to
      // displace OOB vertices, derived from the deformed grid's edge
      // gradients; pre-port v3 froze them via a baseGrid fallback).
      evalWarpKernelCubism(
        state.grid, state.gridSize, state.isQuadTransform === true,
        read, write, len >> 1,
      );
    } else if (state.kind === 'rotation') {
      const m = state.mat;
      for (let i = 0; i < len; i += 2) {
        applyMat3ToPoint(m, read[i], read[i + 1], tmp0);
        write[i] = tmp0[0];
        write[i + 1] = tmp0[1];
      }
    }

    // Swap.
    bufA = bufB;
    bufB = read;

    parent = parentSpec.parent;
  }
  const positions = bufA;

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
 *
 * **Pixel→normalised conversion at warp boundaries.** When a rotation
 * deformer's parent is a warp, its child verts arrive in pivot-relative
 * canvas pixels (offsets from the rotation's pivot in canvas-px scale)
 * but the warp's bilinearFFD expects 0..1 of its grid bbox. The .moc3
 * binary file carries this conversion in
 * `rotation_deformer_keyform.scales = 1 / canvasMaxDim` for warp-parented
 * rotations (see `moc3writer.js:1210` + the binary diff vs Cubism's
 * shelby.moc3 baseline).
 *
 * The .cmo3 XML always emits scale=1.0 — the conversion is not in the
 * spec the evaluator reads. Without this scaling the rotation matrix
 * produces canvas-px output that the next-step warp interprets as
 * 0..1 → values way outside [0,1] → bilinearFFD clamps / extrapolates
 * → meshes render at canvas extremes (the v2 R6 "arms fly off" symptom).
 *
 * Fix: when constructing the rotation state, look at `spec.parent.type`
 * and bake `1 / canvasMaxDim` into the matrix's linear part. Origin
 * stays untouched — it's already in the parent warp's normalised
 * 0..1 frame (cmo3writer line ~3290 converts it during re-parenting).
 */
class DeformerStateCache {
  constructor(rigSpec, paramValues) {
    this._rigSpec = rigSpec;
    this._paramValues = paramValues ?? {};
    this._byId = new Map();
    // Cache the canvas-px → warp-input-frame slopes once per call.
    // The reverse-engineered moc3 value `1/canvasMaxDim` only matches the
    // Cubism convention when the warp parent's input frame happens to be
    // `canvas/canvasMaxDim`-normalised (true for Hiyori where the body
    // warp chain spans the canvas; FALSE for character rigs whose
    // BodyXWarp covers a smaller extent — shelby's slope is ~5×
    // larger). We pull the actual slope from `canvasToInnermostX/Y`,
    // which encodes the chained BZ/BY/BR/BX normalisation slopes.
    const w = rigSpec?.canvas?.w ?? 0;
    const h = rigSpec?.canvas?.h ?? 0;
    const cmd = Math.max(w, h) || 1;
    const cToX = rigSpec?.canvasToInnermostX;
    const cToY = rigSpec?.canvasToInnermostY;
    this._warpSlopeX = typeof cToX === 'function' ? (cToX(1) - cToX(0)) : 1 / cmd;
    this._warpSlopeY = typeof cToY === 'function' ? (cToY(1) - cToY(0)) : 1 / cmd;
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
        if (grid) state = {
          kind: 'warp',
          grid,
          baseGrid: spec.baseGrid,
          gridSize: spec.gridSize,
          isQuadTransform: spec.isQuadTransform === true,
        };
      } else if (first && (typeof first.angle === 'number' || typeof first.originX === 'number')) {
        const r = evalRotation(spec, cell);
        if (r) {
          // Phase 2a port — Cubism's rotation kernel has a different
          // linear part than v3's textbook rotation (BUG-003 root). Use
          // buildRotationMat3CubismAniso which encodes the kernel formula
          // (out.x = -sin·s·ry·px + cos·s·rx·py + ox, etc.) plus the
          // anisotropic post-scale for the parent-frame conversion.
          //
          // Apply the parent-frame conversion — see class doc above.
          // For warp parents the scale must collapse pivot-relative canvas-
          // pixels into the parent warp's INPUT frame, which is `0..1` of
          // its grid bbox. Scale anisotropic to handle non-square bboxes.
          // For rotation parents, the child's canvas-px stays canvas-px.
          //
          // Phase 2b will replace the slope-based extraSx/Sy with a
          // finite-difference Jacobian probe of the parent eval, exactly
          // as RotationDeformer_Setup does in the DLL.
          const isWarpParent = spec.parent?.type === 'warp';
          const sx = isWarpParent ? this._warpSlopeX : 1;
          const sy = isWarpParent ? this._warpSlopeY : 1;
          state = { kind: 'rotation', mat: buildRotationMat3CubismAniso(r, sx, sy) };
        }
      }
    }
    this._byId.set(spec.id, state);
    return state;
  }
}

// (Phase 2a) — local `buildRotationMat3Aniso` removed; the rotation
// state's matrix is now built by `buildRotationMat3CubismAniso` from
// cubismRotationEval.js. The Cubism kernel's linear part differs from
// v3's textbook rotation by a 90° offset (BUG-003 root); see
// cubismRotationEval.js docstring + docs/live2d-export/CUBISM_WARP_PORT.md.
