// Toolset Plan Phase 4.D — Selection vertexIndexRemap dispatcher.
//
// Verifies the applyTopologyOp helper: it must
//   - rewrite mesh.vertices / .uvs / .triangles / .edgeIndices
//   - rebuild blendShape deltas (averaging per vertexSources)
//   - rebuild weightGroups (averaging per vertexSources)
//   - remap selectedVertexIndices via vertexIndexRemap (drop nulls,
//     keep survivors, GROW with new midpoints whose all sources were
//     in the prior selection)
//   - clear activeVertex when its mapping doesn't survive
//
// Run: node scripts/test/test_topology_op_selection_remap.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { mergeAtCenter } from '../../src/v3/operators/edit/merge.js';
import { dissolveVertices } from '../../src/v3/operators/edit/dissolve.js';
import { subdivide } from '../../src/v3/operators/edit/subdivide.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

const PART_ID = 'p1';

function setupSquareMesh() {
  // Reset stores.
  useProjectStore.getState().resetProject();
  useEditorStore.getState().clearAllVertexSelections();

  // Inject a part with a 4-vert square mesh.
  useProjectStore.getState().updateProject((proj) => {
    proj.nodes = [
      {
        id: PART_ID,
        type: 'part',
        name: 'square',
        parent: null,
        visible: true,
        imageWidth: 100,
        imageHeight: 100,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        mesh: {
          vertices: [
            { x:  0, y:  0, restX:  0, restY:  0 },
            { x: 10, y:  0, restX: 10, restY:  0 },
            { x: 10, y: 10, restX: 10, restY: 10 },
            { x:  0, y: 10, restX:  0, restY: 10 },
          ],
          uvs: [0,0, 1,0, 1,1, 0,1],
          triangles: [[0,1,2], [0,2,3]],
          edgeIndices: new Set([0,1,2,3]),
        },
        blendShapes: [],
      },
    ];
  });
}

// 1. Merge survivors stay selected via vertexIndexRemap.
{
  setupSquareMesh();
  // Pre-select verts 0, 1, 2, 3.
  useEditorStore.getState().setVertexSelectionForPart(PART_ID, new Set([0, 1, 2, 3]));
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = mergeAtCenter(mesh, [0, 1]);
  assert(result !== null, 'pre-condition: mergeAtCenter returns result');
  applyTopologyOp(PART_ID, result);

  // Survivors after merge: 0,1 → newIdx 0; 2 → 1; 3 → 2.
  const newSel = useEditorStore.getState().selectedVertexIndices.get(PART_ID);
  assert(newSel !== undefined, 'selection survived');
  assert(newSel.size === 3, `selection has 3 verts (was 4, two collapsed), got ${newSel.size}`);
  assert(newSel.has(0) && newSel.has(1) && newSel.has(2),
    'selection contains remapped 0+1+2');
}

// 2. Subdivide grows selection — new midpoints with both endpoints
//    selected join the post-op selection.
{
  setupSquareMesh();
  // Select all 4 verts → cuts=1 should subdivide both tris.
  useEditorStore.getState().setVertexSelectionForPart(PART_ID, new Set([0, 1, 2, 3]));
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = subdivide(mesh, [0, 1, 2, 3], { cuts: 1, smoothness: 0 });
  assert(result !== null, 'pre-condition: subdivide returns result');
  applyTopologyOp(PART_ID, result);

  // After subdivide: original 4 verts kept, plus new midpoints. Every
  // midpoint has both sources in the prior selection (since all 4 were
  // selected) → all midpoints join the selection.
  const newSel = useEditorStore.getState().selectedVertexIndices.get(PART_ID);
  const mesh2 = useProjectStore.getState().project.nodes[0].mesh;
  assert(newSel.size === mesh2.vertices.length,
    `subdivide selected all → grew: ${newSel.size} of ${mesh2.vertices.length}`);
}

// 3. Subdivide with PARTIAL selection — new midpoints with only one
//    selected endpoint do NOT join.
{
  setupSquareMesh();
  // Select verts 0, 1 (one edge). subdivide → tri (0,1,2) has 2/3 selected
  // (subdivides), tri (0,2,3) has 1/3 selected (doesn't subdivide).
  useEditorStore.getState().setVertexSelectionForPart(PART_ID, new Set([0, 1]));
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = subdivide(mesh, [0, 1], { cuts: 1, smoothness: 0 });
  assert(result !== null, 'pre-condition: subdivide partial returns result');
  applyTopologyOp(PART_ID, result);

  const newSel = useEditorStore.getState().selectedVertexIndices.get(PART_ID);
  // 0 and 1 still selected; midpoint of (0,1) joins (both selected);
  // midpoints of (1,2) and (2,0) do NOT join (1-of-2 selected).
  assert(newSel.has(0), 'subdivide partial: 0 stays selected');
  assert(newSel.has(1), 'subdivide partial: 1 stays selected');
  // Verify only ONE midpoint joined — total selected = 3 (0,1,midOf(0,1)).
  assert(newSel.size === 3,
    `subdivide partial selected: 3 (orig 2 + 1 midpoint), got ${newSel.size}`);
}

