// Toolset Phase 0.A — vertex selection actions on editorStore.
//
// Covers: selectVertex / deselectVertex / toggleVertexSelection /
// setVertexSelectionForPart / selectAllVertices / deselectAllVertices /
// clearAllVertexSelections / invalidateVertexSelectionForPart.
//
// Active-vertex pointer behaviour: set on selectVertex + add-side of
// toggle, cleared when the active vertex is the one being removed.
//
// Run: node scripts/test/test_vertexSelection_basic.mjs

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

// ── Test 1: selectVertex sets the active vertex + replaces selection ─

{
  reset();
  useEditorStore.getState().selectVertex('partA', 5);
  const s = useEditorStore.getState();
  const sel = s.selectedVertexIndices.get('partA');
  assert(sel?.size === 1 && sel.has(5), 'Test 1: selectVertex adds index 5');
  assert(s.activeVertex?.partId === 'partA' && s.activeVertex?.vertIndex === 5,
    'Test 1: activeVertex set');

  // Non-additive replaces.
  useEditorStore.getState().selectVertex('partA', 7);
  const s2 = useEditorStore.getState();
  const sel2 = s2.selectedVertexIndices.get('partA');
  assert(sel2?.size === 1 && sel2.has(7) && !sel2.has(5),
    'Test 1: non-additive replaces (5 dropped, only 7 remains)');
  assert(s2.activeVertex?.vertIndex === 7, 'Test 1: activeVertex updated to 7');
}

// ── Test 2: selectVertex additive=true ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partA', 2, true);
  useEditorStore.getState().selectVertex('partA', 3, true);
  const sel = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel?.size === 3 && sel.has(1) && sel.has(2) && sel.has(3),
    'Test 2: additive selectVertex builds {1, 2, 3}');
  assert(useEditorStore.getState().activeVertex?.vertIndex === 3,
    'Test 2: activeVertex = last-added');
}

// ── Test 3: deselectVertex removes + clears active ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partA', 2, true);
  useEditorStore.getState().deselectVertex('partA', 2);
  const sel = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel?.size === 1 && sel.has(1) && !sel.has(2),
    'Test 3: deselectVertex(2) leaves only 1');
  assert(useEditorStore.getState().activeVertex === null,
    'Test 3: activeVertex was 2 → cleared after removing it');

  // Removing a non-active vertex preserves the active one.
  useEditorStore.getState().selectVertex('partA', 5, true); // active = 5
  useEditorStore.getState().deselectVertex('partA', 1);
  assert(useEditorStore.getState().activeVertex?.vertIndex === 5,
    'Test 3: removing non-active leaves active intact');

  // Deselecting the only remaining entry drops the part key entirely.
  useEditorStore.getState().deselectVertex('partA', 5);
  const sel2 = useEditorStore.getState().selectedVertexIndices;
  assert(!sel2.has('partA'), 'Test 3: empty set deletes the part key');
}

// ── Test 4: toggleVertexSelection toggles and tracks active ──

{
  reset();
  useEditorStore.getState().toggleVertexSelection('partA', 3);
  let sel = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel?.has(3), 'Test 4: toggle adds when missing');
  assert(useEditorStore.getState().activeVertex?.vertIndex === 3,
    'Test 4: toggle sets active on add');

  useEditorStore.getState().toggleVertexSelection('partA', 3);
  assert(!useEditorStore.getState().selectedVertexIndices.has('partA'),
    'Test 4: toggle removes when present (set emptied → key dropped)');
  assert(useEditorStore.getState().activeVertex === null,
    'Test 4: toggle clears active on remove');
}

// ── Test 5: setVertexSelectionForPart replaces with iterable ──

{
  reset();
  useEditorStore.getState().setVertexSelectionForPart('partA', [10, 20, 30]);
  const sel = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel?.size === 3 && sel.has(10) && sel.has(20) && sel.has(30),
    'Test 5: setVertexSelectionForPart with array');

  useEditorStore.getState().setVertexSelectionForPart('partA', new Set([99]));
  const sel2 = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel2?.size === 1 && sel2.has(99),
    'Test 5: setVertexSelectionForPart with Set replaces');

  // Empty iterable drops the entry.
  useEditorStore.getState().setVertexSelectionForPart('partA', []);
  assert(!useEditorStore.getState().selectedVertexIndices.has('partA'),
    'Test 5: empty iterable deletes part key');
}

// ── Test 6: selectAllVertices populates 0..vertCount-1 ──

{
  reset();
  useEditorStore.getState().selectAllVertices('partA', 4);
  const sel = useEditorStore.getState().selectedVertexIndices.get('partA');
  assert(sel?.size === 4 && sel.has(0) && sel.has(1) && sel.has(2) && sel.has(3),
    'Test 6: selectAllVertices(4) = {0, 1, 2, 3}');
}

// ── Test 7: deselectAllVertices clears one part ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partB', 5); // active now on partB
  useEditorStore.getState().deselectAllVertices('partA');
  const s = useEditorStore.getState();
  assert(!s.selectedVertexIndices.has('partA'), 'Test 7: partA cleared');
  assert(s.selectedVertexIndices.get('partB')?.has(5),
    'Test 7: partB selection preserved');
  assert(s.activeVertex?.partId === 'partB',
    'Test 7: active on partB unaffected by partA clear');
}

// ── Test 8: clearAllVertexSelections drops everything ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partB', 2, true);
  useEditorStore.getState().clearAllVertexSelections();
  const s = useEditorStore.getState();
  assert(s.selectedVertexIndices.size === 0, 'Test 8: clear drops all parts');
  assert(s.activeVertex === null, 'Test 8: clear nulls activeVertex');
}

// ── Test 9: invalidateVertexSelectionForPart drops partA, clears active if on partA ─

{
  reset();
  useEditorStore.getState().selectVertex('partA', 3);
  useEditorStore.getState().invalidateVertexSelectionForPart('partA');
  const s = useEditorStore.getState();
  assert(!s.selectedVertexIndices.has('partA'), 'Test 9: invalidate drops part');
  assert(s.activeVertex === null, 'Test 9: invalidate clears active when on dropped part');
}

// ── Test 10: defensive — bad inputs are no-ops ──

{
  reset();
  useEditorStore.getState().selectVertex('', 5);  // empty partId
  useEditorStore.getState().selectVertex('partA', -1);  // negative index
  useEditorStore.getState().selectVertex('partA', 1.5); // non-integer
  assert(useEditorStore.getState().selectedVertexIndices.size === 0,
    'Test 10: invalid inputs all no-op');
}

// ── Test 11: per-part isolation ──

{
  reset();
  useEditorStore.getState().selectVertex('partA', 1);
  useEditorStore.getState().selectVertex('partB', 1, true); // same vertIndex, different part
  const sels = useEditorStore.getState().selectedVertexIndices;
  assert(sels.get('partA')?.has(1) && sels.get('partB')?.has(1),
    'Test 11: same vertIndex tracked per-part (Blender Edit Mode model)');
  assert(sels.get('partA') !== sels.get('partB'),
    'Test 11: per-part Sets are distinct objects');
}

console.log(`vertexSelection_basic: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
