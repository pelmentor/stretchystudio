// GAP-015 Phase A — proportional-edit helper unit tests.
//
// Run: node scripts/test/test_proportionalEdit.mjs

import {
  applyFalloff,
  buildVertexAdjacency,
  getOrBuildAdjacency,
  reachableFrom,
  computeProportionalWeights,
  nextFalloff,
  FALLOFF_CYCLE,
} from '../../src/lib/proportionalEdit.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// ── applyFalloff: rim and centre values per curve ───────────────────
{
  // Centre (t=0): every curve except 'random' returns 1.
  for (const k of FALLOFF_CYCLE) {
    if (k === 'random') continue;
    assert(close(applyFalloff(0, k), 1), `falloff ${k}: centre weight = 1`);
  }
  // Rim (t=1): every curve except 'constant' returns 0.
  for (const k of FALLOFF_CYCLE) {
    if (k === 'constant' || k === 'random') continue;
    assert(applyFalloff(1, k) === 0, `falloff ${k}: rim weight = 0`);
  }
  // Constant stays at 1 inside the radius and 0 at/past the rim.
  assert(applyFalloff(0.999, 'constant') === 1, 'constant: 1 inside rim');
  assert(applyFalloff(1, 'constant') === 0, 'constant: 0 at rim');
  // Out-of-range t.
  assert(applyFalloff(2, 'smooth') === 0, 'smooth: t=2 -> 0');
  assert(applyFalloff(NaN, 'smooth') === 0, 'smooth: NaN -> 0');
  assert(applyFalloff(-0.5, 'smooth') === 1, 'smooth: t<0 clamps to centre');
  // Smooth midpoint at t=0.5 → 0.5 (3·0.25 - 2·0.125 = 0.5)
  assert(close(applyFalloff(0.5, 'smooth'), 0.5),
    'smooth: t=0.5 -> 0.5');
  // Linear curve check.
  assert(close(applyFalloff(0.25, 'linear'), 0.75), 'linear: 0.25 -> 0.75');
  // Sphere curve at t=0.5 → sqrt(0.75)
  assert(close(applyFalloff(0.5, 'sphere'), Math.sqrt(0.75), 1e-9),
    'sphere: t=0.5 -> sqrt(0.75)');
  // Root curve at t=0.5 → sqrt(0.5)
  assert(close(applyFalloff(0.5, 'root'), Math.sqrt(0.5), 1e-9),
    'root: t=0.5 -> sqrt(0.5)');
  // Sharp curve at t=0.5 → 0.25
  assert(close(applyFalloff(0.5, 'sharp'), 0.25), 'sharp: t=0.5 -> 0.25');
}

// ── buildVertexAdjacency: triangle pairs ────────────────────────────
{
  // 4 verts forming two triangles:  (0,1,2) and (0,2,3)
  const indices = [0, 1, 2, 0, 2, 3];
  const adj = buildVertexAdjacency(indices, 4);
  assert(adj.length === 4, 'adj: 4 entries');
  assert(adj[0].has(1) && adj[0].has(2) && adj[0].has(3), 'adj[0] = {1,2,3}');
  assert(adj[1].has(0) && adj[1].has(2) && !adj[1].has(3), 'adj[1] = {0,2}');
  assert(adj[2].has(0) && adj[2].has(1) && adj[2].has(3), 'adj[2] = {0,1,3}');
  assert(adj[3].has(0) && adj[3].has(2) && !adj[3].has(1), 'adj[3] = {0,2}');
  assert(!adj[0].has(0) && !adj[1].has(1), 'adj: no self-loops');
}

// ── reachableFrom: BFS over disconnected components ─────────────────
{
  // Two components: {0,1,2} and {3,4}
  const adj = buildVertexAdjacency([0, 1, 2, 3, 4, 3], 5);
  const r0 = reachableFrom(adj, 0);
  assert(r0.has(0) && r0.has(1) && r0.has(2), 'reachable(0): 0,1,2');
  assert(!r0.has(3) && !r0.has(4), 'reachable(0): excludes other component');
  const r3 = reachableFrom(adj, 3);
  assert(r3.has(3) && r3.has(4), 'reachable(3): 3,4');
  assert(!r3.has(0), 'reachable(3): excludes other component');
  // Out of range
  const rNo = reachableFrom(adj, 99);
  assert(rNo.size === 0, 'reachable(99): empty');
}

