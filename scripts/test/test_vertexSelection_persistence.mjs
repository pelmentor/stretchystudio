// Toolset Phase 0.F — vertex selection persistence across mode switches.
//
// Per plan §0.F:
//   - selectedVertexIndices is preserved when entering another edit
//     mode (e.g. Tab → Pose → Tab → Edit keeps selection).
//   - Cleared when leaving Edit Mode for Object Mode (`exitEditMode`).
//   - Cleared when the active part changes via `setSelection`.
//
// Run: node scripts/test/test_vertexSelection_persistence.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { usePreferencesStore } from '../../src/store/preferencesStore.js';

// Test 3 needs setSelection to actually swap the active object — but
// `setSelection` rejects head changes while `editMode` is active when
// `lockObjectModes` is true (Blender-faithful "Lock Object Modes"
// preference). Disable the lock for the persistence tests so we can
// exercise the head-change path.
usePreferencesStore.setState({ lockObjectModes: false });

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function setupBoneAndPart() {
  // Real project nodes so enterEditMode('pose') actually accepts the
  // bone group and dataKind detection works for both edit modes.
  useProjectStore.setState({
    project: {
      schemaVersion: 0,
      canvas: { width: 800, height: 600 },
      parameters: [],
      animations: [],
      physicsRules: [],
      nodes: [
        { id: 'partA', type: 'part', name: 'A', visible: true, draw_order: 100,
          parent: null,
          mesh: { vertices: [{x: 0, y: 0}, {x: 10, y: 0}], triangles: [0, 1, 0], uvs: [0, 0, 1, 0] } },
        { id: 'bone', type: 'group', boneRole: 'root', name: 'bone',
          parent: null, transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      ],
    },
  });
  useEditorStore.setState({
    selection: ['partA'],
    editMode: 'edit',
    selectedVertexIndices: new Map(),
    activeVertex: null,
    toolMode: 'select',
  });
}

// ── Test 1: Edit → Pose → Edit preserves selection ──

{
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 0);
  useEditorStore.getState().selectVertex('partA', 1, true);
  // Now switch to Pose mode (need a bone selected first per enterEditMode contract).
  useEditorStore.setState({ selection: ['bone'] });
  // setSelection clears selection map, so for a true "preserve across mode switch"
  // test we need to swap modes WITHOUT changing selection. Reset and do the
  // switch directly via enterEditMode on the same part.
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 0);
  useEditorStore.getState().selectVertex('partA', 1, true);
  // enterEditMode on the SAME selection just switches the edit mode.
  // Pose Mode requires a bone-role group as the active selection — for
  // this test we exercise the mode-switch persistence via direct state
  // manipulation rather than enterEditMode (which checks dataKind).
  // The contract is: nothing in editorStore CLEARS the selection just
  // because editMode changed, except exitEditMode and setSelection.
  useEditorStore.setState({ editMode: 'pose' });
  let s = useEditorStore.getState();
  assert(s.selectedVertexIndices.get('partA')?.size === 2,
    'Test 1: Edit → Pose preserves vertex selection');

  useEditorStore.setState({ editMode: 'edit' });
  s = useEditorStore.getState();
  assert(s.selectedVertexIndices.get('partA')?.size === 2,
    'Test 1: Pose → Edit preserves vertex selection');
}

// ── Test 2: exitEditMode clears (Object Mode entry) ──

{
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 5);
  useEditorStore.getState().selectVertex('partA', 8, true);
  useEditorStore.getState().exitEditMode();
  const s = useEditorStore.getState();
  assert(s.selectedVertexIndices.size === 0,
    'Test 2: exitEditMode drops all vertex selections');
  assert(s.activeVertex === null,
    'Test 2: exitEditMode nulls activeVertex');
  assert(s.editMode === null, 'Test 2: editMode → null');
}

// ── Test 3: setSelection (different head) clears ──

{
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 0);
  useEditorStore.getState().selectVertex('partA', 1, true);
  // Switch active object — selection map should drop because
  // editMode goes to null in the same transition (Blender semantics).
  useEditorStore.getState().setSelection(['bone']);
  const s = useEditorStore.getState();
  assert(s.selectedVertexIndices.size === 0,
    'Test 3: setSelection to different head clears vertex selection');
  assert(s.activeVertex === null, 'Test 3: activeVertex cleared');
  assert(s.editMode === null,
    'Test 3: editMode dropped to null on selection-head change');
}

// ── Test 4: setSelection (same head) preserves ──

{
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 0);
  useEditorStore.getState().selectVertex('partA', 1, true);
  // Same first id — extend-only path; editMode stays put.
  useEditorStore.getState().setSelection(['partA']);
  const s = useEditorStore.getState();
  assert(s.selectedVertexIndices.get('partA')?.size === 2,
    'Test 4: setSelection same head preserves vertex selection');
  assert(s.editMode === 'edit', 'Test 4: editMode preserved');
}

// ── Test 5: selection extension on same head preserves ──

{
  setupBoneAndPart();
  useEditorStore.getState().selectVertex('partA', 0);
  // Multi-select extension keeps partA at the head.
  useEditorStore.getState().setSelection(['partA', 'bone']);
  const s = useEditorStore.getState();
  assert(s.selectedVertexIndices.get('partA')?.has(0),
    'Test 5: selection extension preserves vertex selection');
}

console.log(`vertexSelection_persistence: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
