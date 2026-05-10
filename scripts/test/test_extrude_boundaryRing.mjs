// Toolset Plan Phase 5.B — Closed boundary loop extrude.
//
// Verifies: when the entire boundary loop is selected, every boundary
// vert duplicates AND every boundary edge gets a quad bridge. Result:
// original triangle count + 2*N boundary edges new quad triangles.
// New verts at SAME positions as source (modal G then drags them away).
//
// Run: node scripts/test/test_extrude_boundaryRing.mjs

import { extrude } from '../../src/v3/operators/edit/extrude.js';
import { getBoundaryVerts, getBoundaryEdges } from '../../src/lib/meshTopology.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1. Quad fan with closed boundary — 4 perimeter verts, 4 boundary
//    edges. Selecting all 4 perimeter verts → 4 dup verts + 4*2 = 8
//    new quad triangles. The interior center vert (idx 0) is NOT
//    boundary so doesn't duplicate.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },     // 0 (center)
      { x: 1, y: 0 },     // 1
      { x: 0, y: 1 },     // 2
      { x: -1, y: 0 },    // 3
      { x: 0, y: -1 },    // 4
    ],
    uvs: new Float32Array(10),
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
      [0, 4, 1],
    ],
    edgeIndices: null,
  };
  // sanity: boundary detection finds 4 perimeter verts
  assert(getBoundaryVerts(mesh).size === 4, 'boundary = 4 perimeter');
  assert(getBoundaryEdges(mesh).length === 4, '4 boundary edges');

  const r = extrude(mesh, [1, 2, 3, 4]);
  assert(r !== null, 'closed-loop extrude → result');
  // 5 originals + 4 dups = 9 verts.
  assert(r.vertices.length === 9, `9 verts (5 + 4 dups), got ${r.vertices.length}`);
  // 4 original tris + 4 boundary edges × 2 quad tris = 4 + 8 = 12 tris.
  assert(r.triangles.length === 12, `12 tris (4 orig + 8 quads), got ${r.triangles.length}`);
  // Each dup at same position as source.
  for (let i = 1; i <= 4; i++) {
    const src = mesh.vertices[i];
    let foundDup = false;
    for (let j = 5; j < r.vertices.length; j++) {
      if (approx(r.vertices[j].x, src.x) && approx(r.vertices[j].y, src.y)) {
        foundDup = true;
        // vertexSources[dup] = [src]
        const sources = r.vertexSources.get(j);
        if (sources && sources.length === 1 && sources[0] === i) {
          // ok
        } else {
          failed++;
          failures.push(`dup of ${i} should have vertexSources [${i}], got ${sources}`);
        }
        break;
      }
    }
    assert(foundDup, `dup of vert ${i} exists at source pos`);
  }
  // selectionOverride = {5, 6, 7, 8} (all new dups).
  assert(r.selectionOverride.size === 4, '4 new dups in selectionOverride');
  for (let j = 5; j < 9; j++) {
    assert(r.selectionOverride.has(j), `dup ${j} in override`);
  }
  // Every new triangle uses ≥1 dup vert (no new tri made from
  // originals only).
  let allBridgesUseDup = true;
  for (let t = 4; t < r.triangles.length; t++) {
    const [a, b, c] = r.triangles[t];
    if (a < 5 && b < 5 && c < 5) {
      allBridgesUseDup = false;
      break;
    }
  }
  assert(allBridgesUseDup, 'all bridge triangles include ≥1 dup vert');
}

// 2. Closed-loop UV inheritance — each dup's UV matches its source.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ],
    uvs: new Float32Array([
      0.5, 0.5,    // 0
      0.7, 0.5,    // 1
      0.5, 0.7,    // 2
      0.3, 0.5,    // 3
      0.5, 0.3,    // 4
    ]),
    triangles: [[0,1,2], [0,2,3], [0,3,4], [0,4,1]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [1, 2, 3, 4]);
  // Dups are at indices 5..8. Find each dup's source via vertexSources
  // and verify UVs.
  for (let j = 5; j < 9; j++) {
    const sources = r.vertexSources.get(j);
    if (!sources || sources.length !== 1) continue;
    const src = sources[0];
    assert(approx(r.uvs[j*2], mesh.uvs[src*2]) && approx(r.uvs[j*2+1], mesh.uvs[src*2+1]),
      `dup ${j} UV inherits from source ${src}`);
  }
}

// 3. Selection-only-on-2-of-4-perimeter — only the edge between those
//    two gets the quad bridge.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },     // 0 center
      { x: 1, y: 0 },     // 1
      { x: 0, y: 1 },     // 2
      { x: -1, y: 0 },    // 3
      { x: 0, y: -1 },    // 4
    ],
    uvs: new Float32Array(10),
    triangles: [[0,1,2], [0,2,3], [0,3,4], [0,4,1]],
    edgeIndices: null,
  };
  // Boundary edges: (1,2), (2,3), (3,4), (1,4). Selecting {1,2}
  // means only edge (1,2) gets a quad bridge.
  const r = extrude(mesh, [1, 2]);
  assert(r !== null, '2-of-4 boundary selected → result');
  assert(r.vertices.length === 7, `7 verts (5 + 2 dups), got ${r.vertices.length}`);
  // 4 orig tris + 1 quad bridge × 2 tris = 6 tris.
  assert(r.triangles.length === 6, `6 tris (4 orig + 2 bridge), got ${r.triangles.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
