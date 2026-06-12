// Regression for Pose Mode L linked-select bones (2026-06-12, Phase 4
// paint-fidelity follow-up — Pose audit).
//
// Bug class: L (`select.linked.cursor` operator) was Edit-Mode-only via
// `available: () => activeEditPart() !== null`. Pressing L in Pose
// Mode silently no-op'd (operator unavailable). Blender's
// `pose.select_linked` extends bone selection to all bones in the
// SAME armature object as the currently-selected bones.
//
// Fix: extend the existing `select.linked.cursor` operator to be
// polymorphic — Pose Mode branch fires `runSelectLinkedPoseBones()`,
// Edit Mode keeps existing vertex flood-fill. available() now returns
// true in Pose Mode whenever any bone is selected.
//
// Algorithm:
//   1. Walk parent chain from each selected bone to find the first
//      non-bone ancestor — that's the armature root. Collect all
//      armature roots reached (handles multi-armature projects).
//   2. For every visible bone in the project, walk its chain to find
//      its armature root. If it matches one of the collected roots,
//      include in linked selection.
//   3. Preserve non-bone selection items (parts, plain groups, the
//      armature roots themselves if they were selected before).
//
// Run: node scripts/test/test_poseSelectLinkedBones.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function isBone(n) {
  return !!n && n.type === 'group'
    && typeof n.boneRole === 'string' && n.boneRole.length > 0;
}

function runLinked(state) {
  const project = state.project;
  if (!project?.nodes) return 'NO_PROJECT';
  const byId = new Map();
  for (const n of project.nodes) if (n?.id) byId.set(n.id, n);

  const selectedBoneIds = state.selectionItems
    .filter((it) => it?.type === 'group' && isBone(byId.get(it.id)))
    .map((it) => it.id);
  if (selectedBoneIds.length === 0) return 'NO_SELECTED_BONES';

  const armatureRootIds = new Set();
  for (const bid of selectedBoneIds) {
    let cur = byId.get(bid);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (!cur.parent) { armatureRootIds.add('__projectRoot__'); break; }
      const parent = byId.get(cur.parent);
      if (!parent) break;
      if (!isBone(parent)) { armatureRootIds.add(parent.id); break; }
      cur = parent;
    }
  }
  if (armatureRootIds.size === 0) return 'NO_ROOTS';

  const boneToRoot = new Map();
  const rootOf = (id) => {
    if (boneToRoot.has(id)) return boneToRoot.get(id);
    let cur = byId.get(id);
    const path = [];
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.push(cur.id);
      if (!cur.parent) {
        for (const p of path) boneToRoot.set(p, '__projectRoot__');
        return '__projectRoot__';
      }
      const parent = byId.get(cur.parent);
      if (!parent) break;
      if (!isBone(parent)) {
        for (const p of path) boneToRoot.set(p, parent.id);
        return parent.id;
      }
      cur = parent;
    }
    for (const p of path) boneToRoot.set(p, null);
    return null;
  };
  const linkedItems = [];
  for (const n of project.nodes) {
    if (!isBone(n)) continue;
    if (n.visible === false) continue;
    const r = rootOf(n.id);
    if (r && armatureRootIds.has(r)) linkedItems.push({ type: 'group', id: n.id });
  }
  if (linkedItems.length === 0) return 'NO_LINKED';
  const nonBoneItems = state.selectionItems.filter((it) =>
    !(it?.type === 'group' && isBone(byId.get(it.id))));
  state.selectionItems = [...nonBoneItems, ...linkedItems];
  state.editorSelection = state.selectionItems.length > 0
    ? [state.selectionItems[state.selectionItems.length - 1].id]
    : [];
  return 'LINKED';
}

// ── §1 — single armature: select linked from one bone selects all ───

const singleArmature = {
  nodes: [
    { id: 'arm_root', type: 'group', visible: true /* no boneRole = armature root */ },
    { id: 'spine', type: 'group', boneRole: 'spine', parent: 'arm_root', visible: true },
    { id: 'neck', type: 'group', boneRole: 'neck', parent: 'spine', visible: true },
    { id: 'head', type: 'group', boneRole: 'head', parent: 'neck', visible: true },
    { id: 'arm', type: 'group', boneRole: 'rightArm', parent: 'spine', visible: true },
    { id: 'forearm', type: 'group', boneRole: 'rightForearm', parent: 'arm', visible: true },
  ],
};

{
  const state = {
    project: singleArmature,
    selectionItems: [{ type: 'group', id: 'head' }],
    editorSelection: ['head'],
  };
  const result = runLinked(state);
  ok(result === 'LINKED', '§1 — linked OK');
  ok(state.selectionItems.length === 5, '§1 — all 5 bones selected (root excluded — no boneRole)');
  const ids = state.selectionItems.map((it) => it.id).sort();
  ok(ids.join(',') === 'arm,forearm,head,neck,spine',
    '§1 — exactly {arm, forearm, head, neck, spine} — no arm_root');
}

// ── §2 — no bone selected → no-op ───────────────────────────────────

{
  const state = {
    project: singleArmature,
    selectionItems: [],
    editorSelection: [],
  };
  const result = runLinked(state);
  ok(result === 'NO_SELECTED_BONES', '§2 — empty selection → no-op');
}

// ── §3 — non-bone selected (part, armature root) → no-op ────────────

{
  const state = {
    project: {
      nodes: [
        ...singleArmature.nodes,
        { id: 'part_a', type: 'part', visible: true },
      ],
    },
    selectionItems: [{ type: 'part', id: 'part_a' }],
    editorSelection: ['part_a'],
  };
  ok(runLinked(state) === 'NO_SELECTED_BONES', '§3 — part selected, no bone → no-op');
}

