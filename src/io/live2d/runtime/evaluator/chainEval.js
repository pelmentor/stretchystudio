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
import { evalRotation, buildRotationMat3, applyMat3ToPoint } from './rotationEval.js';

/**
 * Phase 2b — FD Jacobian probe step size, in the rotation deformer's
 * parent-warp's normalised 0..1 frame. Cubism's RotationDeformer_Setup
 * starts at 1.0 and shrinks to 0.0125 over 10 retries on degenerate
 * cases; for non-degenerate warps a smallish constant gives stable
 * single-precision deltas without numerical noise. 0.01 = 1% of the
 * parent's normalised extent.
 */
const FD_PROBE_EPS = 0.01;

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
    // Build a deformer-id → spec map once. Phase 2b's chain-walk helper
    // needs O(1) parent lookups; building it here is the same map
    // buildDeformerIndex builds for the outer loop, but we can't share
    // because chainEval.evalRig builds it before constructing this cache.
    // 41 deformers × 5-deep chain × probe-per-rotation → ~250 lookups
    // per evalRig call, so the duplicate map cost is trivial.
    this._specById = new Map();
    if (Array.isArray(rigSpec?.warpDeformers)) {
      for (const d of rigSpec.warpDeformers) if (d?.id) this._specById.set(d.id, d);
    }
    if (Array.isArray(rigSpec?.rotationDeformers)) {
      for (const d of rigSpec.rotationDeformers) if (d?.id) this._specById.set(d.id, d);
    }

    // Legacy `_warpSlopeX/Y` retained only as a fallback when the FD
    // probe can't run (e.g. the parent warp's state can't be built).
    // Phase 2b's probe-based scale is preferred everywhere else.
    const w = rigSpec?.canvas?.w ?? 0;
    const h = rigSpec?.canvas?.h ?? 0;
    const cmd = Math.max(w, h) || 1;
    const cToX = rigSpec?.canvasToInnermostX;
    const cToY = rigSpec?.canvasToInnermostY;
    this._warpSlopeX = typeof cToX === 'function' ? (cToX(1) - cToX(0)) : 1 / cmd;
    this._warpSlopeY = typeof cToY === 'function' ? (cToY(1) - cToY(0)) : 1 / cmd;
  }

  /**
   * Phase 2b — walk the parent chain at a SINGLE point. Used by the
   * rotation deformer's FD Jacobian probe to compute a canvas-final
   * pivot + measure the parent's local Jacobian.
   *
   * Mirrors the per-vertex chain walk in `evalArtMeshFrame` but for
   * one point and with no buffer ping-pong. Returns the point's
   * canvas-final position.
   *
   * @param {{type: string, id: string|null}|null} parent
   * @param {number} x  point in `parent`'s natural input frame
   * @param {number} y
   * @param {number[]} [out]
   * @returns {[number, number]}
   */
  evalChainAtPoint(parent, x, y, out) {
    let cx = x, cy = y;
    let cur = parent;
    let safety = 32;
    const tmp = out ?? [0, 0];
    const inBuf = new Float32Array(2);
    const outBuf = new Float32Array(2);
    while (cur && cur.type !== 'root' && safety-- > 0) {
      if (!cur.id) break;
      const parentSpec = this._specById.get(cur.id);
      if (!parentSpec) break;
      const state = this.getState(parentSpec);
      if (!state) { cur = parentSpec.parent; continue; }
      if (state.kind === 'warp') {
        inBuf[0] = cx; inBuf[1] = cy;
        evalWarpKernelCubism(
          state.grid, state.gridSize, state.isQuadTransform === true,
          inBuf, outBuf, 1,
        );
        cx = outBuf[0]; cy = outBuf[1];
      } else if (state.kind === 'rotation') {
        applyMat3ToPoint(state.mat, cx, cy, tmp);
        cx = tmp[0]; cy = tmp[1];
        // Canvas-final rotation stops the walk (same as evalArtMeshFrame).
        if (state.isCanvasFinal) break;
      }
      cur = parentSpec.parent;
    }
    tmp[0] = cx; tmp[1] = cy;
    return tmp;
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
          // Apply the parent-frame conversion — see class doc above.
          // For warp parents the scale must collapse pivot-relative canvas-
          // pixels into the parent warp's INPUT frame, which is `0..1` of
          // its grid bbox. Scale anisotropic to handle non-square bboxes.
          // For rotation parents, the child's canvas-px stays canvas-px.
          //
          // Phase 2b is BLOCKED on this code path: the matrix structure
          // here is `R · diag(extraSx, extraSy)` — diagonal scale only.
          // Cubism's actual frame conversion at the rotation→warp boundary
          // is the FULL 2x2 inverse Jacobian of the parent warp's bilerp
          // at the pivot (which has off-diagonal terms when the warp is
          // parameter-rotated). A diagonal approximation captures
          // magnitudes but not directional rotation. Full Phase 2b
          // requires switching the rotation state's matrix to a general
          // 2x2 + translation (or a different kernel approach).
          // See docs/live2d-export/CUBISM_WARP_PORT.md Phase 2b.
          const isWarpParent = spec.parent?.type === 'warp';
          const sx = isWarpParent ? this._warpSlopeX : 1;
          const sy = isWarpParent ? this._warpSlopeY : 1;
          state = { kind: 'rotation', mat: buildRotationMat3Aniso(r, sx, sy) };
        }
      }
    }
    this._byId.set(spec.id, state);
    return state;
  }
}

/**
 * Build a rotation matrix with anisotropic frame-conversion scale baked
 * into the linear part. Equivalent to buildRotationMat3 but with separate
 * X/Y scales applied AFTER the rotation/reflect (pre-multiplied diag).
 *
 * NOTE: Phase 2a (`buildRotationMat3CubismAniso`) was reverted on
 * 2026-05-02 after user testing on shelby — that port produced
 * non-identity output at θ=0 (swapped x↔y), sending every rotation-
 * deformer-driven mesh wildly outside the canvas and creating the "char
 * is at rest pose forever, params don't drive" symptom. The IDA
 * disassembly was misread; BUG-003 is reopened pending a re-RE pass.
 *
 * @param {{angleDeg:number, originX:number, originY:number, scale?:number,
 *          reflectX?:boolean, reflectY?:boolean}} r
 * @param {number} extraSx
 * @param {number} extraSy
 * @returns {Float64Array}
 */
function buildRotationMat3Aniso(r, extraSx, extraSy) {
  if (extraSx === 1 && extraSy === 1) return buildRotationMat3(r);
  const angleDeg = r?.angleDeg ?? 0;
  const ox = r?.originX ?? 0;
  const oy = r?.originY ?? 0;
  const s = r?.scale ?? 1;
  const rx = r?.reflectX ? -1 : 1;
  const ry = r?.reflectY ? -1 : 1;
  const rad = (angleDeg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  // Linear = diag(extraSx, extraSy) · R · diag(s*rx, s*ry).
  // The frame-conversion scale wraps the OUTSIDE so origin (already in
  // parent's frame) doesn't get scaled.
  const a = extraSx * cs * s * rx;
  const b = extraSx * (-sn) * s * ry;
  const d = extraSy * sn * s * rx;
  const e = extraSy * cs * s * ry;
  const m = new Float64Array(9);
  m[0] = a; m[1] = b; m[2] = ox;
  m[3] = d; m[4] = e; m[5] = oy;
  m[6] = 0; m[7] = 0; m[8] = 1;
  return m;
}
