// @ts-check

/**
 * Apply eye-closure curves to per-mesh vertex sets, lifted out of
 * `cmo3writer.js` (Phase 6 god-class breakup).
 *
 * Companion to `cmo3/eyeClosureFit.js` — the fit module produces a
 * `ParabolaCurve` from eyewhite/eyelash geometry, and this module
 * applies that curve to a target mesh's vertices to compute the
 * closed-eye keyform (`ParamEyeLOpen=0` shape).
 *
 * Three pure helpers, all canvas-space:
 *
 *   - `evalClosureCurve(params, px)` — evaluates the parabola at any
 *     canvas X (extrapolates naturally beyond xMin/xMax).
 *   - `evalBandY(bandCurve, px)` — piecewise-linear lookup over a
 *     [(x, y), ...] sample list. Used as the fallback when there's no
 *     parabola fit but a sampled band exists.
 *   - `computeClosedCanvasVerts({ curve, ..., canvasVerts, numVerts })`
 *     — returns a fresh `Number[]` of canvas-space closed positions.
 *     Eyelash meshes get their lash-strip thickness preserved (vertex
 *     stays at relY × lashHeight × LASH_STRIP_FRAC above/below the
 *     band line); other eye parts collapse Y straight to the curve.
 *
 * One non-pure-canvas helper:
 *
 *   - `computeClosedVertsForMesh({ ..., rwBox, dfOrigin })` — wraps
 *     the canvas-space compute and converts to whatever frame the
 *     downstream cmo3 emission needs (rig-warp 0..1 if `rwBox` set,
 *     pivot-relative pixels if `dfOrigin` set, else canvas).
 *
 * The lash-strip-half-pixel scale uses a configurable
 * `lashStripFrac` option (default 0.06 — matches the historical
 * EYE_CLOSURE_LASH_STRIP_FRAC value resolved from
 * `project.eyeClosureConfig`). 6% of lash height gives a clean thin
 * closed-eye line that scales naturally across character sizes.
 *
 * @module io/live2d/cmo3/eyeClosureApply
 */

/**
 * @typedef {{ a: number, b: number, c: number, xMid: number, xScale: number }} ClosureCurveParams
 */

/**
 * Evaluate the fitted parabola at canvas X (extrapolates naturally).
 *
 * @param {ClosureCurveParams|null|undefined} params
 * @param {number} px
 * @returns {number|null}
 */
export function evalClosureCurve(params, px) {
  if (!params) return null;
  const xn = (px - params.xMid) / params.xScale;
  return params.a * xn * xn + params.b * xn + params.c;
}

/**
 * Piecewise-linear lookup over a sampled band curve [(x, y), ...].
 * Outside the sample X range, clamps to the nearest endpoint Y.
 *
 * @param {number[][]|null|undefined} bandCurve
 * @param {number} px
 * @returns {number|null}
 */
export function evalBandY(bandCurve, px) {
  if (!bandCurve || bandCurve.length < 2) return null;
  if (px <= bandCurve[0][0]) return bandCurve[0][1];
  const last = bandCurve.length - 1;
  if (px >= bandCurve[last][0]) return bandCurve[last][1];
  for (let j = 0; j < last; j++) {
    if (px >= bandCurve[j][0] && px <= bandCurve[j + 1][0]) {
      const t = (px - bandCurve[j][0]) / (bandCurve[j + 1][0] - bandCurve[j][0]);
      return bandCurve[j][1] + t * (bandCurve[j + 1][1] - bandCurve[j][1]);
    }
  }
  return bandCurve[last][1];
}

