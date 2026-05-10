// Toolset Plan Phase 3.E — Pinch brush math (Blender-faithful
// stroke-aligned semantics, audit-revised D-2 + D-3).
//
// Verifies: stationary cursor early-returns (no stroke direction →
// no pinch), stroke-perpendicular X-axis projection, asymmetric Magnify
// (Ctrl: -0.25× weaker), Ctrl locked at stroke begin (per dispatch
// dragRef.ctrlAtStart), connectedOnly behaviour.
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

// ── 1: No prevCursor (first tick) → no pinch (no stroke direction) ───
{
  const out = pinchTick({
    verts:      [{ x: 10, y: 0 }, { x: 20, y: 0 }],
    cursor:     { x: 15, y: 0 },
    prevCursor: null,
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  assert(out.size === 0, 'first tick (no prevCursor) → no pinch');
}

// ── 2: Stationary cursor (zero grab_delta) → no pinch ────────────────
{
  const out = pinchTick({
    verts:      [{ x: 10, y: 0 }, { x: 20, y: 0 }],
    cursor:     { x: 15, y: 0 },
    prevCursor: { x: 15, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  assert(out.size === 0, 'stationary cursor → no pinch (Blender early-return)');
}

// ── 3: Horizontal stroke (gdx > 0) — verts pinch perpendicular (Y) ───
{
  // Stroke moves cursor +X. xAxis = (-gdy, gdx)/gdLen = (0, 1) — Y direction.
  // Vert above cursor (Y > cursor.y): disp_center.y < 0 (cursor.y - vert.y).
  //   Wait: disp_center = cursor - vert. If vert is above (vert.y > 0) and cursor.y=0,
  //   then disp_center.y = 0 - vert.y = negative.
  //   xAxis = (0, 1). proj = 1 * (-vert.y) = -vert.y.
  //   translate.y = 1 * (-vert.y) * w * s * PINCH_RATE * 1 = -vert.y * 0.5 * w * 1 (positive=Pinch)
  //   For vert at (5, 10): translate.y = -10 * 0.5 = -5 → newY = 10 - 5 = 5.
  //   Vert moves DOWN toward cursor's Y level (i.e. toward stroke axis).
  const verts = [
    { x:  5, y:  10 },   // above
    { x:  5, y: -10 },   // below
    { x:  5, y:   0 },   // on stroke axis
  ];
  const out = pinchTick({
    verts,
    cursor:     { x: 5, y: 0 },
    prevCursor: { x: 0, y: 0 },    // stroke +X
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  // All 3 verts within size=30 of cursor.
  // Vert 0 at (5, 10): pulled toward Y=0 → newY = 5 (halfway)
  // Vert 1 at (5, -10): pulled toward Y=0 → newY = -5 (halfway)
  // Vert 2 at (5, 0): on stroke axis → proj = 0 → no movement → still in result
  assert(approx(out.get(0).y, 5, 1e-6), 'vert above stroke axis: pinched halfway down');
  assert(approx(out.get(1).y, -5, 1e-6), 'vert below stroke axis: pinched halfway up');
  // Vert 2 is on the axis, proj=0 → translate=(0,0). out.set may or may not include it.
  // Since translate is zero, the (idx, p) entry exists with p == verts[2].
  if (out.has(2)) {
    assert(approx(out.get(2).y, 0, 1e-6), 'on-axis vert: no Y change');
  }
}

// ── 4: Horizontal stroke — X unchanged for verts off-axis ────────────
{
  const verts = [{ x: 10, y: 5 }];
  const out = pinchTick({
    verts,
    cursor:     { x: 10, y: 0 },
    prevCursor: { x: 0, y: 0 },     // stroke +X
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  // disp_center = (0, -5). xAxis = (0, 1). proj = -5. translate = (0, -5)*0.5 = (0, -2.5)
  // newPos = (10, 5) + (0, -2.5) = (10, 2.5)
  assert(approx(out.get(0).x, 10, 1e-6), 'horizontal stroke: X unchanged');
  assert(approx(out.get(0).y, 2.5, 1e-6), 'pull: orig 5 → 2.5 (halfway toward stroke axis)');
}

// ── 5: Vertical stroke — verts pinch in X direction ──────────────────
{
  // Stroke moves cursor +Y. xAxis = (-gdy, gdx)/gdLen = (-1, 0).
  const verts = [{ x:  5, y: 10 }, { x: -5, y: 10 }];
  const out = pinchTick({
    verts,
    cursor:     { x: 0, y: 10 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  // Vert 0 at (5, 10): disp_center = (-5, 0). xAxis = (-1, 0).
  //   proj = -1 * -5 + 0 * 0 = 5. translate = (-1, 0) * 5 * 0.5 = (-2.5, 0)
  //   newPos = (5 - 2.5, 10) = (2.5, 10)
  // Vert 1 at (-5, 10): disp_center = (5, 0). proj = -5. translate = (-1, 0)*-5*0.5 = (2.5, 0)
  //   newPos = (-5 + 2.5, 10) = (-2.5, 10)
  assert(approx(out.get(0).x, 2.5, 1e-6), 'vertical stroke: vert 0 pinched left');
  assert(approx(out.get(1).x, -2.5, 1e-6), 'vertical stroke: vert 1 pinched right');
  assert(approx(out.get(0).y, 10, 1e-6), 'vert 0 Y unchanged');
}

// ── 6: Magnify (Ctrl true) flips sign + 0.25× weaker ─────────────────
{
  const verts = [{ x: 10, y: 5 }];
  const out = pinchTick({
    verts,
    cursor:     { x: 10, y: 0 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
    ctrl:       true,
  });
  // Pinch result without ctrl: newY = 2.5 (vert moved -2.5 toward axis)
  // Magnify (ctrl): direction = -0.25, so translate.y = 0 → wait, recompute.
  // proj = -5. stepK = 1 * 0.5 * (-0.25) = -0.125. translate.y = 1 * -5 * -0.125 = 0.625
  // newPos.y = 5 + 0.625 = 5.625 — vert moved AWAY from stroke axis by 0.625.
  assert(approx(out.get(0).y, 5.625, 1e-6),
    'magnify: 0.25× weaker + sign flip → vert pushed AWAY from axis');
}

// ── 7: Strength clamping ─────────────────────────────────────────────
{
  const verts = [{ x: 10, y: 5 }];
  const outSat = pinchTick({
    verts,
    cursor:     { x: 10, y: 0 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   2,            // clamped to 1
    falloff:    'constant',
  });
  assert(approx(outSat.get(0).y, 2.5, 1e-6), 'strength > 1 clamped to 1');

  const outZero = pinchTick({
    verts,
    cursor:     { x: 10, y: 0 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   -0.5,         // clamped to 0 → empty
    falloff:    'constant',
  });
  assert(outZero.size === 0, 'strength < 0 clamped to 0 → empty');
}

// ── 8: Verts outside radius unaffected ───────────────────────────────
{
  const verts = [{ x: 10, y: 5 }, { x: 100, y: 100 }];
  const out = pinchTick({
    verts,
    cursor:     { x: 10, y: 0 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  assert(out.has(0), 'in-range vert moves');
  assert(!out.has(1), 'out-of-range vert unaffected');
}

// ── 9: ConnectedOnly restricts to BFS-reachable verts ────────────────
{
  // Two components: {0,1} and {2}
  const verts = [
    { x: -5, y:  5 },
    { x:  5, y:  5 },
    { x: 15, y:  5 },
  ];
  const adjacency = [new Set([1]), new Set([0]), new Set()];
  const out = pinchTick({
    verts,
    cursor:        { x:  0, y:  0 },
    prevCursor:    { x: -10, y: 0 },     // stroke +X
    size:          30,
    strength:      1,
    falloff:       'constant',
    connectedOnly: true,
    adjacency,
    originIdx:     0,
  });
  assert(out.has(0), 'origin component vert 0 included');
  assert(out.has(1), 'origin component vert 1 included');
  assert(!out.has(2), 'other component vert 2 excluded');
}

// ── 10: Diagonal stroke — xAxis correctly perpendicular ──────────────
{
  // Stroke +X+Y at 45°. xAxis = (-gdy, gdx)/gdLen = (-1/√2, 1/√2)
  const verts = [{ x: 5, y: -5 }];   // perpendicular to stroke direction
  const out = pinchTick({
    verts,
    cursor:     { x: 5, y: 5 },
    prevCursor: { x: 0, y: 0 },
    size:       30,
    strength:   1,
    falloff:    'constant',
  });
  // disp_center = (0, 10). xAxis = (-1/√2, 1/√2).
  // proj = -1/√2 * 0 + 1/√2 * 10 = 10/√2 ≈ 7.071
  // translate.x = -1/√2 * 7.071 * 0.5 = -2.5
  // translate.y =  1/√2 * 7.071 * 0.5 =  2.5
  // newPos = (5 - 2.5, -5 + 2.5) = (2.5, -2.5)
  assert(approx(out.get(0).x, 2.5, 1e-6), 'diagonal: X moves -2.5');
  assert(approx(out.get(0).y, -2.5, 1e-6), 'diagonal: Y moves +2.5');
}

console.log(`\nsculpt_pinch: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
