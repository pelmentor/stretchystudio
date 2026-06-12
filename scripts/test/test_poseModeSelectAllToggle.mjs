// Regression for Pose Mode A / Alt+A bone-scoped select-all / deselect-all
// (2026-06-12, Phase 4 paint-fidelity follow-up — Pose audit).
//
// Bug class: Pose Mode A and Alt+A fell through to the Object Mode
// branch, which (a) cleared bone selection if anything was selected,
// then (b) on next press of A, selected all PARTS in the project
// instead of bones. Both wrong for Pose Mode — Blender's
// `pose_mode_keymap` binds A to `pose.select_all` which scopes to
// bones within the active armature.
//
// Fix:
//   - selection.selectAllToggle gets a Pose Mode branch: if any bone
//     selected → clear; else → select all visible bone groups (groups
//     with non-empty boneRole, visible !== false).
//   - selection.deselectAll gets a Pose Mode branch: filter out
//     bone-typed items from selection (leaves non-bone items alone so
//     a selected armature root stays selected as active object).
//
// Run: node scripts/test/test_poseModeSelectAllToggle.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — selectAllToggle: Pose Mode branch ───────────────────────────
//
// Mirror of the operator's Pose Mode branch policy:
//   1. Collect all visible bone groups (group + non-empty boneRole + visible !== false)
//   2. If selectionStore has any bone item → clear
//   3. Otherwise → select-replace all bones; legacy slot = last bone id

function selectAllTogglePose(state) {
  const project = state.project;
  const boneIds = (project?.nodes ?? [])
    .filter((n) => n && n.type === 'group'
      && typeof n.boneRole === 'string' && n.boneRole.length > 0
      && n.visible !== false)
    .map((n) => n.id);
  if (boneIds.length === 0) return 'NO_BONES';
  const selectedBones = state.selectionItems.filter((it) =>
    it?.type === 'group' && boneIds.includes(it.id));
  if (selectedBones.length > 0) {
    state.selectionItems = [];
    state.editorSelection = [];
    return 'CLEARED';
  }
  state.selectionItems = boneIds.map((id) => ({ type: 'group', id }));
  state.editorSelection = [boneIds[boneIds.length - 1]];
  return 'SELECTED_ALL';
}

const makeProject = () => ({
  nodes: [
    { id: 'arm', type: 'group', boneRole: 'rightArm', visible: true },
    { id: 'forearm', type: 'group', boneRole: 'rightForearm', visible: true },
    { id: 'hand', type: 'group', boneRole: 'rightHand', visible: true },
    { id: 'hidden_bone', type: 'group', boneRole: 'leftEye', visible: false },
    { id: 'plain_group', type: 'group', visible: true },
    { id: 'part_a', type: 'part', visible: true },
    { id: 'part_b', type: 'part', visible: true },
  ],
});

{
  const state = { project: makeProject(), selectionItems: [], editorSelection: [] };
  const result = selectAllTogglePose(state);
  ok(result === 'SELECTED_ALL', '§1 — nothing selected → SELECTED_ALL');
  ok(state.selectionItems.length === 3,
    '§1 — exactly 3 bones selected (visible bones only, hidden_bone excluded)');
  ok(state.selectionItems.every((it) => it.type === 'group'),
    '§1 — all selected items are group-typed');
  ok(state.editorSelection.length === 1 && state.editorSelection[0] === 'hand',
    '§1 — editorStore.selection holds last bone id as active head');
  ok(!state.selectionItems.find((it) => it.id === 'plain_group'),
    '§1 — plain_group (no boneRole) NOT selected');
  ok(!state.selectionItems.find((it) => it.id === 'part_a'),
    '§1 — parts NOT selected (this is the bug the fix closes)');
  ok(!state.selectionItems.find((it) => it.id === 'hidden_bone'),
    '§1 — hidden bone NOT selected (visible:false filtered)');
}

{
  const state = { project: makeProject(), selectionItems: [], editorSelection: [] };
  selectAllTogglePose(state); // first A: select all
  const result = selectAllTogglePose(state); // second A: clear
  ok(result === 'CLEARED', '§1 — second A press → CLEARED');
  ok(state.selectionItems.length === 0, '§1 — selection emptied');
  ok(state.editorSelection.length === 0, '§1 — editor selection emptied');
}

{
  const state = {
    project: makeProject(),
    selectionItems: [{ type: 'group', id: 'arm' }],
    editorSelection: ['arm'],
  };
  const result = selectAllTogglePose(state);
  ok(result === 'CLEARED', '§1 — A with 1 bone selected → CLEARED (Blender behavior)');
}

{
  const state = {
    project: { nodes: [{ id: 'part_a', type: 'part', visible: true }] },
    selectionItems: [],
    editorSelection: [],
  };
  const result = selectAllTogglePose(state);
  ok(result === 'NO_BONES', '§1 — project with no bones → NO_BONES (no-op)');
}

// ── §2 — deselectAll: Pose Mode branch ──────────────────────────────
//
// Filter out bone items only — leave non-bone items (parts, plain
// groups, armature roots without boneRole) alone. Blender's
// pose.select_all(action='DESELECT') is scoped to the active armature.

