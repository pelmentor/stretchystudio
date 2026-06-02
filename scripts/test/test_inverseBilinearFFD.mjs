// Inverse bilinear FFD round-trip — for every (u, v) sampled across
// [0, 1]², compute forward bilinearFFD against a (possibly curved)
// grid, then inverse the result, and check that we land back on the
// original (u, v) within tolerance.
//
// Cases:
//   1. Identity grid (linear, no curvature) — inverse is exact.
//   2. Sheared grid — inverse must still land within 1e-6.
//   3. Curved grid (real warp deformation) — inverse should land
//      within 1e-4 (numerical noise from quadratic solver).
//   4. Out-of-grid target → null.
//
// Run: node scripts/test/test_inverseBilinearFFD.mjs

import { inverseBilinearFFD, inverseBilinearCell } from '../../src/io/live2d/runtime/evaluator/inverseBilinearFFD.js';

/**
 * Plain bilinear FFD — inlined here after `warpEval.js` was retired
 * with the rest of the chainEval engine (2026-05-26). Used ONLY as
 * the forward operation against which `inverseBilinearFFD` is
 * cross-validated. Production code uses `cubismWarpEval.evalWarpKernelCubism`
 * for actual warp evaluation (matches Cubism's triangle-split semantics
 * when `isQuadTransform=false`).
 *
 * @param {Float64Array} grid - flat `(cols+1)*(rows+1)*2` control points
 * @param {{rows: number, cols: number}} gridSize
 * @param {number} u - normalized [0..1]
 * @param {number} v - normalized [0..1]
 * @returns {[number, number]} canvas-px output point
 */
function bilinearFFD(grid, gridSize, u, v) {
  const cols = gridSize.cols;
  const rows = gridSize.rows;
  let cu = Math.floor(u * cols);
  let cv = Math.floor(v * rows);
  if (cu >= cols) cu = cols - 1;
  if (cv >= rows) cv = rows - 1;
  if (cu < 0) cu = 0;
  if (cv < 0) cv = 0;
  const fu = u * cols - cu;
  const fv = v * rows - cv;
  const stride = cols + 1;
  const i00 = (cv * stride + cu) * 2;
  const i10 = (cv * stride + cu + 1) * 2;
  const i01 = ((cv + 1) * stride + cu) * 2;
  const i11 = ((cv + 1) * stride + cu + 1) * 2;
  const w00 = (1 - fu) * (1 - fv);
  const w10 = fu * (1 - fv);
  const w01 = (1 - fu) * fv;
  const w11 = fu * fv;
  return [
    w00 * grid[i00] + w10 * grid[i10] + w01 * grid[i01] + w11 * grid[i11],
    w00 * grid[i00 + 1] + w10 * grid[i10 + 1] + w01 * grid[i01 + 1] + w11 * grid[i11 + 1],
  ];
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps) {
  return Math.abs(a - b) <= eps;
}

/** Build a (cols+1)×(rows+1) grid as a flat Float64Array via a generator. */
function makeGrid(cols, rows, gen) {
  const arr = new Float64Array((cols + 1) * (rows + 1) * 2);
  let i = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [x, y] = gen(c / cols, r / rows);
      arr[i++] = x;
      arr[i++] = y;
    }
  }
  return arr;
}

// ── Test 1: identity grid (linear) ──
{
  // 4×4 grid spanning canvas [0..400] × [0..300]
  const grid = makeGrid(4, 4, (u, v) => [u * 400, v * 300]);
  const gridSize = { rows: 4, cols: 4 };

  const samples = [
    [0.0, 0.0], [0.5, 0.5], [1.0, 1.0],
    [0.25, 0.75], [0.8, 0.2], [0.123, 0.789],
  ];
  for (const [u, v] of samples) {
    const canvas = bilinearFFD(grid, gridSize, u, v);
    const inv = inverseBilinearFFD(grid, gridSize, [canvas[0], canvas[1]]);
    if (!inv) {
      assert(false, `Test 1: identity grid (u=${u}, v=${v}) returned null`);
      continue;
    }
    assert(nearlyEq(inv[0], u, 1e-6),
      `Test 1: u round-trip ${u} → ${inv[0].toFixed(6)} (canvas=${canvas[0].toFixed(2)}, ${canvas[1].toFixed(2)})`);
    assert(nearlyEq(inv[1], v, 1e-6),
      `Test 1: v round-trip ${v} → ${inv[1].toFixed(6)}`);
  }
}

