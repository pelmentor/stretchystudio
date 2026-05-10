// Toolset Phase 0.F — vertex selection invalidation on topology change.
//
// `invalidateVertexSelectionForPart(partId)` is called from the
// add_vertex / remove_vertex paths in CanvasViewport after the mesh
// vertex array changes. This test exercises the action's contract
// directly (CanvasViewport integration is browser-tested).
//
// Run: node scripts/test/test_vertexSelection_invalidation.mjs

import { useEditorStore } from '../../src/store/editorStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function reset() {
  useEditorStore.setState({
    selectedVertexIndices: new Map(),
    activeVertex: null,
  });
}

// ── Test 1: invalidate drops selection + active for matching part ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 5);
  useEditorStore.getState().selectVertex('partA', 8, true);
  useEditorStore.getState().invalidateVertexSelectionForPart('partA');
  const s = useEditorStore.getState();
  assert(!s.selectedVertexIndices.has('partA'), 'Test 1: partA selection cleared');
  assert(s.activeVertex === null, 'Test 1: active was on partA → cleared');
}

// ── Test 2: invalidate doesn't affect other parts ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partB', 2, true); // active on partB
  useEditorStore.getState().invalidateVertexSelectionForPart('partA');
  const s = useEditorStore.getState();
  assert(!s.selectedVertexIndices.has('partA'),
    'Test 2: partA cleared');
  assert(s.selectedVertexIndices.get('partB')?.has(2),
    'Test 2: partB selection preserved');
  assert(s.activeVertex?.partId === 'partB',
    'Test 2: active on partB unchanged');
}

// ── Test 3: invalidate is no-op when part has no selection and is not active ─

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  const before = useEditorStore.getState();
  // partB has no selection and isn't active.
  useEditorStore.getState().invalidateVertexSelectionForPart('partB');
  const after = useEditorStore.getState();
  // Reference equality — no-op should NOT trigger a state replacement.
  assert(before.selectedVertexIndices === after.selectedVertexIndices,
    'Test 3: no-op for empty/non-active part (reference-stable)');
  assert(after.selectedVertexIndices.get('partA')?.has(1),
    'Test 3: partA selection still intact');
}

// ── Test 4: invalidate clears active when active points at the part ──

{
  reset();
  // Build a state where partA has no selection set but IS the active
  // vertex's part. Manually craft because the public actions don't
  // produce that combination, but rendering safety still requires
  // invalidate to clear the active pointer.
  useEditorStore.setState({
    selectedVertexIndices: new Map(),
    activeVertex: { partId: 'partA', vertIndex: 5 },
  });
  useEditorStore.getState().invalidateVertexSelectionForPart('partA');
  assert(useEditorStore.getState().activeVertex === null,
    'Test 4: invalidate clears active even when no selection set on the part');
}

// ── Test 5: invalidate empty / invalid partId is a no-op ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  const before = useEditorStore.getState();
  useEditorStore.getState().invalidateVertexSelectionForPart('');
  useEditorStore.getState().invalidateVertexSelectionForPart(null);
  useEditorStore.getState().invalidateVertexSelectionForPart(undefined);
  const after = useEditorStore.getState();
  assert(before.selectedVertexIndices === after.selectedVertexIndices,
    'Test 5: bad partIds all no-op');
}

console.log(`vertexSelection_invalidation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
