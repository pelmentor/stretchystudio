// Toolset Plan Phase 5.B — Single-vert extrude (degenerate case).
//
// Verifies: one boundary vert selected → duplicate vert appended,
// no new triangles emitted (no quad bridges since no second
// boundary-selected vert shares an edge with it). selectionOverride
// = {newVertIdx}.
//
// Run: node scripts/test/test_extrude_singleVert.mjs

import { extrude, countSelectedBoundary } from '../../src/v3/operators/edit/extrude.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1. Single triangle — extrude vert 0 only.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },   // 0
      { x: 10, y: 0 },  // 1
      { x: 5, y: 10 },  // 2
    ],
    uvs: new Float32Array([0,0, 1,0, 0.5,1]),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0]);
  assert(r !== null, 'single-vert extrude → result not null');
  assert(r.vertices.length === 4, `single-vert extrude → 4 verts (3 orig + 1 dup), got ${r.vertices.length}`);
  // New vert at index 3 == position of source vert 0.
  assert(approx(r.vertices[3].x, 0) && approx(r.vertices[3].y, 0),
    `dup vert at source pos (0, 0), got (${r.vertices[3].x}, ${r.vertices[3].y})`);
  // No new triangles (only 1 selected boundary vert → no quad bridge).
  assert(r.triangles.length === 1, `single-vert extrude → 1 tri (orig only), got ${r.triangles.length}`);
  // selectionOverride = {3}.
  assert(r.selectionOverride instanceof Set, 'selectionOverride is a Set');
  assert(r.selectionOverride.size === 1 && r.selectionOverride.has(3),
    `selectionOverride = {3}, got ${[...r.selectionOverride]}`);
  // vertexSources[3] = [0]
  const sources = r.vertexSources.get(3);
  assert(sources && sources.length === 1 && sources[0] === 0,
    `vertexSources[3] = [0], got ${sources}`);
  // UV at index 3 == UV of source vert 0.
  assert(r.uvs[6] === 0 && r.uvs[7] === 0, 'UV inherited from source vert');
  // retriangulated still true (we add a vert; even if no new tri the
  // mesh changed shape).
  assert(r.retriangulated === true, 'retriangulated=true');
}

// 2. Empty selection → null.
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:1,y:0 }, { x:0,y:1 }],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  const r = extrude(mesh, []);
  assert(r === null, 'empty selection → null');
}

// 3. Selection contains only INTERIOR verts → null (per spec §5.C).
{
  // Closed fan: vert 0 is interior (no boundary). Verts 1..4 perimeter.
  const mesh = {
    vertices: [
      { x: 0, y: 0 },    // 0 (interior)
      { x: 1, y: 0 },    // 1
      { x: 0, y: 1 },    // 2
      { x: -1, y: 0 },   // 3
      { x: 0, y: -1 },   // 4
    ],
    uvs: new Float32Array(10),
    triangles: [[0,1,2], [0,2,3], [0,3,4], [0,4,1]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0]);
  assert(r === null, 'interior-only selection → null');
  assert(countSelectedBoundary(mesh, [0]) === 0, 'countSelectedBoundary([0]) = 0');
}

// 4. Selection mixes interior + boundary — only the boundary vert
//    duplicates.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },    // 0 (interior)
      { x: 1, y: 0 },    // 1 (boundary)
      { x: 0, y: 1 },    // 2 (boundary)
      { x: -1, y: 0 },   // 3 (boundary)
      { x: 0, y: -1 },   // 4 (boundary)
    ],
    uvs: new Float32Array(10),
    triangles: [[0,1,2], [0,2,3], [0,3,4], [0,4,1]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0, 1]); // interior + boundary
  assert(r !== null, 'mixed selection w/ ≥1 boundary → result');
  // Only vert 1 is boundary; vert 0 (interior) ignored.
  assert(r.vertices.length === 6, `+1 dup vert (only boundary), got ${r.vertices.length}`);
  assert(r.selectionOverride.size === 1, 'override has 1 new vert');
  assert(countSelectedBoundary(mesh, [0, 1]) === 1, 'countSelectedBoundary([0,1]) = 1 (only vert 1)');
}

// 5. boundaryVerts inherit boundary edge-flag for duplicates.
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: new Set([0, 1, 2]), // all boundary
  };
  const r = extrude(mesh, [0]);
  // New vert 3 inherits boundary flag from source 0.
  assert(r.edgeIndices.has(3), 'duplicate vert inherits boundary flag');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