/**
 * Compute closed-eye keyform vertices in CANVAS space. Same path used
 * for base eyewhite and `*.<suffix>` variant — base and variant must
 * NOT share input curves or `lashBbox` (each side fits its own
 * parabola against its own geometry).
 *
 * @param {Object} input
 * @param {ClosureCurveParams|null|undefined} input.curve
 * @param {number[][]|null|undefined} input.bandCurveFallback
 * @param {boolean} input.isEyelash
 * @param {{ minY: number, H: number }|null|undefined} input.lashBbox
 * @param {ArrayLike<number>} input.canvasVerts  Flat [x0,y0, x1,y1, …]
 * @param {number} input.numVerts                Pair count.
 * @param {number} [input.shiftPx=0]             Y-shift applied uniformly.
 * @param {number} [input.lashStripFrac=0.06]    Lash strip thickness factor.
 * @returns {number[]}                           Flat closed positions.
 */
export function computeClosedCanvasVerts({
  curve, bandCurveFallback, isEyelash, lashBbox, canvasVerts, numVerts,
  shiftPx = 0, lashStripFrac = 0.06,
}) {
  const lashStripHalfPx = lashBbox ? lashBbox.H * lashStripFrac : 0;
  const closedCanvas = new Array(canvasVerts.length);
  for (let i = 0; i < numVerts; i++) {
    const vx = canvasVerts[i * 2];
    const vy = canvasVerts[i * 2 + 1];
    let bandY = evalClosureCurve(curve, vx);
    if (bandY === null && bandCurveFallback) bandY = evalBandY(bandCurveFallback, vx);
    closedCanvas[i * 2] = vx;
    let closedY;
    if (bandY === null) {
      closedY = vy;
    } else if (isEyelash && lashBbox) {
      const relY = (vy - lashBbox.minY) / lashBbox.H;
      closedY = bandY + (relY - 0.5) * 2 * lashStripHalfPx;
    } else {
      closedY = bandY;
    }
    closedCanvas[i * 2 + 1] = closedY - shiftPx;
  }
  return closedCanvas;
}

/**
 * Compute closed-eye keyform vertices, then frame-convert to the
 * coord space the cmo3 emission needs:
 *
 *   - `rwBox` set       → rig-warp 0..1 of grid extent (with Y clamp
 *                          to grid bbox so out-of-band points don't
 *                          wraparound when the warp rebases).
 *   - `dfOrigin` set    → pivot-relative pixels (vertices minus
 *                          deformer's world origin).
 *   - neither           → canvas-space passthrough.
 *
 * @param {Object} input
 * @param {ClosureCurveParams|null|undefined} input.curve
 * @param {number[][]|null|undefined} input.bandCurveFallback
 * @param {boolean} input.isEyelash
 * @param {{ minY: number, H: number }|null|undefined} input.lashBbox
 * @param {ArrayLike<number>} input.canvasVerts
 * @param {number} input.numVerts
 * @param {{gridMinX:number,gridMinY:number,gridW:number,gridH:number}|null|undefined} [input.rwBox]
 * @param {{x:number,y:number}|null|undefined} [input.dfOrigin]
 * @param {number} [input.shiftPx=0]
 * @param {number} [input.lashStripFrac=0.06]
 * @returns {number[]}
 */
export function computeClosedVertsForMesh({
  curve, bandCurveFallback, isEyelash, lashBbox, canvasVerts, numVerts,
  rwBox, dfOrigin, shiftPx = 0, lashStripFrac = 0.06,
}) {
  const closedCanvas = computeClosedCanvasVerts({
    curve, bandCurveFallback, isEyelash, lashBbox, canvasVerts, numVerts,
    shiftPx, lashStripFrac,
  });
  if (rwBox) {
    const rwMinY = rwBox.gridMinY;
    const rwMaxY = rwBox.gridMinY + rwBox.gridH;
    for (let i = 1; i < closedCanvas.length; i += 2) {
      if (closedCanvas[i] < rwMinY) closedCanvas[i] = rwMinY;
      if (closedCanvas[i] > rwMaxY) closedCanvas[i] = rwMaxY;
    }
    return closedCanvas.map((v, i) =>
      i % 2 === 0
        ? (v - rwBox.gridMinX) / rwBox.gridW
        : (v - rwBox.gridMinY) / rwBox.gridH,
    );
  }
  if (dfOrigin) {
    return closedCanvas.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y));
  }
  return closedCanvas;
}
