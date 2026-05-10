// Toolset Plan Phase 3.C — Grab brush math (Blender-faithful anchored
// semantics, audit-revised D-1).
//
// Verifies: anchored radius (weight from ORIG verts + anchor cursor),
// total-delta vs ORIG positions (NOT incremental from prev cursor),
// stationary cursor = no-op, missing origVerts/anchorCursor = no-op,
// strength clamping, connectedOnly + Y-axis behaviour.
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
const origVerts = [
  { x:  0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 40, y: 0 },
];

// ── 1: Missing origVerts → no-op (anchored Grab requires snapshot) ───
{
  const out = grabTick({
    verts:        origVerts,
    cursor:       { x: 21, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  // origVerts not passed → empty
  assert(out.size === 0, 'missing origVerts → empty (no anchored snapshot)');
}

// ── 2: Missing anchorCursor → no-op ──────────────────────────────────
{
  const out = grabTick({
    verts:     origVerts,
    origVerts,
    cursor:    { x: 21, y: 0 },
    size:      30,
    strength:  1,
    falloff:   'constant',
  });
  assert(out.size === 0, 'missing anchorCursor → empty');
}

// ── 3: Zero total delta (cursor still on anchor) is a no-op ──────────
{
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 20, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  assert(out.size === 0, 'cursor on anchor (zero delta) → empty');
}

// ── 4: Anchor at vert 2; constant falloff; full delta applied ────────
{
  // Anchor at (20, 0) → vert 2 has dist 0 from anchor.
  // cursor at (25, 0) → totalDx=5, totalDy=0. Constant falloff → all
  // verts within size=30 of anchor get full delta.
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  // All 5 verts within size=30 of anchor (20,0): dist 20/10/0/10/20.
  assert(out.size === 5, 'anchored radius covers all 5 verts (constant falloff)');
  // Each vert moves by (5, 0) — full delta applied to ORIG position.
  assert(approx(out.get(2).x, 25) && approx(out.get(2).y, 0),
    'centered vert: orig (20,0) + delta (5,0) = (25,0)');
  assert(approx(out.get(0).x, 5),  'vert 0: orig (0,0) + delta (5,0) = (5,0)');
  assert(approx(out.get(4).x, 45), 'vert 4: orig (40,0) + delta (5,0) = (45,0)');
}

// ── 5: Linear falloff weights based on dist-from-anchor (NOT cursor) ─
{
  // Anchor at (20,0); cursor at (25,0). totalDx=5.
  // Linear falloff weights:
  //   vert 0 dist 20 from anchor → t=20/30 → w=1/3
  //   vert 1 dist 10 → t=1/3 → w=2/3
  //   vert 2 dist 0  → t=0   → w=1
  //   vert 3 dist 10 → w=2/3
  //   vert 4 dist 20 → w=1/3
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'linear',
  });
  // Vert 2 (centered): orig 20 + 5*1 = 25
  assert(approx(out.get(2).x, 25, 1e-6), 'centered: orig 20 + 5*1 = 25 (full weight)');
  // Vert 1: orig 10 + 5*(2/3) = 13.333
  assert(approx(out.get(1).x, 10 + 10/3, 1e-6), 'vert 1: orig + 5*2/3 = 13.333');
  // Vert 0: orig 0 + 5*(1/3) = 1.667
  assert(approx(out.get(0).x, 5/3, 1e-6), 'vert 0: orig + 5*1/3 = 1.667');
}

// ── 6: Cursor wandering doesn't pick up new verts mid-stroke ─────────
{
  // Anchor at (20,0), small radius 8 → only vert 2 in range.
  // Cursor drags far right to (100, 0) — vert 4 at (40,0) is NOT
  // dragged into range; only vert 2 (originally in range at click)
  // moves.
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 100, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         8,
    strength:     1,
    falloff:      'constant',
  });
  assert(out.size === 1, 'cursor wandering off doesn\'t pick up new verts');
  assert(out.has(2), 'only the anchor-radius vert (2) moves');
  // Vert 2 moves the FULL accumulated delta = 80 px.
  assert(approx(out.get(2).x, 100, 1e-6), 'vert 2: orig 20 + total delta 80 = 100');
}

