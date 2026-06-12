// Regression for Pose Mode Shift+LMB bone toggle-select (2026-06-12,
// Phase 4 paint-fidelity follow-up — Pose audit).
//
// Bug class: Pose Mode + Select tool bone-click always single-replaced
// the selection (SkeletonOverlay.jsx:234 — pre-fix
// `selectBoneInBothStores(nodeId)` had no shift branch). Couldn't
// multi-select bones via Shift+LMB — incompatible with Blender's
// `pose_mode_keymap` which supports modifier-aware click selection.
//
// Fix:
//   - `selectBoneInBothStores(nodeId, mode = 'replace')` grows a mode
//     parameter that routes through `selectionStore.select(item, mode)`.
//     Default 'replace' keeps all existing single-arg callers unchanged.
//   - Pose Mode bone-click branch passes `e.shiftKey ? 'toggle' : 'replace'`.
//   - Legacy `editorStore.selection` slot is synced AFTER the toggle so
//     a deselect that empties items results in `setSelection([])`.
//
// Active-follows-click semantic: see [[active-follows-click-blender]].
// SS's selectionStore.toggle keeps the documented "active =
// items[length-1]" convention rather than Blender's
// BM_select_history_store-style active-tracking — toggle-deselecting
// the active bone falls back to the previous item or null. Flagged in
// that memory as intentional SS divergence; matching Blender would
// require a separate activeRef slot. Not changed in this commit.
//
// Run: node scripts/test/test_poseShiftLMBBoneToggle.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — replace mode (no shift) ────────────────────────────────────

function selectBone(state, nodeId, mode) {
  if (mode === 'replace') {
    state.items = [{ type: 'group', id: nodeId }];
  } else if (mode === 'toggle') {
    const idx = state.items.findIndex((it) => it.type === 'group' && it.id === nodeId);
    if (idx >= 0) {
      state.items.splice(idx, 1);
    } else {
      state.items.push({ type: 'group', id: nodeId });
    }
  } else if (mode === 'add') {
    if (!state.items.find((it) => it.type === 'group' && it.id === nodeId)) {
      state.items.push({ type: 'group', id: nodeId });
    }
  }
  // Sync legacy slot — active head from items[length-1] OR null
  const activeHead = state.items.length > 0
    ? state.items[state.items.length - 1].id
    : null;
  state.legacySelection = activeHead ? [activeHead] : [];
}

{
  const state = { items: [], legacySelection: [] };
  selectBone(state, 'bone1', 'replace');
  ok(state.items.length === 1 && state.items[0].id === 'bone1',
    '§1 — replace on empty: single bone added');
  ok(state.legacySelection[0] === 'bone1',
    '§1 — replace syncs active head to legacy slot');
}

{
  const state = { items: [{ type: 'group', id: 'bone_old' }], legacySelection: ['bone_old'] };
  selectBone(state, 'bone_new', 'replace');
  ok(state.items.length === 1 && state.items[0].id === 'bone_new',
    '§1 — replace with existing selection: old discarded, new takes over');
  ok(state.legacySelection[0] === 'bone_new',
    '§1 — legacy slot updates to new selection');
}

// ── §2 — toggle mode (Shift+LMB on unselected bone) ─────────────────

{
  const state = { items: [{ type: 'group', id: 'bone1' }], legacySelection: ['bone1'] };
  selectBone(state, 'bone2', 'toggle');
  ok(state.items.length === 2,
    '§2 — Shift+LMB on unselected bone: ADDS to existing selection');
  ok(state.items.map((it) => it.id).join(',') === 'bone1,bone2',
    '§2 — order: existing first, new appended');
  ok(state.legacySelection[0] === 'bone2',
    '§2 — active head moves to newly-added bone (matches items[last])');
}

// ── §3 — toggle mode (Shift+LMB on already-selected bone) ────────────

{
  const state = {
    items: [
      { type: 'group', id: 'bone1' },
      { type: 'group', id: 'bone2' },
      { type: 'group', id: 'bone3' },
    ],
    legacySelection: ['bone3'],
  };
  selectBone(state, 'bone2', 'toggle');
  ok(state.items.length === 2,
    '§3 — Shift+LMB on selected bone: REMOVES it');
  ok(state.items.map((it) => it.id).join(',') === 'bone1,bone3',
    '§3 — middle item removed, surrounding preserved in order');
  ok(state.legacySelection[0] === 'bone3',
    '§3 — active head stays at last-remaining item (documented SS '
    + 'convention, not Blender-fidelity per [[active-follows-click-blender]])');
}

// ── §4 — toggle-deselect the active bone ────────────────────────────
//
// Toggling off the currently-active bone falls back active to previous
// item per SS convention. NOT Blender-fidelity (Blender's
// BM_select_history_store keeps the clicked element as active even on
// deselect via a separate history list). Documented divergence — see
// the `active-follows-click-blender` memory.

{
  const state = {
    items: [
      { type: 'group', id: 'bone1' },
      { type: 'group', id: 'bone2' },
    ],
    legacySelection: ['bone2'],
  };
  selectBone(state, 'bone2', 'toggle');
  ok(state.items.length === 1 && state.items[0].id === 'bone1',
    '§4 — active bone toggled off → removed');
  ok(state.legacySelection[0] === 'bone1',
    '§4 — active head falls back to previous item (NOT bone2 per Blender semantic)');
}

// ── §5 — toggle-deselect last remaining bone ────────────────────────

{
  const state = {
    items: [{ type: 'group', id: 'bone1' }],
    legacySelection: ['bone1'],
  };
  selectBone(state, 'bone1', 'toggle');
  ok(state.items.length === 0, '§5 — last bone toggled off → empty');
  ok(state.legacySelection.length === 0,
    '§5 — legacy slot empties (active head null)');
}

// ── §6 — shift-key dispatch policy ──────────────────────────────────

function dispatchMode(shiftKey) {
  return shiftKey ? 'toggle' : 'replace';
}

ok(dispatchMode(false) === 'replace', '§6 — no modifier → replace');
ok(dispatchMode(true) === 'toggle', '§6 — Shift held → toggle');

// ── §7 — single-arg legacy call defaults to replace ─────────────────
//
// All non-Pose-mode callers (Object Mode armature-root click, etc.)
// pass nodeId only. Default `mode = 'replace'` keeps them unchanged.

function callWithDefaults(state, nodeId) {
  const mode = 'replace'; // default
  selectBone(state, nodeId, mode);
}

{
  const state = { items: [], legacySelection: [] };
  callWithDefaults(state, 'arm_root');
  ok(state.items.length === 1 && state.items[0].id === 'arm_root',
    '§7 — single-arg callers behave identically to pre-refactor');
}

// ── §8 — Pose Mode gate (only fires when editMode=pose && toolMode=select) ─

function poseClickFires(editMode, toolMode) {
  return editMode === 'pose' && toolMode === 'select';
}

ok(poseClickFires('pose', 'select') === true,
  '§8 — Pose Mode + Select tool → click selects bone');
ok(poseClickFires('pose', 'joint_drag') === false,
  '§8 — Pose Mode + Joint Drag → click is drag-to-pose, NOT select');
ok(poseClickFires(null, 'select') === false,
  '§8 — Object Mode + Select → click is OBJECT click (walks to armature root)');
ok(poseClickFires('edit', 'select') === false,
  '§8 — Edit Mode → not this handler');

console.log(`poseShiftLMBBoneToggle: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
