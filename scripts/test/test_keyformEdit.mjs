// V4 Phase 3b — tests for the keyform-edit slot in editorStore.
//
// Locks in:
//   - enterEditMode('keyform', opts) requires deformerId + keyformIndex
//     + keyTuple + snapshot; populates `keyformEdit`.
//   - exitEditMode commits (clears slot, leaves project state alone).
//   - setSelection auto-exits keyform mode (commit semantics — no
//     restore from snapshot; the live edits already wrote to project).
//
// The Cancel/Esc restore-from-snapshot flow lives in the consuming UI
// (DeformerKeyformsSection) — tested by integration. Here we just lock
// the store-side primitives.
//
// Run: node scripts/test/test_keyformEdit.mjs

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

function reset() {
  useEditorStore.setState({
    selection: [],
    editMode: null,
    activeBlendShapeId: null,
    keyformEdit: null,
    meshSubMode: 'deform',
    toolMode: 'select',
  });
  usePreferencesStore.setState({ lockObjectModes: false });
}

// ── enter requires all opts ────────────────────────────────────────

reset();
{
  get().enterEditMode('keyform');
  assert(get().editMode === null, 'enterEditMode("keyform") with no opts: no-op');
  assert(get().keyformEdit === null, 'enterEditMode("keyform") with no opts: keyformEdit unset');
}

reset();
{
  // Missing snapshot
  get().enterEditMode('keyform', { deformerId: 'D1', keyformIndex: 0, keyTuple: [0] });
  assert(get().editMode === null, 'enterEditMode("keyform") without snapshot: no-op');
}

reset();
{
  // Missing keyTuple
  get().enterEditMode('keyform', { deformerId: 'D1', keyformIndex: 0, snapshot: {} });
  assert(get().editMode === null, 'enterEditMode("keyform") without keyTuple: no-op');
}

// ── enter populates the slot ───────────────────────────────────────

reset();
{
  const snapshot = { keyTuple: [-1, 0], positions: [1, 2, 3, 4] };
  get().enterEditMode('keyform', {
    deformerId: 'FaceParallaxWarp',
    keyformIndex: 4,
    keyTuple: [-1, 0],
    snapshot,
  });
  assert(get().editMode === 'keyform', 'enter populates editMode');
  const e = get().keyformEdit;
  assert(e !== null, 'keyformEdit set');
  assert(e.deformerId === 'FaceParallaxWarp', 'keyformEdit.deformerId stored');
  assert(e.keyformIndex === 4, 'keyformEdit.keyformIndex stored');
  assert(JSON.stringify(e.keyTuple) === '[-1,0]', 'keyformEdit.keyTuple stored');
  assert(e.snapshot === snapshot, 'keyformEdit.snapshot referenced');
  assert(e.authoredOnEntry === false, 'keyformEdit.authoredOnEntry defaults false');
}

// ── authoredOnEntry tracks pre-edit lock state ─────────────────────

reset();
{
  get().enterEditMode('keyform', {
    deformerId: 'D1',
    keyformIndex: 0,
    keyTuple: [0],
    snapshot: {},
    authoredOnEntry: true,
  });
  assert(get().keyformEdit?.authoredOnEntry === true,
    'authoredOnEntry: true preserved');
}

// ── exitEditMode commits (clears slot) ─────────────────────────────

reset();
{
  get().enterEditMode('keyform', {
    deformerId: 'D1', keyformIndex: 0, keyTuple: [0], snapshot: {},
  });
  get().exitEditMode();
  assert(get().editMode === null, 'exitEditMode: editMode cleared');
  assert(get().keyformEdit === null, 'exitEditMode: keyformEdit cleared');
}

// ── setSelection on different head: auto-exits keyform ──────────────

reset();
{
  useEditorStore.setState({
    selection: ['part-1'],
  });
  get().enterEditMode('keyform', {
    deformerId: 'D1', keyformIndex: 0, keyTuple: [0], snapshot: { foo: 'bar' },
  });
  // selection head change clears editMode
  get().setSelection(['part-2']);
  assert(get().editMode === null,
    'setSelection different head: editMode cleared');
  assert(get().keyformEdit === null,
    'setSelection different head: keyformEdit cleared');
}

// ── setSelection same head: keyform mode persists ──────────────────

reset();
{
  useEditorStore.setState({
    selection: ['part-1'],
  });
  get().enterEditMode('keyform', {
    deformerId: 'D1', keyformIndex: 0, keyTuple: [0], snapshot: {},
  });
  // Same head, different tail
  get().setSelection(['part-1', 'part-2']);
  assert(get().editMode === 'keyform',
    'setSelection same head: keyform mode persists');
  assert(get().keyformEdit !== null,
    'setSelection same head: keyformEdit persists');
}

// ── enter then re-enter different keyform: replaces slot ────────────

reset();
{
  get().enterEditMode('keyform', {
    deformerId: 'D1', keyformIndex: 0, keyTuple: [0], snapshot: { v: 'A' },
  });
  get().enterEditMode('keyform', {
    deformerId: 'D2', keyformIndex: 3, keyTuple: [1, 1], snapshot: { v: 'B' },
  });
  assert(get().keyformEdit?.deformerId === 'D2',
    're-enter: deformerId replaced');
  assert(get().keyformEdit?.snapshot?.v === 'B',
    're-enter: snapshot replaced');
}

// ── enter rejects non-keyform kinds via existing path ──────────────

reset();
{
  // Sanity: confirm pre-existing non-keyform kinds still work the same.
  // Legacy 'mesh' alias is normalised to 'edit' (Blender's universal
  // OB_MODE_EDIT) by enterEditMode.
  get().enterEditMode('mesh');
  assert(get().editMode === 'edit',
    'enterEditMode("mesh") legacy alias still works (normalised to "edit")');
  assert(get().keyformEdit === null,
    'enterEditMode("mesh") leaves keyformEdit null');
}

console.log(`keyformEdit: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