// ── computeProportionalWeights: monotonic falloff with distance ─────
{
  // Vertices on a horizontal line: x = 0, 1, 2, 3, 4, 5
  const verts = [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 0 }));
  const w = computeProportionalWeights({
    vertices: verts,
    originIdx: 0,
    radius: 4,
    falloff: 'linear',
  });
  assert(w[0] === 1, 'origin weight = 1');
  // d=1 → t=0.25 → 0.75; d=2 → 0.5; d=3 → 0.25; d=4 → 0 (rim);
  // d=5 → outside radius → 0
  assert(close(w[1], 0.75), 'linear d=1 -> 0.75');
  assert(close(w[2], 0.5),  'linear d=2 -> 0.5');
  assert(close(w[3], 0.25), 'linear d=3 -> 0.25');
  assert(w[4] === 0, 'linear at rim -> 0');
  assert(w[5] === 0, 'beyond radius -> 0');
}

// ── computeProportionalWeights: connected-only filters out disconnected ──
{
  // 4 verts arranged so 0 and 2 are within Euclidean range of origin (0)
  // but 2 is in a separate triangulated component.
  // verts: 0@(0,0), 1@(1,0), 2@(0.5,0.5), 3@(10,10)
  const verts = [
    { x: 0,   y: 0   },
    { x: 1,   y: 0   },
    { x: 0.5, y: 0.5 },
    { x: 10,  y: 10  },
  ];
  // Triangle (0,1,3) — vertex 2 is NOT in any triangle (isolated)
  const adj = buildVertexAdjacency([0, 1, 3], 4);
  const wEuclid = computeProportionalWeights({
    vertices: verts, originIdx: 0, radius: 5, falloff: 'linear',
    connectedOnly: false,
  });
  assert(wEuclid[2] > 0, 'no connectedOnly: vertex 2 weighted by Euclid');
  const wConn = computeProportionalWeights({
    vertices: verts, originIdx: 0, radius: 5, falloff: 'linear',
    connectedOnly: true, adjacency: adj,
  });
  assert(wConn[2] === 0, 'connectedOnly: isolated vertex 2 zeroed');
  assert(wConn[1] > 0, 'connectedOnly: connected vertex 1 still weighted');
}

// ── computeProportionalWeights: empty / zero-radius edge cases ──────
{
  const verts = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  const w0 = computeProportionalWeights({
    vertices: verts, originIdx: 0, radius: 0, falloff: 'linear',
  });
  assert(w0[0] === 1 && w0[1] === 0, 'radius=0: only origin');
  const wNeg = computeProportionalWeights({
    vertices: verts, originIdx: -1, radius: 5, falloff: 'linear',
  });
  assert(wNeg[0] === 0 && wNeg[1] === 0, 'invalid origin: all zero');
  // connectedOnly without adjacency = origin only
  const wNoAdj = computeProportionalWeights({
    vertices: verts, originIdx: 0, radius: 5, falloff: 'linear',
    connectedOnly: true, adjacency: null,
  });
  assert(wNoAdj[0] === 1 && wNoAdj[1] === 0,
    'connectedOnly without adjacency: origin only (graceful degrade)');
}

// ── getOrBuildAdjacency: cache-by-reference (Phase B) ──────────────
{
  const indices = [0, 1, 2, 0, 2, 3];
  const a1 = getOrBuildAdjacency(indices, 4);
  const a2 = getOrBuildAdjacency(indices, 4);
  assert(a1 === a2, 'getOrBuildAdjacency: same indices ref → same adjacency object');

  // Distinct array (different reference) → fresh build.
  const indicesCopy = [0, 1, 2, 0, 2, 3];
  const a3 = getOrBuildAdjacency(indicesCopy, 4);
  assert(a3 !== a1, 'getOrBuildAdjacency: distinct indices ref → fresh adjacency');

  // TypedArray works (it's still an object key for WeakMap).
  const u16 = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const aU = getOrBuildAdjacency(u16, 4);
  const aU2 = getOrBuildAdjacency(u16, 4);
  assert(aU === aU2, 'getOrBuildAdjacency: TypedArray cache hit');
}

// ── nextFalloff cycles ─────────────────────────────────────────────
{
  assert(nextFalloff('smooth') === 'sphere', 'cycle: smooth -> sphere');
  assert(nextFalloff(FALLOFF_CYCLE[FALLOFF_CYCLE.length - 1]) === FALLOFF_CYCLE[0],
    'cycle: last -> first (wraps)');
  assert(nextFalloff('zzz') === 'smooth', 'cycle: unknown -> smooth');
}

console.log(`\nproportionalEdit: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
