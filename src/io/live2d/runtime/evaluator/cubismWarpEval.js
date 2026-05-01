/**
 * Phase 1 of the Cubism warp evaluator port.
 *
 * Byte-faithful port of `WarpDeformer_TransformTarget` from
 * Live2DCubismCore.dll @ 0x7fff2b24cc40 (see CUBISM_WARP_PORT.md for the
 * IDA pseudocode this was transcribed from).
 *
 * Per input vertex (u, v):
 *   1. INSIDE case (0 ≤ u < 1 AND 0 ≤ v < 1):
 *        - default (`isQuadTransform=false`) → triangle-split bilinear
 *          (du+dv > 1 → upper-right triangle; else lower-left triangle).
 *          v3's old `bilinearFFD` always used the 4-point form, which
 *          differs along the cell diagonal for non-axis-aligned grids.
 *        - `isQuadTransform=true` → standard 4-point bilinear.
 *   2. OUTSIDE case (u or v outside [0,1)):
 *        - One-shot lazy compute of 6 edge-gradient cache values from
 *          the four grid corners (TL/TR/BL/BR).
 *        - Dispatch by quadrant:
 *            "Far field" (|u| ≥ 2 or |v| ≥ 2 outside grid): pure linear
 *               extrapolation `baseline + dGrid/dU·u + dGrid/dV·v`.
 *            "Near boundary" (u or v in band [-2,0] ∪ [1,3]): use the
 *               relevant grid edge cell's two corners as the inside
 *               half of a virtual cell, synthesise the outside half via
 *               linear extrapolation, then apply triangle-split.
 *            "Corner zone" (both u and v outside [0,1] in same direction):
 *               same as near-boundary but on a corner cell; both halves
 *               of the virtual cell are extrapolated.
 *
 * The OUTSIDE algorithm (~150 LOC of branching) is what makes Cubism's
 * out-of-bounds behaviour smooth — vertices outside the warp's normalised
 * range still receive deformation, derived from edge gradients. v3's
 * pre-port behaviour was to fall back to `baseGrid` (no displacement),
 * which produced visible discontinuities for rigs whose body warps cover
 * less than the full canvas (e.g. shelby's BodyXWarp).
 *
 * @module io/live2d/runtime/evaluator/cubismWarpEval
 */

// Per-call edge-gradient cache. Lazily populated on the first OOB vertex
// hit, reused across the rest of the loop. We keep this on a single
// object so the cache can survive across vertex iterations within one
// kernel call without per-vertex alloc. A fresh object per call avoids
// state leakage across deformer invocations.
function makeEdgeCache() {
  return {
    populated: false,
    // x components
    bx0: 0,    // baseline x at (u=0, v=0) — matches Cubism's v46 / v98
    dxU: 0,    // mean horizontal d/dU — Cubism's v103
    dxV: 0,    // half cross-difference x term — Cubism's v102
    // y components
    by0: 0,    // baseline y at (u=0, v=0) — Cubism's v49 / v100
    dyU: 0,    // half mean d/dU for y — Cubism's v104
    dyV: 0,    // half cross-difference y term — Cubism's v101
  };
}

/**
 * Populate the edge-gradient cache from the 4 grid corners.
 * Matches the FIRST-OOB-VERTEX branch of WarpDeformer_TransformTarget
 * (lines around 0x7fff2b24d033 in the IDA decompile).
 *
 * Direct transcription:
 *   TR.x = grid[2*uDivs];  TR.y = grid[2*uDivs + 1];
 *   TL.x = grid[0];        TL.y = grid[1];
 *   BL.x = grid[2*BLidx];  BL.y = grid[2*BLidx + 1];   BLidx = vDivs * (uDivs+1)
 *   BR.x = grid[2*BRidx];  BR.y = grid[2*BRidx + 1];   BRidx = uDivs + BLidx
 *
 *   v42 = BR.x - TL.x;   v43 = TR.y - BL.y;   v44 = BR.y - TL.y
 *   v103 = ((TR.x - BL.x) + v42) * 0.5
 *   v104 = (v43 + v44) * 0.5
 *   v45  = v42 - (TR.x - BL.x);   v48 = v44 - v43
 *   v46 = (TL.x + TR.x + BL.x + BR.x) * 0.25 - v42 * 0.5
 *   v49 = (TL.y + TR.y + BL.y + BR.y) * 0.25 - v44 * 0.5
 *   v102 = v45 * 0.5;     v101 = v48 * 0.5
 */
