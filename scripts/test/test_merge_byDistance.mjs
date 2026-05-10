// Toolset Plan Phase 4.A — Merge By Distance ("Remove Doubles").
//
// Verifies: pairwise threshold scan, union-find chain merging,
// "earliest oldIdx wins" representative rule, threshold edge cases.
//
// Run: node scripts/test/test_merge_byDistance.mjs

import { mergeByDistance } from '../../src/v3/operators/edit/merge.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1. Two close verts within threshold → merge to centroid.
{
  const mesh = {
    vertices: [
      { x:  0, y: 0 }, { x: 10, y: 0 },
      { x: 10.5, y: 0 }, { x: 30, y: 0 },
    ],
    uvs: new Float32Array(8),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [1, 2], 1.0);
  assert(r !== null, 'pair within threshold → result');
  assert(r.vertices.length === 3, 'merged 4→3 verts');
  // Pair (10, 10.5) → centroid (10.25, 0)
  assert(approx(r.vertices[1].x, 10.25), 'merged vert at centroid');
}

// 2. Pair OUTSIDE threshold → null
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 },
    ],
    uvs: new Float32Array(6),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1, 2], 1.0);
  assert(r === null, 'no pair within threshold → null');
}

// 3. Threshold = 0 → null (must be > 0)
{
  const mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    uvs: new Float32Array(4),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1], 0);
  assert(r === null, 'threshold 0 → null');
}

// 4. Negative threshold → null
{
  const mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    uvs: new Float32Array(4),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1], -1);
  assert(r === null, 'negative threshold → null');
}

// 5. Selection size < 2 → null
{
  const mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    uvs: new Float32Array(4),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0], 1.0);
  assert(r === null, '1-vert selection → null');
}

// 6. Three verts forming a chain within threshold → all merge to centroid.
//    A=0, B=0.5, C=0.9; threshold=0.6 → A-B merge (0.5), B-C merge (0.4).
//    Union-find chains them all → one group, centroid (0+0.5+0.9)/3 = 0.466
{
  const mesh = {
    vertices: [
      { x: 0,   y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.9, y: 0 },
      { x: 50,  y: 0 },
    ],
    uvs: new Float32Array(8),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1, 2], 0.6);
  assert(r !== null, 'chain merge → result');
  // Chain (0-1, 1-2) → union-find merges all three; vert 3 stays.
  // Result: 4 verts → 2 verts (one merged group + vert 3).
  assert(r.vertices.length === 2, `chain merged 4→2, got ${r.vertices.length}`);
  // Group rep is min oldIdx = 0; sources should be [0,1,2].
  const sources = JSON.stringify(r.vertexSources.get(0));
  assert(sources === '[0,1,2]', `chain sources [0,1,2], got ${sources}`);
  assert(approx(r.vertices[0].x, (0 + 0.5 + 0.9) / 3),
    'chain centroid average of all three');
}

// 7. Two disjoint pairs → two merges (4 verts → 2).
{
  const mesh = {
    vertices: [
      { x: 0,   y: 0 },
      { x: 0.1, y: 0 },
      { x: 100, y: 0 },
      { x: 100.1, y: 0 },
    ],
    uvs: new Float32Array(8),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1, 2, 3], 1.0);
  assert(r !== null, 'two disjoint pairs → result');
  assert(r.vertices.length === 2, 'two pairs → 2 verts');
  // Each merge: (0.05) and (100.05)
  // The compactor assigns newIdx by first-appearance — group rep 0 gets newIdx 0,
  // group rep 2 gets newIdx 1.
  assert(approx(r.vertices[0].x, 0.05), 'first merged at 0.05');
  assert(approx(r.vertices[1].x, 100.05), 'second merged at 100.05');
}

// 8. Selection covers a subset; unselected duplicate is NOT merged.
//    Verts 0,1 are duplicates and selected; vert 2 is also duplicate of 0
//    but unselected → must remain separate.
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    uvs: new Float32Array(6),
    triangles: [],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1], 0.5);
  assert(r !== null, 'subset merge → result');
  assert(r.vertices.length === 2, 'unselected duplicate stays separate');
  // Sources: 0 ← [0,1], 1 ← [2]
  assert(JSON.stringify(r.vertexSources.get(0)) === '[0,1]', 'merged sources [0,1]');
  assert(JSON.stringify(r.vertexSources.get(1)) === '[2]', 'unselected sources [2]');
}

// 9. retriangulated=false even on by-distance merge (Blender preserves
//    topology — only triangle-collapse degenerates get dropped).
{
  const mesh = {
    vertices: [
      { x:  0, y: 0 }, { x:  0.1, y: 0 }, { x: 10, y: 10 },
    ],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = mergeByDistance(mesh, [0, 1], 1.0);
  assert(r !== null, 'edge-collapse case → result');
  assert(r.retriangulated === false, 'mergeByDistance retriangulated=false');
  // Tri (0,1,2) → (0,0,1) → degenerate dropped.
  assert(r.triangles.length === 0, 'collapsed tri dropped');
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`mergeByDistance: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
