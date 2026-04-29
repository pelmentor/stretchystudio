// v2 R3 — Unit tests for warpEval + frameConvert.
// Run: node scripts/test_warpEval.mjs

import { evalWarpGrid, bilinearFFD } from '../../src/io/live2d/runtime/evaluator/warpEval.js';
import { canvasToLocal, localToCanvas } from '../../src/io/live2d/runtime/evaluator/frameConvert.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function arrEq(a, b, eps = 1e-9) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEq(a[i], b[i], eps)) return false;
  return true;
}

// ── evalWarpGrid: single keyform, identity blend ──
{
  const positions = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const spec = {
    gridSize: { rows: 1, cols: 1 },
    keyforms: [{ keyTuple: [0], positions, opacity: 1 }],
  };
  const cellInfo = { indices: [0], weights: [1] };
  const out = evalWarpGrid(spec, cellInfo);
  assert(arrEq(out, positions), 'single keyform → exact reproduction');
}

// ── evalWarpGrid: 2-keyform 50/50 blend ──
{
  const k0 = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const k1 = new Float64Array([2, 2, 3, 2, 2, 3, 3, 3]);
  const spec = {
    gridSize: { rows: 1, cols: 1 },
    keyforms: [{ positions: k0 }, { positions: k1 }],
  };
  const cellInfo = { indices: [0, 1], weights: [0.5, 0.5] };
  const out = evalWarpGrid(spec, cellInfo);
  // Each component = 0.5*k0 + 0.5*k1 = midpoint
  assert(nearlyEq(out[0], 1), '2-keyform blend midpoint x[0]');
  assert(nearlyEq(out[1], 1), '2-keyform blend midpoint y[0]');
  assert(nearlyEq(out[6], 2), '2-keyform blend midpoint x[3]');
  assert(nearlyEq(out[7], 2), '2-keyform blend midpoint y[3]');
}

// ── evalWarpGrid: weight 0 entries skipped (no NaN from undefined) ──
{
  const k0 = new Float64Array([1, 1]);
  const k1 = new Float64Array([3, 3]);
  const spec = { keyforms: [{ positions: k0 }, { positions: k1 }] };
  const cellInfo = { indices: [0, 1], weights: [1, 0] };
  const out = evalWarpGrid(spec, cellInfo);
  assert(arrEq(out, [1, 1]), 'weight-0 entry skipped');
}

// ── evalWarpGrid: empty keyforms → null ──
{
  assert(evalWarpGrid({}, { indices: [0], weights: [1] }) === null,
    'no keyforms → null');
  assert(evalWarpGrid(null, { indices: [0], weights: [1] }) === null,
    'null spec → null');
  assert(evalWarpGrid({ keyforms: [] }, { indices: [0], weights: [1] }) === null,
    'empty keyforms array → null');
}

// ── bilinearFFD: identity 1×1 grid (corners) ──
{
  // 1×1 grid means rows=1, cols=1 → 2×2 control points (4 floats per point pair, 8 total).
  // Order: row-major. (0,0), (1,0), (0,1), (1,1).
  const grid = new Float64Array([
    0, 0,    // (col=0, row=0)
    10, 0,   // (col=1, row=0)
    0, 20,   // (col=0, row=1)
    10, 20,  // (col=1, row=1)
  ]);
  const gs = { rows: 1, cols: 1 };
  // u=0, v=0 → bottom-left corner
  assert(arrEq(bilinearFFD(grid, gs, 0, 0), [0, 0]), 'BL corner identity');
  assert(arrEq(bilinearFFD(grid, gs, 1, 0), [10, 0]), 'BR corner identity');
  assert(arrEq(bilinearFFD(grid, gs, 0, 1), [0, 20]), 'TL corner identity');
  assert(arrEq(bilinearFFD(grid, gs, 1, 1), [10, 20]), 'TR corner identity');
  assert(arrEq(bilinearFFD(grid, gs, 0.5, 0.5), [5, 10]), 'center bilinear');
  assert(arrEq(bilinearFFD(grid, gs, 0.5, 0), [5, 0]), 'midpoint bottom edge');
}

