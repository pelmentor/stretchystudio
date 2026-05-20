// scripts/test/test_workspaceModeEntry.mjs — UI Blender-parity Slice E.
//
// Workspace→mode coupling: activating an edit-purpose workspace enters its
// canonical mode IFF the active selection supports it; layout/animation are
// uncoupled. Verifies selectionSupportsMode (pure) + applyWorkspaceMode
// (store-driven, same harness shape as test_keyingSetMenu §5).

import { applyWorkspaceMode, selectionSupportsMode } from '../../src/v3/workspaceModeEntry.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${msg}`); }
}

function meshedPart(id = 'partA') {
  return {
    id, type: 'part', name: 'PartA',
    mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], uvs: [], triangles: [] },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  };
}
function weightedPart(id = 'partW') {
  const n = meshedPart(id);
  n.mesh.weightGroups = { boneA: [1, 1, 1] };
  return n;
}
function boneGroup(id = 'boneA') {
  return {
    id, type: 'group', name: 'Arm', boneRole: 'leftElbow',
    pose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  };
}
function plainGroup(id = 'grpA') { return { id, type: 'group', name: 'Group' }; }

const proj = (nodes) => ({ nodes, actions: [], parameters: [] });

// Set project + active selection (both stores) + reset editor mode.
function setup(nodes, activeId) {
  useProjectStore.setState({ project: proj(nodes) });
  useEditorStore.setState({ editMode: null, selection: [], viewLayers: {} });
  useSelectionStore.setState({ items: [] });
  if (activeId) useSelectionStore.getState().select({ type: 'group', id: activeId }, 'replace');
}

// ── §1 selectionSupportsMode ─────────────────────────────────────────
console.log('\n§1 selectionSupportsMode');
{
  const p = proj([meshedPart(), boneGroup(), plainGroup(), weightedPart()]);
  const mesh = p.nodes[0]; const bone = p.nodes[1]; const grp = p.nodes[2]; const wpart = p.nodes[3];

  ok(selectionSupportsMode(mesh, p, 'edit'), '§1 mesh supports edit');
  ok(selectionSupportsMode(mesh, p, 'sculpt'), '§1 mesh supports sculpt');
  ok(!selectionSupportsMode(mesh, p, 'pose'), '§1 mesh does NOT support pose');
  ok(!selectionSupportsMode(mesh, p, 'weightPaint'), '§1 plain mesh (no weights) does NOT support weightPaint');

  ok(selectionSupportsMode(bone, p, 'pose'), '§1 bone supports pose');
  ok(selectionSupportsMode(bone, p, 'edit'), '§1 bone supports edit (rest pivots)');
  ok(!selectionSupportsMode(bone, p, 'sculpt'), '§1 bone does NOT support sculpt');

  ok(!selectionSupportsMode(grp, p, 'edit'), '§1 plain group supports no edit mode');
  ok(selectionSupportsMode(wpart, p, 'weightPaint'), '§1 weighted mesh supports weightPaint');
  ok(!selectionSupportsMode(null, p, 'edit'), '§1 null node → false');
}

// ── §2 applyWorkspaceMode ────────────────────────────────────────────
console.log('\n§2 applyWorkspaceMode');
{
  // §2.1 uncoupled workspaces never change mode
  setup([meshedPart()], 'partA');
  applyWorkspaceMode('layout');
  ok(useEditorStore.getState().editMode === null, '§2.1 layout → no mode change');
  applyWorkspaceMode('animation');
  ok(useEditorStore.getState().editMode === null, '§2.1 animation → no mode change');

  // §2.2 sculpt workspace + meshed part → Sculpt
  setup([meshedPart()], 'partA');
  applyWorkspaceMode('sculpt');
  ok(useEditorStore.getState().editMode === 'sculpt', '§2.2 sculpt + mesh → sculpt mode');

  // §2.3 sculpt workspace + bone (no mesh) → unsupported, no change
  setup([boneGroup()], 'boneA');
  applyWorkspaceMode('sculpt');
  ok(useEditorStore.getState().editMode === null, '§2.3 sculpt + bone → no change (unsupported)');

  // §2.4 modeling + meshed part → Edit
  setup([meshedPart()], 'partA');
  applyWorkspaceMode('modeling');
  ok(useEditorStore.getState().editMode === 'edit', '§2.4 modeling + mesh → edit mode');

  // §2.5 rigging + bone → Pose (+ skeleton overlay)
  setup([boneGroup()], 'boneA');
  applyWorkspaceMode('rigging');
  ok(useEditorStore.getState().editMode === 'pose', '§2.5 rigging + bone → pose mode');
  ok(useEditorStore.getState().viewLayers?.skeleton === true, '§2.5 pose entry enables skeleton overlay');

  // §2.6 weightPaint + weighted part → Weight Paint
  setup([weightedPart()], 'partW');
  applyWorkspaceMode('weightPaint');
  ok(useEditorStore.getState().editMode === 'weightPaint', '§2.6 weightPaint + weighted mesh → weightPaint mode');

  // §2.7 no selection → no change
  setup([meshedPart()], null);
  applyWorkspaceMode('sculpt');
  ok(useEditorStore.getState().editMode === null, '§2.7 no selection → no mode change');

  // §2.8 already in target → idempotent (no throw, stays)
  setup([meshedPart()], 'partA');
  useEditorStore.setState({ editMode: 'sculpt' });
  applyWorkspaceMode('sculpt');
  ok(useEditorStore.getState().editMode === 'sculpt', '§2.8 already in target → unchanged');

  // §2.9 unsupported selection leaves an EXISTING mode untouched
  setup([boneGroup()], 'boneA');
  useEditorStore.setState({ editMode: 'pose' });
  applyWorkspaceMode('sculpt'); // bone can't sculpt
  ok(useEditorStore.getState().editMode === 'pose', '§2.9 unsupported target leaves current mode intact');
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
