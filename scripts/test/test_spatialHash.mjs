// Test the SpatialHash neighbour-query helper used by mesh dedup +
// filterByEdgePadding. Each test asserts the hash matches the
// brute-force O(N²) result on the same input.

import { SpatialHash } from '../../src/mesh/spatialHash.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL:', msg); }
}

function bruteHasWithin(points, x, y, dist) {
  const dist2 = dist * dist;
  for (const [px, py] of points) {
    const dx = px - x, dy = py - y;
    if (dx * dx + dy * dy < dist2) return true;
  }
  return false;
}

// --- 1: empty hash returns false for any query
{
  const h = new SpatialHash(2);
  assert(h.hasWithin(0, 0, 1) === false, 'empty: hasWithin returns false');
  assert(h.hasWithin(100, 100, 5) === false, 'empty: hasWithin far query');
}

// --- 2: single point — within / outside radius
{
  const h = new SpatialHash(2);
  h.add(5, 5);
  assert(h.hasWithin(5, 5, 1) === true, 'self: within zero distance is true');
  assert(h.hasWithin(5.5, 5, 1) === true, 'within: 0.5 < 1');
  assert(h.hasWithin(7, 5, 1) === false, 'outside: 2 > 1');
  assert(h.hasWithin(5.99, 5, 1) === true, 'just within: 0.99 < 1');
}

// --- 3: cellSize == dist boundary correctness
//    Insert a point at (1.99, 0); query at (0, 0) with dist=2. The
//    point is within 2.0, so hasWithin should return true. With
//    cellSize=2 the inserted point is in cell (0,0) and the query
//    is in cell (0,0). Easy. Now move the point to (1.99, 1.99) — same cell — and query (0, 0): distance ~2.81, > 2 → false.
{
  const h = new SpatialHash(2);
  h.add(1.99, 0);
  assert(h.hasWithin(0, 0, 2) === true, 'cellSize=dist same-cell within');

  const h2 = new SpatialHash(2);
  h2.add(1.99, 1.99);
  assert(h2.hasWithin(0, 0, 2) === false, 'cellSize=dist same-cell outside');
}

// --- 4: cross-cell query (point in adjacent cell to query)
{
  const h = new SpatialHash(2);
  // cell(1,0) = [2,4) x [0,2). insert at (2.5, 0.5)
  h.add(2.5, 0.5);
  // query at (1.5, 0.5) — cell(0,0). Distance = 1.0. dist=2 → true
  assert(h.hasWithin(1.5, 0.5, 2) === true, 'cross-cell: within');
  // query at (1.5, 0.5), dist=0.5 → false (distance is 1)
  assert(h.hasWithin(1.5, 0.5, 0.5) === false, 'cross-cell: outside');
}

// --- 5: brute-force parity on random scattered points
{
  const N = 200;
  const points = [];
  for (let i = 0; i < N; i++) {
    points.push([Math.random() * 100, Math.random() * 100]);
  }
  const h = new SpatialHash(5);
  h.addAll(points);

  // 50 random queries — the hash result must match brute.
  let mismatches = 0;
  for (let q = 0; q < 50; q++) {
    const qx = Math.random() * 100;
    const qy = Math.random() * 100;
    const dist = 5;
    if (h.hasWithin(qx, qy, dist) !== bruteHasWithin(points, qx, qy, dist)) {
      mismatches++;
    }
  }
  assert(mismatches === 0, `random parity: ${mismatches} mismatches out of 50 queries`);
}

// --- 6: dedup-style usage (the generate.js pattern)
{
  // 100 points clustered, deduped at min-dist 2.
  const pts = [];
  for (let i = 0; i < 100; i++) {
    pts.push([Math.random() * 50, Math.random() * 50]);
  }

  // Brute dedup
  const bruteDeduped = [];
  for (const [px, py] of pts) {
    let dup = false;
    for (const [dx, dy] of bruteDeduped) {
      const ex = px - dx, ey = py - dy;
      if (ex * ex + ey * ey < 4) { dup = true; break; }
    }
    if (!dup) bruteDeduped.push([px, py]);
  }

  // Hash dedup
  const hashDeduped = [];
  const h = new SpatialHash(2);
  for (const [px, py] of pts) {
    if (h.hasWithin(px, py, 2)) continue;
    hashDeduped.push([px, py]);
    h.add(px, py);
  }

  assert(
    hashDeduped.length === bruteDeduped.length,
    `dedup-pattern parity: hash ${hashDeduped.length} vs brute ${bruteDeduped.length}`,
  );
  // Identity match (same points in same order)
  let same = true;
  for (let i = 0; i < hashDeduped.length; i++) {
    if (hashDeduped[i][0] !== bruteDeduped[i][0]
        || hashDeduped[i][1] !== bruteDeduped[i][1]) { same = false; break; }
  }
  assert(same, 'dedup-pattern: same points in same order');
}

// --- 7: cellSize must be > 0
{
  let threw = false;
  try { new SpatialHash(0); } catch { threw = true; }
  assert(threw, 'cellSize=0 throws');

  threw = false;
  try { new SpatialHash(-1); } catch { threw = true; }
  assert(threw, 'cellSize<0 throws');
}

console.log(`spatialHash: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
