// @ts-check

/**
 * ART_MESH_EVAL kernel.
 *
 * Phase 0.D.0 of the Animation Blender-Parity Plan. Ports
 * `chainEval.evalArtMeshFrame` (`src/io/live2d/runtime/evaluator/chainEval.js:212`)
 * into a depgraph operation so the production rAF callback can route
 * through `evalDepGraph` and produce evalRig-shape output without ever
 * touching the chainEval evaluator.
 *
 * # Pipeline
 *
 * 1. cellSelect over the part's mesh `runtime.bindings` against current
 *    `ctx.paramOverrides` (drivers / FCurves / sliders all merge into
 *    that map upstream).
 * 2. Blend the selected `runtime.keyforms[].vertexPositions` with cell
 *    weights. Output the keyform-blended source verts + opacity +
 *    drawOrder (sticky-from-heaviest, matching chainEval).
 * 3. Walk the part's `modifiers[]` chain leaf-first. For each modifier:
 *      - `type:'warp'`     → bilinear-warp through that warp's
 *        GRID_LIFT_TO_PARENT output (canvas-px). Canvas-final → break.
 *      - `type:'rotation'` → apply that rotation's MATRIX_BUILD output.
 *        `isCanvasFinal` → break.
 *      - `type:'armature'` → not yet ported here; the depgraph routes
 *        bone skinning through a separate path. Pass-through.
 * 4. Output `{id, vertexPositions, opacity, drawOrder}` matching the
 *    `ArtMeshFrame` shape in [chainEval.js].
 *
 * # Where this differs from `kernelGeometryEvalDeformed`
 *
 * `GEOMETRY_EVAL_DEFORMED` reads the static `mesh.vertices` field —
 * appropriate for tests that pre-bake a single keyform. ART_MESH_EVAL
 * blends per-frame via cellSelect so it tracks slider / animation /
 * driver state. They're complementary; `GEOMETRY_EVAL_DEFORMED` stays
 * the documented entry-point for "iterate the modifier stack on a
 * vertex buffer", and ART_MESH_EVAL is the production-shaped wrapper.
 *
 * @module anim/depgraph/kernels/artMesh
 */

import { cellSelect } from '../../../io/live2d/runtime/evaluator/cellSelect.js';
import { evalWarpKernelCubism } from '../../../io/live2d/runtime/evaluator/cubismWarpEval.js';
import { applyMat3ToPoint } from '../../../io/live2d/runtime/evaluator/rotationEval.js';
import { OperationCode, NodeType } from '../types.js';

/**
 * @typedef {object} ArtMeshEvalResult
 * @property {string} id
 * @property {Float32Array} vertexPositions
 * @property {number} opacity
 * @property {number} drawOrder
 */

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {ArtMeshEvalResult|null}
 */
export function kernelArtMeshEval(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const partId = idNode.idRef;
  const part = ctx.project?.nodes?.find((n) => n?.id === partId && n.type === 'part');
  if (!part) return null;

  const runtime = part.mesh?.runtime;
  if (!runtime) return null;
  const bindings = Array.isArray(runtime.bindings) ? runtime.bindings : [];
  const keyforms = Array.isArray(runtime.keyforms) ? runtime.keyforms : [];
  if (keyforms.length === 0) return null;

  // 1+2 — cellSelect + keyform blend (mirrors `evalArtMesh`).
  const paramValues = collectParamValues(ctx);
  const cell = cellSelect(bindings, paramValues);
  const meshState = blendKeyforms(keyforms, cell, part.draw_order ?? 500);
  if (!meshState) return null;

  // 3 — walk the modifier chain.
  const len = meshState.vertexPositions.length;
  let bufA = meshState.vertexPositions;
  let bufB = null;
  const tmp = /** @type {[number, number]} */ ([0, 0]);

  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  for (let i = 0; i < stack.length; i++) {
    const mod = stack[i];
    if (!mod || mod.enabled === false) continue;
    const deformerId = mod.deformerId;
    if (typeof deformerId !== 'string' || deformerId.length === 0) continue;
    if (bufB === null) bufB = new Float32Array(len);

    if (mod.type === 'warp') {
      const liftKey = `${deformerId}/${NodeType.GEOMETRY}/${OperationCode.GRID_LIFT_TO_PARENT}`;
      const lift = ctx.outputs.get(liftKey);
      if (lift?.lifted) {
        evalWarpKernelCubism(
          lift.lifted, lift.gridSize, lift.isQuad,
          bufA, bufB, len >> 1,
        );
        const swap = bufA; bufA = bufB; bufB = swap;
        // Lifted grid output IS canvas-px; chain collapses.
        break;
      }
      // Fallback: unlifted current-frame grid (broken chain).
      const keyKey = `${deformerId}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`;
      const keyState = ctx.outputs.get(keyKey);
      if (keyState?.grid) {
        evalWarpKernelCubism(
          keyState.grid, keyState.gridSize,
          keyState.isQuadTransform === true,
          bufA, bufB, len >> 1,
        );
        const swap = bufA; bufA = bufB; bufB = swap;
      }
    } else if (mod.type === 'rotation') {
      const matKey = `${deformerId}/${NodeType.GEOMETRY}/${OperationCode.MATRIX_BUILD}`;
      const matState = ctx.outputs.get(matKey);
      if (!matState?.mat) continue;
      const m = matState.mat;
      for (let v = 0; v < len; v += 2) {
        applyMat3ToPoint(m, bufA[v], bufA[v + 1], tmp);
        bufB[v] = tmp[0];
        bufB[v + 1] = tmp[1];
      }
      const swap = bufA; bufA = bufB; bufB = swap;
      if (matState.isCanvasFinal) break;
    }
    // Other modifier types (armature, etc.) pass through here — the
    // depgraph wires LBS / bone skinning via the part TRANSFORM
    // pipeline, not the art-mesh kernel.
  }

  return {
    id: partId,
    vertexPositions: bufA,
    opacity: meshState.opacity,
    drawOrder: meshState.drawOrder,
  };
}