// 4. Dissolve — survivors keep selection, dissolved verts drop.
{
  setupSquareMesh();
  // Add a centre vert + tris around it so dissolve has a refill case.
  useProjectStore.getState().updateProject((proj) => {
    const n = proj.nodes[0];
    n.mesh.vertices.push({ x: 5, y: 5, restX: 5, restY: 5 });
    n.mesh.uvs = [0,0, 1,0, 1,1, 0,1, 0.5, 0.5];
    n.mesh.triangles = [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ];
  });
  // Pre-select verts 0, 4 (corner + centre).
  useEditorStore.getState().setVertexSelectionForPart(PART_ID, new Set([0, 4]));
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = dissolveVertices(mesh, [4]);
  assert(result !== null, 'pre-condition: dissolve returns result');
  applyTopologyOp(PART_ID, result);

  const newSel = useEditorStore.getState().selectedVertexIndices.get(PART_ID);
  // Vert 4 dissolved → drop. Vert 0 → 0, kept.
  assert(newSel.size === 1, `dissolve: 1 vert remains selected, got ${newSel.size}`);
  assert(newSel.has(0), 'dissolve: vert 0 still selected');
}

// 5. activeVertex remap — when active vert is dissolved, activeVertex clears.
{
  setupSquareMesh();
  useProjectStore.getState().updateProject((proj) => {
    const n = proj.nodes[0];
    n.mesh.vertices.push({ x: 5, y: 5, restX: 5, restY: 5 });
    n.mesh.uvs = [0,0, 1,0, 1,1, 0,1, 0.5, 0.5];
    n.mesh.triangles = [
      [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4],
    ];
  });
  useEditorStore.getState().selectVertex(PART_ID, 4, false);
  // active = (PART_ID, 4) by selectVertex semantics
  const editorState = useEditorStore.getState();
  assert(editorState.activeVertex?.vertIndex === 4, 'pre: active = vert 4');
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = dissolveVertices(mesh, [4]);
  applyTopologyOp(PART_ID, result);
  // After dissolve, active should be cleared (4 → null in remap).
  const after = useEditorStore.getState();
  assert(after.activeVertex === null || after.activeVertex.vertIndex !== 4,
    'dissolve: active vert 4 cleared');
}

// 6. blendShape deltas remapped via vertexSources averaging.
//    Pre-merge: vert 0 has delta {dx:1, dy:0}; vert 1 has {dx:3, dy:0}.
//    After merge of [0,1]: new vert 0 should have averaged delta {dx:2, dy:0}.
{
  setupSquareMesh();
  useProjectStore.getState().updateProject((proj) => {
    const n = proj.nodes[0];
    n.blendShapes = [
      {
        id: 'shape1',
        name: 'shape1',
        deltas: [
          { dx: 1, dy: 0 },
          { dx: 3, dy: 0 },
          { dx: 0, dy: 0 },
          { dx: 0, dy: 0 },
        ],
      },
    ];
  });
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = mergeAtCenter(mesh, [0, 1]);
  applyTopologyOp(PART_ID, result);

  const after = useProjectStore.getState().project.nodes[0];
  assert(after.blendShapes[0].deltas.length === 3,
    `merged blendShape deltas length = 3, got ${after.blendShapes[0].deltas.length}`);
  const merged = after.blendShapes[0].deltas[0];
  assert(approx(merged.dx, 2) && approx(merged.dy, 0),
    `merged delta dx=2 (avg of 1,3), got dx=${merged.dx}`);
}

// 7. weightGroups remapped via averaging.
{
  setupSquareMesh();
  useProjectStore.getState().updateProject((proj) => {
    const n = proj.nodes[0];
    n.mesh.weightGroups = {
      groupA: [0.2, 0.8, 0.5, 0.5],
    };
    n.mesh.activeWeightGroup = 'groupA';
  });
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = mergeAtCenter(mesh, [0, 1]);
  applyTopologyOp(PART_ID, result);

  const afterMesh = useProjectStore.getState().project.nodes[0].mesh;
  assert(afterMesh.weightGroups.groupA.length === 3,
    `merged weightGroup length = 3, got ${afterMesh.weightGroups.groupA.length}`);
  assert(approx(afterMesh.weightGroups.groupA[0], 0.5),
    `merged weight = avg(0.2, 0.8) = 0.5, got ${afterMesh.weightGroups.groupA[0]}`);
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`topology_op_selection_remap: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
