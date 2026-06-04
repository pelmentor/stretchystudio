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

// ── 9. Winding preservation — every sub-triangle has the SAME
//        signed-area sign as the original it came from.
//
// 2026-06-04 audit response: F1 finding ("Knife Case S2 third
// sub-triangle wound CW instead of CCW") was a false positive.
// The agent's residual-quad analysis miscomputed which corner-triple
// fills the gap. This test locks the correct winding so future
// regressions surface as a failed assertion instead of as silent
// downstream signed-area corruption.
function signedArea(a, b, c) {
  return 0.5 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}
{
  // Standard CCW triangle (signed area > 0 in y-up math convention SS uses).
  const mesh = {
    vertices: [
      { x: 0,  y: 0,  restX: 0,  restY: 0 },   // solo (top)
      { x: -1, y: -1, restX: -1, restY: -1 },  // p (bottom-left)
      { x: 1,  y: -1, restX: 1,  restY: -1 },  // q (bottom-right)
    ],
    uvs: new Float32Array([0.5,1, 0,0, 1,0]),
    triangles: [[0, 1, 2]],
  };
  // Sanity: original is CCW.
  assert(signedArea(mesh.vertices[0], mesh.vertices[1], mesh.vertices[2]) > 0,
    '9: original triangle is CCW (signed area > 0)');
  // Cut horizontally between solo and the base. Need two vert indices
  // for the cut endpoints — pick verts that lie ON the cut line. Add
  // two helper verts at y=-0.5 (the cut height) extending outside the
  // triangle so the line from helper-3 to helper-4 actually slices it.
  mesh.vertices.push({ x: -2, y: -0.5 }); // 3
  mesh.vertices.push({ x: 2,  y: -0.5 }); // 4
  const uvAddend = new Float32Array(10);
  uvAddend.set(mesh.uvs);
  uvAddend[3 * 2 + 0] = 0; uvAddend[3 * 2 + 1] = 0.5;
  uvAddend[4 * 2 + 0] = 1; uvAddend[4 * 2 + 1] = 0.5;
  mesh.uvs = uvAddend;
  const result = cutMeshAlongLine(mesh, 3, 4);
  assert(result != null, '9: precondition — cut produces a result');
  // Verify EVERY output triangle has positive signed area (CCW), since
  // the only original triangle was CCW. Case S2's three sub-triangles
  // must all preserve the sign.
  let allCCW = true;
  for (let i = 0; i < result.triangles.length; i++) {
    const [a, b, c] = result.triangles[i];
    const A = result.vertices[a];
    const B = result.vertices[b];
    const C = result.vertices[c];
    const sa = signedArea(A, B, C);
    if (sa <= 0) {
      allCCW = false;
      console.error(`  triangle ${i} (verts ${a},${b},${c}) has signed area ${sa} (CW or degenerate)`);
    }
  }
  assert(allCCW, '9: every sub-triangle preserves the original CCW winding');
  // Also verify the cumulative signed area equals the original (no
  // overlap, no gap, no triangle counted twice with wrong orientation).
  // Triangle (0,1,2) has signed area = 0.5 * ((-1-0)*(-1-0) - (-1-0)*(1-0)) = 0.5 * (1 - (-1)) = 1.0.
  let totalArea = 0;
  for (const [a, b, c] of result.triangles) {
    totalArea += signedArea(result.vertices[a], result.vertices[b], result.vertices[c]);
  }
  const expectedArea = 1.0;
  assert(Math.abs(totalArea - expectedArea) < 1e-9,
    `9: total signed area after cut equals original (got ${totalArea}, expected ${expectedArea})`);
}

// ── 11. Cut along boundary: line passes through a third vert AND lies
//        on triangle edges (all triangles fall in the "no cross" or
//        "co-linear edge" buckets) → null no-op.
{
  const mesh = tallStripMesh();
  const result = cutMeshAlongLine(mesh, 3, 4);
  eq(result, null,
    '11: cut along boundary (all triangles same-sign or on-line) → null');
}

console.log(`\nknifeCut: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
