// Toolset Plan Phase 5.B — Modal G commit (extrude flow).
//
// Drives the full extrude → modal → commit flow at the store level
// (no DOM events; the overlay's per-tick + commit logic factored out
// to a helper that the test invokes directly). Verifies:
//   - extrude opens a batch + applies topology + begins modal.
//   - per-tick mutation writes new vert positions via skipHistory.
//   - commit closes the batch → ONE undo entry on the stack.
//   - Ctrl+Z (undo) restores pre-extrude project state.
//
// Run: node scripts/test/test_extrude_modalCommit.mjs

import { extrude } from '../../src/v3/operators/edit/extrude.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { useModalVertexTransformStore } from '../../src/store/modalVertexTransformStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { beginBatch, endBatch, undo, undoCount, clearHistory } from '../../src/store/undoHistory.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function seedProject() {
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
            uvs: [0,0, 1,0, 1,1, 0,1],
            triangles: [[0, 1, 2], [0, 2, 3]],
            edgeIndices: [],
          },
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
  clearHistory();
}

// 1. Commit flow — extrude + modal G + commit = ONE undo entry that
//    rolls back to pre-extrude state.
{
  seedProject();
  const preExtrudeUndo = undoCount();
  const preExtrudeProject = useProjectStore.getState().project;
  const preExtrudeVertCount = preExtrudeProject.nodes[0].mesh.vertices.length;

  // Run extrude operator's logic directly (matches registry.js
  // edit.extrude exec).
  const part = preExtrudeProject.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  assert(result !== null, 'extrude → result');

  beginBatch(preExtrudeProject);
  assert(undoCount() === preExtrudeUndo + 1, 'beginBatch pushes 1 snapshot');

  applyTopologyOp('p1', result);

  const postTopProject = useProjectStore.getState().project;
  assert(postTopProject.nodes[0].mesh.vertices.length === preExtrudeVertCount + 2,
    '+2 verts post-applyTopologyOp');
  // No new undo entry (we're inside the batch).
  assert(undoCount() === preExtrudeUndo + 1, 'still 1 snapshot (batched)');

  // Begin modal.
  const newVerts = postTopProject.nodes[0].mesh.vertices;
  /** @type {Map<number, {x,y,restX,restY}>} */
  const original = new Map();
  for (const idx of result.selectionOverride) {
    const v = newVerts[idx];
    original.set(idx, { x: v.x, y: v.y, restX: v.restX, restY: v.restY });
  }
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'p1',
    startMouse: { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original,
    vertIndices: new Set(result.selectionOverride),
    rollbackOnCancel: true,
  });

  // Simulate a per-tick translate dx=20, dy=30.
  const updateProject = useProjectStore.getState().updateProject;
  updateProject((proj) => {
    const node = proj.nodes.find((n) => n.id === 'p1');
    const mesh = node.mesh;
    for (const idx of result.selectionOverride) {
      const orig = original.get(idx);
      mesh.vertices[idx].x = orig.x + 20;
      mesh.vertices[idx].y = orig.y + 30;
    }
  }, { skipHistory: true });

  // No new undo entry per-tick.
  assert(undoCount() === preExtrudeUndo + 1, 'still 1 snapshot post-tick');

  // Commit: endBatch, modal commit.
  endBatch();
  useModalVertexTransformStore.getState().commit();

  // Verify dragged verts at final positions.
  const finalProject = useProjectStore.getState().project;
  const finalMesh = finalProject.nodes[0].mesh;
  for (const idx of result.selectionOverride) {
    const orig = original.get(idx);
    assert(approx(finalMesh.vertices[idx].x, orig.x + 20),
      `vert ${idx} x = orig + 20`);
    assert(approx(finalMesh.vertices[idx].y, orig.y + 30),
      `vert ${idx} y = orig + 30`);
  }

  // ONE undo entry total covers the entire flow.
  assert(undoCount() === preExtrudeUndo + 1, 'ONE undo entry covers extrude+drag');

  // Ctrl+Z → restored pre-extrude state.
  undo(useProjectStore.getState().project, (snap) => {
    useProjectStore.getState().updateProject((proj) => {
      Object.assign(proj, snap);
    }, { skipHistory: true });
  });
  const restoredProject = useProjectStore.getState().project;
  assert(restoredProject.nodes[0].mesh.vertices.length === preExtrudeVertCount,
    `post-undo: vert count back to ${preExtrudeVertCount}, got ${restoredProject.nodes[0].mesh.vertices.length}`);
}

// 2. Modal store cleared post-commit.
{
  seedProject();
  const part = useProjectStore.getState().project.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  beginBatch(useProjectStore.getState().project);
  applyTopologyOp('p1', result);
  const newVerts = useProjectStore.getState().project.nodes[0].mesh.vertices;
  const original = new Map();
  for (const idx of result.selectionOverride) {
    original.set(idx, { x: newVerts[idx].x, y: newVerts[idx].y,
                        restX: newVerts[idx].restX, restY: newVerts[idx].restY });
  }
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'p1',
    startMouse: { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original,
    vertIndices: new Set(result.selectionOverride),
    rollbackOnCancel: true,
  });
  endBatch();
  useModalVertexTransformStore.getState().commit();

  const s = useModalVertexTransformStore.getState();
  assert(s.kind === null, 'kind cleared post-commit');
  assert(s.partId === null, 'partId cleared');
  assert(s.original.size === 0, 'original cleared');
  assert(s.committed === true, 'committed = true');
}

// 3. Selection persists post-commit (new dups stay selected — Blender
//    pattern).
{
  seedProject();
  const part = useProjectStore.getState().project.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  beginBatch(useProjectStore.getState().project);
  applyTopologyOp('p1', result);
  endBatch();

  const editorSel = useEditorStore.getState().selectedVertexIndices.get('p1');
  assert(editorSel.size === 2, 'post-commit: 2 dups still selected');
  for (const idx of result.selectionOverride) {
    assert(editorSel.has(idx), `dup ${idx} in editor selection`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
