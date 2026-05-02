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
import { logger } from '../../../../lib/logger.js';

/**
 * Module-level WeakSet of rigSpecs we've already emitted a Phase 3
 * lifted-grid summary for. Logs fire once per (rigSpec identity) so a
 * normal animation tick (60+ evalRig calls/sec) doesn't flood the
 * Logs panel — only Init Rig / cmo3 import / project load produces a
 * new rigSpec identity, and that's exactly when an engineer wants to
 * see the lifted bboxes.
 */
const _liftLoggedSpecs = new WeakSet();

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
 * @param {{kernel?: 'v3-legacy'|'cubism-setup', trace?: TraceCollector}} [options]
 *   Phase 2b — `kernel` selects the rotation-deformer composition
 *   strategy. `'v3-legacy'` (default) keeps the cascaded-normaliser
 *   `_warpSlopeX/Y` constant. `'cubism-setup'` is reserved for the
 *   in-progress Setup port (Stage 0: branches still identical, output
 *   byte-equal). `trace` is an optional collector for per-deformer
 *   intermediate state; consumed by `scripts/cubism_oracle/probe_kernel.mjs`.
 * @returns {ArtMeshFrame[]}
 */
export function evalRig(rigSpec, paramValues, options) {
  if (!rigSpec || !Array.isArray(rigSpec.artMeshes)) return [];
  const kernel = options?.kernel === 'cubism-setup' ? 'cubism-setup' : 'v3-legacy';
  const trace = options?.trace ?? null;
  const cache = new DeformerStateCache(rigSpec, paramValues, { kernel, trace });
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

  // Phase 3 — first-sight log of lifted-grid bboxes per warp on each
  // distinct rigSpec. Fires once per rigSpec identity (init rig / cmo3
  // import / project load), NOT per frame. The summary is the canonical
  // sanity check after a Phase 3 regression: each warp's lifted bbox
  // should sit roughly inside the canvas (e.g. body warps span the
  // character bbox in canvas-px). If a future change breaks the lift
  // (e.g. tiny fractional values, NaN, or out-of-canvas extents), this
  // log surfaces the regression at Init Rig time without needing the
  // oracle harness.
  if (!_liftLoggedSpecs.has(rigSpec)) {
    _liftLoggedSpecs.add(rigSpec);
    emitLiftedBboxSummary(rigSpec, cache);
  }
  return out;
}

/**
 * Walk every warp's lifted grid (computed lazily during the artmesh
 * eval pass) and emit a structured summary to the Logs panel. Skips
 * warps whose lift returned null (rotation-only chain; recorded in
 * the cache as `null`). Called exactly once per rigSpec identity.
 *
 * @param {import('../../rig/rigSpec.js').RigSpec} rigSpec
 * @param {DeformerStateCache} cache
 */
