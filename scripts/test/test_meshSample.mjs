// v3 Phase 0F.26 - tests for src/mesh/sample.js
//
// Interior point sampling for mesh generation. sampleInterior uses
// jittered grid placement (random, but bounded); filterByEdgePadding
// is fully deterministic.
//
// Run: node scripts/test/test_meshSample.mjs

import {
  sampleInterior,
  filterByEdgePadding,
} from '../../src/mesh/sample.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Build an alpha-only ImageData buffer where every pixel is opaque
// at value `alpha`, transparent at 0.
function makeAlphaBuf(width, height, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = alpha;
  }
  return data;
}

// ── sampleInterior ────────────────────────────────────────────────

{
  // Fully opaque 200x200 with gridSpacing 30 → roughly 6x6 = 36 points
  const data = makeAlphaBuf(200, 200, 255);
  const pts = sampleInterior(data, 200, 200, 5, 30);
  assert(pts.length > 10, 'sampleInterior: opaque large image → many points');
  assert(pts.length < 50, 'sampleInterior: opaque large image → bounded count');

  // Each point is a [number, number]
  for (const p of pts) {
    if (!(Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')) {
      failed++;
      console.error(`FAIL: sampleInterior: point shape — ${JSON.stringify(p)}`);
      break;
    }
  }
  passed++;
}

{
  // Fully transparent → no points
  const data = makeAlphaBuf(200, 200, 0);
  const pts = sampleInterior(data, 200, 200, 5, 30);
  assert(pts.length === 0, 'sampleInterior: fully transparent → 0 points');
}

{
  // Threshold gates: alpha=3 with threshold 5 → 0 points
  const data = makeAlphaBuf(200, 200, 3);
  const pts = sampleInterior(data, 200, 200, 5, 30);
  assert(pts.length === 0, 'sampleInterior: below threshold → 0 points');
}

{
  // Tiny image (smaller than gridSpacing) → 0 points (loop doesn't enter)
  const data = makeAlphaBuf(20, 20, 255);
  const pts = sampleInterior(data, 20, 20, 5, 30);
  assert(pts.length === 0, 'sampleInterior: smaller than gridSpacing → 0');
}

{
  // Larger gridSpacing → fewer points
  const data = makeAlphaBuf(400, 400, 255);
  const dense = sampleInterior(data, 400, 400, 5, 20);
  const sparse = sampleInterior(data, 400, 400, 5, 80);
  assert(dense.length > sparse.length,
    'sampleInterior: smaller gridSpacing → more points');
}

// ── filterByEdgePadding ──────────────────────────────────────────

{
  const interior = [[10, 10], [50, 50], [100, 100]];
  const edge = [[10, 10]];
  const out = filterByEdgePadding(interior, edge, 5);
  // Point at (10,10) is within 5 of edge (10,10) → removed
  assert(out.length === 2, 'filter: point near edge removed');
  assert(!out.some(p => p[0] === 10 && p[1] === 10), 'filter: exact match dropped');
}

{
  // No edges → identity
  const interior = [[1, 2], [3, 4]];
  const out = filterByEdgePadding(interior, [], 100);
  assert(out.length === 2, 'filter: no edges → identity');
}

{
  // Empty interior → empty
  const out = filterByEdgePadding([], [[0, 0]], 5);
  assert(out.length === 0, 'filter: empty interior → empty');
}

{
  // minDistance = 0 → only exact matches dropped
  const interior = [[0, 0], [0, 0.0001], [10, 10]];
  const edge = [[0, 0]];
  const out = filterByEdgePadding(interior, edge, 0);
  // dx*dx + dy*dy < 0 is never true; nothing dropped
  assert(out.length === 3, 'filter: minDistance=0 → no drops (strict <)');
}

{
  // Boundary: distance exactly equals minDistance → kept (strict <)
  const interior = [[3, 4]]; // distance 5 from origin
  const edge = [[0, 0]];
  const out = filterByEdgePadding(interior, edge, 5);
  // 3² + 4² = 25 == 5² → not strictly less, so kept
  assert(out.length === 1, 'filter: distance == minDist → kept (strict <)');
}

{
  // All interior points filtered when one edge is "close enough" to all
  const interior = [[1, 1], [2, 2], [3, 3]];
  const edge = [[0, 0]];
  const out = filterByEdgePadding(interior, edge, 100);
  assert(out.length === 0, 'filter: large minDist + nearby edge → all dropped');
}

console.log(`meshSample: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
