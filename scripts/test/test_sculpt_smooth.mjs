// Toolset Plan Phase 3.D — Smooth brush math.
//
// Verifies one- and multi-iteration Laplacian smoothing on a fixture
// mesh, falloff-weighted strength, and the no-adjacency early-return.
//
// Run: node scripts/test/test_sculpt_smooth.mjs

import { smoothTick } from '../../src/lib/sculpt/smooth.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// Fixture: 3-vert row {0, 10, 30} on x-axis with linear adjacency (0-1-2).
// Vertex 1's average-of-neighbours is (0 + 30) / 2 = 15.
// Smoothing pulls vert 1 toward 15, away from 10.
const verts = [
  { x:  0, y: 0 },
  { x: 10, y: 0 },
  { x: 30, y: 0 },
];
const adjacency = [
  new Set([1]),
  new Set([0, 2]),
  new Set([1]),
];

// ── 1: No adjacency → empty map ──────────────────────────────────────
{
  const out = smoothTick({
    verts,
    cursor:    { x: 10, y: 0 },
    size:      100,
    strength:  1,
    falloff:   'constant',
    adjacency: null,
  });
  assert(out.size === 0, 'no adjacency yields empty map');
}

// ── 2: Single iteration with strength=1, constant falloff ────────────
{
  const out = smoothTick({
    verts,
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency,
    iterations: 1,
  });
  // All 3 verts within size=100 → all affected. Constant falloff → weight=1.
  // Vert 0: neighbour {1}. avg = 10. new = 0 + (10-0)*1 = 10.
  // Vert 1: neighbours {0,2}. avg = 15. new = 10 + (15-10)*1 = 15.
  // Vert 2: neighbour {1}. avg = 10. new = 30 + (10-30)*1 = 10.
  // BUT — smoothing iterates SIMULTANEOUSLY: each vert reads CURRENT
  // (un-mutated-this-iter) neighbour values, then commits. So vert 1
  // reads vert 0 = 0 and vert 2 = 30 (not the smoothed values).
  // After commit: verts = [10, 15, 10].
  assert(out.size === 3, 'all 3 verts moved with constant falloff');
  assert(approx(out.get(0).x, 10, 1e-6), 'vert 0: 0 → 10 (toward neighbour avg)');
  assert(approx(out.get(1).x, 15, 1e-6), 'vert 1: 10 → 15 (midpoint of 0 and 30)');
  assert(approx(out.get(2).x, 10, 1e-6), 'vert 2: 30 → 10 (toward neighbour avg)');
}

// ── 3: Strength=0.5 → halfway move ───────────────────────────────────
{
  const out = smoothTick({
    verts,
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   0.5,
    falloff:    'constant',
    adjacency,
    iterations: 1,
  });
  // Vert 1: 10 + (15-10) * 0.5 = 12.5
  assert(approx(out.get(1).x, 12.5, 1e-6), 'vert 1: 10 → 12.5 with strength 0.5');
  // Vert 0: 0 + (10-0) * 0.5 = 5
  assert(approx(out.get(0).x, 5, 1e-6), 'vert 0: 0 → 5 with strength 0.5');
}

// ── 4: Two iterations chain through previous-iter output ─────────────
{
  const out = smoothTick({
    verts,
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency,
    iterations: 2,
  });
  // After iter 1: verts = [10, 15, 10]
  // Iter 2:
  // Vert 0: neighbour {1=15}. avg = 15. new = 10 + (15-10)*1 = 15.
  // Vert 1: neighbours {0=10, 2=10}. avg = 10. new = 15 + (10-15)*1 = 10.
  // Vert 2: neighbour {1=15}. avg = 15. new = 10 + (15-10)*1 = 15.
  // Final: [15, 10, 15].
  assert(approx(out.get(0).x, 15, 1e-6), 'iter 2 vert 0: 10 → 15');
  assert(approx(out.get(1).x, 10, 1e-6), 'iter 2 vert 1: 15 → 10 (oscillation)');
  assert(approx(out.get(2).x, 15, 1e-6), 'iter 2 vert 2: 10 → 15');
}

// ── 5: Cursor outside radius of all verts → no moves ─────────────────
{
  const out = smoothTick({
    verts,
    cursor:     { x: 100, y: 100 },
    size:       10,            // far from every vert
    strength:   1,
    falloff:    'constant',
    adjacency,
  });
  assert(out.size === 0, 'cursor outside radius affects no verts');
}

// ── 6: Selective smoothing — only verts within radius ────────────────
{
  // Cursor centered on vert 1, radius small enough to exclude verts 0/2
  const out = smoothTick({
    verts: [
      { x:  0, y: 0 },   // dist 10 from cursor
      { x: 10, y: 0 },   // dist 0 from cursor (centered)
      { x: 20, y: 0 },   // dist 10 from cursor
    ],
    cursor:     { x: 10, y: 0 },
    size:       5,                  // only vert 1 within range
    strength:   1,
    falloff:    'constant',
    adjacency: [
      new Set([1]),
      new Set([0, 2]),
      new Set([1]),
    ],
  });
  // Only vert 1 affected. Vert 1 reads neighbours at current pos (0, 20).
  // avg = 10. new = 10 + (10-10)*1 = 10. No actual movement.
  assert(out.size === 1, 'only the in-radius vert is in the result map');
  assert(out.has(1), 'vert 1 (in-radius) is the affected one');
  assert(approx(out.get(1).x, 10, 1e-6), 'vert 1 already at avg → no change');
}

// ── 7: Iterations clamped to [1, 10] ─────────────────────────────────
{
  const outZero = smoothTick({
    verts,
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency,
    iterations: 0,
  });
  // 0 → clamped to 1 → expect same as iter=1 case
  assert(approx(outZero.get(1).x, 15, 1e-6), 'iterations=0 clamped to 1');

  const outNeg = smoothTick({
    verts,
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency,
    iterations: -3,
  });
  assert(approx(outNeg.get(1).x, 15, 1e-6), 'iterations<0 clamped to 1');
}

// ── 8: Y-axis smoothing ──────────────────────────────────────────────
{
  // Verts on Y-axis: {0, 10, 30}
  const yverts = [
    { x: 0, y:  0 },
    { x: 0, y: 10 },
    { x: 0, y: 30 },
  ];
  const yadj = [new Set([1]), new Set([0, 2]), new Set([1])];
  const out = smoothTick({
    verts:      yverts,
    cursor:     { x: 0, y: 10 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency:  yadj,
    iterations: 1,
  });
  assert(approx(out.get(1).y, 15, 1e-6), 'Y-axis: vert 1 → 15 (midpoint)');
  assert(approx(out.get(1).x, 0, 1e-6), 'Y-axis: vert 1 X unchanged');
}

// ── 9: Vert with no neighbours (orphan) is skipped ───────────────────
{
  const out = smoothTick({
    verts:      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
    cursor:     { x: 10, y: 0 },
    size:       100,
    strength:   1,
    falloff:    'constant',
    adjacency:  [new Set([]), new Set([2]), new Set([1])],  // vert 0 has no neighbours
    iterations: 1,
  });
  assert(!out.has(0), 'orphan vert (no neighbours) is skipped');
  assert(out.has(1) && out.has(2), 'verts with neighbours still affected');
}

console.log(`\nsculpt_smooth: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
