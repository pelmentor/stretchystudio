// Edit Mode — Delete Vertices op.
//
// Verifies: middle-vert delete drops every incident triangle + leaves
// holes (no fill); boundary-vert delete; multi-vert delete; refuses to
// drop below the 3-vert floor; refuses when every triangle is incident.
//
// Run: node scripts/test/test_deleteVertsEdit.mjs

import { deleteVertices } from '../../src/v3/operators/edit/deleteVerts.js';

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

// Helper — build a 4-vert square mesh with 2 triangles.
//   3 ─── 2
//   │ ╲   │
//   │   ╲ │
//   0 ─── 1
function squareMesh() {
  return {
    vertices: [
      { x: 0, y: 0, restX: 0, restY: 0 },
      { x: 10, y: 0, restX: 10, restY: 0 },
      { x: 10, y: 10, restX: 10, restY: 10 },
      { x: 0, y: 10, restX: 0, restY: 10 },
    ],
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]),
    triangles: [[0, 1, 2], [0, 2, 3]],
  };
}

// Helper — build a hexagonal fan mesh with center vert + 6 outer verts.
//
//     2 ─ 1
//    ╱ ╲ ╱ ╲
//   3 ── 0 ── 6
//    ╲ ╱ ╲ ╱
//     4 ─ 5
function hexFanMesh() {
  return {
    vertices: [
      { x: 5, y: 5 },   // 0 — center
      { x: 7, y: 2 },   // 1
      { x: 3, y: 2 },   // 2
      { x: 1, y: 5 },   // 3
      { x: 3, y: 8 },   // 4
      { x: 7, y: 8 },   // 5
      { x: 9, y: 5 },   // 6
    ],
    uvs: new Float32Array([
      0.5, 0.5,
      0.7, 0.2,
      0.3, 0.2,
      0.1, 0.5,
      0.3, 0.8,
      0.7, 0.8,
      0.9, 0.5,
    ]),
    triangles: [
      [0, 1, 2], [0, 2, 3], [0, 3, 4],
      [0, 4, 5], [0, 5, 6], [0, 6, 1],
    ],
  };
}

// ── 1. Center-vert delete on a hex fan: every triangle is incident ──
//    Result: all 6 triangles dropped → null (no surviving tris).
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([0]));
  eq(result, null,
    '1: center vert delete drops all incident tris → null (no surviving tris)');
}

// ── 2. Single-corner delete on a square ──
//    Verts 0,1,2,3 — drop vert 0. Triangle [0,1,2] and [0,2,3] both
//    incident → both dropped. 3 verts (1,2,3) survive but with no
//    triangles → null.
{
  const mesh = squareMesh();
  const result = deleteVertices(mesh, new Set([0]));
  eq(result, null,
    '2: square corner delete drops both tris → null (no surviving tris)');
}

// ── 3. Hex fan, delete one outer vert (not the center) ──
//    Delete vert 1. Triangles incident: [0,1,2] and [0,6,1]. Both dropped.
//    Surviving tris: [0,2,3], [0,3,4], [0,4,5], [0,5,6] = 4 tris.
//    Surviving verts: 0, 2, 3, 4, 5, 6 = 6 verts (re-indexed to 0..5).
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([1]));
  assert(result != null, '3: hex fan outer delete returns result');
  eq(result.vertices.length, 6, '3: 6 verts survive (was 7, dropped 1)');
  eq(result.triangles.length, 4, '3: 4 tris survive (was 6, dropped 2 incident)');
  // Confirm the surviving triangles reference the new indices, not old.
  for (const t of result.triangles) {
    for (const v of t) {
      assert(v >= 0 && v < 6, `3: tri index ${v} in valid range`);
    }
  }
  // Confirm vertexIndexRemap maps old 1 → null.
  eq(result.vertexIndexRemap.get(1), null, '3: deleted vert maps to null');
  // Old 0 (center) survives — first survivor → new index 0.
  eq(result.vertexIndexRemap.get(0), 0, '3: center vert (old 0) remaps to new 0');
  // Old 6 (last survivor) → new 5.
  eq(result.vertexIndexRemap.get(6), 5, '3: old vert 6 remaps to new 5');
}

