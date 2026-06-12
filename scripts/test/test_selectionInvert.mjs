// Regression for Ctrl+I invert selection (2026-06-12, Phase 4
// paint-fidelity follow-up — Pose audit closes Ctrl+I gap).
//
// Bug class: Ctrl+I was unbound. Blender binds it as a polymorphic
// chord:
//   - Edit Mode (mesh) → mesh.select_all(action='INVERT') over verts
//   - Pose Mode → pose.select_all(action='INVERT') over bones
//   - Object Mode → object.select_all(action='INVERT') over objects
//
// Fix:
//   - New `selection.invert` operator dispatches on editMode + toolMode.
//   - Edit Mode: new `editorStore.invertVertexSelection(partId, vertCount)`
//     method computes the complement set. Active vertex stays put if
//     still selected, else clears (mirrors deselectAllVertices' active
//     handling).
//   - Pose Mode: visible bone IDs collected (group + boneRole +
//     visible !== false). Complement vs currently-selected bones,
//     non-bone selection items pass through untouched.
//   - Object Mode: visible part IDs collected. Complement, non-part
//     items pass through.
//   - Keymap: Ctrl+KeyI → selection.invert.
//
// Run: node scripts/test/test_selectionInvert.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — Edit Mode vertex invert ────────────────────────────────────

function invertVertexSelection(state, partId, vertCount) {
  const cur = state.selectedVertexIndices.get(partId);
  const fresh = new Set();
  for (let i = 0; i < vertCount; i++) {
    if (!cur || !cur.has(i)) fresh.add(i);
  }
  if (fresh.size === 0) {
    state.selectedVertexIndices.delete(partId);
  } else {
    state.selectedVertexIndices.set(partId, fresh);
  }
  const av = state.activeVertex;
  const activeStillSelected = !!(av && av.partId === partId && fresh.has(av.vertIndex));
  if (!activeStillSelected) {
    state.activeVertex = (av && av.partId === partId) ? null : av;
  }
}

{
  const state = {
    selectedVertexIndices: new Map([['p1', new Set([0, 2])]]),
    activeVertex: { partId: 'p1', vertIndex: 0 },
  };
  invertVertexSelection(state, 'p1', 5);
  const result = state.selectedVertexIndices.get('p1');
  ok(result?.has(1) && result?.has(3) && result?.has(4),
    '§1 — invert [0,2] in count=5 → {1,3,4}');
  ok(!result?.has(0) && !result?.has(2),
    '§1 — invert removes previously-selected indices');
  ok(state.activeVertex === null,
    '§1 — active vertex was 0 (now deselected) → cleared');
}

{
  const state = {
    selectedVertexIndices: new Map([['p1', new Set([1])]]),
    activeVertex: { partId: 'p1', vertIndex: 1 },
  };
  invertVertexSelection(state, 'p1', 3);
  ok(state.activeVertex === null, '§1 — active=1 was selected, now inverted out → cleared');
}

{
  const state = {
    selectedVertexIndices: new Map([['p1', new Set([0, 1, 2])]]),
    activeVertex: { partId: 'p1', vertIndex: 0 },
  };
  invertVertexSelection(state, 'p1', 3);
  ok(!state.selectedVertexIndices.has('p1'),
    '§1 — invert ALL-selected vertices → empty set → map entry DELETED');
  ok(state.activeVertex === null, '§1 — active vertex cleared on empty invert');
}

{
  const state = {
    selectedVertexIndices: new Map(),
    activeVertex: null,
  };
  invertVertexSelection(state, 'p1', 3);
  const result = state.selectedVertexIndices.get('p1');
  ok(result?.size === 3,
    '§1 — invert from EMPTY → all 3 verts selected (like A select-all)');
}

// ── §2 — Pose Mode bone invert ──────────────────────────────────────

function invertPose(state) {
  const project = state.project;
  const boneIds = (project?.nodes ?? [])
    .filter((n) => n && n.type === 'group'
      && typeof n.boneRole === 'string' && n.boneRole.length > 0
      && n.visible !== false)
    .map((n) => n.id);
  if (boneIds.length === 0) return 'NO_BONES';
  const selectedBoneIds = new Set(
    state.selectionItems.filter((it) => it?.type === 'group' && boneIds.includes(it.id))
      .map((it) => it.id),
  );
  const nonBoneItems = state.selectionItems.filter((it) =>
    !(it?.type === 'group' && boneIds.includes(it.id)));
  const invertedBoneItems = boneIds
    .filter((id) => !selectedBoneIds.has(id))
    .map((id) => ({ type: 'group', id }));
  state.selectionItems = [...nonBoneItems, ...invertedBoneItems];
  state.editorSelection = state.selectionItems.length > 0
    ? [state.selectionItems[state.selectionItems.length - 1].id]
    : [];
  return 'INVERTED';
}