// ── bilinearFFD: linear extrapolation outside [0,1] ──
//
// Cubism's runtime extrapolates linearly when the chain hands the warp
// a coord outside its grid (e.g. face pivot whose y projects below
// BodyXWarp's range). Clamping collapses every off-grid point to the
// boundary — it broke shelby's face after Phase 1E landed because the
// face pivot mapped to v ≈ -0.043 of BodyXWarp's input.
{
  const grid = new Float64Array([0, 0, 10, 0, 0, 20, 10, 20]);
  const gs = { rows: 1, cols: 1 };
  // u=-0.5 → x = 0 + (-0.5) * (10 - 0) = -5
  assert(arrEq(bilinearFFD(grid, gs, -0.5, 0), [-5, 0]),
    'extrapolate below-min: linear continuation, not clamped');
  // u=1.5 → x = 0 + 1.5 * 10 = 15
  assert(arrEq(bilinearFFD(grid, gs, 1.5, 0), [15, 0]),
    'extrapolate above-max: linear continuation, not clamped');
  // Both axes off-grid simultaneously
  assert(arrEq(bilinearFFD(grid, gs, -0.1, -0.1), [-1, -2]),
    'extrapolate both axes below-min');
  assert(arrEq(bilinearFFD(grid, gs, 1.1, 1.1), [11, 22]),
    'extrapolate both axes above-max');
  // Identity behavior at exact corners is preserved.
  assert(arrEq(bilinearFFD(grid, gs, 0, 0), [0, 0]), 'corner (0,0) identity');
  assert(arrEq(bilinearFFD(grid, gs, 1, 1), [10, 20]), 'corner (1,1) identity');
}

// ── bilinearFFD: 2×2 grid (3×3 control points) ──
{
  // rows=2, cols=2 → 3×3 = 9 control points. Identity rest grid scaled to 100×100 canvas.
  const cps = [];
  for (let r = 0; r <= 2; r++) {
    for (let c = 0; c <= 2; c++) {
      cps.push(c * 50, r * 50);
    }
  }
  const grid = new Float64Array(cps);
  const gs = { rows: 2, cols: 2 };
  // u=0.5, v=0 → on the bottom edge between col 0 and col 1, but cols=2 means 0.5 maps to fu_total=1.0
  // Actually 0.5 * 2 = 1.0 → cell index = 1, fu = 0 → exactly at control point (1, 0)
  assert(arrEq(bilinearFFD(grid, gs, 0.5, 0), [50, 0]), '2x2 grid u=0.5 v=0 hits middle col bottom');
  // u=0.25 → fu_total=0.5 → cell 0, fu=0.5 → midpoint of col 0 and col 1 in row 0
  // = (0.5 * 0 + 0.5 * 50, 0) = (25, 0)
  assert(arrEq(bilinearFFD(grid, gs, 0.25, 0), [25, 0]), '2x2 grid u=0.25 v=0 midway col0-col1');
  // u=0.5, v=0.5 → fu_total=1.0, fv_total=1.0 → cell (1, 1) corner = control point (1, 1) = (50, 50)
  assert(arrEq(bilinearFFD(grid, gs, 0.5, 0.5), [50, 50]), '2x2 grid center hits middle CP');
}

// ── bilinearFFD: with output buffer (no allocation) ──
{
  const grid = new Float64Array([0, 0, 10, 0, 0, 20, 10, 20]);
  const gs = { rows: 1, cols: 1 };
  const out = [99, 99];
  const ret = bilinearFFD(grid, gs, 0.5, 0.5, out);
  assert(ret === out, 'returned out buffer is same reference');
  assert(arrEq(out, [5, 10]), 'out buffer populated correctly');
}

// ── frameConvert: canvas-px round-trip (identity) ──
{
  const cp = [123.456, -78.9];
  const local = canvasToLocal(cp, 'canvas-px');
  assert(arrEq(local, cp), 'canvas-px forward = identity');
  const back = localToCanvas(local, 'canvas-px');
  assert(arrEq(back, cp), 'canvas-px inverse = identity');
}

// ── frameConvert: normalized-0to1 round-trip ──
{
  const ctx = { gridBox: { minX: 100, minY: 50, W: 400, H: 300 } };
  const cp = [300, 200];
  const local = canvasToLocal(cp, 'normalized-0to1', ctx);
  // (300 - 100) / 400 = 0.5; (200 - 50) / 300 = 0.5
  assert(arrEq(local, [0.5, 0.5]), 'normalized forward midpoint');
  const back = localToCanvas(local, 'normalized-0to1', ctx);
  assert(arrEq(back, cp), 'normalized round-trip');
}

// ── frameConvert: normalized-0to1 corners ──
{
  const ctx = { gridBox: { minX: 0, minY: 0, W: 100, H: 100 } };
  assert(arrEq(canvasToLocal([0, 0], 'normalized-0to1', ctx), [0, 0]), 'normalized BL');
  assert(arrEq(canvasToLocal([100, 100], 'normalized-0to1', ctx), [1, 1]), 'normalized TR');
  assert(arrEq(localToCanvas([0, 0], 'normalized-0to1', ctx), [0, 0]), 'normalized BL inv');
  assert(arrEq(localToCanvas([1, 1], 'normalized-0to1', ctx), [100, 100]), 'normalized TR inv');
}

