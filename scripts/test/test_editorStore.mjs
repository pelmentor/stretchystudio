// editorStore — single contextual `editMode` slot replaces the prior
// triple of meshEditMode / skeletonEditMode / blendShapeEditMode. The
// non-trivial behaviour:
//   - setSelection auto-exits editMode on selection-head change
//   - setViewLayers({skeleton:false}) auto-exits skeleton edit mode
//   - enterEditMode('blendShape') requires a blendShapeId (no-op without)
//   - meshSubMode is sticky across re-entries (Blender-like)
//
// Run: node scripts/test/test_editorStore.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { usePreferencesStore } from '../../src/store/preferencesStore.js';

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
    editMode: null,
    activeBlendShapeId: null,
    meshSubMode: 'deform',
  });
}

// ── Initial state ──────────────────────────────────────────────────

reset();
{
  const s = get();
  assert(Array.isArray(s.selection) && s.selection.length === 0, 'initial: empty selection');
  assert(s.toolMode === 'select', 'initial: toolMode = select');
  assert(s.editMode === null, 'initial: editMode null (object mode)');
  assert(s.activeBlendShapeId === null, 'initial: activeBlendShapeId null');
  assert(s.meshSubMode === 'deform', 'initial: meshSubMode deform');
  // BFA-001 — editorMode is no longer a stored field; it derives from
  // uiV3Store.activeWorkspace via selectEditorMode.
  assert(s.editorMode === undefined, 'initial: editorMode field removed');
}

// ── setSelection: clearing exits any edit mode ────────────────────

{
  reset();
  useEditorStore.setState({
    selection: ['part-1'],
    editMode: 'mesh',
  });
  get().setSelection([]);
  assert(get().selection.length === 0, 'setSelection([]): cleared');
  assert(get().editMode === null, 'setSelection([]): editMode exited');
}

// ── setSelection: switching to different node exits edit mode ──────
// (with Lock Object Modes OFF — covered by the dedicated lock tests below)

{
  reset();
  usePreferencesStore.setState({ lockObjectModes: false });
  useEditorStore.setState({
    selection: ['part-1'],
    editMode: 'blendShape',
    activeBlendShapeId: 'shape-1',
  });
  get().setSelection(['part-2']);
  assert(get().selection[0] === 'part-2', 'setSelection different (lock off): head updated');
  assert(get().editMode === null, 'setSelection different (lock off): editMode exited');
  assert(get().activeBlendShapeId === null, 'setSelection different (lock off): activeBlendShape cleared');
  usePreferencesStore.setState({ lockObjectModes: true });
}

// ── setSelection: same head preserves edit mode ────────────────────

{
  reset();
  useEditorStore.setState({
    selection: ['part-1', 'part-2'],
    editMode: 'mesh',
  });
  // Same head 'part-1' but new tail order.
  get().setSelection(['part-1', 'part-3']);
  assert(get().editMode === 'mesh', 'setSelection same head: editMode preserved');
}

// ── enterEditMode('mesh') ─────────────────────────────────────────

{
  reset();
  get().enterEditMode('mesh');
  assert(get().editMode === 'mesh', 'enter mesh: editMode set');
  assert(get().activeBlendShapeId === null, 'enter mesh: blendShapeId stays null');
  assert(get().toolMode === 'brush', 'enter mesh: toolMode defaults to brush');
}

// ── enterEditMode('skeleton') ─────────────────────────────────────

{
  reset();
  get().enterEditMode('skeleton');
  assert(get().editMode === 'skeleton', 'enter skeleton: editMode set');
  assert(get().activeBlendShapeId === null, 'enter skeleton: blendShapeId stays null');
  assert(get().toolMode === 'joint_drag', 'enter skeleton: toolMode defaults to joint_drag');
}

// ── enterEditMode('blendShape', {blendShapeId}) ───────────────────

{
  reset();
  get().enterEditMode('blendShape', { blendShapeId: 'shape-X' });
  assert(get().editMode === 'blendShape', 'enter blendShape: editMode set');
  assert(get().activeBlendShapeId === 'shape-X', 'enter blendShape: id set');
  assert(get().toolMode === 'brush', 'enter blendShape: toolMode defaults to brush');
}

// ── enterEditMode('blendShape') without id is a no-op ─────────────

{
  reset();
  get().enterEditMode('blendShape');
  assert(get().editMode === null, 'enter blendShape no id: no-op (still null)');
  assert(get().activeBlendShapeId === null, 'enter blendShape no id: still null');
}

// ── enterEditMode with unknown kind is a no-op ────────────────────

{
  reset();
  get().enterEditMode('purple');
  assert(get().editMode === null, 'enter unknown kind: no-op');
}

// ── exitEditMode is idempotent and clears blendShapeId ────────────

