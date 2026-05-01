// @ts-check

import { extractBottomContourFromLayerPng } from './pngHelpers.js';
import { logger } from '../../../lib/logger.js';

/**
 * Eye-closure parabola fit, lifted out of `cmo3writer.js`.
 *
 * Given an eyewhite or eyelash mesh (with optional layer PNG), fit a
 * parabola y = a·xn² + b·xn + c (xn = normalised X) to the lower
 * contour. The result is the closure target — eye vertices blend Y
 * onto this curve when ParamEyeLOpen drops to 0.
 *
 * Two sample sources, in priority order:
 *
 *   1. **Layer PNG alpha bottom contour** (best). Per-X-column max
 *      opaque Y from `extractBottomContourFromLayerPng`. Captures
 *      the actual drawn shape, not the mesh approximation.
 *   2. **Mesh bin-max fallback**. Uniform-X bins over the mesh
 *      vertices, take the max-Y vertex per bin. Used when no PNG is
 *      attached or PNG decode fails.
 *
 * Eyelash-fallback mode (`sourceTag === 'eyelash-fallback'`): the
 * lash's lower edge IS the upper eye opening, so the samples get
 * mirrored across a linear baseline before fitting. For eyewhite the
 * lower edge IS the lower lid — no mirror.
 *
 * Pure-ish: async because of the PNG decode; otherwise no I/O. The
 * output curve coefficients are evaluated downstream in canvas space:
 * `y = a · ((x − xMid)/xScale)² + b · ((x − xMid)/xScale) + c`.
 *
 * @module io/live2d/cmo3/eyeClosureFit
 */

/**
 * @typedef {Object} ParabolaCurve
 * @property {number} a       Quadratic coefficient (in normalised-x space).
 * @property {number} b       Linear coefficient.
 * @property {number} c       Constant term — y at xn=0.
 * @property {number} xMid    Canvas-space midpoint of the X span.
 * @property {number} xScale  Canvas-space half-width (xMid ± xScale = xMin/xMax).
 * @property {string} sourceTag    Diagnostic — copied from the caller.
 * @property {string} sampleSource Either '<tag>-png-alpha' or 'mesh-bin-max'.
 * @property {number} xMin    Lower X bound of the fit.
 * @property {number} xMax    Upper X bound of the fit.
 * @property {number} sampleCount Number of samples that fed the fit.
 */

/** Tiny 3×3 determinant — local to the parabola fit. */
function det3(a11, a12, a13, a21, a22, a23, a31, a32, a33) {
  return (
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31)
  );
}

/**
 * Fit a parabola to the lower edge of `sourceMesh`.
 *
 * @param {{ vertices?: number[], pngData?: Uint8Array|null } | null | undefined} sourceMesh
 * @param {string} sourceTag           Caller-supplied diagnostic tag.
 * @param {Object} [opts]
 * @param {number} [opts.binCount=6]   X-uniform bin count for the mesh-fallback sampler.
 * @returns {Promise<ParabolaCurve|null>} `null` on degenerate input.
 */
