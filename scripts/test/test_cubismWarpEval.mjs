// Phase 1 smoke test for the Cubism warp-eval port.
// Run: node scripts/test/test_cubismWarpEval.mjs

import { evalWarpKernelCubism } from '../../src/io/live2d/runtime/evaluator/cubismWarpEval.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function approx(a, b, eps = 1e-5) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEq(a[i], b[i], eps)) return false;
  return true;
}

// Helper — run kernel for a single point (in,out have length 2).
function evalOne(grid, gridSize, isQuad, u, v) {
  const inP = new Float32Array([u, v]);
  const outP = new Float32Array(2);
  evalWarpKernelCubism(grid, gridSize, isQuad, inP, outP, 1);
  return [outP[0], outP[1]];
}

// ── INSIDE — identity grid (axis-aligned, no deformation) ──
{
  // 1×1 cell from (0,0) to (1,1).
  const grid = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const gs = { rows: 1, cols: 1 };

  // At (0.5, 0.5) inside, both triangle-split and 4-point bilinear must
  // return (0.5, 0.5). du+dv = 1 exactly = upper-right triangle boundary.
  const a = evalOne(grid, gs, false, 0.5, 0.5);
  const b = evalOne(grid, gs, true, 0.5, 0.5);
  assert(approx(a, [0.5, 0.5]), 'identity grid: triangle-split mid → (0.5, 0.5)');
  assert(approx(b, [0.5, 0.5]), 'identity grid: 4-point mid → (0.5, 0.5)');

  // Lower-left tri (du+dv < 1): (0.25, 0.25)
  const c = evalOne(grid, gs, false, 0.25, 0.25);
  assert(approx(c, [0.25, 0.25]), 'identity grid: lower-left tri → (0.25, 0.25)');

  // Upper-right tri (du+dv > 1): (0.75, 0.75)
  const d = evalOne(grid, gs, false, 0.75, 0.75);
  assert(approx(d, [0.75, 0.75]), 'identity grid: upper-right tri → (0.75, 0.75)');

  // Corners must match exactly.
  const tl = evalOne(grid, gs, false, 0, 0);
  const tr = evalOne(grid, gs, false, 0.999, 0);
  const bl = evalOne(grid, gs, false, 0, 0.999);
  // Cubism's INSIDE check is `< 1`, so use 0.999 not 1.0 to stay inside.
  assert(approx(tl, [0, 0]), 'identity grid: TL corner');
  assert(approx(tr, [0.999, 0], 1e-3), 'identity grid: TR-near corner');
  assert(approx(bl, [0, 0.999], 1e-3), 'identity grid: BL-near corner');
}

// ── INSIDE — non-square deformed grid (triangle-split visible) ──
{
  // 1×1 cell, BR pulled to (2, 1) (stretched right).
  // Lower-left tri: TL=(0,0), TR=(1,0), BL=(0,1)
  // Upper-right tri: BL=(0,1), BR=(2,1), TR=(1,0)
  const grid = new Float64Array([0, 0, 1, 0, 0, 1, 2, 1]);
  const gs = { rows: 1, cols: 1 };

  // Diagonal point (0.5, 0.5) — du+dv = 1 → upper-right triangle
  // Upper-right: weights (1-du, du+dv-1, 1-dv) = (0.5, 0, 0.5) on (BL, BR, TR)
  // = 0.5*(0,1) + 0 + 0.5*(1,0) = (0.5, 0.5)
  const triMid = evalOne(grid, gs, false, 0.5, 0.5);
  assert(approx(triMid, [0.5, 0.5]), 'tri-split: diagonal mid (0.5,0.5)');

  // 4-point bilinear at the same point:
  // weights (0.25, 0.25, 0.25, 0.25) on (TL, TR, BL, BR)
  // = 0.25*(0,0) + 0.25*(1,0) + 0.25*(0,1) + 0.25*(2,1) = (0.75, 0.5)
  const quadMid = evalOne(grid, gs, true, 0.5, 0.5);
  assert(approx(quadMid, [0.75, 0.5]), '4-point: diagonal mid (0.75,0.5)');

  // Slightly above the diagonal (upper-right triangle):
  //   du=0.6, dv=0.6, du+dv=1.2>1
  //   weights (1-du=0.4 on BL, du+dv-1=0.2 on BR, 1-dv=0.4 on TR)
  //   = 0.4*(0,1) + 0.2*(2,1) + 0.4*(1,0) = (0.8, 0.6)
  const upperTri = evalOne(grid, gs, false, 0.6, 0.6);
  assert(approx(upperTri, [0.8, 0.6]), 'tri-split: upper-right (0.6,0.6)');

  // Slightly below the diagonal (lower-left triangle):
  //   du=0.4, dv=0.4, du+dv=0.8<1
  //   weights (1-du-dv=0.2 on TL, du=0.4 on TR, dv=0.4 on BL)
  //   = 0.2*(0,0) + 0.4*(1,0) + 0.4*(0,1) = (0.4, 0.4)
  const lowerTri = evalOne(grid, gs, false, 0.4, 0.4);
  assert(approx(lowerTri, [0.4, 0.4]), 'tri-split: lower-left (0.4,0.4)');
}

