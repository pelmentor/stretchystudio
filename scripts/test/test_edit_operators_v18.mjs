// 2026-06-04 — Edit-Mode operators must resolve geometry via getMesh
// for v18 projects (Object/ObjectData split).
//
// User report (2026-06-04): "I selected verts and pressed delete/x —
// nothing happened. I had to RMB then pick from menu."
//
// Root cause: every Edit-Mode operator's `available()` gate + `exec()`
// path read `node.mesh` directly. v18 splits parts into `{part, meshData}`
// pairs and DELETES `node.mesh` (geometry routes through `node.dataId`),
// so every chord (X, K, M, Ctrl+X, L, Ctrl+L, Shift+D, E, Delete,
// Backspace) silently no-op'd on loaded projects — the R4 cascade
// audit missed these 9 sites in `v3/operators/registry.js`.
//
// Coverage: construct a synthetic v18 project (part with `dataId` +
// sibling `meshData`) plus an inline v17 part, drive both through the
// same operators, verify both paths mutate the right geometry.
//
// Run: node scripts/test/test_edit_operators_v18.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { getOperator } from '../../src/v3/operators/registry.js';
import { getMesh } from '../../src/store/objectDataAccess.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

const V18_PART = 'pV18';
const V17_PART = 'pV17';

function makeMesh() {
  // 5-vert mesh with 3 tris. Vert 4 is only used by tri [2,3,4], so
  // deleting it leaves [0,1,2] + [0,2,3] (4 verts, 2 tris) — a valid
  // mesh above the rig pipeline's 3-vert floor.
  return {
    vertices: [
      { x:  0, y:  0, restX:  0, restY:  0 },
      { x: 10, y:  0, restX: 10, restY:  0 },
      { x: 10, y: 10, restX: 10, restY: 10 },
      { x:  0, y: 10, restX:  0, restY: 10 },
      { x: 20, y: 20, restX: 20, restY: 20 },
    ],
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1, 2,2]),
    triangles: [[0,1,2], [0,2,3], [2,3,4]],
    edgeIndices: new Set([0,1,2,3,4]),
  };
}

function setupMixedShapeProject() {
  useProjectStore.getState().resetProject();
  useEditorStore.getState().clearAllVertexSelections();
  useEditorStore.getState().exitEditMode();
  useSelectionStore.getState().clear();

  useProjectStore.getState().updateProject((proj) => {
    // v18 part: dataId pointing at a sibling meshData node, no inline `mesh`.
    proj.nodes.push({
      id: V18_PART,
      type: 'part',
      name: 'v18-quad',
      parent: null,
      visible: true,
      imageWidth: 100,
      imageHeight: 100,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      dataId: `${V18_PART}__data`,
      blendShapes: [],
    });
    proj.nodes.push({
      id: `${V18_PART}__data`,
      type: 'meshData',
      ...makeMesh(),
    });

    // v17 part: inline mesh, no dataId.
    proj.nodes.push({
      id: V17_PART,
      type: 'part',
      name: 'v17-quad',
      parent: null,
      visible: true,
      imageWidth: 100,
      imageHeight: 100,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      mesh: makeMesh(),
      blendShapes: [],
    });
  });
}

function enterEditOn(partId) {
  useEditorStore.getState().setSelection([partId]);
  useEditorStore.getState().enterEditMode('edit');
}

function fireOperatorById(opId) {
  const op = getOperator(opId);
  if (!op) throw new Error(`Operator ${opId} not registered`);
  // Mimic dispatcher: gate then exec.
  if (op.available && !op.available({ editorType: 'viewport' })) return false;
  op.exec({ editorType: 'viewport' });
  return true;
}

// ── v18 part: edit.deleteVerts (X chord) ────────────────────────────────
{
  setupMixedShapeProject();
  enterEditOn(V18_PART);
  useEditorStore.getState().setVertexSelectionForPart(V18_PART, new Set([4]));

  const ranX = fireOperatorById('edit.deleteVerts');
  assert(ranX, 'v18 edit.deleteVerts: available() gate passes (pre-fix returned false)');
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n.id === V18_PART);
  const mesh = getMesh(node, project);
  assert(mesh.vertices.length === 4,
    `v18 edit.deleteVerts: 4 verts remain after deleting 1 (got ${mesh.vertices.length})`);
}

// ── v18 part: selection.delete (Delete chord) ───────────────────────────
{
  setupMixedShapeProject();
  enterEditOn(V18_PART);
  useEditorStore.getState().setVertexSelectionForPart(V18_PART, new Set([4]));

  const ran = fireOperatorById('selection.delete');
  assert(ran, 'v18 selection.delete: available() gate passes');
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n.id === V18_PART);
  // CRITICAL: must NOT have fallen through to Object-Mode delete (the
  // pre-fix v18 bug). The part must still exist with 4 verts.
  assert(node != null, 'v18 selection.delete: part NOT deleted (Edit-Mode branch took priority)');
  const mesh = getMesh(node, project);
  assert(mesh && mesh.vertices.length === 4,
    `v18 selection.delete: 4 verts remain (got ${mesh?.vertices?.length})`);
}

// ── v17 part: edit.deleteVerts works the same (no regression) ───────────
{
  setupMixedShapeProject();
  enterEditOn(V17_PART);
  useEditorStore.getState().setVertexSelectionForPart(V17_PART, new Set([4]));

  const ran = fireOperatorById('edit.deleteVerts');
  assert(ran, 'v17 edit.deleteVerts: available() gate passes (regression check)');
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n.id === V17_PART);
  assert(node.mesh.vertices.length === 4,
    `v17 edit.deleteVerts: 4 verts remain (got ${node.mesh.vertices.length})`);
}

// ── v18 part: edit.knife requires 2-vert selection ──────────────────────
{
  setupMixedShapeProject();
  enterEditOn(V18_PART);
  // Knife between verts 0 and 2 (diagonal of the quad).
  useEditorStore.getState().setVertexSelectionForPart(V18_PART, new Set([0, 2]));

  const op = getOperator('edit.knife');
  assert(op != null, 'edit.knife registered');
  const ranK = op.available({ editorType: 'viewport' });
  assert(ranK, 'v18 edit.knife: available() gate passes with 2 verts selected');
}

// ── v18 part: M (mergeMenu) gate ────────────────────────────────────────
{
  setupMixedShapeProject();
  enterEditOn(V18_PART);
  useEditorStore.getState().setVertexSelectionForPart(V18_PART, new Set([0, 1]));

  const op = getOperator('edit.mergeMenu');
  const ok = op.available({ editorType: 'viewport' });
  assert(ok, 'v18 edit.mergeMenu: available() gate passes');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