{
  const state = {
    project: singleArmature,
    selectionItems: [{ type: 'group', id: 'arm_root' }],
    editorSelection: ['arm_root'],
  };
  ok(runLinked(state) === 'NO_SELECTED_BONES',
    '§3 — armature root (group, no boneRole) selected → not a bone → no-op');
}

// ── §4 — multi-armature project: union of armatures hit ─────────────

const multiArmature = {
  nodes: [
    // armature 1
    { id: 'arm1_root', type: 'group', visible: true },
    { id: 'a1_spine', type: 'group', boneRole: 'spine', parent: 'arm1_root', visible: true },
    { id: 'a1_head',  type: 'group', boneRole: 'head',  parent: 'a1_spine', visible: true },
    // armature 2 (separate)
    { id: 'arm2_root', type: 'group', visible: true },
    { id: 'a2_arm',   type: 'group', boneRole: 'leftArm',     parent: 'arm2_root', visible: true },
    { id: 'a2_fore',  type: 'group', boneRole: 'leftForearm', parent: 'a2_arm',    visible: true },
  ],
};

{
  const state = {
    project: multiArmature,
    selectionItems: [
      { type: 'group', id: 'a1_head' },
      { type: 'group', id: 'a2_arm' },
    ],
    editorSelection: ['a2_arm'],
  };
  runLinked(state);
  const ids = state.selectionItems.map((it) => it.id).sort();
  ok(ids.join(',') === 'a1_head,a1_spine,a2_arm,a2_fore',
    '§4 — multi-armature: both arms get fully selected');
}

{
  const state = {
    project: multiArmature,
    selectionItems: [{ type: 'group', id: 'a1_head' }],
    editorSelection: ['a1_head'],
  };
  runLinked(state);
  const ids = state.selectionItems.map((it) => it.id).sort();
  ok(ids.join(',') === 'a1_head,a1_spine',
    '§4 — multi-armature: only the active arm gets expanded, NOT both');
}

// ── §5 — hidden bones excluded ──────────────────────────────────────

{
  const project = {
    nodes: [
      { id: 'r', type: 'group', visible: true },
      { id: 'b1', type: 'group', boneRole: 'spine', parent: 'r', visible: true },
      { id: 'b2', type: 'group', boneRole: 'head',  parent: 'b1', visible: true },
      { id: 'b3', type: 'group', boneRole: 'tail',  parent: 'b1', visible: false /* hidden */ },
    ],
  };
  const state = {
    project,
    selectionItems: [{ type: 'group', id: 'b1' }],
    editorSelection: ['b1'],
  };
  runLinked(state);
  const ids = state.selectionItems.map((it) => it.id).sort();
  ok(ids.join(',') === 'b1,b2',
    '§5 — hidden b3 excluded from linked set');
}

// ── §6 — non-bone selection items preserved ─────────────────────────

{
  const project = {
    nodes: [
      ...singleArmature.nodes,
      { id: 'extra_part', type: 'part', visible: true },
    ],
  };
  const state = {
    project,
    selectionItems: [
      { type: 'group', id: 'head' },
      { type: 'part', id: 'extra_part' },
    ],
    editorSelection: ['extra_part'],
  };
  runLinked(state);
  ok(state.selectionItems.find((it) => it.type === 'part' && it.id === 'extra_part'),
    '§6 — part stays selected after linked-expand');
  const boneCount = state.selectionItems.filter((it) =>
    it?.type === 'group' && isBone({ id: it.id, ...project.nodes.find((n) => n.id === it.id) })).length;
  ok(boneCount === 5, '§6 — all 5 armature bones selected alongside the part');
}

// ── §7 — top-level bone (no parent) → projectRoot sentinel ──────────
//
// If a bone has no parent at all (free-floating bone, no armature
// root in the parent chain), its "armature" is the project root
// sentinel. Linked select then collects every other parent-less
// bone (same sentinel) — useful for ad-hoc rigs.

{
  const project = {
    nodes: [
      { id: 'free_bone1', type: 'group', boneRole: 'misc1', visible: true /* no parent */ },
      { id: 'free_bone2', type: 'group', boneRole: 'misc2', visible: true /* no parent */ },
      { id: 'rooted_root', type: 'group', visible: true },
      { id: 'rooted_bone', type: 'group', boneRole: 'spine', parent: 'rooted_root', visible: true },
    ],
  };
  const state = {
    project,
    selectionItems: [{ type: 'group', id: 'free_bone1' }],
    editorSelection: ['free_bone1'],
  };
  runLinked(state);
  const ids = state.selectionItems.map((it) => it.id).sort();
  ok(ids.join(',') === 'free_bone1,free_bone2',
    '§7 — orphan bones share __projectRoot__ sentinel; both selected');
  ok(!ids.includes('rooted_bone'),
    '§7 — rooted bones NOT included (different armature)');
}

// ── §8 — available() gate ───────────────────────────────────────────

function availableInPose(selectionItems, project) {
  return selectionItems.some((it) => {
    if (it?.type !== 'group') return false;
    const n = project.nodes.find((nn) => nn?.id === it.id);
    return isBone(n);
  });
}

ok(availableInPose(
  [{ type: 'group', id: 'head' }],
  singleArmature,
) === true, '§8 — Pose available() = true when bone selected');

ok(availableInPose(
  [],
  singleArmature,
) === false, '§8 — Pose available() = false when no bone selected (silences L no-op toast)');

ok(availableInPose(
  [{ type: 'group', id: 'arm_root' }],
  singleArmature,
) === false, '§8 — Pose available() = false when only armature root selected (no boneRole)');

console.log(`poseSelectLinkedBones: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