// ── OUTSIDE — far field on identity grid ──
{
  // Identity grid: TL=(0,0), TR=(1,0), BL=(0,1), BR=(1,1)
  const grid = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const gs = { rows: 1, cols: 1 };

  // Far-field linear extrapolation: out.x = u, out.y = v (since grid is identity).
  const farTL = evalOne(grid, gs, false, -5, -5);
  assert(approx(farTL, [-5, -5], 1e-4), 'far field: (-5,-5) → (-5,-5)');

  const farBR = evalOne(grid, gs, false, 5, 5);
  assert(approx(farBR, [5, 5], 1e-4), 'far field: (5,5) → (5,5)');

  const farMixed = evalOne(grid, gs, false, -3, 4);
  assert(approx(farMixed, [-3, 4], 1e-4), 'far field: (-3,4) → (-3,4)');
}

// ── OUTSIDE — boundary regions on identity grid ──
{
  // For an identity grid, OUTSIDE regions should also produce output ≈ (u,v)
  // because the grid extends linearly.
  const grid = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const gs = { rows: 1, cols: 1 };

  // Top band (0<u<1, v<0).
  const topBand = evalOne(grid, gs, false, 0.5, -1);
  assert(approx(topBand, [0.5, -1], 1e-4), 'top band: (0.5,-1) → (0.5,-1)');

  // Bottom band.
  const botBand = evalOne(grid, gs, false, 0.5, 2);
  assert(approx(botBand, [0.5, 2], 1e-4), 'bottom band: (0.5,2) → (0.5,2)');

  // Left band.
  const leftBand = evalOne(grid, gs, false, -1, 0.5);
  assert(approx(leftBand, [-1, 0.5], 1e-4), 'left band: (-1,0.5) → (-1,0.5)');

  // Right band.
  const rightBand = evalOne(grid, gs, false, 2, 0.5);
  assert(approx(rightBand, [2, 0.5], 1e-4), 'right band: (2,0.5) → (2,0.5)');

  // Corner zones.
  const cornerTL = evalOne(grid, gs, false, -1, -1);
  assert(approx(cornerTL, [-1, -1], 1e-4), 'corner TL: (-1,-1) → (-1,-1)');

  const cornerBR = evalOne(grid, gs, false, 2, 2);
  assert(approx(cornerBR, [2, 2], 1e-4), 'corner BR: (2,2) → (2,2)');
}

// ── INSIDE — 2x2 grid, simple deformation, sanity check ──
{
  // 2 cells per dim → 3×3 control points = 9 verts × 2 = 18 floats.
  // Identity-aligned for now (cells span [0,0.5,1] × [0,0.5,1]).
  const grid = new Float64Array([
    0,  0,    0.5, 0,    1, 0,
    0,  0.5,  0.5, 0.5,  1, 0.5,
    0,  1,    0.5, 1,    1, 1,
  ]);
  const gs = { rows: 2, cols: 2 };

  // Mid of cell (0,0): (0.25, 0.25) inside lower-left tri.
  const r1 = evalOne(grid, gs, false, 0.25, 0.25);
  assert(approx(r1, [0.25, 0.25], 1e-6), '2x2 grid: mid cell(0,0) lower-left');

  // (0.75, 0.75) is mid of cell (1,1), du+dv=1 → upper-right tri.
  // For identity sub-grid this still gives (0.75, 0.75).
  const r2 = evalOne(grid, gs, false, 0.75, 0.75);
  assert(approx(r2, [0.75, 0.75], 1e-6), '2x2 grid: mid cell(1,1) upper-right');
}

// ── Output buffer must NOT alias input ──
{
  const grid = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const gs = { rows: 1, cols: 1 };

  // 3-vertex test.
  const inP = new Float32Array([0.25, 0.25,  0.5, 0.5,  0.75, 0.75]);
  const outP = new Float32Array(6);
  evalWarpKernelCubism(grid, gs, false, inP, outP, 3);
  assert(nearlyEq(outP[0], 0.25, 1e-5), 'multi-vertex: vertex 0 x');
  assert(nearlyEq(outP[1], 0.25, 1e-5), 'multi-vertex: vertex 0 y');
  assert(nearlyEq(outP[2], 0.5,  1e-5), 'multi-vertex: vertex 1 x');
  assert(nearlyEq(outP[3], 0.5,  1e-5), 'multi-vertex: vertex 1 y');
  assert(nearlyEq(outP[4], 0.75, 1e-5), 'multi-vertex: vertex 2 x');
  assert(nearlyEq(outP[5], 0.75, 1e-5), 'multi-vertex: vertex 2 y');
  // Input untouched (defensive — we never mutate it but verify).
  assert(inP[0] === 0.25 && inP[5] === 0.75, 'multi-vertex: input untouched');
}

console.log(`cubismWarpEval: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
