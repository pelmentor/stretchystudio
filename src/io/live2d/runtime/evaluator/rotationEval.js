/**
 * v2 R4 — Rotation deformer evaluation.
 *
 * Two pure functions used by `chainEval` (R6):
 *
 *   - `evalRotation(spec, cellInfo)` — Blend a rotation deformer's
 *     keyforms by `cellInfo.weights` and return the active
 *     `{angleDeg, originX, originY, scale, reflectX, reflectY,
 *     opacity}`. Numeric fields lerp linearly; booleans are taken
 *     from the heaviest-weighted keyform (in practice they don't
 *     vary across a deformer's keyforms anyway).
 *
 *   - `buildRotationMat3(state)` — Compose the 3×3 affine matrix that
 *     maps a child point from this deformer's pivot-relative
 *     localFrame to its parent's frame:
 *
 *         parentPos = origin + R(angle) · S(scale) · Reflect(rx, ry) · pivotRelativePos
 *
 *     Return is a 9-element row-major Float64Array
 *     `[a, b, c, d, e, f, 0, 0, 1]` — `[a, b]` and `[d, e]` form the
 *     linear 2×2; `[c, f]` is the translation; bottom row constant.
 *
 * Notes on angle blending:
 *   For typical Cubism rotation ranges ([-30, 0, 30] etc.), straight
 *   linear interpolation matches the reference. For wrap-around cases
 *   (animations crossing ±180°) shortest-arc lerp would be needed —
 *   defer until any rig actually uses such a range.
 *
 * @module io/live2d/runtime/evaluator/rotationEval
 */

/**
 * @param {import('../../rig/rigSpec.js').RotationDeformerSpec} spec
 * @param {{indices: number[], weights: number[]}} cellInfo
 * @returns {{
 *   angleDeg: number,
 *   originX: number,
 *   originY: number,
 *   scale: number,
 *   reflectX: boolean,
 *   reflectY: boolean,
 *   opacity: number,
 * }|null}
 */
export function evalRotation(spec, cellInfo) {
  const keyforms = spec?.keyforms;
  if (!Array.isArray(keyforms) || keyforms.length === 0) return null;
  const idx = cellInfo?.indices ?? [];
  const w = cellInfo?.weights ?? [];

  let angleDeg = 0;
  let originX = 0;
  let originY = 0;
  let scale = 0;
  let opacity = 0;
  let totalW = 0;
  let heaviestW = -Infinity;
  let reflectX = false;
  let reflectY = false;

  for (let c = 0; c < idx.length; c++) {
    const wc = w[c];
    if (!wc) continue;
    const kf = keyforms[idx[c]];
    if (!kf) continue;
    angleDeg += wc * (kf.angle ?? 0);
    originX += wc * (kf.originX ?? 0);
    originY += wc * (kf.originY ?? 0);
    scale   += wc * (kf.scale ?? 1);
    opacity += wc * (kf.opacity ?? 1);
    totalW  += wc;
    if (wc > heaviestW) {
      heaviestW = wc;
      reflectX = !!kf.reflectX;
      reflectY = !!kf.reflectY;
    }
  }

  // Defensive: if cellInfo somehow yielded no contributing keyforms,
  // fall back to the spec's first keyform.
  if (totalW === 0) {
    const kf = keyforms[0] ?? {};
    return {
      angleDeg: kf.angle ?? 0,
      originX: kf.originX ?? 0,
      originY: kf.originY ?? 0,
      scale: kf.scale ?? 1,
      reflectX: !!kf.reflectX,
      reflectY: !!kf.reflectY,
      opacity: kf.opacity ?? 1,
    };
  }

  return { angleDeg, originX, originY, scale, reflectX, reflectY, opacity };
}

/**
 * Build the 3×3 row-major affine matrix from a rotation state.
 *
 * Matrix layout (row-major, applied to column vector [x, y, 1]):
 *
 *     | a  b  c |
 *     | d  e  f |
 *     | 0  0  1 |
 *
 * Returned as a 9-element `Float64Array` so the consumer can compose
 * matrices via `mat3Multiply` without converting array shapes.
 *
 * @param {{angleDeg:number, originX:number, originY:number, scale?:number,
 *          reflectX?:boolean, reflectY?:boolean}} state
 * @returns {Float64Array}
 */
export function buildRotationMat3(state) {
  const angleDeg = state?.angleDeg ?? 0;
  const ox = state?.originX ?? 0;
  const oy = state?.originY ?? 0;
  const s = state?.scale ?? 1;
  const rx = state?.reflectX ? -1 : 1;
  const ry = state?.reflectY ? -1 : 1;

  const rad = (angleDeg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);

  // Linear 2×2 = R · S · Reflect.
  // S · Reflect (applied first, before rotation): diag(s*rx, s*ry).
  // R · diag = [[cs, -sn], [sn, cs]] · diag(s*rx, s*ry)
  //          = [[cs*s*rx, -sn*s*ry], [sn*s*rx, cs*s*ry]].
  const a = cs * s * rx;
  const b = -sn * s * ry;
  const d = sn * s * rx;
  const e = cs * s * ry;

  const m = new Float64Array(9);
  m[0] = a; m[1] = b; m[2] = ox;
  m[3] = d; m[4] = e; m[5] = oy;
  m[6] = 0; m[7] = 0; m[8] = 1;
  return m;
}

/**
 * Apply a 3×3 affine matrix (row-major, layout above) to a 2D point.
 * Convenience for callers that don't want to wire up a full mat3 math
 * library.
 *
 * @param {Float64Array|number[]} m
 * @param {number} x
 * @param {number} y
 * @param {number[]} [out]
 * @returns {number[]} `[x', y']`
 */
export function applyMat3ToPoint(m, x, y, out) {
  const px = m[0] * x + m[1] * y + m[2];
  const py = m[3] * x + m[4] * y + m[5];
  if (out) {
    out[0] = px;
    out[1] = py;
    return out;
  }
  return [px, py];
}

/**
 * Multiply two 3×3 row-major matrices: `out = a · b`.
 *
 * @param {Float64Array|number[]} a
 * @param {Float64Array|number[]} b
 * @param {Float64Array} [out]
 * @returns {Float64Array}
 */
export function mat3Multiply(a, b, out) {
  const o = out ?? new Float64Array(9);
  const a0 = a[0], a1 = a[1], a2 = a[2];
  const a3 = a[3], a4 = a[4], a5 = a[5];
  const a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const b3 = b[3], b4 = b[4], b5 = b[5];
  const b6 = b[6], b7 = b[7], b8 = b[8];
  o[0] = a0 * b0 + a1 * b3 + a2 * b6;
  o[1] = a0 * b1 + a1 * b4 + a2 * b7;
  o[2] = a0 * b2 + a1 * b5 + a2 * b8;
  o[3] = a3 * b0 + a4 * b3 + a5 * b6;
  o[4] = a3 * b1 + a4 * b4 + a5 * b7;
  o[5] = a3 * b2 + a4 * b5 + a5 * b8;
  o[6] = a6 * b0 + a7 * b3 + a8 * b6;
  o[7] = a6 * b1 + a7 * b4 + a8 * b7;
  o[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return o;
}
