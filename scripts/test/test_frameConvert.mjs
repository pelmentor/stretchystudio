// v3 Phase 0F.19 - tests for src/io/live2d/runtime/evaluator/frameConvert.js
//
// frameConvert is the central coord-space converter at the heart of
// the eval pipeline. Three frames - canvas-px / normalized-0to1 /
// pivot-relative - and a forward + inverse for each. A bug here
// silently corrupts every keyform and every rendered frame.
//
// Run: node scripts/test/test_frameConvert.mjs

import {
  canvasToLocal,
  localToCanvas,
} from '../../src/io/live2d/runtime/evaluator/frameConvert.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function nearV(a, b, eps = 1e-9) {
  return near(a[0], b[0], eps) && near(a[1], b[1], eps);
}

// ── canvas-px (identity) ───────────────────────────────────────────

{
  assert(nearV(canvasToLocal([100, 200], 'canvas-px'), [100, 200]),
    'canvas-px forward: identity');
  assert(nearV(localToCanvas([100, 200], 'canvas-px'), [100, 200]),
    'canvas-px inverse: identity');

  // Round-trip on negative / fractional values
  for (const [x, y] of [[-50, 33], [0.5, -0.7], [1024, 2048]]) {
    const local = canvasToLocal([x, y], 'canvas-px');
    const back = localToCanvas(local, 'canvas-px');
    assert(nearV(back, [x, y]), `canvas-px round-trip (${x},${y})`);
  }
}

// ── normalized-0to1 ────────────────────────────────────────────────

{
  // gridBox: [10,20] - [110, 80] → W=100, H=60
  const ctx = { gridBox: { minX: 10, minY: 20, W: 100, H: 60 } };

  // Forward: top-left of grid → (0,0); bottom-right → (1,1)
  assert(nearV(canvasToLocal([10, 20], 'normalized-0to1', ctx), [0, 0]),
    'normalized: top-left → (0,0)');
  assert(nearV(canvasToLocal([110, 80], 'normalized-0to1', ctx), [1, 1]),
    'normalized: bottom-right → (1,1)');
  assert(nearV(canvasToLocal([60, 50], 'normalized-0to1', ctx), [0.5, 0.5]),
    'normalized: center → (0.5,0.5)');

  // Inverse
  assert(nearV(localToCanvas([0, 0], 'normalized-0to1', ctx), [10, 20]),
    'normalized inv: (0,0) → top-left');
  assert(nearV(localToCanvas([1, 1], 'normalized-0to1', ctx), [110, 80]),
    'normalized inv: (1,1) → bottom-right');

  // Round-trip
  for (const p of [[40, 35], [-5, 100], [200, -10]]) {
    const back = localToCanvas(canvasToLocal(p, 'normalized-0to1', ctx),
                               'normalized-0to1', ctx);
    assert(nearV(back, p), `normalized round-trip ${JSON.stringify(p)}`);
  }
}

{
  // Zero-size grid: forward should not divide by zero (returns 0)
  const ctx = { gridBox: { minX: 0, minY: 0, W: 0, H: 0 } };
  const local = canvasToLocal([5, 7], 'normalized-0to1', ctx);
  assert(nearV(local, [0, 0]), 'normalized: zero-size grid → 0,0 (no NaN)');
}

{
  // Missing context throws
  assertThrows(() => canvasToLocal([0, 0], 'normalized-0to1'),
    'normalized: no ctx throws');
  assertThrows(() => canvasToLocal([0, 0], 'normalized-0to1', {}),
    'normalized: ctx without gridBox throws');
  assertThrows(() => localToCanvas([0, 0], 'normalized-0to1'),
    'normalized inv: no ctx throws');
}

// ── pivot-relative ─────────────────────────────────────────────────

{
  // Pivot at (50, 50), no rotation
  const ctx = { pivotX: 50, pivotY: 50, angleDeg: 0 };

  // Forward: vertex at pivot → (0,0)
  assert(nearV(canvasToLocal([50, 50], 'pivot-relative', ctx), [0, 0]),
    'pivot-rel forward: at pivot → (0,0)');
  assert(nearV(canvasToLocal([60, 70], 'pivot-relative', ctx), [10, 20]),
    'pivot-rel forward: offset preserved');

  // Inverse adds pivot back
  assert(nearV(localToCanvas([10, 20], 'pivot-relative', ctx), [60, 70]),
    'pivot-rel inv: offset + pivot');
}

{
  // 90° rotation: a vertex at canvas (60, 50) is (10, 0) from pivot (50,50).
  // With angle=90, the STORED pivot-relative offset is the unrotated
  // version - which means we apply -90 to get back to "before rotation".
  // Vector (10, 0) rotated by -90 = (0, -10).
  const ctx = { pivotX: 50, pivotY: 50, angleDeg: 90 };
  const local = canvasToLocal([60, 50], 'pivot-relative', ctx);
  assert(near(local[0], 0, 1e-9) && near(local[1], -10, 1e-9),
    'pivot-rel forward 90deg: (10,0) → (0,-10)');

  // Inverse rotates by +90 and re-adds pivot: (0, -10) → (10, 0) → +pivot = (60, 50)
  const back = localToCanvas(local, 'pivot-relative', ctx);
  assert(nearV(back, [60, 50], 1e-9), 'pivot-rel round-trip 90deg');
}

{
  // Round-trip across various angles + offsets
  for (const angleDeg of [-180, -90, -45, 0, 30, 90, 180, 270]) {
    const ctx = { pivotX: 100, pivotY: 200, angleDeg };
    for (const p of [[0, 0], [105, 195], [50, 250], [300, -50]]) {
      const back = localToCanvas(canvasToLocal(p, 'pivot-relative', ctx),
                                 'pivot-relative', ctx);
      if (!nearV(back, p, 1e-6)) {
        failed++;
        console.error(`FAIL: pivot-rel round-trip angle=${angleDeg} p=${JSON.stringify(p)} got ${JSON.stringify(back)}`);
        break;
      }
    }
    passed++;  // one batch per angle if all p's passed
  }
}

{
  // Default angleDeg (undefined) treated as 0
  const ctx = { pivotX: 0, pivotY: 0 };
  assert(nearV(canvasToLocal([10, 20], 'pivot-relative', ctx), [10, 20]),
    'pivot-rel: undefined angleDeg defaults to 0');
}

{
  // Missing ctx throws
  assertThrows(() => canvasToLocal([0, 0], 'pivot-relative'),
    'pivot-rel: no ctx throws');
  assertThrows(() => localToCanvas([0, 0], 'pivot-relative'),
    'pivot-rel inv: no ctx throws');
}

// ── Unknown frame ──────────────────────────────────────────────────

assertThrows(() => canvasToLocal([0, 0], 'banana'),
  'unknown frame: forward throws');
assertThrows(() => localToCanvas([0, 0], 'banana'),
  'unknown frame: inverse throws');

console.log(`frameConvert: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