{
  reset();
  get().enterEditMode('blendShape', { blendShapeId: 'shape-Y' });
  get().exitEditMode();
  assert(get().editMode === null, 'exit: editMode cleared');
  assert(get().activeBlendShapeId === null, 'exit: blendShapeId cleared');
  // Idempotent
  get().exitEditMode();
  assert(get().editMode === null, 'exit (idempotent): still null');
}

// ── Switching between edit modes overwrites cleanly ───────────────

{
  reset();
  get().enterEditMode('mesh');
  get().enterEditMode('skeleton');
  assert(get().editMode === 'skeleton', 'switch mesh→skeleton: editMode skeleton');

  get().enterEditMode('blendShape', { blendShapeId: 'shape-1' });
  assert(get().editMode === 'blendShape', 'switch skeleton→blendShape: editMode blendShape');
  assert(get().activeBlendShapeId === 'shape-1', 'switch skeleton→blendShape: id set');

  // Switching back to mesh clears blendShape's id
  get().enterEditMode('mesh');
  assert(get().editMode === 'mesh', 'switch blendShape→mesh: editMode mesh');
  assert(get().activeBlendShapeId === null,
    'switch blendShape→mesh: blendShapeId cleared');
}

// ── meshSubMode is sticky across edit-mode re-entries ─────────────

{
  reset();
  get().enterEditMode('mesh');
  get().setMeshSubMode('adjust');
  assert(get().meshSubMode === 'adjust', 'setMeshSubMode: stored');
  get().exitEditMode();
  assert(get().meshSubMode === 'adjust', 'exit: meshSubMode preserved');
  get().enterEditMode('mesh');
  assert(get().meshSubMode === 'adjust',
    're-enter mesh: previous sub-mode (adjust) restored');
}

// ── Lock Object Modes (Blender behaviour) ─────────────────────────

{
  reset();
  // Lock ON (default) — selection-head change while in edit mode is rejected
  usePreferencesStore.setState({ lockObjectModes: true });
  useEditorStore.setState({
    selection: ['part-A'],
    editMode: 'mesh',
  });
  get().setSelection(['part-B']);
  assert(get().selection[0] === 'part-A',
    'lock ON: head-change while in editMode rejected (selection unchanged)');
  assert(get().editMode === 'mesh',
    'lock ON: editMode preserved across rejected selection change');

  // Empty selection (deselect-all) is allowed even with lock on — and
  // exits editMode because there's no longer a selected part to edit.
  // Different from Blender's component-level empty-select; SS edit
  // mode is per-PART so empty selection is meaningless.
  get().setSelection([]);
  assert(get().selection.length === 0, 'lock ON: empty selection (deselect) allowed');
  assert(get().editMode === null,
    'lock ON: empty selection exits editMode (no part to edit)');

  // Lock OFF — selection-head change exits edit mode (prior SS behaviour)
  usePreferencesStore.setState({ lockObjectModes: false });
  useEditorStore.setState({
    selection: ['part-A'],
    editMode: 'mesh',
  });
  get().setSelection(['part-B']);
  assert(get().selection[0] === 'part-B',
    'lock OFF: head-change goes through');
  assert(get().editMode === null,
    'lock OFF: editMode auto-exits on head change');

  // Same-head re-set always allowed (lock state irrelevant)
  usePreferencesStore.setState({ lockObjectModes: true });
  useEditorStore.setState({
    selection: ['part-A'],
    editMode: 'mesh',
  });
  get().setSelection(['part-A', 'extra-tail']);
  assert(get().selection.length === 2,
    'lock ON + same head: tail-extension goes through');
  assert(get().editMode === 'mesh',
    'lock ON + same head: editMode preserved');

  // No editMode → lock is irrelevant
  usePreferencesStore.setState({ lockObjectModes: true });
  useEditorStore.setState({
    selection: ['part-A'],
    editMode: null,
  });
  get().setSelection(['part-B']);
  assert(get().selection[0] === 'part-B',
    'lock ON + no editMode: head change goes through');

  // Reset preference for subsequent tests
  usePreferencesStore.setState({ lockObjectModes: true });
}

// ── setBrush partial update ───────────────────────────────────────

{
  reset();
  useEditorStore.setState({ brushSize: 50, brushHardness: 0.5 });
  get().setBrush({ brushSize: 100 });
  assert(get().brushSize === 100, 'setBrush: brushSize updated');
  assert(get().brushHardness === 0.5, 'setBrush: brushHardness preserved');
}

// ── setView: per-mode partial update merges (GAP-010 Phase B) ──────