/**
 * Build a `{paramId: value}` snapshot from `ctx.paramOverrides` and
 * fall back to `project.parameters[i].default` for any param the
 * driver/FCurve/animation pass didn't touch. cellSelect is paramId-
 * indexed, not op-indexed, so this lookup is per-mesh-eval cheap.
 *
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {Record<string, number>}
 */
function collectParamValues(ctx) {
  /** @type {Record<string, number>} */
  const values = {};
  const params = ctx.project?.parameters ?? [];
  for (const p of params) {
    if (!p?.id) continue;
    if (typeof p.default === 'number') values[p.id] = p.default;
  }
  if (ctx.paramOverrides) {
    for (const [k, v] of ctx.paramOverrides) {
      if (typeof v === 'number' && Number.isFinite(v)) values[k] = v;
    }
  }
  return values;
}

/**
 * Blend the mesh's `runtime.keyforms[]` with cellSelect weights.
 * Matches `evalArtMesh` exactly: heaviest-cell drawOrder, weighted
 * vertex average, weighted opacity, defensive zero-weight fallback.
 *
 * @param {Array<{keyTuple:number[], vertexPositions:number[]|Float32Array, opacity?:number, drawOrder?:number}>} keyforms
 * @param {{indices: number[], weights: number[]}} cell
 * @param {number} fallbackDrawOrder
 * @returns {{vertexPositions: Float32Array, opacity: number, drawOrder: number}|null}
 */
function blendKeyforms(keyforms, cell, fallbackDrawOrder) {
  const idx = cell?.indices ?? [];
  const w = cell?.weights ?? [];
  // Reference verts — pick the first weighted entry, else keyforms[0].
  let ref = null;
  for (let c = 0; c < idx.length; c++) {
    if (w[c]) { ref = keyforms[idx[c]] ?? null; if (ref) break; }
  }
  if (!ref) ref = keyforms[0];
  if (!ref?.vertexPositions) return null;
  const len = ref.vertexPositions.length;
  const out = new Float32Array(len);
  let opacity = 0;
  let totalW = 0;
  let heaviestW = -Infinity;
  let heaviestKf = null;
  for (let c = 0; c < idx.length; c++) {
    const wc = w[c];
    if (!wc) continue;
    const kf = keyforms[idx[c]];
    if (!kf?.vertexPositions || kf.vertexPositions.length !== len) continue;
    const p = kf.vertexPositions;
    for (let i = 0; i < len; i++) out[i] += wc * p[i];
    opacity += wc * (kf.opacity ?? 1);
    totalW += wc;
    if (wc > heaviestW) {
      heaviestW = wc;
      heaviestKf = kf;
    }
  }
  if (totalW === 0) {
    const kf = keyforms[0];
    out.set(kf.vertexPositions);
    return {
      vertexPositions: out,
      opacity: kf.opacity ?? 1,
      drawOrder: kf.drawOrder ?? fallbackDrawOrder,
    };
  }
  const drawOrder = heaviestKf?.drawOrder ?? fallbackDrawOrder;
  return { vertexPositions: out, opacity, drawOrder };
}
