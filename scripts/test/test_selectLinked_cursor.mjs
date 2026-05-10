// Toolset Plan Phase 6.A — Select Linked from cursor (flood-fill).
//
// Verifies `selectLinkedFromVertex(mesh, originIdx)`:
//   - Returns the connected component reachable from the seed vert.
//   - Two disconnected components: only the seed's component lights up.
//   - Isolated vert (no incident edges): single-vertex set.
//   - Out-of-bounds origin: null.
//   - Mesh with no triangles: single-vertex set (vert exists but no edges).
//
// Run: node scripts/test/test_selectLinked_cursor.mjs

import { selectLinkedFromVertex } from '../../src/v3/operators/select/linked.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. Single triangle — flood-fill from any vert returns all 3.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  for (const seed of [0, 1, 2]) {
    const r = selectLinkedFromVertex(mesh, seed);
    assert(r instanceof Set, `seed ${seed} → returns Set`);
    assert(r.size === 3, `seed ${seed} → all 3 verts (got ${r?.size})`);
    assert(r.has(0) && r.has(1) && r.has(2), `seed ${seed} → has {0,1,2}`);
  }
}

// 2. Two disconnected triangles — flood-fill from one stays in one.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},          // tri A: 0-1-2
      {x:100,y:0},{x:110,y:0},{x:105,y:10},     // tri B: 3-4-5
    ],
    triangles: [[0,1,2],[3,4,5]],
  };
  const a = selectLinkedFromVertex(mesh, 0);
  assert(a.size === 3 && a.has(0) && a.has(1) && a.has(2),
    `seed 0 → tri A only, got ${[...a]}`);
  assert(!a.has(3) && !a.has(4) && !a.has(5),
    `seed 0 → tri B excluded, got ${[...a]}`);
  const b = selectLinkedFromVertex(mesh, 4);
  assert(b.size === 3 && b.has(3) && b.has(4) && b.has(5),
    `seed 4 → tri B only, got ${[...b]}`);
}

// 3. Two triangles SHARING an edge — flood-fill picks both.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},
      {x:15,y:5},
    ],
    // tri 1-2-3 shares edge (1,2) with tri 0-1-2.
    triangles: [[0,1,2],[1,2,3]],
  };
  const r = selectLinkedFromVertex(mesh, 0);
  assert(r.size === 4, `shared-edge mesh → all 4 verts (got ${r?.size})`);
  assert(r.has(0) && r.has(1) && r.has(2) && r.has(3),
    `shared-edge mesh → {0,1,2,3}, got ${[...r]}`);
}

// 4. Quad as 2 triangles sharing diagonal — all 4 verts connected.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},
    ],
    triangles: [[0,1,2],[0,2,3]],
  };
  const r = selectLinkedFromVertex(mesh, 3);
  assert(r.size === 4, `quad → 4 verts from any seed (got ${r?.size})`);
  assert(r.has(0) && r.has(1) && r.has(2) && r.has(3),
    `quad → {0,1,2,3}, got ${[...r]}`);
}

// 5. Out-of-bounds origin → null.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  assert(selectLinkedFromVertex(mesh, 5) === null,
    'origin > vertex count → null');
  assert(selectLinkedFromVertex(mesh, -1) === null,
    'origin < 0 → null');
}

// 6. Empty mesh → null.
{
  const mesh = { vertices: [], triangles: [] };
  assert(selectLinkedFromVertex(mesh, 0) === null,
    'empty mesh → null');
}

// 7. Vert with no incident triangles (orphan vert in mesh) → singleton.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10},{x:50,y:50}],
    triangles: [[0,1,2]],  // vert 3 is orphan
  };
  const r = selectLinkedFromVertex(mesh, 3);
  assert(r.size === 1 && r.has(3),
    `orphan vert seed → singleton {3}, got ${[...r]}`);
}

// 8. Flat triangle indices (alt storage shape) — same flood-fill result.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10},{x:15,y:5}],
    triangles: [0,1,2, 1,2,3],  // flat, not nested
  };
  const r = selectLinkedFromVertex(mesh, 0);
  assert(r.size === 4, `flat-tri seed → all 4 verts (got ${r?.size})`);
}

// 9. Degenerate (zero-area) triangle still pins verts together.
//    Unlike Phase 5 boundary detection (which filters degenerate tris),
//    Select Linked keeps them — Blender's `select_linked_walk` has no
//    area threshold.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},
      {x:50,y:50},{x:60,y:50},          // disconnected pair
    ],
    triangles: [
      [0,1,2],
      [3,4,4],  // degenerate (only 2 unique verts) — links 3 and 4
    ],
  };
  const r = selectLinkedFromVertex(mesh, 3);
  assert(r.has(3) && r.has(4),
    `degenerate-tri vert 3 reachable to 4 (got ${[...r]})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
