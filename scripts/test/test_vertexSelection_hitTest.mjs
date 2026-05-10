// Toolset Phase 0.B — vertex hit-test + adjacency + shortest-path BFS.
//
// Run: node scripts/test/test_vertexSelection_hitTest.mjs

import {
  hitTestVertices,
  buildVertexAdjacency,
  shortestPathBetweenVertices,
} from '../../src/io/hitTest.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Test 1: hitTestVertices on flat array, exact hit ──

{
  const verts = [0, 0,  10, 0,  20, 0];
  assert(hitTestVertices(verts, 0, 0, 1) === 0, 'Test 1: exact hit on v0');
  assert(hitTestVertices(verts, 10, 0, 1) === 1, 'Test 1: exact hit on v1');
  assert(hitTestVertices(verts, 20, 0, 1) === 2, 'Test 1: exact hit on v2');
}

// ── Test 2: nearest-wins when multiple verts inside threshold ──

{
  const verts = [0, 0,  3, 0,  10, 0];
  // Click at (1, 0) → v0 (dist 1) vs v1 (dist 2). Nearest is v0.
  assert(hitTestVertices(verts, 1, 0, 5) === 0, 'Test 2: nearest wins');
  // Click at (2, 0) → v0 (dist 2) vs v1 (dist 1). v1 wins.
  assert(hitTestVertices(verts, 2, 0, 5) === 1, 'Test 2: closer wins');
  // Click at (1.5, 0) → both exactly 1.5 from v0 and v1. Lower index
  // wins on ties (deterministic).
  assert(hitTestVertices(verts, 1.5, 0, 5) === 0, 'Test 2: tie → lower index');
}

// ── Test 3: outside threshold returns -1 ──

{
  const verts = [0, 0,  10, 0];
  assert(hitTestVertices(verts, 5, 0, 1) === -1, 'Test 3: 5px from both, threshold 1 → miss');
  assert(hitTestVertices(verts, 5, 0, 5) === 0, 'Test 3: same click with threshold 5 → v0 (tie, lower index)');
}

// ── Test 4: object-shape array support ──

{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }];
  assert(hitTestVertices(verts, 100, 0, 1) === 1, 'Test 4: object-shape exact hit');
  assert(hitTestVertices(verts, 50, 50, 1) === 2, 'Test 4: object-shape v2');
  assert(hitTestVertices(verts, 200, 200, 5) === -1, 'Test 4: out of range → -1');
}

// ── Test 5: defensive (empty / threshold ≤ 0) ──

{
  assert(hitTestVertices([], 0, 0, 5) === -1, 'Test 5: empty verts → -1');
  assert(hitTestVertices([0, 0], 0, 0, 0) === -1, 'Test 5: threshold=0 → -1');
  assert(hitTestVertices([0, 0], 0, 0, -1) === -1, 'Test 5: threshold<0 → -1');
  assert(hitTestVertices(null, 0, 0, 5) === -1, 'Test 5: null verts → -1');
}

// ── Test 6: buildVertexAdjacency on a single triangle ──

{
  // Triangle (0, 1, 2) → edges (0-1), (1-2), (2-0).
  const adj = buildVertexAdjacency([0, 1, 2], 3);
  assert(adj.size === 3, 'Test 6: 3 verts get adjacency entries');
  assert(adj.get(0).size === 2 && adj.get(0).has(1) && adj.get(0).has(2),
    'Test 6: v0 connected to v1 and v2');
  assert(adj.get(1).has(0) && adj.get(1).has(2),
    'Test 6: v1 connected to v0 and v2');
  assert(adj.get(2).has(0) && adj.get(2).has(1),
    'Test 6: v2 connected to v0 and v1');
}

// ── Test 7: buildVertexAdjacency on a quad (two tris sharing an edge) ─

{
  // Verts 0,1,2,3 forming a quad. Tris: (0,1,2), (1,3,2).
  const adj = buildVertexAdjacency([0, 1, 2,  1, 3, 2], 4);
  assert(adj.get(0).size === 2 && adj.get(0).has(1) && adj.get(0).has(2),
    'Test 7: corner v0 connects to v1, v2');
  assert(adj.get(1).size === 3 && adj.get(1).has(0) && adj.get(1).has(2) && adj.get(1).has(3),
    'Test 7: shared v1 connects to v0, v2, v3');
  assert(adj.get(2).size === 3 && adj.get(2).has(0) && adj.get(2).has(1) && adj.get(2).has(3),
    'Test 7: shared v2 connects to v0, v1, v3');
  assert(adj.get(3).size === 2 && adj.get(3).has(1) && adj.get(3).has(2),
    'Test 7: corner v3 connects to v1, v2');
}

// ── Test 8: shortestPathBetweenVertices straight line ──

{
  // Path graph v0 - v1 - v2 - v3 (each pair shares an edge via degenerate tris):
  const adj = buildVertexAdjacency([0, 1, 0,  1, 2, 1,  2, 3, 2], 4);
  const path = shortestPathBetweenVertices(adj, 0, 3);
  assert(path && path.length === 4 && path[0] === 0 && path[3] === 3,
    `Test 8: path 0→3 has 4 verts (got ${JSON.stringify(path)})`);
  assert(path[1] === 1 && path[2] === 2, 'Test 8: path goes 0-1-2-3');
}

// ── Test 9: BFS picks shortest of two routes ──

{
  // Two paths from v0 to v4:
  //   Direct chain (length 4): 0 - 1 - 2 - 3 - 4
  //   Plus a shortcut (length 2): 0 - 5 - 4
  // Triangulation: degenerate triangles that create just the edges we
  // want, using v6 as a dummy vertex shared in each triangle so we get
  // pairwise edges between consecutive chain verts only.
  const adj = new Map([
    [0, new Set([1, 5])],
    [1, new Set([0, 2])],
    [2, new Set([1, 3])],
    [3, new Set([2, 4])],
    [4, new Set([3, 5])],
    [5, new Set([0, 4])],
  ]);
  const path = shortestPathBetweenVertices(adj, 0, 4);
  assert(path && path.length === 3 && path[0] === 0 && path[2] === 4,
    `Test 9: BFS picks length-2 shortcut (got ${JSON.stringify(path)})`);
  assert(path[1] === 5, 'Test 9: shortcut goes through v5');
}

// ── Test 10: same start/end returns single-vertex path ──

{
  const adj = buildVertexAdjacency([0, 1, 2], 3);
  const path = shortestPathBetweenVertices(adj, 1, 1);
  assert(path && path.length === 1 && path[0] === 1, 'Test 10: from===to → [from]');
}

// ── Test 11: disconnected components return null ──

{
  // Two disjoint triangles: (0,1,2) and (3,4,5). 0 → 5 is unreachable.
  const adj = buildVertexAdjacency([0, 1, 2,  3, 4, 5], 6);
  assert(shortestPathBetweenVertices(adj, 0, 5) === null,
    'Test 11: unreachable returns null');
}

// ── Test 12: missing endpoint in graph returns null ──

{
  const adj = buildVertexAdjacency([0, 1, 2], 3);
  assert(shortestPathBetweenVertices(adj, 0, 99) === null,
    'Test 12: target not in graph → null');
  assert(shortestPathBetweenVertices(adj, 99, 0) === null,
    'Test 12: source not in graph → null');
}

console.log(`vertexSelection_hitTest: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
