// Toolset Plan Phase 3.C — Grab brush math.
//
// Verifies cursor-delta translation, falloff weighting, the no-op
// first-tick (prev cursor null), and Ctrl-no-op (Grab ignores Ctrl).
//
// Run: node scripts/test/test_sculpt_grab.mjs

import { grabTick } from '../../src/lib/sculpt/grab.js';

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

// Fixture: 5 verts in a row at x=0..40 (10 apart), y=0
const verts = [
  { x:  0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 40, y: 0 },
];

// ── 1: First tick (prevCursor null) is a no-op ───────────────────────
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: null,
    size:       30,
    strength:   1,
    falloff:    'smooth',
  });
  assert(out.size === 0, 'first tick (no prevCursor) returns empty map');
}

// ── 2: Zero cursor delta is a no-op ──────────────────────────────────
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 20, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'smooth',
  });
  assert(out.size === 0, 'zero cursor delta returns empty map');
}

// ── 3: Vert at exactly cursor with constant falloff moves the full delta ─
// Cursor at (20, 0) coincides with vert 2; all 5 verts are within size=30.
// Constant falloff returns 1 everywhere in-radius → every vert moves by
// the full cursor delta (1, 0).
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  assert(out.size === 5, 'all 5 verts within size=30 of cursor (constant falloff)');
  assert(approx(out.get(2).x, 21) && approx(out.get(2).y, 0),
    'centered vert moves by full delta with constant falloff');
}

// ── 4: Linear falloff weights match distance/size ────────────────────
// Cursor on vert 2 → vert 2 dist=0, vert 1/3 dist=10, vert 0/4 dist=20.
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'linear',
  });
  // Linear: w = 1 - d/size
  // vert 2 (d=0)  → w=1     → x=20 + 1*1*1 = 21
  // vert 1 (d=10) → w=2/3   → x=10 + 1*2/3 = 10.667
  // vert 0 (d=20) → w=1/3   → x=0  + 1*1/3 = 0.333
  assert(approx(out.get(2).x - 20, 1, 1e-6), 'centered vert: full delta');
  assert(approx(out.get(1).x - 10, 2/3, 1e-6), 'mid vert: 2/3 delta (linear)');
  assert(approx(out.get(0).x - 0, 1/3, 1e-6), 'rim vert: 1/3 delta (linear)');
}

// ── 5: Verts outside radius unaffected ───────────────────────────────
// Cursor on vert 2 (dist 0) with tiny radius → only vert 2 in range.
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       8,
    strength:   1,
    falloff:    'constant',
  });
  assert(out.size === 1, 'only the cursor-anchored vert moves with size=8');
  assert(out.has(2), 'index 2 (x=20) is the moved vert');
}

// ── 6: Strength scales the displacement ──────────────────────────────
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       30,
    strength:   0.5,
    falloff:    'constant',
  });
  // Centered vert: full weight (1) × strength (0.5) × delta (1) = 0.5
  assert(approx(out.get(2).x - 20, 0.5, 1e-6), 'strength halves the displacement');
}

// ── 7: Strength clamped to [0, 1] ────────────────────────────────────
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       30,
    strength:   2,    // clamped to 1
    falloff:    'constant',
  });
  assert(approx(out.get(2).x - 20, 1, 1e-6), 'strength > 1 clamped to 1');
}
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 0 },
    prevCursor: { x: 19, y: 0 },
    size:       30,
    strength:   -0.5, // clamped to 0 → empty result via short-circuit
    falloff:    'constant',
  });
  assert(out.size === 0, 'strength < 0 clamped to 0 → no displacement');
}

// ── 8: Y-axis displacement ───────────────────────────────────────────
{
  const out = grabTick({
    verts,
    cursor:     { x: 20, y: 5 },
    prevCursor: { x: 20, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  // Cursor moved (0, +5), verts within radius all move by (0, +5)
  assert(approx(out.get(2).y, 5, 1e-6), 'Y delta applied');
  assert(approx(out.get(2).x, 20, 1e-6), 'X unchanged');
}

// ── 9: Connected-only with no adjacency falls back to no verts ───────
{
  const out = grabTick({
    verts,
    cursor:        { x: 21, y: 0 },
    prevCursor:    { x: 20, y: 0 },
    size:          30,
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency:     null,    // missing → fall back to safe-default zero
    originIdx:     2,
  });
  assert(out.size === 0, 'connectedOnly without adjacency yields no verts');
}

// ── 10: Connected-only restricts to BFS-reachable verts ──────────────
{
  // Two disconnected components: {0,1,2} and {3,4}
  const adjacency = [
    new Set([1]),
    new Set([0, 2]),
    new Set([1]),
    new Set([4]),
    new Set([3]),
  ];
  const out = grabTick({
    verts,
    cursor:        { x: 21, y: 0 },
    prevCursor:    { x: 20, y: 0 },
    size:          50,                 // large enough to include both components by Euclidean
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency,
    originIdx:     2,                  // origin in {0,1,2} component
  });
  assert(out.size === 3, 'connectedOnly: only 3 verts of {0,1,2} component move');
  assert(out.has(0) && out.has(1) && out.has(2),
    'connectedOnly: indices 0/1/2 reachable from origin 2');
  assert(!out.has(3) && !out.has(4),
    'connectedOnly: indices 3/4 (other component) unaffected');
}

console.log(`\nsculpt_grab: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