// ── 4. UVs compact correctly ──
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([1]));
  assert(result != null, '4: precondition');
  // UVs survive index-compacted. Old vert 6 had UV (0.9, 0.5); new vert 5
  // should have the same UV. Float32Array storage loses a few ulps so
  // compare with a small epsilon.
  assert(Math.abs(result.uvs[5 * 2 + 0] - 0.9) < 1e-6,
    '4: UV X carried over for compacted index');
  assert(Math.abs(result.uvs[5 * 2 + 1] - 0.5) < 1e-6,
    '4: UV Y carried over for compacted index');
}

// ── 5. Empty selection → null no-op ──
{
  const mesh = squareMesh();
  const result = deleteVertices(mesh, new Set());
  eq(result, null, '5: empty selection → null');
}

// ── 6. Invalid indices (out of range, non-integer) are filtered ──
{
  const mesh = squareMesh();
  const result = deleteVertices(mesh, new Set([-1, 99, 1.5, 'foo']));
  eq(result, null, '6: all-invalid selection treated as empty → null');
}

// ── 7. Refuses to drop below 3-vert floor ──
//    Square has 4 verts; deleting 2 leaves 2 verts < 3 → null.
{
  const mesh = squareMesh();
  const result = deleteVertices(mesh, new Set([0, 1]));
  eq(result, null,
    '7: delete that leaves <3 verts refused → null');
}

// ── 8. Multi-vert delete on hex fan ──
//    Delete verts 1 and 4 (opposite outer verts).
//    Incident triangles dropped: [0,1,2], [0,6,1], [0,3,4], [0,4,5] = 4 dropped.
//    Surviving: [0,2,3], [0,5,6] = 2 tris.
//    Surviving verts: 0, 2, 3, 5, 6 = 5 verts.
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([1, 4]));
  assert(result != null, '8: multi-vert delete returns result');
  eq(result.vertices.length, 5, '8: 5 verts survive (was 7, dropped 2)');
  eq(result.triangles.length, 2, '8: 2 tris survive (was 6, dropped 4 incident)');
  // Verify remap: 1 and 4 → null, others map in compacted order.
  eq(result.vertexIndexRemap.get(1), null, '8: vert 1 deleted');
  eq(result.vertexIndexRemap.get(4), null, '8: vert 4 deleted');
  eq(result.vertexIndexRemap.get(0), 0, '8: vert 0 → 0');
  eq(result.vertexIndexRemap.get(2), 1, '8: vert 2 → 1');
  eq(result.vertexIndexRemap.get(3), 2, '8: vert 3 → 2');
  eq(result.vertexIndexRemap.get(5), 3, '8: vert 5 → 3');
  eq(result.vertexIndexRemap.get(6), 4, '8: vert 6 → 4');
}

// ── 9. retriangulated: false sentinel ──
//    Distinguishes delete (raw drop) from dissolve (ear-clip refill).
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([1]));
  eq(result.retriangulated, false,
    '9: delete result marked retriangulated:false (dissolve marks true)');
}

// ── 10. edgeIndices remap ──
{
  const mesh = hexFanMesh();
  mesh.edgeIndices = new Set([1, 2, 3, 6]);
  const result = deleteVertices(mesh, new Set([1]));
  assert(result != null, '10: precondition');
  // Old vert 1 deleted → its edge entry dropped.
  // Old 2 → new 1, old 3 → new 2, old 6 → new 5.
  assert(!result.edgeIndices.has(0), '10: deleted vert not in edgeIndices');
  assert(result.edgeIndices.has(1), '10: old vert 2 → new 1 preserved as edge');
  assert(result.edgeIndices.has(2), '10: old vert 3 → new 2 preserved as edge');
  assert(result.edgeIndices.has(5), '10: old vert 6 → new 5 preserved as edge');
  eq(result.edgeIndices.size, 3, '10: 3 edge entries survive (was 4)');
}

// ── 11. vertexSources reverse-map populated ──
//    Each new index points to the original old index it came from
//    (single-element array; delete doesn't merge verts).
{
  const mesh = hexFanMesh();
  const result = deleteVertices(mesh, new Set([1, 4]));
  assert(result != null, '11: precondition');
  for (const [newIdx, oldIndices] of result.vertexSources) {
    eq(oldIndices.length, 1,
      `11: vertexSources[${newIdx}] has exactly one source (delete doesn't merge)`);
  }
}

console.log(`\ndeleteVertsEdit: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
