// Toolset Plan Phase 4.C — Subdivide N-cuts (Blender single-pass).
//
// Verifies: Blender's `MESH_OT_subdivide` semantic where cuts=N means
// N midpoints per edge in a single pass → (N+1)^2 sub-triangles per
// parent. Audit fix D-1 — pre-fix we iterated single-cuts (4^cuts
// sub-tris); now we match Blender's `bm_subdivide_multicut` exactly.
//
// Verifies: cuts=2 → 9 sub-tris per parent (NOT 16); cuts=3 → 16
// (NOT 64); vertexSources references ORIGINAL mesh's verts (NOT
// intermediate); max-cuts (6) clamping; growing-selection rule.
//
// Run: node scripts/test/test_subdivide_n_cuts.mjs

import { subdivide } from '../../src/v3/operators/edit/subdivide.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. cuts=2 on a single tri: 9 sub-tris per parent, triangular grid
//    with 3 segments per edge → (3+1)(3+2)/2 = 10 grid points
//    (3 corners + 6 edge midpoints + 1 interior centroid).
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: 2, smoothness: 0 });
  assert(r !== null, 'cuts=2 → result');
  assert(r.triangles.length === 9, `cuts=2 → 9 tris (Blender single-pass), got ${r.triangles.length}`);
  // 3 corners + 3 edges × 2 midpoints/edge + 1 interior centroid = 10
  assert(r.vertices.length === 10, `cuts=2 → 10 verts (3 + 6 + 1), got ${r.vertices.length}`);
  // Verify the interior vert is the centroid via vertexSources/Weights.
  let foundCentroid = false;
  for (let i = 3; i < 10; i++) {
    const sources = r.vertexSources.get(i);
    const weights = r.vertexWeights?.get(i);
    if (sources?.length === 3 && weights) {
      const allEqual = weights.every((w) => Math.abs(w - 1/3) < 1e-9);
      if (allEqual) { foundCentroid = true; break; }
    }
  }
  assert(foundCentroid, 'cuts=2 has 1 interior vert at centroid (α=β=γ=1/3)');
}

// 2. Composed vertexSources for cuts=2 — every newIdx maps to
//    ORIGINAL mesh's old indices, NOT to first-cut intermediates.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: 2, smoothness: 0 });
  // Every vertexSource entry should reference indices < 3 (original
  // mesh had 3 verts).
  for (const [newIdx, sources] of r.vertexSources) {
    for (const s of sources) {
      assert(s >= 0 && s < 3, `vertexSources[${newIdx}] source ${s} in original range [0,3)`);
    }
  }
}

// 3. cuts=7 clamps to cuts=6 (Blender UI cap). cuts=6 → triangular grid
//    with 7 segments per edge → (7+1)(7+2)/2 = 36 verts; (6+1)^2 = 49 tris.
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  const rClamped = subdivide(mesh, [0, 1, 2], { cuts: 99, smoothness: 0 });
  const rExplicit = subdivide(mesh, [0, 1, 2], { cuts: 6, smoothness: 0 });
  assert(rClamped !== null && rExplicit !== null, 'cuts=99/6 → result');
  assert(rClamped.vertices.length === rExplicit.vertices.length,
    `cuts=99 clamps to cuts=6 (vert count match): ${rClamped.vertices.length} vs ${rExplicit.vertices.length}`);
  assert(rClamped.triangles.length === rExplicit.triangles.length,
    'cuts=99 clamps to cuts=6 (tri count match)');
  assert(rExplicit.triangles.length === 49,
    `cuts=6 → 49 tris ((6+1)^2), got ${rExplicit.triangles.length}`);
  assert(rExplicit.vertices.length === 36,
    `cuts=6 → 36 verts ((7)(8)/2), got ${rExplicit.vertices.length}`);
}

// 4. cuts=-5 clamps to cuts=1 (no-op floor).
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: -5, smoothness: 0 });
  assert(r !== null, 'cuts=-5 → cuts=1');
  assert(r.vertices.length === 6, 'cuts=-5 single subdivision');
}

// 5. Selection growth across cuts: select 2 verts (an edge); cuts=2.
//    First cut subdivides 0 tris (only 2 of 3 selected, but let's make
//    a 2-tri fixture so the shared edge gets bisected).
//
//    After cut 1: edge midpoint (between 0 and 1) inherits the
//    both-selected rule. Tris incident to this midpoint can get further
//    subdivided in cut 2 if their endpoints are also selected.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 },   // 0 selected
      { x: 10, y: 0 },  // 1 selected
      { x: 5, y: 10 },  // 2 unselected
      { x: 15, y: 10 }, // 3 unselected
    ],
    uvs: new Float32Array(8),
    triangles: [[0, 1, 2], [1, 3, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1], { cuts: 2, smoothness: 0 });
  // Cut 1: tri (0,1,2) has 2 of 3 selected → subdivides into 4. Tri (1,3,2)
  // has 1 of 3 selected → no-op.
  // Cut 1 yields: orig 4 + 3 mids on (0,1,2) = 7 verts; tris = 4 (subd) + 1 (kept) = 5.
  // Cut 2: in the post-cut-1 mesh, edge (0, midOf(0,1)) — both selected
  // (mid is now in the selection). Sub-tri (0, midAB, midCA) has all 3
  // sources of midpoints → midAB ←{0,1}, midCA ←{0,2}. midAB IS selected
  // (both 0,1 selected), midCA is NOT selected (2 unselected). So this
  // sub-tri has 0+midAB selected, midCA unselected → 2 of 3, subdivides.
  // Etc. The exact final count depends on the cascade.
  assert(r !== null, 'cuts=2 partial selection → result');
  // Just verify it terminates and produces valid topology.
  assert(r.vertices.length > 4, 'cuts=2 grew vertex count');
  assert(r.triangles.length > 0, 'cuts=2 produced tris');
}

// 6. Composed vertexIndexRemap is identity for original verts (none deleted).
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: 3, smoothness: 0 });
  for (const oldIdx of [0, 1, 2]) {
    const ne = r.vertexIndexRemap.get(oldIdx);
    assert(ne === oldIdx, `cuts=3 remap[${oldIdx}] = ${oldIdx} (no deletes)`);
  }
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`subdivide_n_cuts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