function populateEdgeCache(cache, grid, gridSize) {
  const uDivs = gridSize.cols;  // u-divisions = number of cells along u
  const vDivs = gridSize.rows;
  const stride = uDivs + 1;
  const tlIdx = 0;
  const trIdx = uDivs;
  const blIdx = vDivs * stride;
  const brIdx = uDivs + blIdx;

  const tlx = grid[2 * tlIdx];
  const tly = grid[2 * tlIdx + 1];
  const trx = grid[2 * trIdx];
  const try_ = grid[2 * trIdx + 1];
  const blx = grid[2 * blIdx];
  const bly = grid[2 * blIdx + 1];
  const brx = grid[2 * brIdx];
  const bry = grid[2 * brIdx + 1];

  const dxBR_TL = brx - tlx;       // v42
  const dyTR_BL = try_ - bly;      // v43
  const dyBR_TL = bry - tly;       // v44
  const dxTR_BL = trx - blx;

  cache.dxU = ((dxTR_BL) + dxBR_TL) * 0.5;     // v103
  cache.dyU = (dyTR_BL + dyBR_TL) * 0.5;       // v104
  const v45 = dxBR_TL - dxTR_BL;
  const v48 = dyBR_TL - dyTR_BL;
  cache.bx0 = (tlx + trx + blx + brx) * 0.25 - dxBR_TL * 0.5;  // v46/v98
  cache.by0 = (tly + try_ + bly + bry) * 0.25 - dyBR_TL * 0.5; // v49/v100
  cache.dxV = v45 * 0.5;  // v102
  cache.dyV = v48 * 0.5;  // v101
  cache.populated = true;
}

/** Linear extrapolation using the cached gradients. Used by the far-field
 *  branch + as the "outside half" of virtual cells in the boundary regions.
 *    out.x = dxU·u + bx0 + dxV·v
 *    out.y = dyU·u + by0 + dyV·v
 *  (Matches the v36/v37/v93/v95 expressions in the FAR FIELD branch,
 *  IDA decompile around 0x7fff2b24d99d.)
 */
function farFieldXY(cache, u, v, out) {
  out[0] = cache.dxU * u + cache.bx0 + cache.dxV * v;
  out[1] = cache.dyU * u + cache.by0 + cache.dyV * v;
}

/**
 * Triangle-split bilinear OR full bilinear, applied to one virtual cell
 * with 4 corners {TL, TR, BL, BR}. `du, dv` are the cell-local fractions
 * (both should land in roughly [0, 1] but we don't assert — the boundary
 * regions push slightly outside).
 *
 * Cubism dispatches on `du + dv > 1` for triangle-split mode:
 *  - upper-right tri: out = (1-du)·BL + (du+dv-1)·BR + (1-dv)·TR
 *  - lower-left tri:  out = (1-du-dv)·TL + du·TR + dv·BL
 * For full bilinear:
 *  - out = (1-du)(1-dv)·TL + du(1-dv)·TR + (1-du)dv·BL + du·dv·BR
 */
function interpCellXY(
  tlx, tly, trx, try_, blx, bly, brx, bry,
  du, dv, isQuadTransform, out,
) {
  if (isQuadTransform) {
    const w00 = (1 - du) * (1 - dv);
    const w10 = du * (1 - dv);
    const w01 = (1 - du) * dv;
    const w11 = du * dv;
    out[0] = w00 * tlx + w10 * trx + w01 * blx + w11 * brx;
    out[1] = w00 * tly + w10 * try_ + w01 * bly + w11 * bry;
    return;
  }
  if (du + dv > 1) {
    // Upper-right triangle (BL, BR, TR — all but TL contribute).
    const a = 1 - du;            // weight on BL
    const b = du + dv - 1;       // weight on BR
    const c = 1 - dv;            // weight on TR
    out[0] = a * blx + b * brx + c * trx;
    out[1] = a * bly + b * bry + c * try_;
  } else {
    // Lower-left triangle (TL, TR, BL — all but BR contribute).
    const a = 1 - du - dv;       // weight on TL
    const b = du;                // weight on TR
    const c = dv;                // weight on BL
    out[0] = a * tlx + b * trx + c * blx;
    out[1] = a * tly + b * try_ + c * bly;
  }
}

