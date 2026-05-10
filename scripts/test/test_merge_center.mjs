// Toolset Plan Phase 4.A — Merge operator: At Center / At Cursor /
// At Last + Collapse modes (mergeByDistance has its own suite).
//
// Verifies: centroid math, vert dedup via union-find, triangle drop on
// collapse, UV averaging, edgeIndices preservation, vertexIndexRemap +
// vertexSources contract.
//
// Run: node scripts/test/test_merge_center.mjs

import {
  mergeAtCenter, mergeAtCursor, mergeAtLast, mergeCollapse,
} from '../../src/v3/operators/edit/merge.js';
import { buildVertexAdjacency } from '../../src/lib/proportionalEdit.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// Fixture: 4 verts forming a square + 2 tris.
//
//   3 ── 2
//   │  ╲ │
//   0 ── 1
//
function fixtureSquare() {
  return {
    vertices: [
      { x:  0, y:  0, restX:  0, restY:  0 },
      { x: 10, y:  0, restX: 10, restY:  0 },
      { x: 10, y: 10, restX: 10, restY: 10 },
      { x:  0, y: 10, restX:  0, restY: 10 },
    ],
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]),
    triangles: [[0,1,2], [0,2,3]],
    edgeIndices: new Set([0,1,2,3]),
  };
}

// ── mergeAtCenter ──────────────────────────────────────────────────

// 1. selection=[] → null
{
  const r = mergeAtCenter(fixtureSquare(), []);
  assert(r === null, 'mergeAtCenter empty selection → null');
}

// 2. selection=[0] (single vert) → null (need ≥2 to merge)
{
  const r = mergeAtCenter(fixtureSquare(), [0]);
  assert(r === null, 'mergeAtCenter 1-vert selection → null');
}

// 3. selection=[0,1] → both move to (5, 0); vert count drops to 3.
{
  const r = mergeAtCenter(fixtureSquare(), [0, 1]);
  assert(r !== null, 'mergeAtCenter 2-vert selection → result');
  assert(r.vertices.length === 3, 'mergeAtCenter [0,1] → 3 verts after merge');
  // Survivor index 0 = merged 0+1 → centroid (5, 0)
  assert(approx(r.vertices[0].x, 5) && approx(r.vertices[0].y, 0),
    'mergeAtCenter [0,1] → merged vert at (5, 0)');
  // Survivor index 1 = old vert 2 (passthrough), 2 = old vert 3
  assert(approx(r.vertices[1].x, 10) && approx(r.vertices[1].y, 10),
    'mergeAtCenter [0,1] → vert 2 unchanged');
  assert(approx(r.vertices[2].x, 0) && approx(r.vertices[2].y, 10),
    'mergeAtCenter [0,1] → vert 3 unchanged');
  // Triangle (0,1,2) collapses (a==b after rewrite) → dropped.
  // Triangle (0,2,3) → (0,1,2) survives.
  assert(r.triangles.length === 1, 'mergeAtCenter [0,1] → degenerate tri dropped');
  // vertexIndexRemap: 0→0, 1→0, 2→1, 3→2
  assert(r.vertexIndexRemap.get(0) === 0, 'remap 0 → 0');
  assert(r.vertexIndexRemap.get(1) === 0, 'remap 1 → 0 (merged with 0)');
  assert(r.vertexIndexRemap.get(2) === 1, 'remap 2 → 1');
  assert(r.vertexIndexRemap.get(3) === 2, 'remap 3 → 2');
  // vertexSources: 0 ← [0,1], 1 ← [2], 2 ← [3]
  assert(JSON.stringify(r.vertexSources.get(0)) === '[0,1]', 'sources[0] = [0,1]');
  assert(JSON.stringify(r.vertexSources.get(1)) === '[2]', 'sources[1] = [2]');
  assert(JSON.stringify(r.vertexSources.get(2)) === '[3]', 'sources[2] = [3]');
  // UV: merged UV averaged from (0,0) + (1,0) = (0.5, 0)
  assert(approx(r.uvs[0], 0.5) && approx(r.uvs[1], 0),
    'mergeAtCenter [0,1] → merged UV averaged');
  // edgeIndices: 0,1 → 0; 2 → 1; 3 → 2
  assert(r.edgeIndices.has(0) && r.edgeIndices.has(1) && r.edgeIndices.has(2),
    'edgeIndices remapped through merge');
  // retriangulated: false (merge preserves topology, doesn't rebuild)
  assert(r.retriangulated === false, 'mergeAtCenter sets retriangulated=false');
}

// 4. selection=[0,1,2,3] (all verts) → one merged vert at centroid (5,5)
{
  const r = mergeAtCenter(fixtureSquare(), [0,1,2,3]);
  assert(r !== null, 'mergeAtCenter [0,1,2,3] → result');
  assert(r.vertices.length === 1, 'mergeAtCenter all → 1 vert');
  assert(approx(r.vertices[0].x, 5) && approx(r.vertices[0].y, 5),
    'mergeAtCenter all → centroid (5, 5)');
  assert(r.triangles.length === 0, 'mergeAtCenter all → all tris collapse');
}

