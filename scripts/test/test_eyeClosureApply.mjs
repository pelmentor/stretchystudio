// v3 Phase 6 - tests for src/io/live2d/cmo3/eyeClosureApply.js
// Run: node scripts/test/test_eyeClosureApply.mjs

import {
  evalClosureCurve,
  evalBandY,
  computeClosedCanvasVerts,
  computeClosedVertsForMesh,
} from '../../src/io/live2d/cmo3/eyeClosureApply.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

// ── evalClosureCurve ───────────────────────────────────────────────

{
  // Null curve → null (lets caller fall back to bandCurveFallback).
  assert(evalClosureCurve(null, 50) === null, 'null params → null');
  assert(evalClosureCurve(undefined, 50) === null, 'undefined params → null');

  // Simple parabola: y = 1 * xn² + 0 * xn + 10, with xMid=50, xScale=10.
  // So at canvas X = 50, xn=0 → y = 10. At canvas X = 60, xn=1 → y = 11.
  const params = { a: 1, b: 0, c: 10, xMid: 50, xScale: 10 };
  assert(approx(evalClosureCurve(params, 50), 10), 'parabola y(50) = 10');
  assert(approx(evalClosureCurve(params, 60), 11), 'parabola y(60) = 11');
  assert(approx(evalClosureCurve(params, 40), 11), 'parabola y(40) = 11 (symmetric)');
  assert(approx(evalClosureCurve(params, 70), 14), 'parabola y(70) = 14');

  // Linear b: y = 0 + 2*xn + 5, xMid=0, xScale=1
  const lin = { a: 0, b: 2, c: 5, xMid: 0, xScale: 1 };
  assert(approx(evalClosureCurve(lin, 0), 5), 'linear y(0) = 5');
  assert(approx(evalClosureCurve(lin, 3), 11), 'linear y(3) = 11');
}

// ── evalBandY ──────────────────────────────────────────────────────

{
  assert(evalBandY(null, 50) === null, 'null bandCurve → null');
  assert(evalBandY([], 50) === null, 'empty bandCurve → null');
  assert(evalBandY([[10, 20]], 50) === null, 'single-point bandCurve → null');

  const band = [[0, 10], [10, 20], [20, 50]];
  // Below first: clamp to first Y
  assert(evalBandY(band, -5) === 10, 'before first sample → first y');
  // After last: clamp to last Y
  assert(evalBandY(band, 100) === 50, 'after last sample → last y');
  // At sample
  assert(evalBandY(band, 0) === 10, 'at first sample');
  assert(evalBandY(band, 10) === 20, 'at middle sample');
  assert(evalBandY(band, 20) === 50, 'at last sample');
  // Between samples — linear interp
  assert(evalBandY(band, 5)  === 15, 'midway between 0 and 10');
  assert(evalBandY(band, 15) === 35, 'midway between 10 and 20');
}

// ── computeClosedCanvasVerts: non-eyelash (eyewhite-style) ────────

{
  // Three vertices at X=0..20, all Y=10. Curve forces closed Y to 30.
  const curve = { a: 0, b: 0, c: 30, xMid: 10, xScale: 10 };
  const out = computeClosedCanvasVerts({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [0, 10, 10, 10, 20, 10],
    numVerts: 3,
  });
  // X stays, Y collapses straight to 30
  assert(out[0] === 0  && out[1] === 30, 'vert 0 → (0, 30)');
  assert(out[2] === 10 && out[3] === 30, 'vert 1 → (10, 30)');
  assert(out[4] === 20 && out[5] === 30, 'vert 2 → (20, 30)');
}

// ── computeClosedCanvasVerts: eyelash with lashBbox ───────────────

{
  // Eyelash mesh: relY 0..1 → Y range 100..200. lashStripFrac=0.06 → halfPx = 6.
  // BandY = 50 (from curve). Each vertex's closed Y = 50 + (relY - 0.5) * 12.
  const curve = { a: 0, b: 0, c: 50, xMid: 0, xScale: 1 };
  const lashBbox = { minY: 100, H: 100 };
  const verts = [
    0, 100,   // relY = 0 → 50 + (-0.5)*12 = 44
    0, 150,   // relY = 0.5 → 50 + 0 = 50
    0, 200,   // relY = 1 → 50 + 0.5*12 = 56
  ];
  const out = computeClosedCanvasVerts({
    curve,
    bandCurveFallback: null,
    isEyelash: true,
    lashBbox,
    canvasVerts: verts,
    numVerts: 3,
    lashStripFrac: 0.06,
  });
  assert(approx(out[1], 44), 'eyelash top: Y = 44');
  assert(approx(out[3], 50), 'eyelash mid: Y = 50');
  assert(approx(out[5], 56), 'eyelash bot: Y = 56');
}

