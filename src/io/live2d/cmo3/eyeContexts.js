// @ts-nocheck

/**
 * Eye-closure context pre-pass for the .cmo3 generator.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #43).
 *
 * For every base-side eye-source mesh (eyelash / eyewhite, both sides),
 * extracts a closure curve in BodyX 0..1 space — used by Section 3c's
 * per-part rig warps to push eye-part vertices toward a shared
 * convergence line when ParamEye{L,R}Open=0.
 *
 * Pipeline per mesh:
 *
 *   1. Vertex pairs sorted by X. Eyewhite → take all; eyelash fallback
 *      → take central 60 % (excludes decorative wings).
 *   2. X-uniform binning → `lowerHalf[]` of (binMeanX, binMaxY) — true
 *      bottom contour, not Y-median filtering which would mix in
 *      interior triangulation vertices.
 *   3. Least-squares parabola fit y = a·xn² + b·xn + c via Cramer's
 *      rule (3×3 determinants). xn normalised on the mesh's X span for
 *      numerical stability.
 *   4. Sample parabola N=7 points within the FIT data X range (no
 *      extrapolation drift).
 *   5. Apply yOffset = −0.15 × meshHeight to raise from raw lower-edge
 *      to the natural closed-eye position.
 *   6. Eyewhite path → curve points are the closure target directly.
 *      Eyelash fallback → flip around the line through curve endpoints
 *      (preserve tilt, invert curvature) to convert "upper opening"
 *      shape into "lower eyelid" shape.
 *   7. Project (x, y) into BodyX 0..1 via `canvasToBodyXX/Y` — Section
 *      3c's rig-warp grids live in BodyX local frame.
 *
 * `findEyeCtx(tag, bbCx, bbCy)` resolves the right context per
 * downstream eye-part mesh: prefers eyewhite source on the matching
 * side, falls back to any eyewhite, then matching-side eyelash, then
 * any context. Tie-broken by squared distance to the part's bbox
 * center (also in BodyX space).
 *
 * @module io/live2d/cmo3/eyeContexts
 */

import { EYEWHITE_TAGS, EYE_SOURCE_TAGS } from './eyeTags.js';

/**
 * @param {Object} opts
 * @param {Array<any>} opts.perMesh
 * @param {Array<any>} opts.meshes
 * @param {boolean} opts.generateRig
 * @param {(cx: number) => number} opts.canvasToBodyXX
 * @param {(cy: number) => number} opts.canvasToBodyXY
 * @param {any} opts.rigDebugLog
 * @returns {{
 *   eyeContexts: Array<{tag: string, isEyewhite: boolean, curvePoints: Array<[number, number]>, bboxCenterX: number, bboxCenterY: number}>,
 *   findEyeCtx: (tag: string, bboxCx: number, bboxCy: number) => any,
 * }}
 */
