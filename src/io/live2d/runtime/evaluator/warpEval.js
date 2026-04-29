/**
 * v2 R3 — Warp deformer evaluation.
 *
 * Two pure functions, used by `chainEval` (R6) to apply a warp
 * deformer's deformation to its child geometry:
 *
 *   - `evalWarpGrid(spec, cellInfo)` — Blend the warp's per-keyform
 *     control-point grids by `cellInfo.weights` and return the
 *     currently-active deformed grid. Output is in the warp's
 *     `localFrame` (interpretation requires `frameConvert`).
 *
 *   - `bilinearFFD(grid, gridSize, u, v)` — Apply the warp's grid as
 *     a free-form deformation to a single point in the warp's
 *     normalized [0..1] × [0..1] domain. Returns the interpolated
 *     control-point in the warp's `localFrame`.
 *
 * Pure JS. No allocations beyond the `Float64Array(N*2)` returned by
 * `evalWarpGrid`. Bilinear FFD allocates nothing — caller passes
 * an output `[x, y]` array if it wants to avoid heap churn in tight
 * loops.
 *
 * @module io/live2d/runtime/evaluator/warpEval
 */

/**
 * Blend the warp's per-keyform position arrays using cellSelect output.
 * Caller is responsible for ensuring keyform positions are all in the
 * same coordinate space (the spec's `localFrame`).
 *
 * @param {import('../../rig/rigSpec.js').WarpDeformerSpec} spec
 * @param {{indices: number[], weights: number[]}} cellInfo
 * @returns {Float64Array|null}
 */
export function evalWarpGrid(spec, cellInfo) {
  const keyforms = spec?.keyforms;
  if (!Array.isArray(keyforms) || keyforms.length === 0) return null;
  const first = keyforms[cellInfo?.indices?.[0] ?? 0];
  if (!first?.positions) return null;
  const len = first.positions.length;
  const out = new Float64Array(len);
  const idx = cellInfo?.indices ?? [];
  const w = cellInfo?.weights ?? [];
  for (let c = 0; c < idx.length; c++) {
    const wc = w[c];
    if (!wc) continue;
    const kf = keyforms[idx[c]];
    if (!kf?.positions) continue;
    const p = kf.positions;
    for (let i = 0; i < len; i++) out[i] += wc * p[i];
  }
  return out;
}

/**
 * Bilinear FFD on a warp control-point grid.
 *
 * The grid is laid out row-major with `(cols+1) × (rows+1)` control
 * points; each control point is two floats `(px, py)`. The input
 * `(u, v)` is in the warp's normalised [0, 1] domain — `u = 0`
 * maps to the leftmost column of control points, `u = 1` to the
 * rightmost; same for `v` and rows. Out-of-domain inputs clamp.
 *
 * Output is in the warp's `localFrame` (whatever space the grid's
 * control points live in). Caller composes through parent chain.
 *
 * @param {Float64Array} grid          - flat (cols+1)*(rows+1)*2 floats
 * @param {{rows:number, cols:number}} gridSize
 * @param {number} u                   - 0..1 across cols
 * @param {number} v                   - 0..1 across rows
 * @param {number[]} [out]             - optional output array `[x, y]` to avoid alloc
 * @returns {number[]}                  - [x, y] in the grid's localFrame
 */
export function bilinearFFD(grid, gridSize, u, v, out) {
  const rows = gridSize.rows;
  const cols = gridSize.cols;
  const nCols = cols + 1;

  // Map u/v to cell index + fractional. u in [0..1] → fu_total in [0..cols].
  // **Don't clamp fu_total / fv_total — extrapolate.** When the chain hands
  // us coordinates outside [0,1] (e.g. face pivot whose y projects below
  // BodyXWarp's range via canvasToBodyXY → negative), the Cubism runtime
  // extrapolates linearly using the edge cell's slope; clamping collapses
  // every off-grid point to the boundary, which is what made shelby's
  // face render as a tiny rectangle at the canvas top after Phase 1E
  // landed (off-grid v collapsed entire face to row 0).
  //
  // The clamp on `i, j` (cell indices) stays — those still need to address
  // a valid 2×2 patch of grid points. fu, fv are allowed to go outside
  // [0,1] so the bilinear weights act as a linear extrapolator.
  const fu_total = u * cols;
  const fv_total = v * rows;

  let i = Math.floor(fu_total);
  let j = Math.floor(fv_total);
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i >= cols) i = cols - 1;
  if (j >= rows) j = rows - 1;
  const fu = fu_total - i;
  const fv = fv_total - j;

  const idx00 = (j * nCols + i) * 2;
  const idx10 = (j * nCols + (i + 1)) * 2;
  const idx01 = ((j + 1) * nCols + i) * 2;
  const idx11 = ((j + 1) * nCols + (i + 1)) * 2;

  const w00 = (1 - fu) * (1 - fv);
  const w10 = fu * (1 - fv);
  const w01 = (1 - fu) * fv;
  const w11 = fu * fv;

  const px =
    w00 * grid[idx00] + w10 * grid[idx10] +
    w01 * grid[idx01] + w11 * grid[idx11];
  const py =
    w00 * grid[idx00 + 1] + w10 * grid[idx10 + 1] +
    w01 * grid[idx01 + 1] + w11 * grid[idx11 + 1];

  if (out) {
    out[0] = px;
    out[1] = py;
    return out;
  }
  return [px, py];
}
