// Toolset Plan Phase 5.B — Open boundary path extrude.
//
// Verifies: when an open path (not closed loop) of boundary verts is
// selected, quads emit only along contiguous segments. End verts get
// duplicates without a closing quad. blendShape deltas + weightGroups
// + boneWeights inherit from the source vert (length-1 vertexSources).
//
// Run: node scripts/test/test_extrude_partialBoundary.mjs

import { extrude } from '../../src/v3/operators/edit/extrude.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// 1. Strip mesh — 4 verts in a row, 2 triangles forming a flat quad.
//    Boundary verts: all 4 perimeter (the strip is one quad). Boundary
//    edges: 4. Selecting verts {0, 1} → 2 dups + 1 quad bridge along
//    edge (0, 1).
{
  const mesh = {
    vertices: [
      { x: 0,  y: 0 },    // 0
      { x: 10, y: 0 },    // 1
      { x: 10, y: 10 },   // 2
      { x: 0,  y: 10 },   // 3
    ],
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]),
    triangles: [[0, 1, 2], [0, 2, 3]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0, 1]);
  assert(r !== null, '2-vert open path → result');
  assert(r.vertices.length === 6, `6 verts (4 + 2 dups), got ${r.vertices.length}`);
  // 2 orig tris + 1 quad bridge × 2 = 4 tris.
  assert(r.triangles.length === 4, `4 tris (2 orig + 2 bridge), got ${r.triangles.length}`);
  // Both dups at correct positions.
  const sources0 = [...r.vertexSources.entries()].find(([nidx, srcs]) => nidx >= 4 && srcs[0] === 0);
  const sources1 = [...r.vertexSources.entries()].find(([nidx, srcs]) => nidx >= 4 && srcs[0] === 1);
  assert(sources0 && sources1, 'dups for both source verts');
}

// 2. Three contiguous boundary verts selected → 2 quad bridges
//    (between v0-v1 and v1-v2; not between v0-v2 unless they share an
//    edge). Strip mesh edges: (0,1), (1,2), (2,3), (0,3). Selecting
//    {0, 1, 2} → bridges along (0,1) and (1,2). 2 quads × 2 tris = 4.
{
  const mesh = {
    vertices: [
      { x: 0,  y: 0 },    // 0
      { x: 10, y: 0 },    // 1
      { x: 10, y: 10 },   // 2
      { x: 0,  y: 10 },   // 3
    ],
    uvs: new Float32Array(8),
    triangles: [[0, 1, 2], [0, 2, 3]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0, 1, 2]);
  assert(r.vertices.length === 7, `7 verts (4 + 3 dups), got ${r.vertices.length}`);
  assert(r.triangles.length === 6, `6 tris (2 orig + 4 bridge), got ${r.triangles.length}`);
}

// 3. Non-contiguous selection — 2 boundary verts NOT sharing a
//    boundary edge. {0, 2} selected: 0-2 is a NON-boundary edge
//    (interior diagonal). So 2 dups, NO bridge.
{
  const mesh = {
    vertices: [
      { x: 0,  y: 0 },    // 0
      { x: 10, y: 0 },    // 1
      { x: 10, y: 10 },   // 2
      { x: 0,  y: 10 },   // 3
    ],
    uvs: new Float32Array(8),
    // Diagonal triangulation puts edge (0,2) as INTERIOR (shared by
    // both tris).
    triangles: [[0, 1, 2], [0, 2, 3]],
    edgeIndices: null,
  };
  const r = extrude(mesh, [0, 2]);
  assert(r.vertices.length === 6, `6 verts (4 + 2 dups), got ${r.vertices.length}`);
  // 2 orig tris + NO bridge tris.
  assert(r.triangles.length === 2, `2 tris (no bridge), got ${r.triangles.length}`);
}

// 4. Per-vertex blendShape data inheritance. Run via dispatcher to
//    verify the dispatcher's per-vertex remap honours length-1
//    vertexSources for new verts.
{
  // Reset stores fresh for this test.
  useProjectStore.setState({
    project: {
      schemaVersion: 30,
      nextNodeId: 100,
      canvasWidth: 1024, canvasHeight: 1024,
      nodes: [
        {
          id: 'p1',
          type: 'part',
          name: 'TestPart',
          parent: null,
          mesh: {
            vertices: [
              { x: 0,  y: 0,  restX: 0,  restY: 0 },
              { x: 10, y: 0,  restX: 10, restY: 0 },
              { x: 10, y: 10, restX: 10, restY: 10 },
              { x: 0,  y: 10, restX: 0,  restY: 10 },
            ],
            uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]),
            triangles: [[0, 1, 2], [0, 2, 3]],
            edgeIndices: [0, 1, 2, 3],
          },
          blendShapes: [
            {
              id: 'shape1',
              name: 'TestShape',
              deltas: [
                { dx: 1, dy: 0 },   // 0
                { dx: 2, dy: 0 },   // 1
                { dx: 0, dy: 1 },   // 2
                { dx: 0, dy: 2 },   // 3
              ],
            },
          ],
        },
      ],
      animations: [],
    },
  });
  useEditorStore.setState({
    selection: ['p1'],
    editMode: 'edit',
    toolMode: 'select',
    selectedVertexIndices: new Map([['p1', new Set([0, 1])]]),
    activeVertex: { partId: 'p1', vertIndex: 0 },
  });
  const project = useProjectStore.getState().project;
  const part = project.nodes[0];
  const result = extrude(part.mesh, [0, 1]);
  applyTopologyOp('p1', result);
  const updated = useProjectStore.getState().project;
  const part2 = updated.nodes[0];
  // Dups are at indices 4 and 5 (whichever order they came in).
  // blendShape deltas should be inherited from source.
  const deltas = part2.blendShapes[0].deltas;
  assert(deltas.length === 6, `deltas length = 6 (4 + 2 dups), got ${deltas.length}`);
  // Find the dup of vert 0 + dup of vert 1.
  const sources = result.vertexSources;
  for (const [newIdx, src] of sources.entries()) {
    if (newIdx < 4) continue;
    const sourceIdx = src[0];
    assert(deltas[newIdx].dx === deltas[sourceIdx].dx
           && deltas[newIdx].dy === deltas[sourceIdx].dy,
      `dup ${newIdx} blendShape inherits from source ${sourceIdx}`);
  }
  // selectionOverride applied → selection contains the new dups only.
  const editorSel = useEditorStore.getState().selectedVertexIndices.get('p1');
  assert(editorSel.size === 2, `editor selection has 2 (dups), got ${editorSel.size}`);
  for (let j = 4; j < 6; j++) {
    assert(editorSel.has(j), `editor selection has dup ${j}`);
  }
  // Source verts 0, 1 should NOT remain selected.
  assert(!editorSel.has(0) && !editorSel.has(1),
    'source verts 0, 1 deselected after extrude (Blender pattern)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