/**
 * Read the 2-vertex pair from a grid edge — used to anchor the inside
 * half of boundary-region virtual cells.
 *
 *   For the TOP row (v=0): cells span u-axis at v-row 0.
 *     cellLeft  = grid[cellU       , 0]
 *     cellRight = grid[cellU + 1   , 0]
 *
 *   For the BOTTOM row (v=1): same but v-row vDivs.
 *
 *   For the LEFT col (u=0): cells span v-axis at u-col 0.
 *   For the RIGHT col (u=1): same but u-col uDivs.
 */

/**
 * Cubism warp eval kernel, byte-faithful port of
 * `WarpDeformer_TransformTarget`.
 *
 * @param {Float64Array|Float32Array} grid          - flat (cols+1)*(rows+1)*2 floats
 * @param {{rows:number, cols:number}} gridSize     - cubism notation: cols = uDivs, rows = vDivs
 * @param {boolean} isQuadTransform                  - false (default) = triangle-split, true = 4-point bilinear
 * @param {Float32Array|Array} vertsIn               - input (u, v) pairs, length = 2*N
 * @param {Float32Array|Array} vertsOut              - output (x, y) pairs, length = 2*N. Must NOT alias vertsIn.
 * @param {number} vertCount                          - number of vertices (N)
 */
