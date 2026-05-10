// Toolset Plan Phase 5.A — Boundary detection.
//
// Verifies: degenerate-tri filter (interior seam triangles don't
// produce phantom boundary edges), single-tri all-3-boundary, two-tri
// shared-edge boundary subset, closed-fan no-boundary, exposed
// getBoundaryEdges return shape.
//
// Run: node scripts/test/test_getBoundaryVerts.mjs

import { getBoundaryVerts, getBoundaryEdges } from '../../src/lib/meshTopology.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. Single triangle — every vertex is a boundary vertex.
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    triangles: [[0, 1, 2]],
  };
  const b = getBoundaryVerts(mesh);
  assert(b.size === 3, `single tri → 3 boundary verts, got ${b.size}`);
  assert(b.has(0) && b.has(1) && b.has(2), 'single tri → all 3 verts in boundary');
  const edges = getBoundaryEdges(mesh);
  assert(edges.length === 3, `single tri → 3 boundary edges, got ${edges.length}`);
}

// 2. Two-tri quad sharing edge (1, 2): boundary verts are all 4
//    perimeter verts; the shared edge (1,2) is INTERIOR (used by
//    both tris) so it doesn't appear in boundary edges.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },   // 0
      { x: 10, y: 0 },  // 1
      { x: 5, y: 10 },  // 2
      { x: 15, y: 10 }, // 3
    ],
    triangles: [[0, 1, 2], [1, 3, 2]],
  };
  const b = getBoundaryVerts(mesh);
  assert(b.size === 4, `quad → 4 boundary verts, got ${b.size}`);
  const edges = getBoundaryEdges(mesh);
  assert(edges.length === 4, `quad → 4 boundary edges, got ${edges.length}`);
  // Edge (1,2) (interior) must NOT appear.
  const sharedAppears = edges.some(([u, v]) => (u === 1 && v === 2) || (u === 2 && v === 1));
  assert(!sharedAppears, 'shared interior edge (1,2) NOT in boundary edges');
}

// 3. Closed fan around a center vert — every spoke triangle shares
//    edges only with its two fan neighbours, and the perimeter is
//    a closed loop. Center vert is NOT boundary; perimeter verts ARE.
{
  // Center 0 with 4 perimeter verts (1..4). 4 triangles forming a
  // closed quad fan. Since the perimeter loops, edge 1-2, 2-3, 3-4,
  // 4-1 each used by ONE triangle = boundary. The spoke edges 0-1,
  // 0-2, 0-3, 0-4 each used by TWO triangles = interior.
  const mesh = {
    vertices: [
      { x: 0, y: 0 },     // 0 (center)
      { x: 1, y: 0 },     // 1
      { x: 0, y: 1 },     // 2
      { x: -1, y: 0 },    // 3
      { x: 0, y: -1 },    // 4
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
      [0, 4, 1],
    ],
  };
  const b = getBoundaryVerts(mesh);
  assert(!b.has(0), 'closed fan: center vert NOT boundary');
  assert(b.has(1) && b.has(2) && b.has(3) && b.has(4), 'closed fan: 4 perimeter verts boundary');
  assert(b.size === 4, `closed fan: only perimeter, got ${b.size}`);
  const edges = getBoundaryEdges(mesh);
  assert(edges.length === 4, `closed fan: 4 perimeter edges, got ${edges.length}`);
}

// 4. Empty mesh.
{
  const mesh = { vertices: [], triangles: [] };
  const b = getBoundaryVerts(mesh);
  assert(b.size === 0, 'empty mesh → empty boundary');
}

// 5. Degenerate seam triangle filter — three collinear verts form a
//    seam tri. Without the degenerate filter, the seam edges appear
//    used by exactly one triangle = misclassified as boundary.
//    The filter must drop the seam tri before counting.
{
  // Verts: 0,1,2 form a real triangle. Verts 3,4,5 form a degenerate
  // seam tri (collinear at y=20). Verts 0,1,2 sit at the bottom,
  // their edges should be the only boundary.
  const mesh = {
    vertices: [
      { x: 0, y: 0 },     // 0
      { x: 10, y: 0 },    // 1
      { x: 5, y: 5 },     // 2
      { x: 0, y: 20 },    // 3
      { x: 5, y: 20 },    // 4 (collinear with 3 + 5)
      { x: 10, y: 20 },   // 5
    ],
    triangles: [
      [0, 1, 2],
      [3, 4, 5],          // degenerate (zero area)
    ],
  };
  const b = getBoundaryVerts(mesh);
  // Real tri verts 0,1,2 are boundary. Seam verts 3,4,5 are NOT
  // (their tri was filtered).
  assert(b.has(0) && b.has(1) && b.has(2), 'real tri verts in boundary');
  assert(!b.has(3) && !b.has(4) && !b.has(5),
    `seam verts NOT boundary (degenerate filter); got 3:${b.has(3)} 4:${b.has(4)} 5:${b.has(5)}`);
  assert(b.size === 3, `boundary size 3 (only real tri), got ${b.size}`);
}

// 6. Two coincident verts in a triangle (a == b case — zero area).
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },     // 0
      { x: 0, y: 0 },     // 1 (coincident with 0)
      { x: 10, y: 0 },    // 2
    ],
    triangles: [[0, 1, 2]],
  };
  const b = getBoundaryVerts(mesh);
  assert(b.size === 0,
    `coincident-vert tri filtered as degenerate, got ${b.size} boundary verts`);
}

// 7. Boundary edges return shape — sorted (u, v) with u < v.
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    triangles: [[0, 1, 2]],
  };
  const edges = getBoundaryEdges(mesh);
  for (const [u, v] of edges) {
    assert(u < v, `edge (${u}, ${v}) has u < v`);
  }
}

// 8. Custom epsArea threshold — lower the threshold so a tiny but
//    real triangle isn't filtered out as degenerate.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
      { x: 0, y: 0.01 },  // tiny but non-degenerate
    ],
    triangles: [[0, 1, 2]],
  };
  // Default epsArea = 1e-9 — area is 0.5 * 0.01 * 0.01 = 5e-5, well
  // above the threshold, so this counts as a real tri.
  const b = getBoundaryVerts(mesh);
  assert(b.size === 3, 'tiny but non-degenerate tri kept');
  // Pass a huge epsArea — now the tiny tri IS filtered.
  const b2 = getBoundaryVerts(mesh, { epsArea: 1 });
  assert(b2.size === 0, 'tiny tri dropped under huge epsArea');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
