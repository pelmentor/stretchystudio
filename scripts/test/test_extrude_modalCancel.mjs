// Toolset Plan Phase 5.B — Modal G Esc-cancel (extrude flow).
//
// Verifies the rollback path: extrude opens batch + applies topology
// + begins modal, user drags, then Esc → discardBatch pops the batch
// snapshot AND restores pre-extrude state in one swoop. Critical: NO
// new entries land on the redo stack (Esc means "never happened",
// not "I want to redo this later").
//
// Run: node scripts/test/test_extrude_modalCancel.mjs

import { extrude } from '../../src/v3/operators/edit/extrude.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { useModalVertexTransformStore } from '../../src/store/modalVertexTransformStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import {
  beginBatch, endBatch, discardBatch,
  undo, redo, undoCount, redoCount, clearHistory,
} from '../../src/store/undoHistory.js';

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

// 1. Cancel flow — extrude + modal G + cancel = state restored,
//    NO undo entry pushed, NO redo entry pushed.
{
  seedProject();
  const preExtrudeUndo = undoCount();
  const preExtrudeRedo = redoCount();
  const preExtrudeProject = useProjectStore.getState().project;
  const preExtrudeVertCount = preExtrudeProject.nodes[0].mesh.vertices.length;
  const preExtrudeTriCount = preExtrudeProject.nodes[0].mesh.triangles.length;
  const preExtrudeSelection = new Set(useEditorStore.getState().selectedVertexIndices.get('p1'));

  const part = preExtrudeProject.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  beginBatch(preExtrudeProject);
  assert(undoCount() === preExtrudeUndo + 1, 'beginBatch +1 snapshot');

  applyTopologyOp('p1', result);

  // Verify topology applied (verts + tris added).
  let postProj = useProjectStore.getState().project;
  assert(postProj.nodes[0].mesh.vertices.length === preExtrudeVertCount + 2,
    'applyTopologyOp added 2 verts');
  assert(postProj.nodes[0].mesh.triangles.length > preExtrudeTriCount,
    'applyTopologyOp added quad triangles');

  // Begin modal + simulate a drag tick.
  const newVerts = postProj.nodes[0].mesh.vertices;
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
  const updateProject = useProjectStore.getState().updateProject;
  updateProject((proj) => {
    const node = proj.nodes.find((n) => n.id === 'p1');
    for (const idx of result.selectionOverride) {
      const orig = original.get(idx);
      node.mesh.vertices[idx].x = orig.x + 100;
      node.mesh.vertices[idx].y = orig.y + 200;
    }
  }, { skipHistory: true });

  // Cancel — discardBatch directly (mirrors the overlay's
  // rollbackThenCancel path).
  discardBatch((snapshot) => {
    updateProject((proj) => {
      Object.assign(proj, snapshot);
    }, { skipHistory: true });
  });
  useModalVertexTransformStore.getState().cancel();

  // Project state matches pre-extrude.
  postProj = useProjectStore.getState().project;
  assert(postProj.nodes[0].mesh.vertices.length === preExtrudeVertCount,
    `vert count restored to ${preExtrudeVertCount}, got ${postProj.nodes[0].mesh.vertices.length}`);
  assert(postProj.nodes[0].mesh.triangles.length === preExtrudeTriCount,
    `tri count restored to ${preExtrudeTriCount}, got ${postProj.nodes[0].mesh.triangles.length}`);
  // Original verts at their original positions (none of the modal
  // drag's writes survived).
  for (let i = 0; i < preExtrudeVertCount; i++) {
    const orig = preExtrudeProject.nodes[0].mesh.vertices[i];
    const cur  = postProj.nodes[0].mesh.vertices[i];
    assert(approx(cur.x, orig.x) && approx(cur.y, orig.y),
      `vert ${i} restored to original (${orig.x}, ${orig.y})`);
  }

  // Undo stack same as before extrude — no entry pushed.
  assert(undoCount() === preExtrudeUndo,
    `undo count back to ${preExtrudeUndo}, got ${undoCount()}`);
  // Redo stack ALSO unchanged — discardBatch must NOT pollute redo.
  assert(redoCount() === preExtrudeRedo,
    `redo count unchanged (${preExtrudeRedo}), got ${redoCount()}`);
}

// 2. Modal store cleared post-cancel.
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
  discardBatch((snapshot) => {
    useProjectStore.getState().updateProject((proj) => {
      Object.assign(proj, snapshot);
    }, { skipHistory: true });
  });
  useModalVertexTransformStore.getState().cancel();
  const s = useModalVertexTransformStore.getState();
  assert(s.kind === null, 'kind cleared post-cancel');
  assert(s.partId === null, 'partId cleared');
  assert(s.committed === false, 'committed = false');
  assert(s.rollbackOnCancel === false, 'rollbackOnCancel cleared');
}

// 3. discardBatch at depth > 1 just decrements (nested case).
{
  seedProject();
  const proj = useProjectStore.getState().project;
  const initialUndo = undoCount();
  beginBatch(proj);          // depth 1, snapshot pushed
  beginBatch(proj);          // depth 2, no extra snapshot
  assert(undoCount() === initialUndo + 1, 'nested beginBatch: still 1 snapshot');
  let applyCalled = false;
  discardBatch(() => { applyCalled = true; });
  assert(!applyCalled, 'inner discardBatch: no applyFn call');
  assert(undoCount() === initialUndo + 1, 'inner discardBatch: snapshot still in stack');
  // Outermost discardBatch fires applyFn + pops.
  let outerApplyCalled = false;
  discardBatch((s) => { outerApplyCalled = true; });
  assert(outerApplyCalled, 'outer discardBatch: applyFn called');
  assert(undoCount() === initialUndo, 'outer discardBatch: snapshot popped');
}

// 4. Cancel doesn't pollute redo stack — verify Ctrl+Shift+Z after
//    cancel does NOT bring the extrude back.
{
  seedProject();
  // First push something to the redo stack: do a real edit + undo.
  useProjectStore.getState().updateProject((proj) => {
    proj.nodes[0].name = 'modified';
  });
  undo(useProjectStore.getState().project, (s) => {
    useProjectStore.getState().updateProject((p) => Object.assign(p, s), { skipHistory: true });
  });
  const preCancelRedoCount = redoCount();
  assert(preCancelRedoCount > 0, 'redo stack populated by undo of edit');
  const preCancelRedoVal = preCancelRedoCount;

  // Now extrude + cancel.
  const part = useProjectStore.getState().project.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  beginBatch(useProjectStore.getState().project);
  applyTopologyOp('p1', result);
  discardBatch((snapshot) => {
    useProjectStore.getState().updateProject((proj) => {
      Object.assign(proj, snapshot);
    }, { skipHistory: true });
  });

  // Redo stack count unchanged by cancel.
  assert(redoCount() === preCancelRedoVal,
    `redo unchanged after cancel (${preCancelRedoVal}), got ${redoCount()}`);
  // Redo restores the pre-cancel state, NOT the extrude.
  redo(useProjectStore.getState().project, (s) => {
    useProjectStore.getState().updateProject((p) => Object.assign(p, s), { skipHistory: true });
  });
  const afterRedo = useProjectStore.getState().project;
  // Should be the "modified" state — NOT extrude state.
  assert(afterRedo.nodes[0].name === 'modified',
    `redo restored real edit (name=modified), got name=${afterRedo.nodes[0].name}`);
  assert(afterRedo.nodes[0].mesh.vertices.length === 4,
    'redo did NOT restore extrude (vert count = 4, no dups)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
