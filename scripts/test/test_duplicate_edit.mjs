// Toolset Plan Phase 6.B — Edit-Mode Duplicate.
//
// Verifies `duplicate(mesh, selection)`:
//   - Selected verts get duplicated, positions preserved.
//   - Triangles fully inside selection get cloned to the new verts.
//   - Triangles partially inside selection are NOT cloned.
//   - selectionOverride = the new dup verts.
//   - vertexSources records 1-source mapping for each dup.
//   - UVs inherited from source.
//   - vertexIndexRemap = identity for originals.
//   - Out-of-bounds / non-integer indices in selection: silently dropped.
//   - Empty / null mesh inputs: null.
//
// Run: node scripts/test/test_duplicate_edit.mjs

import { duplicate } from '../../src/v3/operators/edit/duplicate.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1. Single tri, dup all 3 verts → 3 dups + 1 cloned tri.
{
  const mesh = {
    vertices: [
      {x:0,y:0,restX:0,restY:0},
      {x:10,y:0,restX:10,restY:0},
      {x:5,y:10,restX:5,restY:10},
    ],
    uvs: new Float32Array([0,0, 1,0, 0.5,1]),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  const r = duplicate(mesh, [0,1,2]);
  assert(r !== null, 'all-3 dup → result not null');
  assert(r.vertices.length === 6, `dup → 6 verts (3 orig + 3 dup), got ${r.vertices.length}`);
  // Dups at indices 3,4,5 mirror source positions.
  assert(approx(r.vertices[3].x, 0)  && approx(r.vertices[3].y, 0),  'dup vert 3 at source pos');
  assert(approx(r.vertices[4].x, 10) && approx(r.vertices[4].y, 0),  'dup vert 4 at source pos');
  assert(approx(r.vertices[5].x, 5)  && approx(r.vertices[5].y, 10), 'dup vert 5 at source pos');
  // restX/restY copied through.
  assert(r.vertices[3].restX === 0 && r.vertices[3].restY === 0, 'dup rest preserved');
  // Original tri preserved + new cloned tri.
  assert(r.triangles.length === 2, `dup → 2 tris (orig + clone), got ${r.triangles.length}`);
  // The cloned tri is the last one and points at dups.
  const cloned = r.triangles[1];
  assert(cloned[0] === 3 && cloned[1] === 4 && cloned[2] === 5,
    `cloned tri = [3,4,5], got [${cloned}]`);
  // selectionOverride = {3,4,5}.
  assert(r.selectionOverride instanceof Set && r.selectionOverride.size === 3,
    `selectionOverride.size=3, got ${r.selectionOverride?.size}`);
  for (const i of [3,4,5]) {
    assert(r.selectionOverride.has(i), `selectionOverride includes ${i}`);
  }
  // vertexSources: dup 3 → [0], 4 → [1], 5 → [2].
  assert(r.vertexSources.get(3)?.[0] === 0, 'vertexSources[3] = [0]');
  assert(r.vertexSources.get(4)?.[0] === 1, 'vertexSources[4] = [1]');
  assert(r.vertexSources.get(5)?.[0] === 2, 'vertexSources[5] = [2]');
  // UVs inherited.
  assert(r.uvs[6] === 0   && r.uvs[7] === 0,   'UV[3] = source UV[0]');
  assert(r.uvs[8] === 1   && r.uvs[9] === 0,   'UV[4] = source UV[1]');
  assert(r.uvs[10] === 0.5 && r.uvs[11] === 1, 'UV[5] = source UV[2]');
  // vertexIndexRemap = identity for survivors.
  for (const i of [0,1,2]) {
    assert(r.vertexIndexRemap.get(i) === i, `vertexIndexRemap[${i}] = ${i}`);
  }
}

// 2. Two tris sharing edge, dup only 2 verts (subset) → no cloned tri
//    (no triangle is FULLY in selection).
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},{x:15,y:5},
    ],
    uvs: new Float32Array(8),
    triangles: [[0,1,2],[1,2,3]],
    edgeIndices: null,
  };
  const r = duplicate(mesh, [0,1]);
  assert(r !== null, 'partial dup → result not null');
  assert(r.vertices.length === 6, `4 orig + 2 dup = 6, got ${r.vertices.length}`);
  // No cloned triangles (tri [0,1,2] missing vert 2; tri [1,2,3] missing 2 and 3).
  assert(r.triangles.length === 2, `no triangles cloned, got ${r.triangles.length}`);
  assert(r.selectionOverride.size === 2 && r.selectionOverride.has(4) && r.selectionOverride.has(5),
    `selectionOverride = {4,5}, got ${[...r.selectionOverride]}`);
}

// 3. Two tris sharing edge, dup 3 verts that fully cover ONE tri →
//    one cloned tri.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},{x:15,y:5},
    ],
    uvs: new Float32Array(8),
    triangles: [[0,1,2],[1,2,3]],
    edgeIndices: null,
  };
  const r = duplicate(mesh, [0,1,2]);
  assert(r !== null, '3-of-4 dup → result not null');
  assert(r.vertices.length === 7, `4 orig + 3 dup = 7, got ${r.vertices.length}`);
  // One cloned triangle (only tri [0,1,2] is fully covered).
  assert(r.triangles.length === 3, `1 tri cloned, got ${r.triangles.length}`);
  // The cloned tri is on dups.
  const cloned = r.triangles[2];
  assert(cloned[0] >= 4 && cloned[1] >= 4 && cloned[2] >= 4,
    `cloned tri uses dup indices, got [${cloned}]`);
}

// 4. Empty selection → null.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
  };
  assert(duplicate(mesh, []) === null, 'empty selection → null');
}

// 5. Out-of-bounds + non-integer indices silently dropped.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
  };
  const r = duplicate(mesh, [-1, 1.5, 100, 'x', null, 0]);
  assert(r !== null, 'bad-index input → still result if at least one valid');
  assert(r.vertices.length === 4, `1 valid index → 1 dup, got ${r.vertices.length}`);
  assert(r.selectionOverride.has(3), 'dup of vert 0 selected');
}

// 6. edgeIndices propagates: source vert in edgeIndices → dup also in
//    edgeIndices.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: [0, 1, 2],
  };
  const r = duplicate(mesh, [0]);
  assert(r.edgeIndices instanceof Set, 'edgeIndices is Set');
  assert(r.edgeIndices.has(0) && r.edgeIndices.has(3),
    `edgeIndices preserves boundary on source AND dup, got ${[...r.edgeIndices]}`);
}

// 7. Null / empty mesh inputs → null.
{
  assert(duplicate(null, [0]) === null, 'null mesh → null');
  assert(duplicate({}, [0]) === null, 'empty mesh → null');
  assert(duplicate({vertices: [], triangles: []}, [0]) === null,
    'empty verts → null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