const makePoseProject = () => ({
  nodes: [
    { id: 'b1', type: 'group', boneRole: 'rightArm', visible: true },
    { id: 'b2', type: 'group', boneRole: 'leftArm', visible: true },
    { id: 'b3', type: 'group', boneRole: 'neck', visible: true },
    { id: 'b_hidden', type: 'group', boneRole: 'eye', visible: false },
    { id: 'part_a', type: 'part', visible: true },
  ],
});

{
  const state = { project: makePoseProject(), selectionItems: [], editorSelection: [] };
  invertPose(state);
  ok(state.selectionItems.length === 3, '§2 — invert empty → 3 visible bones selected');
  ok(state.selectionItems.every((it) => it.type === 'group'),
    '§2 — only group-typed items');
  ok(!state.selectionItems.find((it) => it.id === 'b_hidden'),
    '§2 — hidden bone NOT in inverted set');
}

{
  const state = {
    project: makePoseProject(),
    selectionItems: [{ type: 'group', id: 'b1' }],
    editorSelection: ['b1'],
  };
  invertPose(state);
  ok(state.selectionItems.length === 2, '§2 — 1 of 3 selected → invert to other 2');
  ok(state.selectionItems.map((it) => it.id).sort().join(',') === 'b2,b3',
    '§2 — inverted set is exactly {b2,b3}');
}

{
  const state = {
    project: makePoseProject(),
    selectionItems: [
      { type: 'group', id: 'b1' },
      { type: 'part', id: 'part_a' },
    ],
    editorSelection: ['part_a'],
  };
  invertPose(state);
  ok(state.selectionItems.length === 3, '§2 — non-bone item preserved (1 part + 2 inverted bones)');
  ok(state.selectionItems.find((it) => it.type === 'part' && it.id === 'part_a'),
    '§2 — part_a still present (non-bone untouched by Pose invert)');
  ok(state.selectionItems.filter((it) => it.type === 'group').map((it) => it.id).sort().join(',') === 'b2,b3',
    '§2 — bones inverted; part untouched');
}

// ── §3 — Object Mode part invert ────────────────────────────────────

function invertObject(state) {
  const project = state.project;
  const partIds = (project?.nodes ?? [])
    .filter((n) => n?.type === 'part' && n.visible !== false)
    .map((n) => n.id);
  if (partIds.length === 0) return 'NO_PARTS';
  const selectedPartIds = new Set(
    state.selectionItems.filter((it) => it?.type === 'part' && partIds.includes(it.id))
      .map((it) => it.id),
  );
  const nonPartItems = state.selectionItems.filter((it) =>
    !(it?.type === 'part' && partIds.includes(it.id)));
  const invertedPartItems = partIds
    .filter((id) => !selectedPartIds.has(id))
    .map((id) => ({ type: 'part', id }));
  state.selectionItems = [...nonPartItems, ...invertedPartItems];
  return 'INVERTED';
}

{
  const state = {
    project: {
      nodes: [
        { id: 'pa', type: 'part', visible: true },
        { id: 'pb', type: 'part', visible: true },
        { id: 'pc', type: 'part', visible: false }, // hidden
      ],
    },
    selectionItems: [{ type: 'part', id: 'pa' }],
  };
  invertObject(state);
  ok(state.selectionItems.length === 1 && state.selectionItems[0].id === 'pb',
    '§3 — invert {pa} from visible {pa,pb} → {pb} (pc hidden ignored)');
}

// ── §4 — dispatch: which branch fires per editMode ──────────────────

function dispatchBranch(editMode, toolMode) {
  if (editMode === 'edit' && toolMode === 'select') return 'EDIT_VERTEX';
  if (editMode === 'pose') return 'POSE_BONE';
  return 'OBJECT_PART';
}

ok(dispatchBranch('edit', 'select') === 'EDIT_VERTEX', '§4 — Edit + select → vertex branch');
ok(dispatchBranch('edit', 'brush') === 'OBJECT_PART',
  '§4 — Edit + brush tool → falls through (vertex branch gated by select tool)');
ok(dispatchBranch('pose', 'select') === 'POSE_BONE', '§4 — Pose → bone branch');
ok(dispatchBranch('pose', 'joint_drag') === 'POSE_BONE',
  '§4 — Pose tool-mode doesn\'t matter — Ctrl+I always inverts bones in Pose Mode');
ok(dispatchBranch(null, 'select') === 'OBJECT_PART', '§4 — Object Mode → part branch');
ok(dispatchBranch('sculpt', 'brush') === 'OBJECT_PART',
  '§4 — Sculpt → falls through to Object branch (no sculpt-specific invert)');
ok(dispatchBranch('weightPaint', 'brush') === 'OBJECT_PART',
  '§4 — Weight Paint → falls through (no weight-paint-specific invert)');

console.log(`selectionInvert: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