// ── Test 2: sheared grid (still linear in each cell) ──
{
  const grid = makeGrid(3, 3, (u, v) => [u * 300 + v * 50, v * 200]);
  const gridSize = { rows: 3, cols: 3 };

  const samples = [[0.1, 0.1], [0.5, 0.5], [0.9, 0.4], [0.33, 0.67]];
  for (const [u, v] of samples) {
    const canvas = bilinearFFD(grid, gridSize, u, v);
    const inv = inverseBilinearFFD(grid, gridSize, [canvas[0], canvas[1]]);
    if (!inv) {
      assert(false, `Test 2: sheared (u=${u}, v=${v}) returned null`);
      continue;
    }
    assert(nearlyEq(inv[0], u, 1e-5), `Test 2: u ${u} → ${inv[0].toFixed(6)}`);
    assert(nearlyEq(inv[1], v, 1e-5), `Test 2: v ${v} → ${inv[1].toFixed(6)}`);
  }
}

// ── Test 3: curved grid (real bilinear FFD non-linearity) ──
{
  // 4×4 grid with a barrel-curve so cells are quads, not parallelograms.
  // Forward bilinear FFD then describes a non-linear deformation; the
  // inverse must solve a real quadratic.
  const grid = makeGrid(4, 4, (u, v) => {
    // Pinch the middle inward.
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;        // 0..1 from center
    const pinch = 1 - 0.15 * (1 - r);                  // tighter at center
    const cx = 200 + (u - 0.5) * 400 * pinch;
    const cy = 150 + (v - 0.5) * 300 * pinch;
    return [cx, cy];
  });
  const gridSize = { rows: 4, cols: 4 };

  const samples = [
    [0.05, 0.05], [0.2, 0.3], [0.5, 0.5], [0.7, 0.4], [0.95, 0.95],
  ];
  for (const [u, v] of samples) {
    const canvas = bilinearFFD(grid, gridSize, u, v);
    const inv = inverseBilinearFFD(grid, gridSize, [canvas[0], canvas[1]]);
    if (!inv) {
      assert(false, `Test 3: curved (u=${u}, v=${v}) returned null`);
      continue;
    }
    // Curved cells compound numerical noise across the quadratic solve;
    // 1e-4 absolute error is the realistic FP tolerance.
    assert(nearlyEq(inv[0], u, 1e-4), `Test 3: u ${u} → ${inv[0].toFixed(6)}`);
    assert(nearlyEq(inv[1], v, 1e-4), `Test 3: v ${v} → ${inv[1].toFixed(6)}`);
  }
}

// ── Test 4: out-of-grid target returns null ──
{
  const grid = makeGrid(3, 3, (u, v) => [u * 100, v * 100]);
  const gridSize = { rows: 3, cols: 3 };

  // Way outside (canvas grid spans [0, 100] × [0, 100]).
  const inv = inverseBilinearFFD(grid, gridSize, [-500, -500]);
  assert(inv === null, `Test 4: far-outside target → null (got ${inv && JSON.stringify(inv)})`);
  // Also slightly outside.
  const inv2 = inverseBilinearFFD(grid, gridSize, [200, 200]);
  assert(inv2 === null, `Test 4: 2× outside target → null (got ${inv2 && JSON.stringify(inv2)})`);
}

// ── Test 5: single-cell sanity (inverseBilinearCell direct) ──
{
  // Unit square cell with one corner pulled out. Inverse should still
  // land within tol.
  const P00 = [0, 0], P10 = [10, 1], P01 = [1, 10], P11 = [11, 11];
  const target = [5.0, 5.0];
  const inv = inverseBilinearCell(P00, P10, P01, P11, target);
  assert(inv != null, `Test 5: bent cell returns a solution`);
  if (inv) {
    // Forward-eval to verify
    const s = inv[0], t = inv[1];
    const fx = (1 - s) * (1 - t) * P00[0] + s * (1 - t) * P10[0]
             + (1 - s) * t * P01[0] + s * t * P11[0];
    const fy = (1 - s) * (1 - t) * P00[1] + s * (1 - t) * P10[1]
             + (1 - s) * t * P01[1] + s * t * P11[1];
    assert(nearlyEq(fx, 5.0, 1e-4) && nearlyEq(fy, 5.0, 1e-4),
      `Test 5: cell forward-eval(s=${s.toFixed(4)}, t=${t.toFixed(4)}) → (${fx.toFixed(4)}, ${fy.toFixed(4)})`);
  }
}

// ── Test 6: identity passes the same canvas point exactly ──
{
  // Verifies that an unshifted grid point round-trips with zero error.
  const grid = makeGrid(2, 2, (u, v) => [u * 100, v * 100]);
  const inv = inverseBilinearFFD(grid, { rows: 2, cols: 2 }, [50, 50]);
  if (!inv) {
    assert(false, 'Test 6: midpoint of identity grid returned null');
  } else {
    assert(nearlyEq(inv[0], 0.5, 1e-9), `Test 6: u midpoint (got ${inv[0]})`);
    assert(nearlyEq(inv[1], 0.5, 1e-9), `Test 6: v midpoint (got ${inv[1]})`);
  }
}

console.log(`\ninverseBilinearFFD: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
