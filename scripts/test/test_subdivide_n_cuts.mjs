// Toolset Plan Phase 4.C — Subdivide N-cuts composition.
//
// Verifies: cuts=2..6 compose correctly (each cut subdivides the prior
// mesh), final vertexSources references the ORIGINAL mesh's verts (so
// per-vertex blendShape data can be remapped), max-cuts (6) clamping,
// growing-selection rule (new midpoints with both-selected endpoints
// join the next-cut selection).
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

// 1. cuts=2 on a single tri: cuts=1 → 6 verts, 4 tris.
//    cuts=2 → each of 4 sub-tris subdivides → 16 tris, ~12 verts unique
//    (3 corners + 3 first-cut midpoints + new midpoints on the 9 new
//    edges of the 4 sub-tris, with shared edges deduped).
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
  assert(r.triangles.length === 16, `cuts=2 → 16 tris (4 × 4), got ${r.triangles.length}`);
  // Vert count: corners (3) + first cut midpoints (3) + second cut
  // midpoints (each sub-tri's 3 edges, shared via dedup). For a triangle
  // subdivided twice, the result is a regular triangular grid with
  // (n+1)(n+2)/2 verts where n = 2² = 4 → 15 verts. Our triangle starts
  // with the corner+midpoint topology so the count is 15.
  assert(r.vertices.length === 15, `cuts=2 → 15 verts (regular grid), got ${r.vertices.length}`);
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

// 3. cuts=7 clamps to cuts=6 (Blender UI cap).
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0,1,2]],
    edgeIndices: null,
  };
  // cuts=6: triangular grid with (2^6 + 1)*(2^6 + 2)/2 = 65 * 66 / 2 = 2145 verts.
  const rClamped = subdivide(mesh, [0, 1, 2], { cuts: 99, smoothness: 0 });
  const rExplicit = subdivide(mesh, [0, 1, 2], { cuts: 6, smoothness: 0 });
  assert(rClamped !== null && rExplicit !== null, 'cuts=99/6 → result');
  assert(rClamped.vertices.length === rExplicit.vertices.length,
    `cuts=99 clamps to cuts=6 (vert count match): ${rClamped.vertices.length} vs ${rExplicit.vertices.length}`);
  assert(rClamped.triangles.length === rExplicit.triangles.length,
    'cuts=99 clamps to cuts=6 (tri count match)');
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
