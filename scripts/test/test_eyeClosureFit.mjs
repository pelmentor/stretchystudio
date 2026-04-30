// v3 Phase 6 - tests for src/io/live2d/cmo3/eyeClosureFit.js
// Run: node scripts/test/test_eyeClosureFit.mjs

import { fitParabolaFromLowerEdge } from '../../src/io/live2d/cmo3/eyeClosureFit.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 0.05) { return Math.abs(a - b) < eps; }

/** Evaluate the fitted parabola at canvas X. */
function evalCurve(curve, x) {
  const xn = (x - curve.xMid) / curve.xScale;
  return curve.a * xn * xn + curve.b * xn + curve.c;
}

/** Build flat vertex array from {x,y} pairs. */
function flat(pairs) {
  const out = [];
  for (const [x, y] of pairs) { out.push(x, y); }
  return out;
}

// ── Degenerate input ──────────────────────────────────────────────

{
  const r1 = await fitParabolaFromLowerEdge(null, 'eyewhite-l');
  assert(r1 === null, 'null mesh → null');

  const r2 = await fitParabolaFromLowerEdge({ vertices: [] }, 'eyewhite-l');
  assert(r2 === null, 'empty vertices → null');

  const r3 = await fitParabolaFromLowerEdge({ vertices: [10, 20] }, 'eyewhite-l');
  assert(r3 === null, 'single vertex → null');

  // Width < 1 (all X equal)
  const r4 = await fitParabolaFromLowerEdge(
    { vertices: flat([[10, 0], [10, 1], [10, 2]]) }, 'eyewhite-l');
  assert(r4 === null, 'zero-width X span → null');

  // Sample count < 3 after binning
  const r5 = await fitParabolaFromLowerEdge(
    { vertices: flat([[0, 0], [100, 100]]) }, 'eyewhite-l');
  assert(r5 === null, 'fewer than 3 samples → null (only 2 vertices passes width but < 3 samples)');
}

// ── Constant Y (flat line) ────────────────────────────────────────

{
  const verts = [];
  for (let x = 0; x <= 60; x += 5) verts.push(x, 30);
  const curve = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l');
  assert(curve !== null, 'flat line: produces curve');
  assert(approx(curve.a, 0), 'flat line: a ≈ 0');
  assert(approx(curve.b, 0), 'flat line: b ≈ 0');
  assert(approx(curve.c, 30), 'flat line: c ≈ 30');
  assert(approx(curve.xMid, 30), 'flat line: xMid = 30');
  assert(approx(curve.xScale, 30), 'flat line: xScale = 30');
}

// ── True parabola, sampled densely so bin-max picks the parabola apex ──
// Note: bin-max sampling over a U-shape biases the per-bin Y upward
// (each bin's max is at its outer edge, not its centre). We don't test
// exact recovery — just that the fit is concave-up (a > 0) with finite
// minimum near x = 50.

{
  const verts = [];
  for (let x = 0; x <= 100; x += 5) {
    const y = ((x - 50) ** 2) / 25 + 10;
    verts.push(x, y);
  }
  const curve = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l');
  assert(curve !== null, 'parabola: produces curve');
  assert(curve.a > 0, 'parabola: concave-up (a > 0)');
  // Curve minimum is near xn = -b/(2a). In canvas-x space the minimum
  // location is xMid - b/(2a) * xScale; for a symmetric input that
  // should land near 50.
  const xMinOfFit = curve.xMid - (curve.b / (2 * curve.a)) * curve.xScale;
  assert(Math.abs(xMinOfFit - 50) < 5, 'parabola: minimum near x = 50');
}

// ── Lower-edge extraction (mesh has top + bottom rows) ──────────

{
  // Two-row mesh: y=0 top edge, y=20 bottom edge. Bin-max should pick bottom.
  const verts = [];
  for (let x = 0; x <= 60; x += 10) {
    verts.push(x, 0);   // top
    verts.push(x, 20);  // bottom (greater Y → max in bin)
  }
  const curve = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l');
  assert(curve !== null, 'lower edge: produces curve');
  // Curve should fit y ≈ 20 (the lower edge), not y ≈ 0
  assert(approx(curve.c, 20, 1), 'lower edge: c ≈ 20 (bottom Y)');
}

// ── sourceTag / sampleSource tracking ──────────────────────────

{
  const verts = [];
  for (let x = 0; x <= 60; x += 5) verts.push(x, 30);
  const curve = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-r');
  assert(curve.sourceTag === 'eyewhite-r', 'sourceTag echoed');
  assert(curve.sampleSource === 'mesh-bin-max', 'sampleSource = mesh-bin-max (no PNG)');
  assert(curve.sampleCount > 0, 'sampleCount tracked');
  assert(approx(curve.xMin, 0) && approx(curve.xMax, 60), 'xMin/xMax tracked');
}

// ── Eyelash-fallback: mirrors across linear baseline ────────────

{
  // Lash whose lower edge is a downward arc → mirror-fit should produce
  // an UPWARD arc (the lower-lid approximation).
  const verts = [];
  for (let x = 0; x <= 60; x += 5) {
    // Quadratic dipping down: y = 30 - 0.02 * (x-30)^2
    const y = 30 - 0.02 * (x - 30) ** 2;
    verts.push(x, y);
  }
  const curveDirect = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l');
  const curveFlipped = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyelash-fallback');
  assert(curveDirect !== null && curveFlipped !== null, 'eyelash-fallback: both fit');
  // Direct fit: a < 0 (downward concave)
  assert(curveDirect.a < 0, 'direct fit: a < 0');
  // Eyelash-fallback mirrors → a should flip sign
  assert(curveFlipped.a > 0, 'eyelash-fallback: a > 0 after mirror');
}

// ── Custom binCount option ──────────────────────────────────────

{
  // 60 vertices spread over 0..60. Bin counts 4 and 12 should both produce curves.
  const verts = [];
  for (let x = 0; x <= 60; x++) verts.push(x, 30);
  const c4  = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l', { binCount: 4 });
  const c12 = await fitParabolaFromLowerEdge({ vertices: verts }, 'eyewhite-l', { binCount: 12 });
  assert(c4 !== null,  'binCount=4: fits');
  assert(c12 !== null, 'binCount=12: fits');
  assert(c4.sampleCount === 4,  'binCount=4: 4 samples');
  assert(c12.sampleCount === 12, 'binCount=12: 12 samples');
}

console.log(`eyeClosureFit: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