// ── computeClosedCanvasVerts: shiftPx applies uniformly ────────────

{
  const curve = { a: 0, b: 0, c: 30, xMid: 0, xScale: 1 };
  const out = computeClosedCanvasVerts({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [0, 0, 10, 0],
    numVerts: 2,
    shiftPx: 5,
  });
  // Closed Y = 30; shift = 5 → 25.
  assert(out[1] === 25, 'shiftPx subtracted: vert 0');
  assert(out[3] === 25, 'shiftPx subtracted: vert 1');
}

// ── computeClosedCanvasVerts: bandFallback when curve null ────────

{
  // No parabola, but band fallback at constant Y = 42.
  const out = computeClosedCanvasVerts({
    curve: null,
    bandCurveFallback: [[0, 42], [10, 42]],
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [5, 0],
    numVerts: 1,
  });
  assert(out[1] === 42, 'fallback band Y used');
}

// ── computeClosedCanvasVerts: no curve + no fallback → original Y ──

{
  const out = computeClosedCanvasVerts({
    curve: null,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [0, 99, 10, 88],
    numVerts: 2,
  });
  assert(out[0] === 0  && out[1] === 99, 'no curve: vert 0 unchanged');
  assert(out[2] === 10 && out[3] === 88, 'no curve: vert 1 unchanged');
}

// ── computeClosedVertsForMesh: rwBox normalization ────────────────

{
  // Curve forces all Y to 50. rwBox (0..100 X, 0..100 Y) → normalized.
  const curve = { a: 0, b: 0, c: 50, xMid: 50, xScale: 50 };
  const out = computeClosedVertsForMesh({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [0, 25, 100, 25],
    numVerts: 2,
    rwBox: { gridMinX: 0, gridMinY: 0, gridW: 100, gridH: 100 },
  });
  // Closed canvas: x stays, y → 50.  rwBox normalization: x/100, y/100.
  assert(approx(out[0], 0)   && approx(out[1], 0.5), 'vert 0 → (0, 0.5)');
  assert(approx(out[2], 1)   && approx(out[3], 0.5), 'vert 1 → (1, 0.5)');
}

// ── computeClosedVertsForMesh: rwBox Y-clamp prevents out-of-bbox ─

{
  // Curve forces Y to 200, but rwBox.gridMinY..gridMaxY = 0..100 → clamp to 100.
  const curve = { a: 0, b: 0, c: 200, xMid: 0, xScale: 1 };
  const out = computeClosedVertsForMesh({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [50, 0],
    numVerts: 1,
    rwBox: { gridMinX: 0, gridMinY: 0, gridW: 100, gridH: 100 },
  });
  // Y clamped to 100, then normalized → 1.
  assert(approx(out[1], 1.0), 'rwBox Y clamped to grid max → normalized 1');
}

// ── computeClosedVertsForMesh: dfOrigin (pivot-relative pixels) ────

{
  // Curve Y = 50; dfOrigin (10, 30) → vert minus origin.
  const curve = { a: 0, b: 0, c: 50, xMid: 0, xScale: 1 };
  const out = computeClosedVertsForMesh({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [25, 0],
    numVerts: 1,
    dfOrigin: { x: 10, y: 30 },
  });
  // Closed canvas (25, 50) - origin (10, 30) = (15, 20)
  assert(approx(out[0], 15), 'dfOrigin: x - origin.x');
  assert(approx(out[1], 20), 'dfOrigin: y - origin.y');
}

// ── computeClosedVertsForMesh: no rwBox + no dfOrigin → canvas ────

{
  const curve = { a: 0, b: 0, c: 99, xMid: 0, xScale: 1 };
  const out = computeClosedVertsForMesh({
    curve,
    bandCurveFallback: null,
    isEyelash: false,
    lashBbox: null,
    canvasVerts: [10, 5],
    numVerts: 1,
  });
  assert(out[0] === 10 && out[1] === 99, 'passthrough canvas-space');
}

console.log(`eyeClosureApply: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