{
  reset();
  useEditorStore.setState({
    viewByMode: {
      viewport:    { zoom: 1, panX: 0, panY: 0 },
      livePreview: { zoom: 1, panX: 0, panY: 0 },
    },
  });
  get().setView('viewport', { zoom: 2 });
  assert(get().viewByMode.viewport.zoom === 2, 'setView(viewport): zoom updated');
  assert(get().viewByMode.viewport.panX === 0, 'setView(viewport): panX preserved');
  assert(get().viewByMode.livePreview.zoom === 1,
    'setView(viewport): livePreview view NOT mutated');
  get().setView('livePreview', { panX: 100 });
  assert(get().viewByMode.livePreview.panX === 100, 'setView(livePreview): panX updated');
  assert(get().viewByMode.viewport.zoom === 2,
    'setView(livePreview): viewport zoom preserved');
  const before = JSON.stringify(get().viewByMode);
  get().setView('definitely_not_a_mode', { zoom: 99 });
  assert(JSON.stringify(get().viewByMode) === before, 'setView(unknown mode): no-op');
}

// ── setViewLayers: partial update merges (GAP-016) ─────────────────

{
  reset();
  useEditorStore.setState({
    viewLayers: {
      image: true,
      wireframe: false,
      vertices: false,
      edgeOutline: false,
      skeleton: true,
      irisClipping: true,
      warpGrids: true,
      rotationPivots: true,
    },
  });
  get().setViewLayers({ wireframe: true });
  assert(get().viewLayers.wireframe === true, 'setViewLayers: wireframe updated');
  assert(get().viewLayers.image === true, 'setViewLayers: image preserved');
  assert(get().viewLayers.skeleton === true, 'setViewLayers: skeleton preserved');
}

// ── setViewLayers({skeleton:false}) auto-exits skeleton edit ──────

{
  reset();
  useEditorStore.setState({
    viewLayers: { ...get().viewLayers, skeleton: true },
    editMode: 'skeleton',
  });
  get().setViewLayers({ skeleton: false });
  assert(get().viewLayers.skeleton === false, 'setViewLayers({skeleton:false}): off');
  assert(get().editMode === null, 'setViewLayers({skeleton:false}): editMode exited');

  // BUT: if user is in MESH edit, dropping the skeleton layer must
  // NOT exit mesh edit (skeleton layer is independent of mesh edit).
  useEditorStore.setState({
    viewLayers: { ...get().viewLayers, skeleton: true },
    editMode: 'mesh',
  });
  get().setViewLayers({ skeleton: false });
  assert(get().editMode === 'mesh',
    'setViewLayers({skeleton:false}): does NOT exit mesh edit');
}

// ── Last-used-tool persistence: setToolMode mirrors into prefs ────

{
  reset();
  // Seed mesh edit; default toolMode = 'brush'.
  useEditorStore.setState({ editMode: 'mesh' });
  // Reset the persisted map to a known shape so we observe a write.
  usePreferencesStore.setState({
    lastToolByMode: { object: 'select', mesh: 'brush', skeleton: 'joint_drag', blendShape: 'brush' },
  });

  get().setToolMode('add_vertex');
  assert(get().toolMode === 'add_vertex',
    'setToolMode: in-memory updated');
  assert(usePreferencesStore.getState().lastToolByMode.mesh === 'add_vertex',
    'setToolMode: prefs.lastToolByMode.mesh mirrored');
  assert(usePreferencesStore.getState().lastToolByMode.object === 'select',
    'setToolMode: untouched mode keys preserved');

  // Object-mode key encoded as 'object'.
  useEditorStore.setState({ editMode: null, toolMode: 'select' });
  get().setToolMode('select');
  assert(usePreferencesStore.getState().lastToolByMode.object === 'select',
    'setToolMode: object-mode key written');

  // Identical-value write is a no-op (no extra prefs churn).
  const before = usePreferencesStore.getState().lastToolByMode;
  get().setToolMode('select');
  assert(usePreferencesStore.getState().lastToolByMode === before,
    'setToolMode: identical value preserves prefs identity');
}

// ── enterEditMode reads persisted last-tool (sticky across Tab) ───

{
  reset();
  // Persist a non-default tool for mesh edit.
  usePreferencesStore.setState({
    lastToolByMode: { object: 'select', mesh: 'remove_vertex', skeleton: 'joint_drag', blendShape: 'brush' },
  });
  get().enterEditMode('mesh');
  assert(get().toolMode === 'remove_vertex',
    'enterEditMode(mesh): restores last-used tool from prefs');

  // Skeleton entry restores joint_drag (default).
  reset();
  usePreferencesStore.setState({
    lastToolByMode: { object: 'select', mesh: 'brush', skeleton: 'joint_drag', blendShape: 'brush' },
  });
  get().enterEditMode('skeleton');
  assert(get().toolMode === 'joint_drag',
    'enterEditMode(skeleton): restores joint_drag');

  // Empty / malformed prefs → falls through to canonical defaults.
  reset();
  usePreferencesStore.setState({ lastToolByMode: {} });
  get().enterEditMode('mesh');
  assert(get().toolMode === 'brush',
    'enterEditMode(mesh) with empty prefs: falls back to brush');
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
  assert(get().expandedGroups === refAfterFirst, 'expandGroup: idempotent (same ref)');
}

console.log(`editorStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
