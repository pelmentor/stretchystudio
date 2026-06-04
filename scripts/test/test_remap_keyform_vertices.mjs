// 2026-06-04 — `remapKeyformVertices` pure-function tests.
//
// Helper introduced to fix the post-topology-op live-preview FREEZE:
// `applyTopologyOp` used to delete `mesh.runtime` wholesale, so
// `kernelArtMeshEval`'s `if (!runtime) return null;` early-returned for
// every part the user just edited. The remap migrates the interleaved
// `[x0, y0, x1, y1, ...]` Float32Array across delete / merge / dissolve
// / subdivide / knife / extrude using the same `vertexSources` /
// `vertexWeights` semantics the blendShape delta remap already consumes.
//
// Coverage:
//   1. Identity pass-through (no remap, just length)
//   2. Simple delete (survivor copy)
//   3. Merge (uniform mean)
//   4. Subdivide / weighted midpoint
//   5. Out-of-range source coerces to 0
//   6. Non-finite source skipped
//
// Run: node scripts/test/test_remap_keyform_vertices.mjs

import { remapKeyformVertices } from '../../src/lib/meshTopology.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1 — identity remap (every new vert = same old vert).
{
  const old = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
  const sources = new Map([[0, [0]], [1, [1]], [2, [2]], [3, [3]]]);
  const out = remapKeyformVertices(old, sources, 4, null);
  assert(out.length === 8, '1.identity length 8');
  for (let i = 0; i < 8; i++) {
    assert(approx(out[i], old[i]), `1.identity[${i}] = ${old[i]}`);
  }
}

// 2 — drop vert 0 (delete): survivors are 1,2,3 → new indices 0,1,2.
{
  const old = new Float32Array([100, 200, 10, 0, 10, 10, 0, 10]);
  const sources = new Map([[0, [1]], [1, [2]], [2, [3]]]);
  const out = remapKeyformVertices(old, sources, 3, null);
  assert(out.length === 6, '2.delete length 6');
  assert(approx(out[0], 10), '2.delete vert0.x → old vert1.x');
  assert(approx(out[1], 0),  '2.delete vert0.y → old vert1.y');
  assert(approx(out[2], 10), '2.delete vert1.x → old vert2.x');
  assert(approx(out[3], 10), '2.delete vert1.y → old vert2.y');
  assert(approx(out[4], 0),  '2.delete vert2.x → old vert3.x');
  assert(approx(out[5], 10), '2.delete vert2.y → old vert3.y');
}

// 3 — merge: 2 verts collapse into 1; uniform mean of their positions.
{
  const old = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
  // New vert 0 = avg(old 0, old 1); new vert 1 = old 2; new vert 2 = old 3.
  const sources = new Map([[0, [0, 1]], [1, [2]], [2, [3]]]);
  const out = remapKeyformVertices(old, sources, 3, null);
  assert(approx(out[0], 5), `3.merge mean x = 5 (got ${out[0]})`);
  assert(approx(out[1], 0), `3.merge mean y = 0 (got ${out[1]})`);
  assert(approx(out[2], 10), '3.merge vert1.x = 10');
  assert(approx(out[3], 10), '3.merge vert1.y = 10');
}

// 4 — subdivide weighted midpoint between 0 and 2 at t=0.25 (closer to 0).
{
  const old = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
  const sources = new Map([
    [0, [0]],
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [0, 2]], // midpoint
  ]);
  const weights = new Map([[4, [0.75, 0.25]]]); // 75% of vert 0, 25% of vert 2
  const out = remapKeyformVertices(old, sources, 5, weights);
  // Position = (0 * 0.75 + 10 * 0.25) / (0.75 + 0.25) = 2.5
  assert(approx(out[8],  2.5), `4.subdivide vert4.x = 2.5 (got ${out[8]})`);
  assert(approx(out[9],  2.5), `4.subdivide vert4.y = 2.5 (got ${out[9]})`);
}

// 5 — out-of-range source index: out coords stay 0.
{
  const old = new Float32Array([1, 2, 3, 4]); // 2 verts available
  const sources = new Map([[0, [5]]]); // sources[0] is out-of-bounds
  const out = remapKeyformVertices(old, sources, 1, null);
  assert(out.length === 2, '5.oob length 2');
  assert(out[0] === 0, '5.oob vert0.x → 0');
  assert(out[1] === 0, '5.oob vert0.y → 0');
}

// 6 — non-finite source skipped; remap from valid neighbour wins.
{
  const old = new Float32Array([NaN, 0, 10, 10]);
  // New vert 0 averages old 0 (NaN x) and old 1 (10, 10). NaN is dropped.
  const sources = new Map([[0, [0, 1]]]);
  const out = remapKeyformVertices(old, sources, 1, null);
  assert(approx(out[0], 10), `6.nan-skip vert0.x = 10 (got ${out[0]})`);
  assert(approx(out[1], 10), `6.nan-skip vert0.y = 10 (got ${out[1]})`);
}

// 7 — uniform-mean merge (no weights map) of 3 verts.
{
  const old = new Float32Array([0, 0, 6, 0, 0, 6]);
  const sources = new Map([[0, [0, 1, 2]]]);
  const out = remapKeyformVertices(old, sources, 1, null);
  assert(approx(out[0], 2), `7.uniform3 mean x = 2 (got ${out[0]})`);
  assert(approx(out[1], 2), `7.uniform3 mean y = 2 (got ${out[1]})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