// ── 7: Total-delta semantics (not per-tick incremental) ──────────────
{
  // Tick 1: cursor (25, 0) → totalDx 5
  const out1 = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  // Tick 2: cursor (30, 0) → totalDx 10 (NOT 5, even though cursor only moved 5 from prev)
  const out2 = grabTick({
    verts:        origVerts,        // STILL the orig snapshot (unchanged across ticks)
    origVerts,
    cursor:       { x: 30, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  // Vert 2 should be at orig (20) + tick-2 total delta (10) = 30, NOT
  // tick-2 incremental (5) on top of tick-1 result. Anchored Blender
  // semantics: each tick repositions verts to orig + cumulative delta.
  assert(approx(out1.get(2).x, 25), 'tick 1: vert 2 → 25');
  assert(approx(out2.get(2).x, 30), 'tick 2: vert 2 → 30 (orig + total delta)');
}

// ── 8: Strength scales the displacement ──────────────────────────────
{
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     0.5,
    falloff:      'constant',
  });
  // Centered vert: orig 20 + delta (5) * weight (1) * strength (0.5) = 22.5
  assert(approx(out.get(2).x, 22.5, 1e-6), 'strength halves the displacement');
}

// ── 9: Strength clamping ─────────────────────────────────────────────
{
  const outSat = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     2,            // clamped to 1
    falloff:      'constant',
  });
  assert(approx(outSat.get(2).x, 25, 1e-6), 'strength > 1 clamped to 1');

  const outZero = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     -0.5,         // clamped to 0 → empty
    falloff:      'constant',
  });
  assert(outZero.size === 0, 'strength < 0 clamped to 0 → empty');
}

// ── 10: Y-axis displacement ──────────────────────────────────────────
{
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 20, y: 5 },
    anchorCursor: { x: 20, y: 0 },
    size:         30,
    strength:     1,
    falloff:      'constant',
  });
  // Anchor at (20, 0); vert 2 dist 0 → weight 1 → moves by (0, 5)
  assert(approx(out.get(2).y, 5, 1e-6), 'Y delta applied to anchor-vert');
  assert(approx(out.get(2).x, 20, 1e-6), 'X unchanged');
}

// ── 11: ConnectedOnly with no adjacency falls back to no verts ───────
{
  const out = grabTick({
    verts:         origVerts,
    origVerts,
    cursor:        { x: 25, y: 0 },
    anchorCursor:  { x: 20, y: 0 },
    size:          30,
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency:     null,
    originIdx:     2,
  });
  assert(out.size === 0, 'connectedOnly without adjacency yields empty');
}

// ── 12: ConnectedOnly restricts to BFS-reachable verts ───────────────
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
    verts:         origVerts,
    origVerts,
    cursor:        { x: 25, y: 0 },
    anchorCursor:  { x: 20, y: 0 },
    size:          50,
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency,
    originIdx:     2,
  });
  assert(out.size === 3, 'connectedOnly: 3 verts of {0,1,2} component move');
  assert(out.has(0) && out.has(1) && out.has(2), 'origin component verts move');
  assert(!out.has(3) && !out.has(4), 'other component verts unaffected');
}

// ── 13: Verts outside anchored radius unaffected ─────────────────────
{
  const out = grabTick({
    verts:        origVerts,
    origVerts,
    cursor:       { x: 25, y: 0 },
    anchorCursor: { x: 20, y: 0 },
    size:         8,                // only vert 2 within range of anchor
    strength:     1,
    falloff:      'constant',
  });
  assert(out.size === 1, 'only the in-range vert moves');
  assert(out.has(2), 'vert 2 is the anchored vert');
}

console.log(`\nsculpt_grab: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
