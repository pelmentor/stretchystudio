/**
 * v2 R5 — Art mesh keyform evaluation.
 *
 * Take an `ArtMeshSpec` plus a `cellInfo` (from `cellSelect`) and
 * blend the per-keyform vertex grids, opacities and (optional)
 * drawOrders into a single resolved state. Output vertex positions
 * are in the spec's parent localFrame — `chainEval` (R6) walks the
 * parent chain to compose them back into canvas-px.
 *
 * Same blending shape as `warpEval.evalWarpGrid` but for variable-
 * length per-keyform vertex arrays. Opacity is a scalar (lerps
 * directly); drawOrder is sticky-from-heaviest-keyform because
 * draw-order changes mid-blend produce visible Z-flicker — Cubism's
 * runtime treats drawOrder as discrete per-keyform anyway.
 *
 * Pure JS, no allocations besides the returned `Float32Array`.
 *
 * @module io/live2d/runtime/evaluator/artMeshEval
 */

/**
 * @param {import('../../rig/rigSpec.js').ArtMeshSpec} spec
 * @param {{indices: number[], weights: number[]}} cellInfo
 * @returns {{
 *   vertexPositions: Float32Array,
 *   opacity: number,
 *   drawOrder: number,
 * }|null}
 */
export function evalArtMesh(spec, cellInfo) {
  const keyforms = spec?.keyforms;
  if (!Array.isArray(keyforms) || keyforms.length === 0) return null;
  const idx = cellInfo?.indices ?? [];
  const w = cellInfo?.weights ?? [];

  // Reference keyform — first weighted entry (or fall back to keyforms[0]).
  let refKf = null;
  for (let c = 0; c < idx.length; c++) {
    if (w[c]) { refKf = keyforms[idx[c]] ?? null; if (refKf) break; }
  }
  if (!refKf) refKf = keyforms[0];
  if (!refKf?.vertexPositions) return null;

  const len = refKf.vertexPositions.length;
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

  // Defensive zero-total-weight fallback: copy first keyform verbatim.
  if (totalW === 0) {
    const kf = keyforms[0];
    out.set(kf.vertexPositions);
    return {
      vertexPositions: out,
      opacity: kf.opacity ?? 1,
      drawOrder: kf.drawOrder ?? spec?.drawOrder ?? 500,
    };
  }

  const drawOrder =
    heaviestKf?.drawOrder ?? spec?.drawOrder ?? 500;

  return { vertexPositions: out, opacity, drawOrder };
}
