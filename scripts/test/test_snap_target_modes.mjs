// Toolset Plan Phase 2.C/F — selection-anchor target modes.
//
// Validates `computeSelectionAnchor` for all four target modes:
// closest / center / median / active.
//
// Run: node scripts/test/test_snap_target_modes.mjs

import { computeSelectionAnchor } from '../../src/lib/snap/snapMath.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

const verts = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
  { x: 50, y: 100 },  // outlier — pulls bbox center but not the median
];

const cursor = { x: 0, y: 0 };
const activeVert = { x: 99, y: 88 };

// ── closest: returns cursor verbatim ─────────────────────────────────
{
  const r = computeSelectionAnchor(verts, 'closest', { cursor, activeVert });
  assert(r.x === 0 && r.y === 0, 'closest: anchor = cursor');
  // Empty verts also fall back to cursor (no crash).
  const r2 = computeSelectionAnchor([], 'closest', { cursor });
  assert(r2.x === 0 && r2.y === 0, 'closest empty verts: anchor = cursor');
}

// ── center: AABB midpoint ────────────────────────────────────────────
{
  // bbox: x in [10,50], y in [10,100] → center (30, 55)
  const r = computeSelectionAnchor(verts, 'center', { cursor });
  assert(close(r.x, 30), `center.x = 30, got ${r.x}`);
  assert(close(r.y, 55), `center.y = 55, got ${r.y}`);
  // Single vert → center is that vert.
  const r2 = computeSelectionAnchor([{ x: 7, y: -3 }], 'center', { cursor });
  assert(r2.x === 7 && r2.y === -3, 'center single vert');
  // Empty verts → cursor.
  const r3 = computeSelectionAnchor([], 'center', { cursor });
  assert(r3.x === 0 && r3.y === 0, 'center empty → cursor');
}

// ── median: per-axis median (5 verts, take index 2) ──────────────────
{
  // x sorted: [10, 10, 30, 30, 50] → median = 30
  // y sorted: [10, 10, 30, 30, 100] → median = 30
  const r = computeSelectionAnchor(verts, 'median', { cursor });
  assert(close(r.x, 30), `median.x = 30, got ${r.x}`);
  assert(close(r.y, 30), `median.y = 30, got ${r.y}`);
  // Even count: floor(n/2) picks the upper of the two middles.
  const evens = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 100 }, { x: 200, y: 200 }];
  // x sorted: [0, 10, 100, 200] → floor(4/2)=2 → 100
  const r2 = computeSelectionAnchor(evens, 'median', { cursor });
  assert(close(r2.x, 100), `median even x = 100, got ${r2.x}`);
  assert(close(r2.y, 100), `median even y = 100, got ${r2.y}`);
}

// ── active: returns activeVert when present, else cursor ─────────────
{
  const r = computeSelectionAnchor(verts, 'active', { cursor, activeVert });
  assert(r.x === 99 && r.y === 88, 'active with activeVert: anchor = activeVert');
  const r2 = computeSelectionAnchor(verts, 'active', { cursor, activeVert: null });
  assert(r2.x === 0 && r2.y === 0, 'active without activeVert: falls back to cursor');
  const r3 = computeSelectionAnchor(verts, 'active', { cursor });
  assert(r3.x === 0 && r3.y === 0, 'active no activeVert key: falls back to cursor');
}

// ── filtering: NaN / non-finite verts ignored ────────────────────────
{
  const dirty = [
    { x: 10, y: 10 },
    { x: NaN, y: 10 },
    { x: 30, y: 30 },
    null,
    undefined,
  ];
  // Center: bbox of [10,10] and [30,30] → (20, 20)
  const r = computeSelectionAnchor(dirty, 'center', { cursor });
  assert(close(r.x, 20) && close(r.y, 20), 'center: NaN / null verts filtered');
}

// ── unknown target: defaults to cursor ───────────────────────────────
{
  const r = computeSelectionAnchor(verts, 'bogus', { cursor });
  assert(r.x === 0 && r.y === 0, 'unknown target → cursor fallback');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
