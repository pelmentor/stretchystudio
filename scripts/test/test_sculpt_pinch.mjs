// Toolset Plan Phase 3.E — Pinch brush math (with Magnify on Ctrl).
//
// Verifies verts pull toward cursor, sign flips with Ctrl (Magnify),
// EPS skip for verts already at cursor, and the falloff/strength
// scaling.
//
// Run: node scripts/test/test_sculpt_pinch.mjs

import { pinchTick } from '../../src/lib/sculpt/pinch.js';

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

// Fixture: 5-vert row {0, 10, 20, 30, 40} on x-axis. Cursor at (20, 0).
const verts = [
  { x:  0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 40, y: 0 },
];

// ── 1: Vert exactly at cursor is skipped (EPS guard) ─────────────────
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     30,
    strength: 1,
    falloff:  'constant',
  });
  // Vert 2 at (20, 0) is within EPS of cursor → skipped.
  // Verts 0, 1, 3, 4 within radius 30 → all pull toward cursor.
  assert(!out.has(2), 'vert at cursor (within EPS) is skipped');
  assert(out.size === 4, '4 of 5 verts pulled (vert 2 is at-cursor)');
}

// ── 2: Verts outside radius unaffected ───────────────────────────────
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     5,                // only vert 2 (dist 0) within range, but skipped by EPS
    strength: 1,
    falloff:  'constant',
  });
  assert(out.size === 0, 'all verts outside radius (EPS-skipped center) → empty');
}

// ── 3: Pinch direction: verts move TOWARD cursor ─────────────────────
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     30,
    strength: 1,
    falloff:  'constant',
  });
  // Vert 1 at (10, 0): dx = 20-10 = 10. PINCH_RATE = 0.5, weight 1, strength 1.
  // newX = 10 + 10 * (1 * 1 * 0.5 * 1) = 10 + 5 = 15. (halfway to cursor)
  assert(approx(out.get(1).x, 15, 1e-6), 'vert 1: 10 → 15 (halfway to cursor at full strength)');
  assert(approx(out.get(3).x, 25, 1e-6), 'vert 3: 30 → 25 (halfway to cursor at full strength)');
  // Vert 0 at (0, 0): dx = 20. newX = 0 + 20 * 0.5 = 10. (halfway to cursor)
  assert(approx(out.get(0).x, 10, 1e-6), 'vert 0: 0 → 10 (halfway to cursor)');
  assert(approx(out.get(4).x, 30, 1e-6), 'vert 4: 40 → 30 (halfway to cursor)');
}

// ── 4: Magnify (Ctrl held) — sign flips, verts move AWAY from cursor ─
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     30,
    strength: 1,
    falloff:  'constant',
    ctrl:     true,
  });
  // Vert 1 at (10, 0): newX = 10 + 10 * (-0.5) = 5 (pushed AWAY from cursor 20)
  assert(approx(out.get(1).x, 5, 1e-6), 'magnify vert 1: 10 → 5 (away from cursor)');
  assert(approx(out.get(3).x, 35, 1e-6), 'magnify vert 3: 30 → 35 (away from cursor)');
}

// ── 5: Strength scales the magnitude ─────────────────────────────────
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     30,
    strength: 0.4,
    falloff:  'constant',
  });
  // Vert 1: dx=10, k = 1 * 0.4 * 0.5 = 0.2. newX = 10 + 10*0.2 = 12
  assert(approx(out.get(1).x, 12, 1e-6), 'strength 0.4: 1/5 of full-pinch step');
}

// ── 6: Y-axis pull ───────────────────────────────────────────────────
{
  const yverts = [
    { x: 0, y:  0 },
    { x: 0, y: 10 },
    { x: 0, y: 20 },
  ];
  const out = pinchTick({
    verts:    yverts,
    cursor:   { x: 0, y: 10 },
    size:     30,
    strength: 1,
    falloff:  'constant',
  });
  // Vert 0 at (0, 0): dy = 10. newY = 0 + 10 * 0.5 = 5
  assert(approx(out.get(0).y, 5, 1e-6), 'Y-axis: vert 0 → 5 (toward cursor y=10)');
  assert(approx(out.get(0).x, 0, 1e-6), 'Y-axis: vert 0 X unchanged');
  assert(approx(out.get(2).y, 15, 1e-6), 'Y-axis: vert 2 → 15 (toward cursor y=10)');
}

// ── 7: Diagonal pull ─────────────────────────────────────────────────
{
  const dverts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  const out = pinchTick({
    verts:    dverts,
    cursor:   { x: 10, y: 10 },
    size:     30,
    strength: 1,
    falloff:  'constant',
  });
  // Vert 0 at (0, 0): dx=10, dy=10. newX = 5, newY = 5.
  assert(approx(out.get(0).x, 5, 1e-6) && approx(out.get(0).y, 5, 1e-6),
    'diagonal vert: pulls along (10,10) by half');
}

// ── 8: Linear falloff weights pull-magnitude by distance ─────────────
{
  const out = pinchTick({
    verts,
    cursor:   { x: 20, y: 0 },
    size:     30,
    strength: 1,
    falloff:  'linear',
  });
  // Vert 1 at (10, 0): dist 10, weight = 1 - 10/30 = 2/3.
  // newX = 10 + 10 * (2/3 * 1 * 0.5) = 10 + 10/3 ≈ 13.333
  assert(approx(out.get(1).x, 10 + 10/3, 1e-5),
    'linear falloff: vert 1 moves 1/3 of the way (weight 2/3)');
  // Vert 0 at (0, 0): dist 20, weight = 1 - 20/30 = 1/3.
  // newX = 0 + 20 * (1/3 * 0.5) = 0 + 20/6 ≈ 3.333
  assert(approx(out.get(0).x, 20/6, 1e-5),
    'linear falloff: rim vert moves less');
}

// ── 9: Connected-only restricts to BFS-reachable verts ───────────────
{
  // Two disconnected components: {0,1,2} and {3,4}
  const adjacency = [
    new Set([1]),
    new Set([0, 2]),
    new Set([1]),
    new Set([4]),
    new Set([3]),
  ];
  const out = pinchTick({
    verts,
    cursor:        { x: 20, y: 0 },
    size:          30,
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency,
    originIdx:     1,    // origin in {0,1,2} component
  });
  // Vert 2 (origin component, but at cursor) is EPS-skipped.
  // Verts 0, 1 in origin component → moved.
  // Verts 3, 4 in OTHER component → unaffected.
  assert(out.has(0) && out.has(1), 'connectedOnly: origin component verts moved');
  assert(!out.has(3) && !out.has(4), 'connectedOnly: other component verts unaffected');
}

console.log(`\nsculpt_pinch: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
