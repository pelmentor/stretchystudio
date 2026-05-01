// @ts-check

/**
 * Cubism rotation-deformer evaluator — Phase 2a port.
 *
 * Byte-faithful JS port of `RotationDeformer_TransformTarget` at IDA
 * 0x7fff2b24c950 in `Live2DCubismCoreJNI.dll` (Cubism 5.0 Editor's
 * statically-linked Cubism Core). Replaces v3's hand-written
 * textbook-rotation in [`rotationEval.js`](./rotationEval.js)
 * (`buildRotationMat3` + `applyMat3ToPoint`) which has been the root of
 * BUG-003 ("Body Angle X/Y/Z + face Angle X/Y/Z don't match Cubism").
 *
 * # The discrepancy
 *
 * v3's textbook rotation (post-multiply diag scale, then standard 2D
 * rotation, then translate):
 *
 *     out.x = cos·s·rX·px + (-sin·s·rY)·py + originX
 *     out.y = sin·s·rX·px + ( cos·s·rY)·py + originY
 *
 * Cubism's actual kernel:
 *
 *     out.x = (-sin·s·rY)·px + (cos·s·rX)·py + originX
 *     out.y = ( cos·s·rY)·px + (sin·s·rX)·py + originY
 *
 * Same translation, same scale, same reflect flags — but the LINEAR
 * 2x2 part is different. Equivalent to `R_textbook(θ + 90°)·diag(rx,
 * ry)` versus `R_textbook(θ)·diag(rx, ry)`. For a body-angle deformer
 * with θ ∈ [-30°, +30°] the v3 kernel produced near-identity; Cubism's
 * kernel produces a near-90°-rotated transform. The user-visible
 * symptom: rotation deformers' children deform along the wrong axis.
 *
 * # Why we trust this kernel
 *
 * Decompiled directly from the DLL (IDA Pro MCP, 2026-05-02). Field
 * mapping verified against moc3 binary spec:
 *   - `model[68]`  = `rotation_deformer_keyform.scales`     (per-deformer)
 *   - `model[69]`  = `rotation_deformer_keyform.origin_xs`  (per-deformer)
 *   - `model[70]`  = `rotation_deformer_keyform.origin_ys`  (per-deformer)
 *   - `model[71]`  = accumulated angle from parameter binding
 *   - `model[72]`  = `rotation_deformer_keyform.reflect_xs`
 *   - `model[73]`  = `rotation_deformer_keyform.reflect_ys`
 *
 * Note: an earlier draft of [docs/live2d-export/CUBISM_WARP_PORT.md](../../../../docs/live2d-export/CUBISM_WARP_PORT.md)
 * labeled model[69]/model[70] as "ty"/"tx" (creating the impression of an
 * x↔y axis swap). That was a mis-labelling — model[69] = origin_xs,
 * model[70] = origin_ys per the moc3 sections in `moc3writer.js:403-404`.
 * This port uses the correct semantics.
 *
 * # Phase 2a vs Phase 2b
 *
 * Phase 2a (this file): per-vertex eval kernel only. Replaces v3's
 * textbook-rotation matrix application. The chain orchestration —
 * specifically the `_warpSlopeX/Y = 1/canvasMaxDim` closed-form
 * approximation in `chainEval.js` — STAYS for now. That works correctly
 * when the warp-parent's eval has a constant Jacobian; for shelby's
 * smaller body warp it approximates poorly (~5× off), which is the
 * residual chain-composition divergence.
 *
 * Phase 2b (separate ship): port `RotationDeformer_Setup` —
 * finite-difference Jacobian probing of the parent eval, replacing the
 * `_warpSlopeX/Y` approximation. That fully closes the
 * rotation-on-warp-parent divergence.
 *
 * @module io/live2d/runtime/evaluator/cubismRotationEval
 */

/**
 * @typedef {Object} CubismRotationState
 *   The values needed to evaluate one rotation deformer at one frame.
 *   Same shape as `evalRotation`'s return in [`rotationEval.js`](./rotationEval.js)
 *   — the new kernel reads the same state shape, so the rigSpec
 *   builder doesn't need to change.
 * @property {number} angleDeg   accumulated angle (base + binding contribution)
 * @property {number} scale      composed scale (keyform.scale × parent slope; for warp-parented deformers)
 * @property {number} originX    pivot X in the parent's frame (canvas-px for root, normalised 0..1 for warp-parented)
 * @property {number} originY    pivot Y in the parent's frame
 * @property {boolean} reflectX  true → flip X axis
 * @property {boolean} reflectY  true → flip Y axis
 */

