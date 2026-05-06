// @ts-check

/**
 * Inverse of `bilinearFFD` (forward in `warpEval.js`).
 *
 * Given a deformed warp grid (in canvas-px) and a target canvas-px point,
 * find normalized `(u, v) ∈ [0, 1]²` such that
 * `bilinearFFD(grid, gridSize, u, v) ≈ targetCanvas`.
 *
 * The forward bilinear FFD over a single cell with corners P00, P10,
 * P01, P11 is:
 *
 *     F(s, t) = (1-s)(1-t)·P00 + s(1-t)·P10 + (1-s)t·P01 + st·P11
 *             = P00 + s·B + t·C + s·t·A
 *
 * where:
 *     A = P00 - P10 - P01 + P11   (warp curvature, second-order)
 *     B = P10 - P00               (s-direction edge)
 *     C = P01 - P00               (t-direction edge)
 *     D = target - P00
 *
 * Substituting the x-equation into the y-equation yields a quadratic
 * in `t`:
 *
 *     a·t² + b·t + c = 0
 *
 * with:
 *     a = A × C   (= A.x*C.y - A.y*C.x)
 *     b = (D × A) + (B × C)
 *     c = D × B
 *
 * Roots are picked so that `t ∈ [0, 1]`; `s` is back-solved from the
 * x-equation. When the cell is non-curved (a ≈ 0) the equation
 * collapses to linear `t = -c / b`.
 *
 * This is needed by the V4 keyform editor — when the user drags a
 * `normalized-0to1` warp's control point in screen-px, we need to
 * write back into `keyform.positions` in [0, 1]² of the parent's
 * grid. The forward composition uses `bilinearFFD` over the parent's
 * deformed grid; the inverse here closes the loop.
 *
 * @module io/live2d/runtime/evaluator/inverseBilinearFFD
 */

const EPS = 1e-9;

/** 2-D cross product magnitude. */
function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/**
 * Inverse bilinear within a single cell `[(P00, P10, P01, P11)]`.
 * Returns `null` if the target lies outside `[0, 1]²` of the cell or
 * the cell is degenerate enough that no real root falls in range.
 *
 * Caller is responsible for picking the right cell — typically by
 * walking every cell of the grid until one returns a non-null result.
 *
 * @param {[number, number]} P00
 * @param {[number, number]} P10
 * @param {[number, number]} P01
 * @param {[number, number]} P11
 * @param {[number, number]} target
 * @returns {[number, number] | null}
 */
export function inverseBilinearCell(P00, P10, P01, P11, target) {
  const Bx = P10[0] - P00[0];
  const By = P10[1] - P00[1];
  const Cx = P01[0] - P00[0];
  const Cy = P01[1] - P00[1];
  const Ax = P00[0] - P10[0] - P01[0] + P11[0];
  const Ay = P00[1] - P10[1] - P01[1] + P11[1];
  const Dx = target[0] - P00[0];
  const Dy = target[1] - P00[1];

  const a = cross(Ax, Ay, Cx, Cy);
  const b = cross(Dx, Dy, Ax, Ay) + cross(Bx, By, Cx, Cy);
  const c = cross(Dx, Dy, Bx, By);

  /** @type {number[]} */
  const tCandidates = [];
  if (Math.abs(a) < EPS) {
    // Linear: b·t + c = 0
    if (Math.abs(b) < EPS) {
      // Truly degenerate; bail.
      return null;
    }
    tCandidates.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tCandidates.push((-b + sq) / (2 * a));
    tCandidates.push((-b - sq) / (2 * a));
  }

  // Try each root; pick the one yielding s ∈ [-tol, 1+tol] and t in
  // the same range. tol = 1e-6 absorbs FP noise without admitting
  // points clearly outside the cell.
  const TOL = 1e-6;
  /** @type {[number, number] | null} */
  let best = null;
  let bestErr = Infinity;
  for (const t of tCandidates) {
    if (!Number.isFinite(t)) continue;
    if (t < -TOL || t > 1 + TOL) continue;
    // s = (Dx - t·Cx) / (Bx + t·Ax). Pick whichever denominator is
    // larger in absolute value to dodge a numerical zero.
    const denomX = Bx + t * Ax;
    const denomY = By + t * Ay;
    let s;
    if (Math.abs(denomX) >= Math.abs(denomY)) {
      if (Math.abs(denomX) < EPS) continue;
      s = (Dx - t * Cx) / denomX;
    } else {
      if (Math.abs(denomY) < EPS) continue;
      s = (Dy - t * Cy) / denomY;
    }
    if (s < -TOL || s > 1 + TOL) continue;
    // Verify (s, t) actually maps back near `target` (rejects spurious
    // quadratic roots that happen to land in [0, 1] with s near zero).
    const fx = P00[0] + s * Bx + t * Cx + s * t * Ax;
    const fy = P00[1] + s * By + t * Cy + s * t * Ay;
    const err = Math.hypot(fx - target[0], fy - target[1]);
    if (err < bestErr) {
      bestErr = err;
      best = [Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, t))];
    }
  }
  return best;
}

/**
 * Inverse bilinear FFD over a full warp grid.
 *
 * Walks every cell, returning the first match. With a 5×5 grid that's
 * 25 cell tests in the worst case — fast enough for drag (60Hz).
 *
 * @param {Float64Array | Float32Array | number[]} grid
 *   Flat (cols+1) * (rows+1) * 2 floats, in canvas-px (the parent's
 *   *deformed* state at the locked keyform tuple).
 * @param {{rows: number, cols: number}} gridSize
 * @param {[number, number]} canvasPos
 * @returns {[number, number] | null}  `(u, v)` in `[0, 1]²` of the
 *   whole grid, or `null` if `canvasPos` lies outside every cell of
 *   the deformed grid.
 */
export function inverseBilinearFFD(grid, gridSize, canvasPos) {
  const { rows, cols } = gridSize;
  if (rows < 1 || cols < 1) return null;
  const nCols = cols + 1;
  /** @type {[number, number] | null} */
  let best = null;
  let bestErr = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = (r * nCols + c) * 2;
      const i10 = (r * nCols + (c + 1)) * 2;
      const i01 = ((r + 1) * nCols + c) * 2;
      const i11 = ((r + 1) * nCols + (c + 1)) * 2;
      const local = inverseBilinearCell(
        [grid[i00], grid[i00 + 1]],
        [grid[i10], grid[i10 + 1]],
        [grid[i01], grid[i01 + 1]],
        [grid[i11], grid[i11 + 1]],
        canvasPos,
      );
      if (!local) continue;
      // Re-eval to score (the cell solver already verified within
      // tolerance, but cells that overlap geometrically may both match
      // — pick the one with the smallest residual).
      const s = local[0], t = local[1];
      const fx = (1 - s) * (1 - t) * grid[i00]
               + s * (1 - t) * grid[i10]
               + (1 - s) * t * grid[i01]
               + s * t * grid[i11];
      const fy = (1 - s) * (1 - t) * grid[i00 + 1]
               + s * (1 - t) * grid[i10 + 1]
               + (1 - s) * t * grid[i01 + 1]
               + s * t * grid[i11 + 1];
      const err = Math.hypot(fx - canvasPos[0], fy - canvasPos[1]);
      if (err < bestErr) {
        bestErr = err;
        best = [(c + s) / cols, (r + t) / rows];
      }
    }
  }
  return best;
}