function deselectAllPose(state) {
  const project = state.project;
  const isBone = (it) => {
    if (it?.type !== 'group') return false;
    const node = project?.nodes?.find((n) => n?.id === it.id);
    return !!node && typeof node.boneRole === 'string' && node.boneRole.length > 0;
  };
  const nonBoneItems = state.selectionItems.filter((it) => !isBone(it));
  if (nonBoneItems.length === state.selectionItems.length) return 'NO_BONES_SELECTED';
  state.selectionItems = nonBoneItems;
  state.editorSelection = nonBoneItems.length > 0
    ? [nonBoneItems[nonBoneItems.length - 1].id]
    : [];
  return 'DESELECTED';
}

{
  const state = {
    project: makeProject(),
    selectionItems: [
      { type: 'group', id: 'arm' },
      { type: 'group', id: 'forearm' },
      { type: 'part', id: 'part_a' },
    ],
    editorSelection: ['part_a'],
  };
  const result = deselectAllPose(state);
  ok(result === 'DESELECTED', '§2 — mixed selection: Alt+A deselects bones only');
  ok(state.selectionItems.length === 1, '§2 — 1 item left (the part)');
  ok(state.selectionItems[0].id === 'part_a', '§2 — part remains selected');
  ok(state.editorSelection[0] === 'part_a', '§2 — active head moves to the part');
}

{
  const state = {
    project: makeProject(),
    selectionItems: [{ type: 'part', id: 'part_a' }],
    editorSelection: ['part_a'],
  };
  const result = deselectAllPose(state);
  ok(result === 'NO_BONES_SELECTED',
    '§2 — only parts selected → no-op (NO_BONES_SELECTED)');
  ok(state.selectionItems.length === 1, '§2 — part selection unchanged');
}

{
  const state = {
    project: makeProject(),
    selectionItems: [
      { type: 'group', id: 'arm' },
      { type: 'group', id: 'forearm' },
    ],
    editorSelection: ['forearm'],
  };
  const result = deselectAllPose(state);
  ok(result === 'DESELECTED', '§2 — only bones: Alt+A clears all');
  ok(state.selectionItems.length === 0, '§2 — selection emptied');
  ok(state.editorSelection.length === 0, '§2 — active head emptied');
}

{
  const state = {
    project: makeProject(),
    selectionItems: [
      { type: 'group', id: 'plain_group' },  // group, no boneRole
    ],
    editorSelection: ['plain_group'],
  };
  const result = deselectAllPose(state);
  ok(result === 'NO_BONES_SELECTED',
    '§2 — plain_group (no boneRole) is NOT a bone — Alt+A no-op on it');
  ok(state.selectionItems.length === 1, '§2 — plain_group stays selected');
}

// ── §3 — gate is editMode === 'pose' ────────────────────────────────
//
// Object Mode A continues to operate on parts; Edit Mode A continues
// to operate on vertices. The new branch is exclusive to Pose Mode.

function whichBranch(editMode, toolMode) {
  if (editMode === 'edit' && toolMode === 'select') return 'EDIT_VERTEX';
  if (editMode === 'pose') return 'POSE_BONE';
  return 'OBJECT_PART';
}

ok(whichBranch('edit', 'select') === 'EDIT_VERTEX', '§3 — Edit Mode → vertex branch');
ok(whichBranch('pose', 'select') === 'POSE_BONE', '§3 — Pose Mode → bone branch (new)');
ok(whichBranch(null, 'select') === 'OBJECT_PART', '§3 — Object Mode → part branch');
ok(whichBranch('sculpt', 'brush') === 'OBJECT_PART',
  '§3 — Sculpt/Weight Paint fall through to OBJECT branch (no A binding there yet)');
ok(whichBranch('edit', 'brush') === 'OBJECT_PART',
  '§3 — Edit Mode + brush tool: falls through (vertex branch is select-tool gated)');

// ── §4 — selection isolation: armature root with no boneRole stays ──
//
// If user selected an armature root (a group with boneRole undefined or
// empty — the top-level armature container, NOT a bone), Alt+A should
// NOT clear it. The armature root is the "active object" container in
// Pose Mode; bones live INSIDE it.

{
  const state = {
    project: {
      nodes: [
        { id: 'armature_root', type: 'group' /* no boneRole */, visible: true },
        { id: 'bone1', type: 'group', boneRole: 'rightArm', visible: true },
      ],
    },
    selectionItems: [
      { type: 'group', id: 'armature_root' },
      { type: 'group', id: 'bone1' },
    ],
    editorSelection: ['bone1'],
  };
  deselectAllPose(state);
  ok(state.selectionItems.length === 1, '§4 — armature root survives Alt+A');
  ok(state.selectionItems[0].id === 'armature_root',
    '§4 — armature root specifically is the survivor');
  ok(state.editorSelection[0] === 'armature_root',
    '§4 — active head moves to armature root');
}

console.log(`poseModeSelectAllToggle: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