// ── mergeAtCursor ──────────────────────────────────────────────────

// 5. selection=[0,1] cursor=(100,100) → both move to cursor
{
  const r = mergeAtCursor(fixtureSquare(), [0, 1], { x: 100, y: 100 });
  assert(r !== null, 'mergeAtCursor → result');
  assert(approx(r.vertices[0].x, 100) && approx(r.vertices[0].y, 100),
    'mergeAtCursor [0,1] → at cursor');
}

// 6. selection=[0] (single vert) → translates to cursor (snap-to-cursor)
{
  const r = mergeAtCursor(fixtureSquare(), [0], { x: 50, y: 50 });
  assert(r !== null, 'mergeAtCursor 1-vert → result (snap-to-cursor)');
  assert(r.vertices.length === 4, 'mergeAtCursor 1-vert → no merge, 4 verts');
  assert(approx(r.vertices[0].x, 50) && approx(r.vertices[0].y, 50),
    'mergeAtCursor 1-vert → vert 0 at cursor');
  // Other verts unchanged.
  assert(approx(r.vertices[1].x, 10), 'mergeAtCursor 1-vert → vert 1 unchanged');
}

// 7. cursor=null → null
{
  const r = mergeAtCursor(fixtureSquare(), [0, 1], null);
  assert(r === null, 'mergeAtCursor null cursor → null');
}

// 8. cursor=NaN → null
{
  const r = mergeAtCursor(fixtureSquare(), [0, 1], { x: NaN, y: 0 });
  assert(r === null, 'mergeAtCursor NaN cursor → null');
}

// ── mergeAtLast ────────────────────────────────────────────────────

// 9. selection=[0,1,2] active=2 → all collapse to vert 2 at (10, 10)
{
  const r = mergeAtLast(fixtureSquare(), [0, 1, 2], 2);
  assert(r !== null, 'mergeAtLast → result');
  assert(r.vertices.length === 2, 'mergeAtLast → 2 verts (3 collapsed + 1 untouched)');
  // Merged survivor at (10, 10)
  assert(approx(r.vertices[0].x, 10) && approx(r.vertices[0].y, 10),
    'mergeAtLast → merged at active position');
}

// 10. active not in selection → null
{
  const r = mergeAtLast(fixtureSquare(), [0, 1], 2);
  assert(r === null, 'mergeAtLast active not in selection → null');
}

// 11. active out of range → null
{
  const r = mergeAtLast(fixtureSquare(), [0, 1, 2], 99);
  assert(r === null, 'mergeAtLast active OOR → null');
}

// ── mergeCollapse (graph-connected components) ─────────────────────

// 12. selection=[0,1,2,3] all connected → single component → one centroid
{
  const m = fixtureSquare();
  const adj = buildVertexAdjacency(m.triangles.flat(), m.vertices.length);
  const r = mergeCollapse(m, [0,1,2,3], adj);
  assert(r !== null, 'mergeCollapse all connected → result');
  assert(r.vertices.length === 1, 'mergeCollapse all → 1 vert');
  assert(approx(r.vertices[0].x, 5) && approx(r.vertices[0].y, 5),
    'mergeCollapse all → centroid (5,5)');
}

// 13. selection=[0,2] not directly adjacent but connected via tri (0,1,2)
//     and (0,2,3) — verts 0 and 2 share both tris so they ARE adjacent.
{
  const m = fixtureSquare();
  const adj = buildVertexAdjacency(m.triangles.flat(), m.vertices.length);
  const r = mergeCollapse(m, [0, 2], adj);
  assert(r !== null, 'mergeCollapse [0,2] adjacent → result');
  assert(r.vertices.length === 3, 'mergeCollapse [0,2] → 3 verts');
}

// 14. selection=[0] alone → null (no edge between selected verts)
{
  const m = fixtureSquare();
  const adj = buildVertexAdjacency(m.triangles.flat(), m.vertices.length);
  const r = mergeCollapse(m, [0], adj);
  assert(r === null, 'mergeCollapse 1-vert → null');
}

// 15. mergeCollapse with two disconnected pairs → two centroids.
//     Build a fresh fixture: two squares sharing no verts.
{
  const m = {
    vertices: [
      { x: 0, y: 0 },   { x: 10, y: 0 },   { x: 10, y: 10 },   { x: 0, y: 10 },
      { x: 100, y: 0 }, { x: 110, y: 0 },  { x: 110, y: 10 },  { x: 100, y: 10 },
    ],
    uvs: new Float32Array(16),
    triangles: [
      [0,1,2], [0,2,3],
      [4,5,6], [4,6,7],
    ],
    edgeIndices: null,
  };
  const adj = buildVertexAdjacency(m.triangles.flat(), m.vertices.length);
  const r = mergeCollapse(m, [0,1, 4,5], adj);
  assert(r !== null, 'mergeCollapse two pairs → result');
  // [0,1] merge to one vert; [4,5] merge to one vert. Verts 2,3,6,7 stay.
  // Total = 6 (was 8, lost 2 to merges).
  assert(r.vertices.length === 6, 'mergeCollapse two pairs → 6 verts');
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`merge: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