function emitLiftedBboxSummary(rigSpec, cache) {
  const warps = Array.isArray(rigSpec.warpDeformers) ? rigSpec.warpDeformers : [];
  if (warps.length === 0) return;
  /** @type {Record<string, {x:[number,number], y:[number,number]}>} */
  const summary = {};
  let nullCount = 0;
  for (const w of warps) {
    const lifted = cache._liftedById.get(w.id);
    if (!lifted) { nullCount++; continue; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < lifted.length; i += 2) {
      const x = lifted[i], y = lifted[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    summary[w.id] = {
      x: [Math.round(minX * 10) / 10, Math.round(maxX * 10) / 10],
      y: [Math.round(minY * 10) / 10, Math.round(maxY * 10) / 10],
    };
  }
  const lifted = Object.keys(summary).length;
  logger.debug(
    'chainEvalLift',
    `lifted ${lifted} warp${lifted === 1 ? '' : 's'} to canvas-px${nullCount > 0 ? ` (${nullCount} unliftable)` : ''}`,
    { canvas: rigSpec.canvas, summary },
  );
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
      // Phase 3 — use the warp's LIFTED grid (canvas-px control points,
      // pre-composed through every ancestor warp/rotation) and STOP
      // walking the chain after this single bilinear lookup. Equivalent
      // to Cubism Core's pipeline: WarpDeformer_Setup lifts grids
      // top-down; the artmesh evaluator then does ONE bilinear per
      // vertex against the leaf warp's lifted grid. Mathematically
      // matches Cubism — nested-bilinear composition (the legacy
      // pre-Phase-3 path) is a quartic polynomial when intermediate
      // warps are non-identity, while the lifted approach stays a
      // proper bilinear in canvas space.
      //
      // Bilinear kernel itself is the byte-faithful Phase 1 port from
      // cubismWarpEval.js (verified at 0.07 px on shelby rest pose for
      // non-eye meshes). Phase 3 just changes WHICH grid the kernel
      // evaluates against, not the kernel itself.
      const lifted = cache.getLiftedGrid(parentSpec);
      if (lifted) {
        evalWarpKernelCubism(
          lifted, parentSpec.gridSize, parentSpec.isQuadTransform === true,
          read, write, len >> 1,
        );
        bufA = bufB;
        bufB = read;
        // Lifted grid output is canvas-px; the chain is collapsed.
        break;
      }
      // Fallback: parent had no lifted grid (broken chain). Apply the
      // unlifted current-frame grid and continue walking. Preserves
      // legacy behaviour for malformed rigs.
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
export class DeformerStateCache {
  constructor(rigSpec, paramValues, options) {
    this._rigSpec = rigSpec;
    this._paramValues = paramValues ?? {};
    /**
     * Phase 2b — which kernel branch should `getState` follow when it
     * builds rotation matrices and which composition strategy should
     * `evalChainAtPoint` use. Stored on the cache so per-frame state
     * derivations stay consistent with the chosen kernel for the whole
     * `evalRig` call. Stage 0: branches are identical except for the
     * `kernel` field being readable; output byte-equal.
     * @type {'v3-legacy'|'cubism-setup'}
     */
    this._kernel = options?.kernel === 'cubism-setup' ? 'cubism-setup' : 'v3-legacy';
    /**
     * Phase 2b — optional `TraceCollector` for `probe_kernel.mjs`.
     * `null` in production paths so the trace branches are dead-code-
     * eliminated by the JIT after a few iterations.
     * @type {TraceCollector|null}
     */
    this._trace = options?.trace ?? null;
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

    // Phase 3 — per-warp lifted grid cache. Each entry maps a warp's id
    // to a Float64Array of canvas-px control point positions (same shape
    // as the warp's keyform grid). Populated lazily by `getLiftedGrid`,
    // computed once per evalRig call. Mirrors Cubism Core's
    // `WarpDeformer_Setup` (IDA `0x7fff2b24e410`) which lifts each warp's
    // grid to canvas-root via parent.TransformTarget(grid) before any
    // artmesh evaluation runs. Reduces the per-vertex chain walk from
    // O(chainDepth) nested bilinears to a single bilinear against the
    // lifted grid — mathematically equivalent to Cubism Core, whereas
    // nested bilinears compose to a quartic when intermediate warps are
    // non-identity.
    /** @type {Map<string, Float64Array|null>} */
    this._liftedById = new Map();
    /**
     * Phase 3 — set of warp ids currently mid-recursion in
     * `getLiftedGrid`. Used purely to detect cycles in the lift chain
     * (W1 → W2 → W1 — a malformed rig topology) and emit a one-shot
     * structured warn. The cycle-break itself is handled by the
     * sentinel pattern (`_liftedById.set(id, null)` before recursion);
     * this Set is the diagnostic surface so a malformed rig surfaces
     * loudly in the Logs panel instead of silently degrading.
     * @type {Set<string>}
     */
    this._liftingInFlight = new Set();

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
   * Phase 3 — return the warp's grid lifted to canvas-px by walking up
   * the parent chain and applying each ancestor's evaluator at every
   * control point. The result has the same shape as `state.grid` but
   * each (x, y) pair is in canvas-px rather than the warp's localFrame.
   *
   * Recursive + memoized. The recursion is bounded by chain depth
   * (≤ 32 in practice). For root warps (whose localFrame is canvas-px
   * already) the lifted grid is the current-frame grid itself — no
   * extra allocation.
   *
   * Falls back to the unlifted grid when an ancestor can't be resolved
   * (preserves the legacy nested-bilinear behaviour for that artmesh
   * rather than crashing). The unlifted-fallback path produces the
   * same output as pre-Phase-3 chainEval at REST POSE since at rest
   * every warp is an affine map, and bilinear-of-affine = affine.
   *
   * @param {import('../../rig/rigSpec.js').WarpDeformerSpec} warpSpec
   * @returns {Float64Array|null}
   */
  getLiftedGrid(warpSpec) {
    if (!warpSpec?.id) return null;
    if (this._liftedById.has(warpSpec.id)) return this._liftedById.get(warpSpec.id);

    // Cycle detection. If we're re-entered for an id that's still
    // mid-recursion higher up the stack, the rig has a malformed parent
    // loop. Surface it loudly and bail. The `_liftingInFlight` set is
    // cleared in the `finally` block at the end of this method so a
    // legitimate later call for the same warp (after the first lift
    // returns null) doesn't re-warn.
    if (this._liftingInFlight.has(warpSpec.id)) {
      logger.warn(
        'chainEvalLift',
        `cycle detected at warp '${warpSpec.id}' — chain has a parent loop, lifted grid will be partial`,
        { warpId: warpSpec.id, inFlight: Array.from(this._liftingInFlight) },
      );
      this._liftedById.set(warpSpec.id, null);
      return null;
    }
    this._liftingInFlight.add(warpSpec.id);
    try {
      return this._computeLiftedGrid(warpSpec);
    } finally {
      this._liftingInFlight.delete(warpSpec.id);
    }
  }

  /**
   * Internal: actually compute the lifted grid. Wrapped by
   * `getLiftedGrid` which handles the in-flight tracking + cycle
   * detection.
   *
   * @param {import('../../rig/rigSpec.js').WarpDeformerSpec} warpSpec
   * @returns {Float64Array|null}
   */
  _computeLiftedGrid(warpSpec) {
    const state = this.getState(warpSpec);
    if (!state || state.kind !== 'warp') {
      this._liftedById.set(warpSpec.id, null);
      return null;
    }

    const grid = state.grid;
    const gridSize = state.gridSize;
    const nPts = (gridSize.rows + 1) * (gridSize.cols + 1);

    // Root warp: localFrame is canvas-px, grid is already canvas-px.
    // No lift needed; return the current-frame grid directly.
    if (!warpSpec.parent || warpSpec.parent.type === 'root') {
      this._liftedById.set(warpSpec.id, grid);
      if (this._trace) this._trace.recordLiftedGrid(warpSpec, grid);
      return grid;
    }

    // (Cycle break is handled by `_liftingInFlight` set in the public
    // `getLiftedGrid` wrapper — when a recursive call lands on an id
    // that's already in flight, it emits a structured warn and returns
    // null, which the `if (!curParentLifted) break` below treats as
    // "ancestor can't be lifted", giving us a best-effort partial lift
    // matching legacy chainEval's bounded-safety semantics — no crash.)

    // Walk the parent chain. Each step transforms `positions` (an
    // (rows+1)×(cols+1) grid of x,y pairs) from the current frame to
    // the next-up frame via either a rotation matrix or a warp's
    // lifted-grid bilinear. Once we hit a warp parent we apply its
    // lifted grid (which is already canvas-px) and STOP — chain
    // is collapsed. If we walk all the way to root via rotations
    // without ever hitting a warp ancestor, the output is whatever
    // frame the rotation chain ended in (typically canvas-px-relative
    // to the topmost rotation's pivot, which is canvas-px when the
    // top rotation's parent is root).
    let positions = new Float64Array(nPts * 2);
    for (let i = 0; i < nPts * 2; i++) positions[i] = grid[i];
    let curParent = warpSpec.parent;
    let safety = 32;
    const tmp = [0, 0];

    while (curParent && curParent.type !== 'root' && safety-- > 0) {
      const curParentSpec = this._specById.get(curParent.id);
      if (!curParentSpec) break;

      if (curParent.type === 'warp') {
        // Apply parent's lifted-grid bilinear at every control point.
        // Output is canvas-px (lifted grid's localFrame). Done — break
        // out of the lifting loop.
        const curParentLifted = this.getLiftedGrid(curParentSpec);
        if (!curParentLifted) break;
        const vertsIn = new Float32Array(nPts * 2);
        for (let i = 0; i < nPts * 2; i++) vertsIn[i] = positions[i];
        const vertsOut = new Float32Array(nPts * 2);
        evalWarpKernelCubism(
          curParentLifted,
          curParentSpec.gridSize,
          curParentSpec.isQuadTransform === true,
          vertsIn,
          vertsOut,
          nPts,
        );
        for (let i = 0; i < nPts * 2; i++) positions[i] = vertsOut[i];
        curParent = null;
        break;
      } else if (curParent.type === 'rotation') {
        // Apply rotation matrix at every control point. Output is in
        // the rotation's parent's input frame; continue walking up.
        const curParentState = this.getState(curParentSpec);
        if (!curParentState || curParentState.kind !== 'rotation') break;
        const m = curParentState.mat;
        for (let i = 0; i < nPts; i++) {
          applyMat3ToPoint(m, positions[i * 2], positions[i * 2 + 1], tmp);
          positions[i * 2] = tmp[0];
          positions[i * 2 + 1] = tmp[1];
        }
        curParent = curParentSpec.parent;
      } else {
        break;
      }
    }

    this._liftedById.set(warpSpec.id, positions);
    if (this._trace) this._trace.recordLiftedGrid(warpSpec, positions);
    return positions;
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
   * **Phase 3 lifted-grid composition.** When the walk hits a warp
   * parent we evaluate against that warp's LIFTED grid (canvas-px
   * control points pre-composed through every ancestor warp/rotation)
   * and STOP. This matches `evalArtMeshFrame`'s Phase 3 semantics —
   * artmesh verts and FD probes must traverse the chain identically,
   * otherwise the FD probe measures a Jacobian that doesn't correspond
   * to what the artmesh sees.
   *
   * Falls back to the unlifted current-frame grid when the warp has no
   * lifted grid (broken chain). Mirrors `evalArtMeshFrame`'s same fallback.
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
        // Phase 3: prefer the lifted (canvas-px) grid; output is
        // canvas-px, so the chain collapses after this single step.
        const lifted = this.getLiftedGrid(parentSpec);
        if (lifted) {
          inBuf[0] = cx; inBuf[1] = cy;
          evalWarpKernelCubism(
            lifted, parentSpec.gridSize, parentSpec.isQuadTransform === true,
            inBuf, outBuf, 1,
          );
          cx = outBuf[0]; cy = outBuf[1];
          break;
        }
        // Fallback: unlifted current-frame grid; continue walking.
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
          // Phase 2b kernel switch: both branches currently produce the
          // same output (Stage 0 plumbing — Setup path lands in Stage 2).
          // The branch exists so Stages 1-3 can swap `_warpSlopeX/Y` for
          // an FD-probed J⁻¹ inside `cubism-setup` without disturbing the
          // production legacy path.
          const isWarpParent = spec.parent?.type === 'warp';
          if (this._kernel === 'cubism-setup') {
            // Stage 0 stub: identical to legacy. Real Setup path lands
            // in Stage 2 after Stage 1's measurement pass picks P1/P2/P3.
            const sx = isWarpParent ? this._warpSlopeX : 1;
            const sy = isWarpParent ? this._warpSlopeY : 1;
            state = { kind: 'rotation', mat: buildRotationMat3Aniso(r, sx, sy) };
          } else {
            const sx = isWarpParent ? this._warpSlopeX : 1;
            const sy = isWarpParent ? this._warpSlopeY : 1;
            state = { kind: 'rotation', mat: buildRotationMat3Aniso(r, sx, sy) };
          }
        }
      }
    }
    this._byId.set(spec.id, state);
    if (this._trace && state) this._trace.recordDeformerState(spec, state, this);
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

/**
 * Phase 2b — diagnostic trace collector. Pass an instance via
 * `evalRig(rigSpec, paramValues, { trace })` and the cache will record
 * per-deformer intermediate state into it as `getState` /
 * `getLiftedGrid` populate. Consumed by
 * `scripts/cubism_oracle/probe_kernel.mjs` to print numerical state at
 * a chosen fixture for Stage 1's measurement pass.
 *
 * Storage:
 *  - `deformerStates: Map<id, {kind, ...}>` — the public state from
 *    `getState`, plus extra metadata: `parentType`, `slopeX`, `slopeY`
 *    (the cascaded-normaliser values used for warp-parent rotations).
 *  - `liftedBboxes: Map<warpId, {x:[min,max], y:[min,max]}>` — the
 *    lifted-grid extents in canvas-px (one entry per warp that was
 *    lifted during the call; rotation-only ancestor chains produce no
 *    entry).
 *
 * The collector is a plain class (no globals), so a probe can run
 * multiple `evalRig` calls and inspect each independently.
 */
export class TraceCollector {
  constructor() {
    /** @type {Map<string, {id:string, kind:string, parentType:string|null, parentId:string|null, mat?:Float64Array, slopeX?:number, slopeY?:number, gridSize?:{rows:number,cols:number}}>} */
    this.deformerStates = new Map();
    /** @type {Map<string, {x:[number,number], y:[number,number]}>} */
    this.liftedBboxes = new Map();
  }

  /**
   * Called by `DeformerStateCache.getState` after the state is built.
   * @param {{id:string, parent?:{type:string,id:string|null}}} spec
   * @param {{kind:string, mat?:Float64Array, gridSize?:{rows:number,cols:number}}} state
   * @param {DeformerStateCache} cache
   */
  recordDeformerState(spec, state, cache) {
    if (!spec?.id || !state) return;
    const parentType = spec.parent?.type ?? null;
    const parentId = spec.parent?.id ?? null;
    const entry = { id: spec.id, kind: state.kind, parentType, parentId };
    if (state.kind === 'rotation') {
      entry.mat = state.mat ? Float64Array.from(state.mat) : null;
      if (parentType === 'warp') {
        entry.slopeX = cache._warpSlopeX;
        entry.slopeY = cache._warpSlopeY;
      }
    } else if (state.kind === 'warp') {
      entry.gridSize = state.gridSize;
    }
    this.deformerStates.set(spec.id, entry);
  }

  /**
   * Called by `DeformerStateCache._computeLiftedGrid` after a warp's
   * lifted grid is populated. Stores only the bbox (cheap) — the full
   * grid is left in the cache for the consumer to fetch directly when
   * needed.
   * @param {{id:string}} warpSpec
   * @param {Float64Array|null} positions
   */
  recordLiftedGrid(warpSpec, positions) {
    if (!warpSpec?.id || !positions) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i], y = positions[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.liftedBboxes.set(warpSpec.id, { x: [minX, maxX], y: [minY, maxY] });
  }
}
