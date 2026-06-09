// @ts-check

/**
 * ART_MESH_EVAL kernel.
 *
 * Phase 0.D.0 of the Animation Blender-Parity Plan. Originally ported
 * from the retired chainEval engine (`146b716`, 2026-05-26 retirement
 * commit, -9338/+90 LOC). Today this is the production art-mesh eval
 * path — the chainEval evaluator no longer exists; the depgraph kernel
 * IS the engine.
 *
 * # Pipeline
 *
 * 1. cellSelect over the part's mesh `runtime.bindings` against current
 *    `ctx.paramOverrides` (drivers / FCurves / sliders all merge into
 *    that map upstream).
 * 2. Blend the selected `runtime.keyforms[].vertexPositions` with cell
 *    weights. Output the keyform-blended source verts + opacity +
 *    drawOrder (sticky-from-heaviest semantics).
 * 3. Walk the part's `modifiers[]` chain leaf-first. For each modifier:
 *      - `type:'warp'`     → bilinear-warp through that warp's
 *        GRID_LIFT_TO_PARENT output (canvas-px). Canvas-final → break.
 *      - `type:'rotation'` → apply that rotation's MATRIX_BUILD output.
 *        `isCanvasFinal` → break.
 *      - `type:'armature'` → handled by the post-chain skin pass below
 *        (Phase 0.D). The modifier-loop branch is a no-op so the chain
 *        keeps walking past it; weighted skinning then runs once on the
 *        final buffer using bone WORLD matrices composed from
 *        TRANSFORM_COMPOSE outputs.
 * 4. Post-chain bone composition (Phase 0.D armature port). Mirrors
 *    the renderer's `pickBonePostChainComposition` step
 *    (`renderer/bonePostChainComposition.js`):
 *      - LBS: parts with `boneWeights` + enabled Armature modifier
 *        receive two-bone linear blend skinning using the joint and
 *        parent bone WORLD matrices.
 *      - Overlay: parts with no weights but a bone-group ancestor get
 *        a uniform world-matrix multiplication (rigid-follow).
 *      - None: parts with weights but no modifier (post-Apply state)
 *        skip composition.
 *    Bone WORLD matrices come from `kernels/bonePostChain.js`, which
 *    walks the bone parent chain reading TRANSFORM_COMPOSE outputs.
 *    The renderer's post-loop skips skinning when the depgraph engine
 *    is selected so this pass owns the work end-to-end.
 * 5. Output `{id, vertexPositions, opacity, drawOrder}` — the
 *    canonical `ArtMeshFrame` shape.
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
import { applyBonePostChainSkin } from './bonePostChain.js';
import {
  modifierRefId,
  getWarpRestGrid,
} from '../../../store/warpLatticeAccess.js';
import { isModifierEnabled, MODIFIER_MODE_REALTIME } from '../../modifierTypeInfo.js';
import { buildCanvasFinalMat3 } from './matrix.js';
import { OperationCode, NodeType } from '../types.js';
import { getMesh } from '../../../store/objectDataAccess.js';

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
  // Use the per-eval part-by-id cache (also used by the bone post-chain
  // pass below). Without this, every ART_MESH_EVAL kernel did a linear
  // `nodes.find` — O(parts × nodes) per frame ≈ 20k comparisons on a
  // 100-part rig with 200 total nodes.
  if (!ctx._artMeshByIdCache) {
    ctx._artMeshByIdCache = new Map();
    for (const n of ctx.project?.nodes ?? []) {
      if (n && n.type === 'part' && n.id) ctx._artMeshByIdCache.set(n.id, n);
    }
  }
  const part = ctx._artMeshByIdCache.get(partId);
  if (!part) return null;

  // v18 (Object/ObjectData split) routes geometry through `node.dataId`
  // → sibling `meshData` node; `part.mesh` is undefined after the split.
  // Pre-fix (R4 cascade miss 2026-06-04) this read silently returned null
  // for every post-v18 part — depgraph eval skipped them entirely. The
  // signature-validation banner still fired (`StaleRigBanner` walks
  // signatures via getMesh), but the live preview rendered no parts.
  const mesh = getMesh(part, ctx.project);
  const runtime = mesh?.runtime;
  if (!runtime) return null;
  // Keyform-blend source: prefer the selectRigSpec art mesh when one was
  // handed in (production), so modifier-toggle REPROJECTION is honoured —
  // selectRigSpec rewrites keyform verts into the effective leaf-parent
  // frame when a modifier is disabled (`needsReproject`), while the raw
  // `mesh.runtime` cache is still in the baked leaf frame. For the common
  // (no-toggle) case the two are identical, so this is a no-op there. The
  // chain topology (`part.modifiers`) is still read from the project below
  // — only the keyform DATA comes from the rigSpec.
  const rigMesh = ctx.rigArtMeshById?.get(partId) ?? null;
  const bindings = Array.isArray(rigMesh?.bindings)
    ? rigMesh.bindings
    : (Array.isArray(runtime.bindings) ? runtime.bindings : []);
  const keyforms = Array.isArray(rigMesh?.keyforms)
    ? rigMesh.keyforms
    : (Array.isArray(runtime.keyforms) ? runtime.keyforms : []);
  if (keyforms.length === 0) return null;

  // 1+2 — cellSelect + keyform blend (mirrors `evalArtMesh`).
  const paramValues = collectParamValues(ctx);
  const cell = cellSelect(bindings, paramValues);
  const meshState = blendKeyforms(keyforms, cell, part.draw_order ?? 500);
  if (!meshState) return null;

  // 3 — walk the deformer chain.
  const len = meshState.vertexPositions.length;
  let bufA = meshState.vertexPositions;
  const tmp = /** @type {[number, number]} */ ([0, 0]);

  // I-20 (rigInvariantCheck) opt-in per-step bbox trace: when the part's
  // id is in ctx.artMeshBboxTrace, capture bbox(bufA) before the loop and
  // after each modifier step plus the final bone-skin step. Allows the
  // framework to pinpoint WHICH step blows up a part's verts when I-9
  // fires (chain composition mystery). No allocations on the hot path
  // when the flag isn't set.
  const traceEnabled = ctx.artMeshBboxTrace instanceof Set && ctx.artMeshBboxTrace.has(partId);
  /** @type {Array<{label:string, minX:number, minY:number, maxX:number, maxY:number}>|null} */
  const trace = traceEnabled ? [] : null;
  const captureBbox = (label) => {
    if (!trace) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < len; i += 2) {
      const x = bufA[i], y = bufA[i + 1];
      if (Number.isFinite(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (Number.isFinite(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    trace.push({ label, minX, minY, maxX, maxY });
  };
  captureBbox('post-keyform-blend');

  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  // Per-modifier display gate. The eye icon toggles `mode & MODE_REALTIME`
  // (viewport display); the ✓/× button toggles `enabled`. `isModifierEnabled`
  // honours BOTH — viewport eval defaults to MODE_REALTIME (export supplies
  // MODE_RENDER via ctx.requiredMode). Mirrors `kernels/geometry.js`; a raw
  // `enabled === false` check would silently ignore the eye toggle.
  const requiredMode = ctx.requiredMode ?? MODIFIER_MODE_REALTIME;

  // M2.1 (RULE-№4, 2026-05-23): the implicit-parent fallback that walked
  // `mesh.runtime.parent` for pre-RULE-№4 rotation-deformer-shaped chains
  // is retired. Post-RULE-№4 (v44 migration `migrations/groupRotationToBone.js`),
  // bone-baked parts' `runtime.parent` is `{type:'part', id:<boneGroupId>}`
  // and the bone transform comes from the always-last Armature modifier
  // entry the synth appends to every bone-weighted part's stack (handled
  // by `applyBonePostChainSkin` below). The fallback was dead code for any
  // migrated project; `walkDeformerParentChain` + the matching `build.js`
  // implicit-parent dep-edges are removed together.
  let bufB = null;
  for (let i = 0; i < stack.length; i++) {
    const mod = stack[i];
    if (!mod || !isModifierEnabled(mod, requiredMode)) continue;
    // v43 — lattice (warp) modifiers reference the cage object via
    // `objectId`; rotation via `deformerId`. The depgraph deformer node
    // is keyed by that id either way.
    const deformerId = modifierRefId(mod);
    if (typeof deformerId !== 'string' || deformerId.length === 0) continue;
    if (bufB === null) bufB = new Float32Array(len);

    // Build this modifier's EFFECTIVE (enabled) chain-above, leaf-first.
    // Both the warp lift and the rotation canvas-final probe compose
    // through it. The global GRID_LIFT_TO_PARENT / MATRIX_BUILD ops
    // compose through the deformer's GLOBAL `def.parent` chain — correct
    // only when THIS part's effective chain-above matches it. Under
    // Blender per-part modifier semantics a part can disable a MID-STACK
    // modifier on a shared deformer (e.g. a body warp), so its effective
    // chain skips that ancestor; feeding it the global op would deform it
    // by a warp/rotation it opted out of. When any ancestor is disabled
    // (`skippedDisabledAbove`) we recompose through the explicit chain;
    // the common no-disable case reuses the precomputed global op
    // verbatim, so it's byte-identical and free (oracle/parity untouched).
    // A DISABLED warp is composed at its REST grid (Blender pass-through:
    // the modifier contributes its rest mapping, removing only the
    // param-driven deformation, NOT the spatial frame). Excluding it
    // instead collapses the frame and flings the part off-canvas. Disabled
    // rotations are still excluded (rotation-rest is a separate case);
    // both set `hasDisabledAbove` to take the per-part recompose path.
    const chainAbove = [];
    let hasDisabledAbove = false;
    for (let j = i + 1; j < stack.length; j++) {
      const up = stack[j];
      if (!up) continue;
      const upEnabled = isModifierEnabled(up, requiredMode);
      // Only chain-deformer steps participate in the composition.
      // computePerPartLift / computePerPartRotationCanvasFinal dispatch on
      // 'warp'/'rotation'; map lattice → 'warp' (a lattice IS a warp);
      // SKIP armature / unknown types (not part of the warp/rotation chain).
      const upChainType = up.type === 'rotation'
        ? 'rotation'
        : (up.type === 'warp' || up.type === 'lattice') ? 'warp' : null;
      if (!upChainType) continue;
      if (!upEnabled) {
        hasDisabledAbove = true;
        // Disabled rotation: excluded (rest-rotation not yet supported).
        if (upChainType === 'rotation') continue;
      }
      const upId = modifierRefId(up);
      if (typeof upId === 'string' && upId.length > 0) {
        // `enabled` only meaningful for warp steps (disabled→rest grid).
        chainAbove.push({ type: upChainType, id: upId, enabled: upChainType === 'warp' ? upEnabled : true });
      }
    }

    if (mod.type === 'warp' || mod.type === 'lattice') {
      let lift = null;
      if (!hasDisabledAbove) {
        lift = ctx.outputs.get(`${deformerId}/${NodeType.GEOMETRY}/${OperationCode.GRID_LIFT_TO_PARENT}`);
      }
      if (!lift?.lifted) {
        lift = computePerPartLift(deformerId, chainAbove, ctx);
      }
      if (lift?.lifted) {
        evalWarpKernelCubism(
          lift.lifted, lift.gridSize, lift.isQuad,
          bufA, bufB, len >> 1,
        );
        const swap = bufA; bufA = bufB; bufB = swap;
        captureBbox(`mod[${i}] warp-lifted (deformerId=${deformerId})`);
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
        captureBbox(`mod[${i}] warp-unlifted (deformerId=${deformerId})`);
      }
    } else if (mod.type === 'rotation') {
      // Global MATRIX_BUILD bakes the rotation's canvas-final pivot
      // through its GLOBAL parent chain (the Setup probe walks
      // `def.parent`). When an ancestor is disabled for THIS part, that
      // global matrix still carries the disabled warp/rotation — so
      // disabling e.g. the body Breath warp on a bone-baked part whose
      // leaf is a GroupRotation has no effect (the rotation collapses the
      // chain via `isCanvasFinal`). Recompose the canvas-final matrix
      // through the part's effective chain instead. No-disable → reuse the
      // global op (byte-identical fast path).
      let matState = null;
      if (!hasDisabledAbove) {
        matState = ctx.outputs.get(`${deformerId}/${NodeType.GEOMETRY}/${OperationCode.MATRIX_BUILD}`);
      }
      if (!matState?.mat) {
        matState = computePerPartRotationCanvasFinal(deformerId, chainAbove, ctx);
      }
      if (!matState?.mat) continue;
      const m = matState.mat;
      for (let v = 0; v < len; v += 2) {
        applyMat3ToPoint(m, bufA[v], bufA[v + 1], tmp);
        bufB[v] = tmp[0];
        bufB[v + 1] = tmp[1];
      }
      const swap = bufA; bufA = bufB; bufB = swap;
      captureBbox(`mod[${i}] rotation (deformerId=${deformerId}, isCanvasFinal=${!!matState.isCanvasFinal})`);
      if (matState.isCanvasFinal) break;
    }
    // Armature modifiers fall through here intentionally. Bone
    // skinning runs as a single post-chain pass below — once per part,
    // using the joint + parent bone WORLD matrices composed from
    // TRANSFORM_COMPOSE outputs. Mirrors the renderer's three-state
    // composition (`renderer/bonePostChainComposition.js`).
  }

  // Phase 0.D — bone post-chain composition. Caches per-eval bone
  // WORLD matrices on `ctx` so chains shared between sibling parts (a
  // limb's two parts both ride leftElbow) only walk the bone hierarchy
  // once. The byId map is also memoised because every part eval would
  // otherwise rebuild it.
  let byId = ctx._artMeshByIdCache;
  if (!byId) {
    byId = new Map();
    const projNodes = Array.isArray(ctx.project?.nodes) ? ctx.project.nodes : [];
    for (const n of projNodes) {
      if (n?.id) byId.set(n.id, n);
    }
    ctx._artMeshByIdCache = byId;
  }
  let boneWorldCache = ctx._artMeshBoneWorldCache;
  if (!boneWorldCache) {
    boneWorldCache = new Map();
    ctx._artMeshBoneWorldCache = boneWorldCache;
  }
  // v18: hand the resolved mesh in so bone-weight skinning sees boneWeights /
  // jointBoneId on the linked meshData node. `mesh` was resolved once at the
  // top via getMesh; reuse the same reference.
  applyBonePostChainSkin(part, mesh ?? null, bufA, ctx, byId, boneWorldCache);
  captureBbox('post-applyBonePostChainSkin');

  if (trace) {
    if (!ctx.artMeshBboxTraceResults) ctx.artMeshBboxTraceResults = new Map();
    ctx.artMeshBboxTraceResults.set(partId, trace);
  }

  return {
    id: partId,
    vertexPositions: bufA,
    opacity: meshState.opacity,
    drawOrder: meshState.drawOrder,
  };
}

/**
 * Compose a warp's lifted (canvas-px) control-point grid through an
 * EXPLICIT `chainAbove` — the part's enabled modifier chain above this
 * warp, leaf-first — instead of the warp's global `def.parent` chain.
 * Walks the per-part chain so a part that disabled a mid-stack modifier
 * on a shared deformer doesn't get deformed by the ancestor it opted out
 * of. (Pre-`146b716` this duplicated chainEval's `getLiftedGridForChain`;
 * both modules walked the same chain logic.)
 *
 * Reads the depgraph's already-computed per-deformer outputs — each
 * warp's KEYFORM_EVAL grid + each rotation's MATRIX_BUILD matrix — so it
 * adds no graph nodes. Results are memoised on `ctx` keyed by warp id +
 * chain signature, so parts sharing the same divergent chain compose
 * once (per-chain memoisation).
 *
 * @param {string} warpId
 * @param {Array<{type: string, id: string, enabled?: boolean}>} chainAbove -
 *   chain above this warp, leaf-first. A warp step with `enabled === false`
 *   composes at its REST grid (frame-preserving pass-through).
 * @param {import('../eval.js').EvalContext} ctx
 * @param {boolean} [enabled=true] - whether THIS warp is enabled; disabled →
 *   compose at its rest grid instead of the current keyform grid.
 * @returns {{lifted: Float64Array, gridSize: {rows:number, cols:number}, isQuad: boolean} | null}
 */
function computePerPartLift(warpId, chainAbove, ctx, enabled = true) {
  let cache = ctx._perPartWarpLiftCache;
  if (!cache) { cache = new Map(); ctx._perPartWarpLiftCache = cache; }
  const sig = `${warpId}:${enabled ? 1 : 0}|${chainAbove.map((c) => `${c.type}:${c.id}:${c.enabled === false ? 0 : 1}`).join('>')}`;
  if (cache.has(sig)) return cache.get(sig);

  const keyState = ctx.outputs.get(`${warpId}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`);
  if (!keyState || keyState.kind !== 'warp' || !keyState.grid) {
    cache.set(sig, null);
    return null;
  }
  const gridSize = keyState.gridSize;
  const isQuad = keyState.isQuadTransform === true;
  const nPts = (gridSize.rows + 1) * (gridSize.cols + 1);
  // Disabled warp → compose at its REST grid (baseGrid / lattice rest cage),
  // so it contributes its frame mapping but no param-driven deformation.
  // gridSize/isQuad still come from KEYFORM_EVAL (topology is invariant).
  const baseGrid = enabled ? keyState.grid : (restGridFor(warpId, ctx) ?? keyState.grid);

  // No chain above → this warp's grid IS the outermost frame (matches
  // getLiftedGridForChain's chainAbove.length===0 branch).
  if (chainAbove.length === 0) {
    const res = { lifted: Float64Array.from(baseGrid), gridSize, isQuad };
    cache.set(sig, res);
    return res;
  }

  const positions = new Float64Array(nPts * 2);
  for (let k = 0; k < nPts * 2; k++) positions[k] = baseGrid[k];
  const tmp = /** @type {[number, number]} */ ([0, 0]);
  for (let s = 0; s < chainAbove.length; s++) {
    const step = chainAbove[s];
    if (!step || !step.id) break;
    if (step.type === 'warp') {
      // Recurse: lift this step through the rest of the chain, then warp
      // every current CP through its canvas-px grid (one bilinear per
      // level — NOT nested bilinear-of-bilinear, which would be quartic).
      // Output is canvas-px → composition is done, break.
      const stepLift = computePerPartLift(step.id, chainAbove.slice(s + 1), ctx, step.enabled !== false);
      if (!stepLift?.lifted) break;
      const vIn = new Float32Array(nPts * 2);
      const vOut = new Float32Array(nPts * 2);
      for (let k = 0; k < nPts * 2; k++) vIn[k] = positions[k];
      evalWarpKernelCubism(stepLift.lifted, stepLift.gridSize, stepLift.isQuad, vIn, vOut, nPts);
      for (let k = 0; k < nPts * 2; k++) positions[k] = vOut[k];
      break;
    }
    if (step.type === 'rotation') {
      // Recompose this rotation's canvas-final matrix through the REST of
      // the per-part chain — the global MATRIX_BUILD bakes the rotation's
      // GLOBAL parents, which may include ancestors this part disabled.
      const matState = computePerPartRotationCanvasFinal(step.id, chainAbove.slice(s + 1), ctx);
      if (!matState?.mat) break;
      const m = matState.mat;
      for (let p = 0; p < nPts; p++) {
        applyMat3ToPoint(m, positions[p * 2], positions[p * 2 + 1], tmp);
        positions[p * 2] = tmp[0];
        positions[p * 2 + 1] = tmp[1];
      }
      if (matState.isCanvasFinal) break;
      continue;
    }
    break; // unknown step type — matches getLiftedGridForChain:797
  }
  const res = { lifted: positions, gridSize, isQuad };
  cache.set(sig, res);
  return res;
}

/**
 * Rest control grid for a warp/lattice deformer (its `baseGrid` / lattice
 * rest cage) as a flat Float64Array, via the `getWarpRestGrid` seam. Used to
 * compose a DISABLED warp at rest — it contributes its frame mapping but no
 * param-driven deformation (Blender modifier pass-through). Memoised on ctx;
 * the rest grid is invariant across a single eval.
 *
 * @param {string} deformerId
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {Float64Array|null}
 */
function restGridFor(deformerId, ctx) {
  let cache = ctx._restGridCache;
  if (!cache) { cache = new Map(); ctx._restGridCache = cache; }
  if (cache.has(deformerId)) return cache.get(deformerId);
  const node = ctx.project?.nodes?.find((n) => n?.id === deformerId);
  const rest = node ? getWarpRestGrid(node, ctx.project) : undefined;
  const out = Array.isArray(rest) && rest.length > 0 ? Float64Array.from(rest) : null;
  cache.set(deformerId, out);
  return out;
}

/**
 * Walk a single point through a part's EFFECTIVE (enabled) `chainAbove`,
 * leaf-first, recomposing each ancestor per-part (never reading a global
 * canvas-final output). The leaf-first first step, composed through the
 * rest, is itself canvas-final, so one application lands the point in
 * canvas-px. Walks the EXPLICIT per-part chain instead of the deformer's
 * global `def.parent` pointers — divergent per-part disables resolve
 * correctly.
 *
 * @param {Array<{type:string, id:string, enabled?:boolean}>} chainAbove - leaf-first
 * @param {number} x
 * @param {number} y
 * @param {import('../eval.js').EvalContext} ctx
 * @param {[number,number]} out - written with [canvasX, canvasY]
 */
function perPartChainPoint(chainAbove, x, y, ctx, out) {
  if (!chainAbove || chainAbove.length === 0) { out[0] = x; out[1] = y; return; }
  const step = chainAbove[0];
  const rest = chainAbove.slice(1);
  const inBuf = new Float32Array(2);
  const outBuf = new Float32Array(2);
  if (step.type === 'warp') {
    const stepEnabled = step.enabled !== false;
    const lift = computePerPartLift(step.id, rest, ctx, stepEnabled);
    if (lift?.lifted) {
      inBuf[0] = x; inBuf[1] = y;
      evalWarpKernelCubism(lift.lifted, lift.gridSize, lift.isQuad, inBuf, outBuf, 1);
      out[0] = outBuf[0]; out[1] = outBuf[1];
      return; // lifted grid IS canvas-px
    }
    // Fallback: unlifted grid (rest grid if this step is disabled), then
    // continue through the rest of the chain.
    const keyState = ctx.outputs.get(`${step.id}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`);
    const fallbackGrid = stepEnabled ? keyState?.grid : (restGridFor(step.id, ctx) ?? keyState?.grid);
    if (keyState?.grid && fallbackGrid) {
      inBuf[0] = x; inBuf[1] = y;
      evalWarpKernelCubism(fallbackGrid, keyState.gridSize, keyState.isQuadTransform === true, inBuf, outBuf, 1);
      perPartChainPoint(rest, outBuf[0], outBuf[1], ctx, out);
      return;
    }
    perPartChainPoint(rest, x, y, ctx, out);
    return;
  }
  if (step.type === 'rotation') {
    const matState = computePerPartRotationCanvasFinal(step.id, rest, ctx);
    if (matState?.mat) {
      const tmp = /** @type {[number,number]} */ ([0, 0]);
      applyMat3ToPoint(matState.mat, x, y, tmp);
      if (matState.isCanvasFinal) { out[0] = tmp[0]; out[1] = tmp[1]; return; }
      perPartChainPoint(rest, tmp[0], tmp[1], ctx, out);
      return;
    }
    perPartChainPoint(rest, x, y, ctx, out);
    return;
  }
  perPartChainPoint(rest, x, y, ctx, out);
}

/**
 * Recompute a rotation deformer's canvas-final matrix by FD-probing its
 * authored pivot through the part's EFFECTIVE (enabled) `chainAbove`,
 * recomposing every ancestor per-part. Depgraph analogue of
 * `kernelRotationSetupProbe` (rotationSetup.js:52-124) but over the
 * explicit per-part chain rather than the global `def.parent` pointers —
 * so a mid-stack ancestor the part disabled is genuinely excluded from
 * this rotation's pivot. Mirrors the FD-probe ε (warp parent → 0.01,
 * rotation parent → 1.0) + the degenerate -Y fallback exactly.
 *
 * Memoised on `ctx` keyed by rotation id + chain signature, mirroring
 * `computePerPartLift`. Recursion always shortens `chainAbove`, so no
 * same-signature re-entry.
 *
 * @param {string} rotationId
 * @param {Array<{type:string, id:string, enabled?:boolean}>} chainAbove - leaf-first
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {{mat: Float64Array, isCanvasFinal: boolean}|null}
 */
function computePerPartRotationCanvasFinal(rotationId, chainAbove, ctx) {
  let cache = ctx._perPartRotMatCache;
  if (!cache) { cache = new Map(); ctx._perPartRotMatCache = cache; }
  const sig = `${rotationId}|${chainAbove.map((c) => `${c.type}:${c.id}:${c.enabled === false ? 0 : 1}`).join('>')}`;
  if (cache.has(sig)) return cache.get(sig);

  const key = ctx.outputs.get(`${rotationId}/${NodeType.GEOMETRY}/${OperationCode.KEYFORM_EVAL}`);
  if (!key || key.kind !== 'rotation') { cache.set(sig, null); return null; }
  const angleDeg = (key.angle ?? 0) + (key.baseAngle ?? 0);
  const px = key.originX ?? 0;
  const py = key.originY ?? 0;
  const setupBase = {
    scale: key.scale ?? 1,
    reflectX: !!key.reflectX,
    reflectY: !!key.reflectY,
    opacity: key.opacity ?? 1,
  };

  // No enabled ancestors → authored pivot is already canvas-px (mirrors
  // the root-parented branch of kernelRotationSetupProbe).
  if (chainAbove.length === 0) {
    const res = buildCanvasFinalMat3({
      ...setupBase, canvasFinalPivot: [px, py], effectiveAngleDeg: angleDeg,
    });
    cache.set(sig, res);
    return res;
  }

  // FD probe at the pivot through the per-part chain. ε mirrors the
  // immediate-parent-type choice in kernelRotationSetupProbe:87.
  const eps = chainAbove[0].type === 'warp' ? 0.01 : 1.0;
  const c = /** @type {[number,number]} */ ([0, 0]);
  const d = /** @type {[number,number]} */ ([0, 0]);
  perPartChainPoint(chainAbove, px, py, ctx, c);
  perPartChainPoint(chainAbove, px, py + eps, ctx, d);
  let dx = d[0] - c[0];
  let dy = d[1] - c[1];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    perPartChainPoint(chainAbove, px, py - eps, ctx, d);
    dx = -(d[0] - c[0]);
    dy = -(d[1] - c[1]);
  }
  let probedRad;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    probedRad = 0;
  } else {
    probedRad = Math.PI / 2 - Math.atan2(dy, dx);
    while (probedRad > Math.PI) probedRad -= 2 * Math.PI;
    while (probedRad <= -Math.PI) probedRad += 2 * Math.PI;
  }
  const res = buildCanvasFinalMat3({
    ...setupBase,
    canvasFinalPivot: [c[0], c[1]],
    effectiveAngleDeg: angleDeg - probedRad * 180 / Math.PI,
  });
  cache.set(sig, res);
  return res;
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
  // Cache per eval. The output depends only on `ctx.project.parameters`
  // defaults and `ctx.paramOverrides`, both constant for one eval pass.
  // Without this cache every ART_MESH_EVAL kernel re-walked ALL params
  // and re-allocated a fresh `{}` — for 100 parts × 80 params that's
  // 8000 property writes + 100 fresh objects per frame. This was the
  // dominant CPU cost during idle animation playback on heavy rigs.
  if (ctx._paramValuesCache) return ctx._paramValuesCache;
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
  ctx._paramValuesCache = values;
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
