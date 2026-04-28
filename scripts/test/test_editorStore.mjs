// v3 Phase 0F.18 - tests for the subtle setSelection / mode-exit
// interactions in src/store/editorStore.js.
//
// editorStore has many small actions; the only one with non-obvious
// behavior is setSelection's auto-exit logic: changing selection to
// a different node clears mesh-edit + blend-shape-edit modes so the
// new selection doesn't inherit the prior node's edit context.
//
// Run: node scripts/test/test_editorStore.mjs

import { useEditorStore } from '../../src/store/editorStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function get() { return useEditorStore.getState(); }

// Reset store to initial-ish state for each test block
function reset() {
  useEditorStore.setState({
    selection: [],
    meshEditMode: false,
    blendShapeEditMode: false,
    activeBlendShapeId: null,
  });
}

// ── Initial state ──────────────────────────────────────────────────

reset();
{
  const s = get();
  assert(Array.isArray(s.selection) && s.selection.length === 0, 'initial: empty selection');
  assert(s.toolMode === 'select', 'initial: toolMode = select');
  assert(s.meshEditMode === false, 'initial: meshEditMode false');
  assert(s.blendShapeEditMode === false, 'initial: blendShapeEditMode false');
  assert(s.editorMode === 'staging', 'initial: editorMode = staging');
}

// ── setSelection: clearing exits mesh + blend modes ───────────────

{
  reset();
  useEditorStore.setState({
    selection: ['node-A'],
    meshEditMode: true,
    blendShapeEditMode: true,
    activeBlendShapeId: 'shape-1',
  });
  get().setSelection([]);
  assert(get().selection.length === 0, 'setSelection([]): cleared');
  assert(get().meshEditMode === false, 'setSelection([]): meshEditMode exited');
  assert(get().blendShapeEditMode === false, 'setSelection([]): blendShapeEditMode exited');
  assert(get().activeBlendShapeId === null, 'setSelection([]): activeBlendShapeId cleared');
}

// ── setSelection: switching to different node exits modes ──────────

{
  reset();
  useEditorStore.setState({
    selection: ['node-A'],
    meshEditMode: true,
    blendShapeEditMode: true,
    activeBlendShapeId: 'shape-1',
  });
  get().setSelection(['node-B']);
  assert(get().selection[0] === 'node-B', 'setSelection: replaced');
  assert(get().meshEditMode === false, 'setSelection different: meshEditMode exited');
  assert(get().blendShapeEditMode === false, 'setSelection different: blendShape exited');
  assert(get().activeBlendShapeId === null, 'setSelection different: activeBlendShape cleared');
}

// ── setSelection: same head node KEEPS edit modes ─────────────────

{
  reset();
  useEditorStore.setState({
    selection: ['node-A'],
    meshEditMode: true,
    blendShapeEditMode: true,
    activeBlendShapeId: 'shape-1',
  });
  // Re-selecting the same primary node (e.g. shift-click adds extras)
  // should NOT clobber the user's mesh-edit / blend-shape state.
  get().setSelection(['node-A', 'node-extra']);
  assert(get().selection.length === 2, 'setSelection same head: added extras');
  assert(get().meshEditMode === true, 'setSelection same head: meshEditMode preserved');
  assert(get().blendShapeEditMode === true, 'setSelection same head: blendShape preserved');
  assert(get().activeBlendShapeId === 'shape-1', 'setSelection same head: activeBlendShape preserved');
}

// ── setBrush: partial update merges with existing ─────────────────

{
  reset();
  useEditorStore.setState({ brushSize: 50, brushHardness: 0.5 });
  get().setBrush({ brushSize: 100 });
  assert(get().brushSize === 100, 'setBrush: brushSize updated');
  assert(get().brushHardness === 0.5, 'setBrush: brushHardness preserved (partial update)');
}

// ── setView: partial update merges ─────────────────────────────────

{
  reset();
  useEditorStore.setState({ view: { zoom: 1, panX: 0, panY: 0 } });
  get().setView({ zoom: 2 });
  assert(get().view.zoom === 2, 'setView: zoom updated');
  assert(get().view.panX === 0, 'setView: panX preserved');
  get().setView({ panX: 10, panY: 20 });
  assert(get().view.zoom === 2, 'setView: zoom preserved');
  assert(get().view.panX === 10 && get().view.panY === 20, 'setView: pan updated');
}

// ── setOverlays: partial update merges ─────────────────────────────

{
  reset();
  useEditorStore.setState({
    overlays: {
      showImage: true,
      showWireframe: false,
      showVertices: false,
      showEdgeOutline: false,
      irisClipping: true,
    },
  });
  get().setOverlays({ showWireframe: true });
  assert(get().overlays.showWireframe === true, 'setOverlays: showWireframe updated');
  assert(get().overlays.showImage === true, 'setOverlays: showImage preserved');
  assert(get().overlays.irisClipping === true, 'setOverlays: irisClipping preserved');
}

// ── enterBlendShapeEditMode + exit ────────────────────────────────

{
  reset();
  get().enterBlendShapeEditMode('shape-X');
  assert(get().blendShapeEditMode === true, 'enter: mode on');
  assert(get().activeBlendShapeId === 'shape-X', 'enter: id set');
  assert(get().meshEditMode === true, 'enter: meshEditMode auto-on');
  assert(get().toolMode === 'select', 'enter: toolMode select');

  get().exitBlendShapeEditMode();
  assert(get().blendShapeEditMode === false, 'exit: mode off');
  assert(get().activeBlendShapeId === null, 'exit: id cleared');
  assert(get().meshEditMode === false, 'exit: meshEditMode also off');
}

// ── toggleGroupExpand ─────────────────────────────────────────────

{
  reset();
  useEditorStore.setState({ expandedGroups: new Set() });
  get().toggleGroupExpand('g1');
  assert(get().expandedGroups.has('g1'), 'toggle: g1 added');
  get().toggleGroupExpand('g1');
  assert(!get().expandedGroups.has('g1'), 'toggle: g1 removed');
}

// ── expandGroup is idempotent ────────────────────────────────────

{
  reset();
  useEditorStore.setState({ expandedGroups: new Set() });
  get().expandGroup('g1');
  const refAfterFirst = get().expandedGroups;
  get().expandGroup('g1');
  // expandGroup returns same state if already present (set ref unchanged)
  assert(get().expandedGroups === refAfterFirst, 'expandGroup: idempotent (same ref)');
}

// ── setShowSkeleton: turning off also exits skeletonEditMode ──────

{
  reset();
  useEditorStore.setState({ showSkeleton: true, skeletonEditMode: true });
  get().setShowSkeleton(false);
  assert(get().showSkeleton === false, 'setShowSkeleton(false): off');
  assert(get().skeletonEditMode === false, 'setShowSkeleton(false): edit mode also off');

  // Re-enabling preserves whatever skeletonEditMode was (currently false)
  useEditorStore.setState({ showSkeleton: false, skeletonEditMode: false });
  get().setShowSkeleton(true);
  assert(get().showSkeleton === true, 'setShowSkeleton(true): on');
  assert(get().skeletonEditMode === false, 'setShowSkeleton(true): edit mode untouched');
}

console.log(`editorStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
