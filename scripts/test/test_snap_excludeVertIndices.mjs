// Toolset Plan Phase 5 audit fix G-9 — snap hash per-part vert exclusion.
//
// Verifies the new `opts.excludeVertIndicesByPart` build-time filter
// added to `buildSnapHash` in Phase 5: dragged extruded duplicates
// don't auto-snap to their source positions at t=0 (the duplicates
// start at the same coords as their sources).
//
// Pre-fix: zero direct test coverage for the new filter; semantic
// correctness assumed but never asserted.
//
// Run: node scripts/test/test_snap_excludeVertIndices.mjs

import { buildSnapHash } from '../../src/lib/snap/snapHash.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. No exclusion → all verts present.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
    ]}}],
  };
  const hash = buildSnapHash(project, { cellSize: 64 });
  assert(hash.count === 3, `no exclusion → 3 verts, got ${hash.count}`);
  const hit = hash.findNearest(10, 0, 1);
  assert(hit?.vertIndex === 1, `vert 1 found at (10, 0), got ${hit?.vertIndex}`);
}

// 2. Exclude vert 1 → only verts 0, 2 in hash.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
    ]}}],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map([['p1', new Set([1])]]),
  });
  assert(hash.count === 2, `vert 1 excluded → 2 verts, got ${hash.count}`);
  const hitMid = hash.findNearest(10, 0, 1);
  assert(hitMid === null, `excluded vert 1 not found near (10, 0), got ${hitMid?.vertIndex}`);
  const hit0 = hash.findNearest(0, 0, 1);
  assert(hit0?.vertIndex === 0, `non-excluded vert 0 found, got ${hit0?.vertIndex}`);
  const hit2 = hash.findNearest(20, 0, 1);
  assert(hit2?.vertIndex === 2, `non-excluded vert 2 found, got ${hit2?.vertIndex}`);
}

// 3. Exclude multiple verts on same part.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 },
    ]}}],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map([['p1', new Set([0, 2])]]),
  });
  assert(hash.count === 2, `2 verts excluded → 2 left, got ${hash.count}`);
  assert(hash.findNearest(10, 0, 1)?.vertIndex === 1, 'vert 1 (not excluded) found');
  assert(hash.findNearest(30, 0, 1)?.vertIndex === 3, 'vert 3 (not excluded) found');
  assert(hash.findNearest(0, 0, 1) === null, 'vert 0 excluded');
  assert(hash.findNearest(20, 0, 1) === null, 'vert 2 excluded');
}

// 4. Exclusion only applies to named part — other parts' verts pass through.
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', mesh: { vertices: [
        { x: 0, y: 0 }, { x: 10, y: 0 },
      ]}},
      { id: 'p2', type: 'part', mesh: { vertices: [
        { x: 0, y: 0 }, { x: 10, y: 0 },
      ]}},
    ],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map([['p1', new Set([0, 1])]]),
  });
  // p1 fully excluded, p2 fully kept = 2 verts.
  assert(hash.count === 2, `cross-part exclusion: only p1 excluded, got ${hash.count}`);
  // Querying near (10, 0) should find p2's vert, not p1's.
  const hit = hash.findNearest(10, 0, 1);
  assert(hit?.partId === 'p2', `(10,0) → p2 (p1 excluded), got partId=${hit?.partId}`);
}

// 5. Empty exclusion Map → all verts kept.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 },
    ]}}],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map(),
  });
  assert(hash.count === 2, 'empty exclusion Map → all verts kept');
}

// 6. Empty Set for a part → no verts excluded for that part.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 },
    ]}}],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map([['p1', new Set()]]),
  });
  assert(hash.count === 2, 'empty Set for part → no verts excluded');
}

// 7. Coexists with `excludePartId` — both filters apply.
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }]}},
      { id: 'p2', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }]}},
    ],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludePartId: 'p1',
    excludeVertIndicesByPart: new Map([['p2', new Set([0])]]),
  });
  // p1 fully excluded by excludePartId; p2's vert 0 excluded by per-vert filter.
  // Only p2's vert 1 remains.
  assert(hash.count === 1, `combined exclusion → 1 vert, got ${hash.count}`);
  const hit = hash.findNearest(10, 0, 1);
  assert(hit?.partId === 'p2' && hit?.vertIndex === 1, 'only p2 vert 1 remains');
}

// 8. Exclusion Set looking up a part NOT present → no error, no effect.
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }]}}],
  };
  const hash = buildSnapHash(project, {
    cellSize: 64,
    excludeVertIndicesByPart: new Map([['unknownPart', new Set([0])]]),
  });
  assert(hash.count === 1, 'unknown part in exclusion Map → no effect on existing parts');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