// ── frameConvert: normalized-0to1 zero-extent gridBox ──
{
  const ctx = { gridBox: { minX: 50, minY: 50, W: 0, H: 0 } };
  const local = canvasToLocal([100, 100], 'normalized-0to1', ctx);
  assert(arrEq(local, [0, 0]), 'normalized W=0/H=0 → 0,0 (no div-by-zero)');
}

// ── frameConvert: normalized-0to1 missing context throws ──
{
  let threw = false;
  try { canvasToLocal([1, 1], 'normalized-0to1'); } catch (_) { threw = true; }
  assert(threw, 'normalized forward without ctx throws');
  threw = false;
  try { localToCanvas([1, 1], 'normalized-0to1'); } catch (_) { threw = true; }
  assert(threw, 'normalized inverse without ctx throws');
}

// ── frameConvert: pivot-relative round-trip (no rotation) ──
{
  const ctx = { pivotX: 100, pivotY: 100, angleDeg: 0 };
  const cp = [150, 200];
  const local = canvasToLocal(cp, 'pivot-relative', ctx);
  assert(arrEq(local, [50, 100]), 'pivot-relative forward (no rotation) = subtract pivot');
  const back = localToCanvas(local, 'pivot-relative', ctx);
  assert(arrEq(back, cp), 'pivot-relative round-trip (no rotation)');
}

// ── frameConvert: pivot-relative 90° rotation ──
{
  const ctx = { pivotX: 0, pivotY: 0, angleDeg: 90 };
  // Local point (1, 0) — under +90° rotation should map to canvas (0, 1).
  // Inverse (local→canvas): rotate by +90 CCW → (0, 1).
  const back = localToCanvas([1, 0], 'pivot-relative', ctx);
  assert(arrEq(back, [Math.cos(Math.PI / 2), Math.sin(Math.PI / 2)], 1e-12),
    'pivot-relative 90° local→canvas rotates correctly');

  // Round-trip: canvas (0, 1) → unrotate by -90 → (1, 0)
  const local = canvasToLocal([0, 1], 'pivot-relative', ctx);
  assert(arrEq(local, [1, 0], 1e-12),
    'pivot-relative 90° canvas→local unrotates correctly');
}

// ── frameConvert: pivot-relative round-trip arbitrary angle ──
{
  const ctx = { pivotX: 50, pivotY: 75, angleDeg: 33.7 };
  const cp = [120, -42];
  const local = canvasToLocal(cp, 'pivot-relative', ctx);
  const back = localToCanvas(local, 'pivot-relative', ctx);
  assert(arrEq(back, cp, 1e-9), 'pivot-relative round-trip arbitrary angle');
}

// ── frameConvert: unknown localFrame throws ──
{
  let threw = false;
  try { canvasToLocal([0, 0], 'foobar'); } catch (_) { threw = true; }
  assert(threw, 'unknown frame in forward throws');
  threw = false;
  try { localToCanvas([0, 0], 'foobar'); } catch (_) { threw = true; }
  assert(threw, 'unknown frame in inverse throws');
}

// ── Integration: evalWarpGrid → bilinearFFD chain ──
{
  // A 1×1 warp with 2 keyforms — rest at unit square, fully shifted at (10, 10) offset.
  // At t=0.5 we expect a uniformly shifted unit square.
  const k0 = new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const k1 = new Float64Array([10, 10, 11, 10, 10, 11, 11, 11]);
  const spec = {
    gridSize: { rows: 1, cols: 1 },
    keyforms: [{ positions: k0 }, { positions: k1 }],
  };
  const cellInfo = { indices: [0, 1], weights: [0.5, 0.5] };
  const grid = evalWarpGrid(spec, cellInfo);
  // FFD at center should be ((0+1+10+11)/4, (0+0+10+11)/4) wait — let me reason carefully.
  // Blend at t=0.5: rest (0,0) and offset (10,10) → midpoint (5,5).
  // Unit square shifted by (5,5) → corners: (5,5), (6,5), (5,6), (6,6). Center: (5.5, 5.5).
  const center = bilinearFFD(grid, spec.gridSize, 0.5, 0.5);
  assert(arrEq(center, [5.5, 5.5]), 'integration: blend then FFD center');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