export async function fitParabolaFromLowerEdge(sourceMesh, sourceTag, opts = {}) {
  const binCount = Number.isFinite(opts.binCount) && opts.binCount > 0 ? opts.binCount : 6;

  if (!sourceMesh || !sourceMesh.vertices || sourceMesh.vertices.length < 6) {
    logger.warn('eyeClosureFit', `skip ${sourceTag}: no vertices or < 6`, {
      hasMesh: !!sourceMesh,
      vertCount: sourceMesh?.vertices?.length ?? 0,
    });
    return null;
  }
  const sourceVerts = sourceMesh.vertices;
  const nv = sourceVerts.length / 2;
  const pairs = new Array(nv);
  for (let i = 0; i < nv; i++) pairs[i] = [sourceVerts[i * 2], sourceVerts[i * 2 + 1]];
  pairs.sort((a, b) => a[0] - b[0]);
  const xMin = pairs[0][0];
  const xMax = pairs[pairs.length - 1][0];
  if (xMax - xMin < 1) return null;

  // PNG-alpha sampling first (P12); fall back to mesh bin-max.
  let samples = null;
  let sampleSource = 'mesh-bin-max';
  const hasPngData = !!sourceMesh.pngData && sourceMesh.pngData.length > 0;
  if (hasPngData) {
    const contour = await extractBottomContourFromLayerPng(sourceMesh.pngData, xMin, xMax);
    if (contour && contour.length >= 5) {
      samples = contour;
      sampleSource = sourceTag + '-png-alpha';
    } else {
      logger.warn('eyeClosureFit', `${sourceTag}: PNG decode produced too-few samples`, {
        contourLength: contour?.length ?? 0,
      });
    }
  } else {
    logger.warn('eyeClosureFit', `${sourceTag}: no pngData attached — falling back to mesh bin-max`);
  }
  if (!samples) {
    const binW = (xMax - xMin) / binCount;
    samples = [];
    for (let b = 0; b < binCount; b++) {
      const bxLo = xMin + b * binW;
      const bxHi = b === binCount - 1 ? xMax + 1 : xMin + (b + 1) * binW;
      let maxY = -Infinity, sumX = 0, count = 0;
      for (const p of pairs) {
        if (p[0] < bxLo || p[0] >= bxHi) continue;
        if (p[1] > maxY) maxY = p[1];
        sumX += p[0]; count++;
      }
      if (count > 0) samples.push([sumX / count, maxY]);
    }
  }
  if (samples.length < 3) {
    logger.warn('eyeClosureFit', `${sourceTag}: too few samples for fit`, {
      sampleCount: samples.length,
      sampleSource,
    });
    return null;
  }

  // Eyelash-fallback: mirror across the linear baseline because the
  // lash's lower edge approximates the upper opening, not the lower lid.
  let fitSamples = samples;
  if (sourceTag === 'eyelash-fallback' && samples.length >= 2) {
    const [x0, y0] = samples[0];
    const [xN, yN] = samples[samples.length - 1];
    const slope = (yN - y0) / Math.max(1e-6, xN - x0);
    fitSamples = samples.map(([x, y]) => {
      const yLine = y0 + slope * (x - x0);
      return [x, 2 * yLine - y];
    });
  }

  const xMid = (xMin + xMax) / 2;
  const xScale = (xMax - xMin) / 2 || 1;
  let sX = 0, sY = 0, sX2 = 0, sX3 = 0, sX4 = 0, sXY = 0, sX2Y = 0;
  for (const [x, y] of fitSamples) {
    const xn = (x - xMid) / xScale;
    const xn2 = xn * xn;
    sX += xn; sY += y;
    sX2 += xn2; sX3 += xn2 * xn; sX4 += xn2 * xn2;
    sXY += xn * y; sX2Y += xn2 * y;
  }
  const n = fitSamples.length;
  const detM = det3(n, sX, sX2, sX, sX2, sX3, sX2, sX3, sX4);
  if (Math.abs(detM) < 1e-9) {
    logger.warn('eyeClosureFit', `${sourceTag}: degenerate fit (detM≈0)`, { detM, sampleSource });
    return null;
  }
  const c = det3(sY, sX, sX2, sXY, sX2, sX3, sX2Y, sX3, sX4) / detM;
  const bc = det3(n, sY, sX2, sX, sXY, sX3, sX2, sX2Y, sX4) / detM;
  const ac = det3(n, sX, sY, sX, sX2, sXY, sX2, sX3, sX2Y) / detM;
  const result = { a: ac, b: bc, c, xMid, xScale, sourceTag, sampleSource, xMin, xMax, sampleCount: samples.length };
  logger.info('eyeClosureFit', `${sourceTag}: fit ok (${sampleSource})`, {
    a: ac, b: bc, c, xMid, xScale, xMin, xMax, sampleCount: samples.length,
  });
  return result;
}
