// Edit Mode — Knife (vertex-to-vertex straight-line cut) geometric core.
//
// Verifies: cut through interior triangle adds intersection verts +
// subdivides; shared edge between two cut triangles reuses ONE new
// vert (no tear); cut along an existing edge is a no-op; cut between
// adjacent verts that share an edge is a no-op; UV linear interp at
// intersections; A == B / out-of-range refused.
//
// Run: node scripts/test/test_knifeCut.mjs

import { cutMeshAlongLine } from '../../src/v3/operators/edit/knife.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}
function near(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${a}\n   expected: ${b}`);
}

// Mesh helper: 4-vert square with 2 triangles sharing the diagonal 0–2.
//   3 ─── 2
//   │ ╲   │
//   │   ╲ │
//   0 ─── 1
function squareMesh() {
  return {
    vertices: [
      { x: 0,  y: 0,  restX: 0,  restY: 0 },
      { x: 10, y: 0,  restX: 10, restY: 0 },
      { x: 10, y: 10, restX: 10, restY: 10 },
      { x: 0,  y: 10, restX: 0,  restY: 10 },
    ],
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]),
    triangles: [[0, 1, 2], [0, 2, 3]],
  };
}

// 6-vert mesh of 4 triangles. Vertical strip:
//   3 ─── 2
//   │ ╲   │
//   │   ╲ │
//   0 ─── 1
//   │ ╲   │
//   │   ╲ │
//   4 ─── 5
// Triangles: (0,1,2), (0,2,3), (4,0,1), (4,1,5).
function tallStripMesh() {
  return {
    vertices: [
      { x: 0,  y: 10, restX: 0,  restY: 10 }, // 0
      { x: 10, y: 10, restX: 10, restY: 10 }, // 1
      { x: 10, y: 20, restX: 10, restY: 20 }, // 2
      { x: 0,  y: 20, restX: 0,  restY: 20 }, // 3
      { x: 0,  y: 0,  restX: 0,  restY: 0 },  // 4
      { x: 10, y: 0,  restX: 10, restY: 0 },  // 5
    ],
    uvs: new Float32Array([0,0.5, 1,0.5, 1,1, 0,1, 0,0, 1,0]),
    triangles: [[0, 1, 2], [0, 2, 3], [4, 0, 1], [4, 1, 5]],
  };
}

// ── 1. Cut between two non-adjacent verts of the square (3 → 1, both
//        corners on the diagonal not shared by either triangle directly):
//        line passes through the interior, crosses edge (0,2) (the shared
//        diagonal). Both triangles get cut.
//
//        Expected: 1 new intersection vert on edge (0,2); the new vert
//        sits at the midpoint by geometry (3 → 1 is the OTHER diagonal,
//        crosses (0,2) at the centre).
{
  const mesh = squareMesh();
  const result = cutMeshAlongLine(mesh, 3, 1);
  assert(result != null, '1: cut 3→1 across square returns result');
  eq(result.vertices.length, 5, '1: 5 verts (4 original + 1 intersection)');
  // The new vert is at the centre of the square (5, 5).
  const x = result.vertices[4];
  near(x.x, 5, 1e-6, '1: new vert X at midpoint');
  near(x.y, 5, 1e-6, '1: new vert Y at midpoint');
  // restX / restY interpolated too
  near(x.restX, 5, 1e-6, '1: new vert restX at midpoint');
  near(x.restY, 5, 1e-6, '1: new vert restY at midpoint');
  // UV linear interp between (0,0) and (1,1) at t=0.5 → (0.5, 0.5).
  near(result.uvs[4 * 2 + 0], 0.5, 1e-6, '1: new vert UV.x interpolated');
  near(result.uvs[4 * 2 + 1], 0.5, 1e-6, '1: new vert UV.y interpolated');
  // vertexSources for the new vert = [0, 2] (endpoints of the crossed edge).
  const srcs = result.vertexSources.get(4);
  assert(Array.isArray(srcs) && srcs.length === 2, '1: new vert has 2 sources');
  assert(srcs.includes(0) && srcs.includes(2),
    '1: sources are endpoints of edge (0,2)');
  // Both original triangles were cut. Each triangle had ONE vert on the
  // line (3 for one, 1 for the other), so each splits into 2 sub-tris.
  // Total triangles after cut: 4 (2 per original).
  eq(result.triangles.length, 4, '1: 4 sub-triangles (2 per cut tri)');
}

// ── 2. Shared-edge cut on tall strip: cut 3 → 5 crosses both edge (0,2)
//        in the upper rect AND edge (0,1) in the lower rect (and possibly
//        more). The middle horizontal edge (0,1) is shared between two
//        triangles; the new intersection vert on it must be REUSED — if
//        each triangle allocates its own, the mesh tears.
{
  const mesh = tallStripMesh();
  const result = cutMeshAlongLine(mesh, 3, 5);
  assert(result != null, '2: cut 3→5 on tall strip returns result');
  // Count intersection verts (anything beyond index 5 is new).
  const newVerts = result.vertices.length - 6;
  assert(newVerts >= 1, '2: at least 1 intersection vert created');
  // Check vertexSources for each new vert references the canonical edge
  // pair from the input mesh — and that no two new verts share the same
  // canonical edge pair (the dedup property).
  const seenEdges = new Set();
  for (let i = 6; i < result.vertices.length; i++) {
    const srcs = result.vertexSources.get(i);
    assert(Array.isArray(srcs) && srcs.length === 2, `2: new vert ${i} has 2 sources`);
    const key = srcs[0] < srcs[1] ? `${srcs[0]}:${srcs[1]}` : `${srcs[1]}:${srcs[0]}`;
    assert(!seenEdges.has(key),
      `2: edge ${key} only gets one intersection vert (no tear)`);
    seenEdges.add(key);
  }
}

// ── 3. Cut along an existing edge → no-op.
//        On the square, the diagonal (0,2) is an actual edge. Cutting
//        0 → 2 should not create new verts (all 4 corners lie on the
//        cut line OR on the same side; both triangles have a 0 distance
//        for two verts → fall into "all on the line or one side").
{
  const mesh = squareMesh();
  const result = cutMeshAlongLine(mesh, 0, 2);
  eq(result, null, '3: cut along existing diagonal edge → null no-op');
}

// ── 4. Cut between adjacent verts that share an edge (0 → 1 on square)
//        → no-op (the cut IS the edge).
{
  const mesh = squareMesh();
  const result = cutMeshAlongLine(mesh, 0, 1);
  eq(result, null, '4: cut along existing boundary edge → null no-op');
}

// ── 5. A == B is a refused no-op.
{
  const mesh = squareMesh();
  eq(cutMeshAlongLine(mesh, 1, 1), null, '5: A == B → null');
}

// ── 6. Out-of-range indices refused.
{
  const mesh = squareMesh();
  eq(cutMeshAlongLine(mesh, -1, 1), null, '6a: negative A → null');
  eq(cutMeshAlongLine(mesh, 0, 99), null, '6b: out-of-range B → null');
  eq(cutMeshAlongLine(mesh, 'x', 1), null, '6c: non-integer A → null');
}

// ── 7. Existing verts survive at their indices (knife is append-only;
//        no remap of original verts).
{
  const mesh = squareMesh();
  const result = cutMeshAlongLine(mesh, 3, 1);
  assert(result != null, '7: precondition');
  // First 4 entries of result.vertices should match input verts exactly.
  for (let i = 0; i < 4; i++) {
    eq(result.vertices[i].x, mesh.vertices[i].x, `7: vert ${i} X preserved`);
    eq(result.vertices[i].y, mesh.vertices[i].y, `7: vert ${i} Y preserved`);
  }
  // vertexIndexRemap identity for original verts.
  for (let i = 0; i < 4; i++) {
    eq(result.vertexIndexRemap.get(i), i, `7: remap identity for vert ${i}`);
  }
}

// ── 8. retriangulated: true (knife always re-meshes when it cuts).
{
  const mesh = squareMesh();
  const result = cutMeshAlongLine(mesh, 3, 1);
  eq(result.retriangulated, true, '8: knife result marks retriangulated:true');
}

// ── 9. Cut through a third vertex (line passes exactly through a
//        non-endpoint vert): the triangle should subdivide cleanly.
//        Take the tall strip; cut from vert 3 (top-left) to vert 4
//        (bottom-left). Both are on x=0 line. The line passes through
//        vert 0 (also x=0). Triangles (0,1,2) and (4,0,1) have vert 0
//        on the line; triangles (0,2,3) and (4,1,5) — wait, (0,2,3)
//        has verts (0,10), (10,20), (0,20); side(0) = 0 because (0,y) is
//        on the line x=0; side(2) = dirX*(y-aY) - dirY*(x-aX). Let me
//        compute: A = vert 3 = (0, 20), B = vert 4 = (0, 0). dirX=0,
//        dirY=-20. For vert 0 (0, 10): cross = 0*(10-20) - (-20)*(0-0) = 0.
//        For vert 2 (10, 20): cross = 0*(20-20) - (-20)*(10-0) = 200 > 0.
//        For vert 1 (10, 10): cross = 0*(10-20) - (-20)*(10-0) = 200 > 0.
//        For vert 5 (10, 0): cross = 0*(0-20) - (-20)*(10-0) = 200 > 0.
//        All non-endpoint verts on the right are side=1; all left verts
//        are on the line. NO triangle has opposite-sign endpoints —
//        cut is a no-op.
{
  const mesh = tallStripMesh();
  const result = cutMeshAlongLine(mesh, 3, 4);
  eq(result, null,
    '9: cut along boundary (all triangles same-sign or on-line) → null');
}

console.log(`\nknifeCut: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