export function evalWarpKernelCubism(grid, gridSize, isQuadTransform, vertsIn, vertsOut, vertCount) {
  const uDivs = gridSize.cols;
  const vDivs = gridSize.rows;
  const stride = uDivs + 1;
  const cache = makeEdgeCache();
  const out2 = [0, 0];

  for (let vi = 0; vi < vertCount; vi++) {
    const u = vertsIn[2 * vi];
    const v = vertsIn[2 * vi + 1];

    const inside = u >= 0 && v >= 0 && u < 1 && v < 1;

    if (inside) {
      // INSIDE [0,1): triangle-split or bilinear on the actual deformed cell.
      const fuTotal = u * uDivs;
      const fvTotal = v * vDivs;
      let cellU = Math.floor(fuTotal);
      let cellV = Math.floor(fvTotal);
      if (cellU >= uDivs) cellU = uDivs - 1;
      if (cellV >= vDivs) cellV = vDivs - 1;
      if (cellU < 0) cellU = 0;
      if (cellV < 0) cellV = 0;
      const du = fuTotal - cellU;
      const dv = fvTotal - cellV;

      const tl = (cellV * stride + cellU) * 2;
      const tr = tl + 2;
      const bl = tl + stride * 2;
      const br = bl + 2;

      interpCellXY(
        grid[tl], grid[tl + 1],
        grid[tr], grid[tr + 1],
        grid[bl], grid[bl + 1],
        grid[br], grid[br + 1],
        du, dv, isQuadTransform, out2,
      );
      vertsOut[2 * vi] = out2[0];
      vertsOut[2 * vi + 1] = out2[1];
      continue;
    }

    // OUTSIDE — populate the edge-gradient cache lazily.
    if (!cache.populated) populateEdgeCache(cache, grid, gridSize);

    // Far-field test (matches `v28 <= -2.0 || v28 >= 3.0 || v29 <= -2.0 || v29 >= 3.0`)
    if (u <= -2.0 || u >= 3.0 || v <= -2.0 || v >= 3.0) {
      farFieldXY(cache, u, v, out2);
      vertsOut[2 * vi] = out2[0];
      vertsOut[2 * vi + 1] = out2[1];
      continue;
    }

    // Boundary regions — 8 cases, one per (u-class, v-class) where each
    // class is ∈ {below: ≤0, inside: (0,1), above: ≥1}. The inside-inside
    // case is handled above; all other 8 fall here.
    //
    // Each region builds a virtual cell with 4 corners and applies the
    // same triangle-split / bilinear via `interpCellXY`. The corners come
    // from a mix of {real grid edge cells} and {linear extrapolation via
    // farFieldXY}.

    const uClass = u <= 0 ? -1 : (u >= 1 ? 1 : 0);
    const vClass = v <= 0 ? -1 : (v >= 1 ? 1 : 0);

    // Mid-region cell index (the grid cell on the closest edge that
    // we're "extending" out from). For u-mid case (0<u<1), pick
    // floor(u·uDivs), clamped. Same for v-mid.
    const uMidCell = (() => {
      let c = Math.floor(u * uDivs);
      if (c >= uDivs) c = uDivs - 1;
      if (c < 0) c = 0;
      return c;
    })();
    const vMidCell = (() => {
      let c = Math.floor(v * vDivs);
      if (c >= vDivs) c = vDivs - 1;
      if (c < 0) c = 0;
      return c;
    })();

    // Per-region virtual cell setup. For simplicity we always set the
    // cell up the same way: TL/TR/BL/BR are real grid points or
    // extrapolated ones. `du, dv` are the within-cell fractions.
    let tlx = 0, tly = 0, trx = 0, try_ = 0;
    let blx = 0, bly = 0, brx = 0, bry = 0;
    let du = 0, dv = 0;
    const tmpA = [0, 0];
    const tmpB = [0, 0];

    if (vClass === -1 && uClass === 0) {
      // Top band (0 < u < 1, v ≤ 0). Real cells on top row (v=0).
      // Inside half = grid[uMidCell, 0] / grid[uMidCell+1, 0]
      // Outside half = farFieldXY(u-coord-of-cell, v=-2)
      const tlIdx = (0 * stride + uMidCell) * 2;
      const trIdx = tlIdx + 2;
      tlx = grid[tlIdx]; tly = grid[tlIdx + 1];
      trx = grid[trIdx]; try_ = grid[trIdx + 1];
      const uCellLeft = uMidCell / uDivs;
      const uCellRight = (uMidCell + 1) / uDivs;
      farFieldXY(cache, uCellLeft, -2.0, tmpA);
      farFieldXY(cache, uCellRight, -2.0, tmpB);
      blx = tmpA[0]; bly = tmpA[1];
      brx = tmpB[0]; bry = tmpB[1];
      du = u * uDivs - uMidCell;
      dv = (v - (-2.0)) / 2.0;     // v ∈ [-2, 0] → dv ∈ [0, 1]
      // Swap so that "TL" of virtual cell corresponds to (u=0, v=0) of cell.
      // Top band: real grid is at v=0 (= dv=1 of the virtual cell). So
      // the virtual cell maps:
      //   virtTL = extrapolated at v=-2 (= bly above) — should be TL of cell
      //   virtBL = real grid (= tly above) — should be BL of cell
      // Swap top↔bottom of the virtual cell:
      const sx0 = blx, sy0 = bly, sx1 = brx, sy1 = bry;
      blx = tlx; bly = tly; brx = trx; bry = try_;
      tlx = sx0; tly = sy0; trx = sx1; try_ = sy1;
    } else if (vClass === 1 && uClass === 0) {
      // Bottom band (0 < u < 1, v ≥ 1). Real cells on bottom row (v=1).
      const blIdx = (vDivs * stride + uMidCell) * 2;
      const brIdx = blIdx + 2;
      blx = grid[blIdx]; bly = grid[blIdx + 1];
      brx = grid[brIdx]; bry = grid[brIdx + 1];
      const uCellLeft = uMidCell / uDivs;
      const uCellRight = (uMidCell + 1) / uDivs;
      farFieldXY(cache, uCellLeft, 3.0, tmpA);
      farFieldXY(cache, uCellRight, 3.0, tmpB);
      tlx = tmpA[0]; tly = tmpA[1];
      trx = tmpB[0]; try_ = tmpB[1];
      du = u * uDivs - uMidCell;
      dv = (v - 1.0) / 2.0;          // v ∈ [1, 3] → dv ∈ [0, 1]
    } else if (uClass === -1 && vClass === 0) {
      // Left band (0 < v < 1, u ≤ 0).
      const tlIdx = (vMidCell * stride + 0) * 2;
      const blIdx = tlIdx + stride * 2;
      trx = grid[tlIdx]; try_ = grid[tlIdx + 1];
      brx = grid[blIdx]; bry = grid[blIdx + 1];
      const vCellTop = vMidCell / vDivs;
      const vCellBot = (vMidCell + 1) / vDivs;
      farFieldXY(cache, -2.0, vCellTop, tmpA);
      farFieldXY(cache, -2.0, vCellBot, tmpB);
      tlx = tmpA[0]; tly = tmpA[1];
      blx = tmpB[0]; bly = tmpB[1];
      du = (u - (-2.0)) / 2.0;       // u ∈ [-2, 0] → du ∈ [0, 1]
      dv = v * vDivs - vMidCell;
    } else if (uClass === 1 && vClass === 0) {
      // Right band (0 < v < 1, u ≥ 1).
      const trIdx = (vMidCell * stride + uDivs) * 2;
      const brIdx = trIdx + stride * 2;
      tlx = grid[trIdx]; tly = grid[trIdx + 1];
      blx = grid[brIdx]; bly = grid[brIdx + 1];
      const vCellTop = vMidCell / vDivs;
      const vCellBot = (vMidCell + 1) / vDivs;
      farFieldXY(cache, 3.0, vCellTop, tmpA);
      farFieldXY(cache, 3.0, vCellBot, tmpB);
      trx = tmpA[0]; try_ = tmpA[1];
      brx = tmpB[0]; bry = tmpB[1];
      du = (u - 1.0) / 2.0;          // u ∈ [1, 3] → du ∈ [0, 1]
      dv = v * vDivs - vMidCell;
    } else {
      // Corner zones (u and v both outside [0,1]). Build a virtual cell
      // anchored at the relevant grid corner, with 3 of 4 corners
      // extrapolated. Use farFieldXY at (u-edge, v-edge), (u-corner, v-edge),
      // (u-edge, v-corner) where -edge means -2 and +edge means 3.
      const uEdge = uClass < 0 ? -2.0 : 3.0;
      const vEdge = vClass < 0 ? -2.0 : 3.0;
      const uAnchor = uClass < 0 ? 0.0 : 1.0;
      const vAnchor = vClass < 0 ? 0.0 : 1.0;

      // Real grid corner — TL/TR/BL/BR depending on which corner zone.
      let cornerU = uClass < 0 ? 0 : uDivs;
      let cornerV = vClass < 0 ? 0 : vDivs;
      const cornerIdx = (cornerV * stride + cornerU) * 2;
      const cornerX = grid[cornerIdx];
      const cornerY = grid[cornerIdx + 1];

      // Extrapolated corners.
      const extrUEdgeX = [0, 0]; // (uEdge, vAnchor)
      const extrVEdgeX = [0, 0]; // (uAnchor, vEdge)
      const extrBothX = [0, 0];  // (uEdge, vEdge)
      farFieldXY(cache, uEdge, vAnchor, extrUEdgeX);
      farFieldXY(cache, uAnchor, vEdge, extrVEdgeX);
      farFieldXY(cache, uEdge, vEdge, extrBothX);

      // Build virtual cell — TL is (smaller u, smaller v), etc.
      // Map the 4 logical positions ((uAnchor, vAnchor), (uEdge, vAnchor),
      // (uAnchor, vEdge), (uEdge, vEdge)) into TL/TR/BL/BR based on signs.
      const positions = [
        { x: cornerX, y: cornerY, u: uAnchor, v: vAnchor },
        { x: extrUEdgeX[0], y: extrUEdgeX[1], u: uEdge, v: vAnchor },
        { x: extrVEdgeX[0], y: extrVEdgeX[1], u: uAnchor, v: vEdge },
        { x: extrBothX[0], y: extrBothX[1], u: uEdge, v: vEdge },
      ];

      // Find which has min(u,v) → TL, max(u),min(v) → TR, etc.
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of positions) {
        if (p.u < minU) minU = p.u;
        if (p.u > maxU) maxU = p.u;
        if (p.v < minV) minV = p.v;
        if (p.v > maxV) maxV = p.v;
      }
      const find = (uu, vv) => positions.find(p => p.u === uu && p.v === vv);
      const TL = find(minU, minV);
      const TR = find(maxU, minV);
      const BL = find(minU, maxV);
      const BR = find(maxU, maxV);
      tlx = TL.x; tly = TL.y;
      trx = TR.x; try_ = TR.y;
      blx = BL.x; bly = BL.y;
      brx = BR.x; bry = BR.y;
      du = (u - minU) / (maxU - minU);
      dv = (v - minV) / (maxV - minV);
    }

    interpCellXY(tlx, tly, trx, try_, blx, bly, brx, bry, du, dv, isQuadTransform, out2);
    vertsOut[2 * vi] = out2[0];
    vertsOut[2 * vi + 1] = out2[1];
  }
}