export function buildEyeContexts(opts) {
  const { perMesh, meshes, generateRig, canvasToBodyXX, canvasToBodyXY, rigDebugLog } = opts;

  const eyeContexts = [];

  if (generateRig) {
    for (const pm of perMesh) {
      const m = meshes[pm.mi];
      if (!EYE_SOURCE_TAGS.has(m.tag)) continue;
      if (pm.hasBakedKeyforms) continue;
      const verts = pm.vertices;
      const nv = verts.length / 2;
      if (nv < 3) continue;
      // ── Extract true bottom contour via X-bin max-Y ──
      // Sort vertices by X, split into X-bins, take MAX Y vertex per bin.
      // This captures the actual bottom boundary (not mixed with interior
      // triangulation vertices that filtering by Y > median would include).
      const pairs = new Array(nv);
      for (let i = 0; i < nv; i++) pairs[i] = [verts[i * 2], verts[i * 2 + 1]];
      pairs.sort((a, b) => a[0] - b[0]);
      // For eyewhite: use all vertices (clean mesh, no wings).
      // For eyelash fallback: take central 60% to exclude decorative wings.
      const isEyewhiteSrc = EYEWHITE_TAGS.has(m.tag);
      const pLo = isEyewhiteSrc ? 0 : Math.floor(nv * 0.20);
      const pHi = isEyewhiteSrc ? nv : Math.max(pLo + 1, Math.ceil(nv * 0.80));
      const central = pairs.slice(pLo, pHi);
      if (central.length < 4) continue;
      // Bin-max extraction of bottom contour
      const N_BINS = Math.min(8, Math.max(3, Math.floor(central.length / 3)));
      const lowerHalf = []; // actually "bottom contour points" now
      for (let b = 0; b < N_BINS; b++) {
        const binStart = Math.floor(central.length * b / N_BINS);
        const binEnd = Math.floor(central.length * (b + 1) / N_BINS);
        if (binEnd <= binStart) continue;
        let maxY = -Infinity, sumX = 0;
        for (let i = binStart; i < binEnd; i++) {
          if (central[i][1] > maxY) maxY = central[i][1];
          sumX += central[i][0];
        }
        lowerHalf.push([sumX / (binEnd - binStart), maxY]);
      }
      if (lowerHalf.length < 3) continue;
      // Compute Y-range of mesh to offset the curve up to natural closed-eye position.
      // Raw bin-max-Y sits at the lower eyelid; natural closed eye is slightly above.
      let meshMinY = Infinity, meshMaxY = -Infinity;
      for (const p of pairs) {
        if (p[1] < meshMinY) meshMinY = p[1];
        if (p[1] > meshMaxY) meshMaxY = p[1];
      }
      const yOffset = -0.15 * (meshMaxY - meshMinY); // negative = upward on canvas
      // Fit parabola y = ax² + bx + c via least-squares (normalize X for numerical stability)
      const fullMinX = pairs[0][0], fullMaxX = pairs[pairs.length - 1][0];
      const xMid = (fullMinX + fullMaxX) / 2;
      const xScale = (fullMaxX - fullMinX) / 2 || 1;
      let sX = 0, sY = 0, sX2 = 0, sX3 = 0, sX4 = 0, sXY = 0, sX2Y = 0;
      for (const [x, y] of lowerHalf) {
        const xn = (x - xMid) / xScale; // normalized X ∈ roughly [-1, 1]
        const xn2 = xn * xn;
        sX += xn; sY += y;
        sX2 += xn2; sX3 += xn2 * xn; sX4 += xn2 * xn2;
        sXY += xn * y; sX2Y += xn2 * y;
      }
      const nPts = lowerHalf.length;
      // Solve 3x3 linear system: M * [c, b, a]^T = [sY, sXY, sX2Y]^T
      //   [nPts sX  sX2] [c]   [sY]
      //   [sX   sX2 sX3] [b] = [sXY]
      //   [sX2  sX3 sX4] [a]   [sX2Y]
      // Using Cramer's rule (3x3 determinants)
      const det3 = (a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
        a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
      const detM  = det3(nPts, sX, sX2, sX, sX2, sX3, sX2, sX3, sX4);
      if (Math.abs(detM) < 1e-12) continue;
      const detC  = det3(sY, sX, sX2, sXY, sX2, sX3, sX2Y, sX3, sX4);
      const detB  = det3(nPts, sY, sX2, sX, sXY, sX3, sX2, sX2Y, sX4);
      const detA  = det3(nPts, sX, sY, sX, sX2, sXY, sX2, sX3, sX2Y);
      const c = detC / detM, b = detB / detM, a = detA / detM;
      // Sample parabola within fit data X range (avoid extrapolation drift)
      const fitMinX = lowerHalf.reduce((m, p) => Math.min(m, p[0]), Infinity);
      const fitMaxX = lowerHalf.reduce((m, p) => Math.max(m, p[0]), -Infinity);
      const N_SAMPLES = 7;
      const rawSamples = [];
      for (let i = 0; i < N_SAMPLES; i++) {
        const t = i / (N_SAMPLES - 1);
        const xCanvas = fitMinX + t * (fitMaxX - fitMinX);
        const xn = (xCanvas - xMid) / xScale;
        const yCanvas = a * xn * xn + b * xn + c;
        rawSamples.push([xCanvas, yCanvas]);
      }
      // Eyewhite lower edge = lower eyelid (smile shape directly, no flip needed).
      // Eyelash lower edge = upper eye opening (frown shape); flip to get smile shape.
      // Apply yOffset to raise curve from raw lower-edge to natural closed-eye position.
      const isEyewhite = EYEWHITE_TAGS.has(m.tag);
      let curvePoints;
      if (isEyewhite) {
        curvePoints = rawSamples.map(([x, y]) =>
          [canvasToBodyXX(x), canvasToBodyXY(y + yOffset)]);
      } else {
        // Flip around line through endpoints (preserve tilt, invert curvature)
        const [x0, y0s] = rawSamples[0];
        const [xN, yNs] = rawSamples[rawSamples.length - 1];
        const slope = (yNs - y0s) / Math.max(1e-6, xN - x0);
        curvePoints = rawSamples.map(([x, y]) => {
          const yLine = y0s + slope * (x - x0);
          return [canvasToBodyXX(x), canvasToBodyXY(2 * yLine - y + yOffset)];
        });
      }
      // Bbox center for proximity matching with eyewhite/irides (use full pairs range)
      const [lX, lY] = pairs[0];
      const [rX, rY] = pairs[pairs.length - 1];
      const bboxCenterX = canvasToBodyXX((lX + rX) / 2);
      const bboxCenterY = canvasToBodyXY((lY + rY) / 2);
      eyeContexts.push({
        tag: m.tag, isEyewhite, curvePoints, bboxCenterX, bboxCenterY,
      });
      if (rigDebugLog) {
        rigDebugLog.eyeClosureContexts.push({
          sourceTag: m.tag, isEyewhite,
          meshBbox: { minY: meshMinY, maxY: meshMaxY, H: meshMaxY - meshMinY },
          yOffset_canvasPx: yOffset,
          parabolaFit: { a, b, c, xMid, xScale },
          curveSampleCount: curvePoints.length,
          curvePoints_bodyX01: curvePoints,
        });
      }
    }
  }

  // Find matching eye ctx: prefer eyewhite source (more accurate), same side, proximity
  const findEyeCtx = (tag, bboxCx, bboxCy) => {
    if (eyeContexts.length === 0) return null;
    const side = tag.endsWith('-l') ? 'l' : tag.endsWith('-r') ? 'r' : '';
    // First try: eyewhite with matching side
    let pool = eyeContexts.filter(c => c.isEyewhite &&
      ((side === 'l' && c.tag.endsWith('-l')) ||
       (side === 'r' && c.tag.endsWith('-r')) ||
       (!side)));
    // Second try: any eyewhite
    if (!pool.length) pool = eyeContexts.filter(c => c.isEyewhite);
    // Third try: eyelash with matching side
    if (!pool.length) pool = eyeContexts.filter(c =>
      (side === 'l' && c.tag.endsWith('-l')) ||
      (side === 'r' && c.tag.endsWith('-r')));
    // Last resort: any context
    if (!pool.length) pool = eyeContexts;
    let best = null, bestD2 = Infinity;
    for (const c of pool) {
      const dx = bboxCx - c.bboxCenterX, dy = bboxCy - c.bboxCenterY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  };

  return { eyeContexts, findEyeCtx };
}
