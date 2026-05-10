// Toolset Plan Phase 2.C/F — snap-to-vertex spatial hash threshold.
//
// Validates that:
//   - `findNearestVertex` returns the nearest project vertex within
//     the threshold and null otherwise.
//   - `excludePartId` skips a node's own verts (snap to OTHER parts).
//   - `invalidateSnapHash` forces a rebuild on next get.
//   - The hash handles both vertex shapes (`Array<{x,y}>` and flat
//     `[x,y,...]`).
//
// Run: node scripts/test/test_snap_vertex_threshold.mjs

import {
  findNearestVertex,
  invalidateSnapHash,
  _resetSnapHashForTests,
  buildSnapHash,
} from '../../src/lib/snap/snapHash.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeProject() {
  return {
    nodes: [
      { id: 'A', type: 'part', mesh: { vertices: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 150, y: 200 },
      ] } },
      { id: 'B', type: 'part', mesh: { vertices: [
        { x: 500, y: 500 },
        { x: 600, y: 500 },
      ] } },
      // Flat-numeric vertex shape (legacy mesh-worker output).
      { id: 'C', type: 'part', mesh: { vertices: [800, 800, 850, 850] } },
      // Non-part nodes are ignored.
      { id: 'G', type: 'group', transform: { x: 0, y: 0 } },
    ],
  };
}

// Reset the cache so tests are deterministic.
_resetSnapHashForTests();

// ── 1: nearest within threshold ──────────────────────────────────────
{
  const proj = makeProject();
  const hit = findNearestVertex(proj, 102, 101, 8);
  assert(hit && hit.x === 100 && hit.y === 100,
    `(102, 101) within 8 of A[0]@(100,100), got ${JSON.stringify(hit)}`);
  assert(hit.partId === 'A' && hit.vertIndex === 0,
    'identity: partId=A, vertIndex=0');
}

// ── 2: nothing within threshold ──────────────────────────────────────
{
  const proj = makeProject();
  const miss = findNearestVertex(proj, 300, 300, 8);
  assert(miss === null, 'far miss returns null');
}

// ── 3: ties broken by first-found (deterministic enough) ─────────────
{
  // (102, 100) is 2 away from A[0] and 98 away from A[1] — A[0] wins.
  const proj = makeProject();
  const hit = findNearestVertex(proj, 102, 100, 16);
  assert(hit && hit.vertIndex === 0, 'closer wins over further (vert 0)');
}

// ── 4: flat-numeric vertex shape works ───────────────────────────────
{
  _resetSnapHashForTests();
  const proj = makeProject();
  const hit = findNearestVertex(proj, 801, 801, 8);
  assert(hit && hit.x === 800 && hit.y === 800,
    `flat-numeric: (801,801) → C[0]@(800,800), got ${JSON.stringify(hit)}`);
  assert(hit.partId === 'C' && hit.vertIndex === 0,
    'flat-numeric: partId=C, vertIndex=0');
}

// ── 5: excludePartId skips own verts ─────────────────────────────────
{
  _resetSnapHashForTests();
  const proj = makeProject();
  // Cursor at A[0]; excluding A means we'd need to look elsewhere.
  // Within threshold 8 of (100, 100) only A's own verts exist → null.
  const miss = findNearestVertex(proj, 100, 100, 8, { excludePartId: 'A' });
  assert(miss === null, 'excludePartId: skips own verts → null');
  // Cursor near B without excluding A: hits B regardless.
  const hit = findNearestVertex(proj, 502, 500, 8, { excludePartId: 'A' });
  assert(hit && hit.partId === 'B', 'excludePartId: still hits other parts');
}

// ── 6: invalidateSnapHash forces rebuild ─────────────────────────────
{
  _resetSnapHashForTests();
  const proj = makeProject();
  const hit1 = findNearestVertex(proj, 102, 101, 8);
  assert(hit1 && hit1.partId === 'A', 'pre-invalidate: hit A');
  // Mutate the project: move A[0] far away.
  proj.nodes[0].mesh.vertices[0] = { x: 9999, y: 9999 };
  // Without invalidating, the cached hash still says A is at (100,100).
  const hitStale = findNearestVertex(proj, 102, 101, 8);
  assert(hitStale && hitStale.partId === 'A',
    'pre-invalidate: stale cache still hits old A pos');
  // Invalidate → next call rebuilds.
  invalidateSnapHash();
  const hitFresh = findNearestVertex(proj, 102, 101, 8);
  assert(hitFresh === null,
    'post-invalidate: rebuild reflects mutation, no hit at old pos');
}

// ── 7: bad threshold degrades to null ────────────────────────────────
{
  _resetSnapHashForTests();
  const proj = makeProject();
  assert(findNearestVertex(proj, 100, 100, 0) === null, 'threshold 0 → null');
  assert(findNearestVertex(proj, 100, 100, -1) === null, 'threshold <0 → null');
  assert(findNearestVertex(proj, 100, 100, NaN) === null, 'threshold NaN → null');
}

// ── 8: empty / null project degrades to null ─────────────────────────
{
  _resetSnapHashForTests();
  assert(findNearestVertex(null, 100, 100, 8) === null, 'null proj → null');
  assert(findNearestVertex({ nodes: [] }, 100, 100, 8) === null, 'empty nodes → null');
  assert(findNearestVertex({ nodes: [{ id: 'X', type: 'group' }] }, 100, 100, 8) === null,
    'no parts → null');
}

// ── 9: buildSnapHash standalone (no caching) ─────────────────────────
{
  const proj = makeProject();
  const hash = buildSnapHash(proj, 64);
  // 3 + 2 + 2 = 7 verts (A 3, B 2, C 2 flat)
  assert(hash.count === 7, `direct build count = 7, got ${hash.count}`);
}

// ── 10: project-identity change forces rebuild (no invalidate needed) ─
{
  _resetSnapHashForTests();
  const projOld = makeProject();
  const hit1 = findNearestVertex(projOld, 102, 101, 8);
  assert(hit1 && hit1.partId === 'A', 'projOld: hit A');
  // Whole-store swap to a project with different verts. No
  // invalidateSnapHash() — identity check should catch it.
  const projNew = {
    nodes: [{ id: 'Z', type: 'part', mesh: { vertices: [{ x: 102, y: 101 }] } }],
  };
  const hit2 = findNearestVertex(projNew, 102, 101, 8);
  assert(hit2 && hit2.partId === 'Z',
    'project swap: cache rebuilds against new project identity');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