/**
 * Per-vertex rotation eval kernel — exact port of
 * `RotationDeformer_TransformTarget`.
 *
 * Writes 2N output floats to `vertsOut` from 2N input floats in
 * `vertsIn`. Both buffers are flat `[x0, y0, x1, y1, …]` Float32Array
 * or Float64Array. In-place is allowed (`vertsIn === vertsOut`) — the
 * kernel reads each vertex once before writing. (DLL also supports
 * in-place via aliased pointers — verified from the assembly, which
 * uses `*result` and `result[1..]` reads before the assigns.)
 *
 * @param {CubismRotationState} state
 * @param {ArrayLike<number>} vertsIn   2N entries (read)
 * @param {Array<number>|Float32Array|Float64Array} vertsOut  2N entries (write)
 * @param {number} vertCount   number of (x,y) pairs to process
 */
export function evalRotationKernelCubism(state, vertsIn, vertsOut, vertCount) {
  const angleRad = (state.angleDeg ?? 0) * Math.PI / 180;
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const s = state.scale ?? 1;
  const rx = state.reflectX ? -1 : 1;
  const ry = state.reflectY ? -1 : 1;
  const ox = state.originX ?? 0;
  const oy = state.originY ?? 0;

  // Linear 2x2 coefficients — see file docstring for derivation.
  const a = -sin * s * ry;  // out.x ← px·a
  const b =  cos * s * rx;  // out.x ← py·b
  const c =  cos * s * ry;  // out.y ← px·c
  const d =  sin * s * rx;  // out.y ← py·d

  for (let i = 0; i < vertCount; i++) {
    const i2 = i << 1;
    // Read both first (in-place safe).
    const px = vertsIn[i2];
    const py = vertsIn[i2 + 1];
    vertsOut[i2]     = px * a + py * b + ox;
    vertsOut[i2 + 1] = px * c + py * d + oy;
  }
}

/**
 * Build the 3×3 row-major affine matrix matching `evalRotationKernelCubism`.
 *
 * Useful for callers that want the matrix form (`chainEval`'s
 * DeformerStateCache currently caches a `Float64Array(9)`). Composes
 * via `mat3Multiply` like the textbook variant — only the linear part
 * differs. Bottom row is `[0, 0, 1]` so the matrix is a true 2D affine.
 *
 * @param {CubismRotationState} state
 * @returns {Float64Array}
 */
export function buildRotationMat3Cubism(state) {
  const angleRad = (state.angleDeg ?? 0) * Math.PI / 180;
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const s = state.scale ?? 1;
  const rx = state.reflectX ? -1 : 1;
  const ry = state.reflectY ? -1 : 1;
  const ox = state.originX ?? 0;
  const oy = state.originY ?? 0;

  const m = new Float64Array(9);
  m[0] = -sin * s * ry; m[1] = cos * s * rx; m[2] = ox;
  m[3] =  cos * s * ry; m[4] = sin * s * rx; m[5] = oy;
  m[6] = 0;             m[7] = 0;            m[8] = 1;
  return m;
}

/**
 * Anisotropic-scale variant — applies separate X and Y scale factors
 * to the linear part AFTER the rotation/reflect/scale composition.
 *
 * Used by `chainEval`'s DeformerStateCache for warp-parented rotation
 * deformers, where the child verts arrive in pivot-relative canvas-px
 * but the parent warp's eval expects a normalised 0..1 frame. The
 * `extraSx`/`extraSy` are `canvasToInnermostX/Y` slopes (≈ 1/canvasMaxDim
 * for full-canvas warps; smaller for sub-canvas warps like shelby's
 * body warp).
 *
 * Phase 2b will replace this with finite-difference Jacobian probe of
 * the parent's eval; for now it's a drop-in replacement for v3's
 * `buildRotationMat3Aniso` that uses Cubism's linear part instead of
 * textbook rotation.
 *
 * @param {CubismRotationState} state
 * @param {number} extraSx
 * @param {number} extraSy
 * @returns {Float64Array}
 */
export function buildRotationMat3CubismAniso(state, extraSx, extraSy) {
  if (extraSx === 1 && extraSy === 1) return buildRotationMat3Cubism(state);
  const angleRad = (state.angleDeg ?? 0) * Math.PI / 180;
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const s = state.scale ?? 1;
  const rx = state.reflectX ? -1 : 1;
  const ry = state.reflectY ? -1 : 1;
  const ox = state.originX ?? 0;
  const oy = state.originY ?? 0;

  const m = new Float64Array(9);
  // Same linear-part shape as Cubism kernel; rows post-multiplied by
  // diag(extraSx, extraSy).
  m[0] = -sin * s * ry * extraSx; m[1] = cos * s * rx * extraSx; m[2] = ox;
  m[3] =  cos * s * ry * extraSy; m[4] = sin * s * rx * extraSy; m[5] = oy;
  m[6] = 0;                       m[7] = 0;                      m[8] = 1;
  return m;
}
