// Regression for Pose Mode Ctrl+LMB linked-pick (2026-06-12, Phase 4
// paint-fidelity follow-up — Pose audit).
//
// Bug class: Ctrl+LMB on a bone in Pose Mode had no effect — the
// SkeletonOverlay bone-click handler only checked shiftKey for toggle
// vs replace, missed Ctrl entirely. Blender's
// `pose.select_linked_pick(extend=False)` extends bone selection
// to all bones in the SAME armature as the clicked bone (without
// needing the bone to be pre-selected first — L requires that).
//
// Fix: SkeletonOverlay's Pose+Select bone-click branch grows a
// Ctrl/Meta check ABOVE the shift toggle check:
//   - Ctrl+LMB → linked-pick replace (selection = clicked bone's
//     armature bones). Active head = clicked bone.
//   - Ctrl+Shift+LMB → linked-pick extend (linked bones ADDED to
//     existing selection, no replace). Active head = clicked bone.
//   - Shift+LMB (no Ctrl) → toggle clicked bone (shipped c080e8e).
//   - bare LMB → single replace.
//
// Shared algorithm: `computeLinkedBoneIds(project, seedIds)` extracted
// into `src/lib/pose/selectLinked.js` — used by both the L keymap
// operator (selection-driven seeds) and this click handler (cursor-
// driven seeds). Both consumers walk the same parent-chain logic to
// find armature roots and collect descendant bones.
//
// Run: node scripts/test/test_poseCtrlLMBLinkedPick.mjs

import { computeLinkedBoneIds, isBoneGroupNode } from '../../src/lib/pose/selectLinked.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — computeLinkedBoneIds: basic chain expansion ─────────────────

const arm1 = {
  nodes: [
    { id: 'arm1_root', type: 'group', visible: true /* no boneRole */ },
    { id: 'spine',  type: 'group', boneRole: 'spine',  parent: 'arm1_root', visible: true },
    { id: 'neck',   type: 'group', boneRole: 'neck',   parent: 'spine', visible: true },
    { id: 'head',   type: 'group', boneRole: 'head',   parent: 'neck', visible: true },
    { id: 'r_arm',  type: 'group', boneRole: 'rArm',   parent: 'spine', visible: true },
    { id: 'r_fore', type: 'group', boneRole: 'rFore',  parent: 'r_arm', visible: true },
  ],
};

{
  const linked = computeLinkedBoneIds(arm1, ['head']);
  ok(linked.size === 5, '§1 — seed=head → 5 bones reached (root excluded)');
  ok(linked.has('spine') && linked.has('neck') && linked.has('head'),
    '§1 — head chain reached');
  ok(linked.has('r_arm') && linked.has('r_fore'),
    '§1 — sibling arm reached (same armature)');
  ok(!linked.has('arm1_root'), '§1 — armature root NOT in linked set');
}

// ── §2 — non-bone seed → empty set ───────────────────────────────────

{
  const linked = computeLinkedBoneIds(arm1, ['arm1_root']);
  ok(linked.size === 0,
    '§2 — armature root (no boneRole) as seed → empty (defensive)');
}

{
  const linked = computeLinkedBoneIds(arm1, ['nonexistent_id']);
  ok(linked.size === 0, '§2 — unknown id as seed → empty');
}

// ── §3 — multi-armature: only seed's armature gets expanded ─────────

const multiArm = {
  nodes: [
    ...arm1.nodes,
    { id: 'arm2_root', type: 'group', visible: true },
    { id: 'l_arm', type: 'group', boneRole: 'lArm', parent: 'arm2_root', visible: true },
    { id: 'l_fore', type: 'group', boneRole: 'lFore', parent: 'l_arm', visible: true },
  ],
};

{
  const linked = computeLinkedBoneIds(multiArm, ['head']);
  ok(linked.size === 5, '§3 — clicking head only expands arm1 (5 bones)');
  ok(!linked.has('l_arm') && !linked.has('l_fore'),
    '§3 — arm2 bones NOT included');
}

{
  const linked = computeLinkedBoneIds(multiArm, ['l_arm']);
  ok(linked.size === 2, '§3 — clicking l_arm expands only arm2 (2 bones)');
  ok(linked.has('l_arm') && linked.has('l_fore'),
    '§3 — arm2 bones present');
}

{
  // Multiple seeds → union of armatures
  const linked = computeLinkedBoneIds(multiArm, ['head', 'l_arm']);
  ok(linked.size === 7, '§3 — seeds in BOTH armatures → 7 bones total');
}

// ── §4 — hidden bones excluded ──────────────────────────────────────

{
  const project = {
    nodes: [
      { id: 'r', type: 'group', visible: true },
      { id: 'b1', type: 'group', boneRole: 'spine', parent: 'r', visible: true },
      { id: 'b2', type: 'group', boneRole: 'head', parent: 'b1', visible: true },
      { id: 'b3', type: 'group', boneRole: 'tail', parent: 'b1', visible: false },
    ],
  };
  const linked = computeLinkedBoneIds(project, ['b1']);
  ok(linked.size === 2, '§4 — b3 hidden → 2 visible bones returned');
  ok(linked.has('b1') && linked.has('b2'), '§4 — visible bones included');
  ok(!linked.has('b3'), '§4 — hidden bone excluded');
}

// ── §5 — orphan bones share sentinel ──────────────────────────────

{
  const project = {
    nodes: [
      { id: 'free1', type: 'group', boneRole: 'misc1', visible: true /* no parent */ },
      { id: 'free2', type: 'group', boneRole: 'misc2', visible: true },
      { id: 'rooted_root', type: 'group', visible: true },
      { id: 'rooted', type: 'group', boneRole: 'spine', parent: 'rooted_root', visible: true },
    ],
  };
  const linked = computeLinkedBoneIds(project, ['free1']);
  ok(linked.size === 2 && linked.has('free1') && linked.has('free2'),
    '§5 — orphan bones grouped under __projectRoot__ sentinel');
  ok(!linked.has('rooted'),
    '§5 — rooted bone has different armature → excluded');
}

// ── §6 — selection-result composition (click handler logic) ─────────
//
// Mirror the SkeletonOverlay handler's selection-mutation policy:
//   Ctrl+LMB: replace selection with linked items. Active = clicked.
//   Ctrl+Shift+LMB: add linked items to existing (no dedupe via Set).
//     Active = clicked.

function ctrlLMBReplace(state, clickedId, project) {
  const linked = computeLinkedBoneIds(project, [clickedId]);
  if (linked.size === 0) return 'FALLBACK';
  state.items = [...linked].map((id) => ({ type: 'group', id }));
  state.legacyActive = clickedId;
  return 'REPLACED';
}

function ctrlShiftLMBExtend(state, clickedId, project) {
  const linked = computeLinkedBoneIds(project, [clickedId]);
  if (linked.size === 0) return 'FALLBACK';
  const existingIds = new Set(state.items.map((it) => it.id));
  const additions = [...linked]
    .filter((id) => !existingIds.has(id))
    .map((id) => ({ type: 'group', id }));
  state.items = [...state.items, ...additions];
  state.legacyActive = clickedId;
  return 'EXTENDED';
}

{
  const state = { items: [{ type: 'group', id: 'r_arm' }], legacyActive: 'r_arm' };
  const result = ctrlLMBReplace(state, 'head', arm1);
  ok(result === 'REPLACED', '§6 — Ctrl+LMB returns REPLACED');
  ok(state.items.length === 5, '§6 — 5 linked items replace single-bone selection');
  ok(state.legacyActive === 'head', '§6 — active head = clicked bone');
}

{
  const state = { items: [{ type: 'group', id: 'r_arm' }], legacyActive: 'r_arm' };
  const result = ctrlShiftLMBExtend(state, 'head', arm1);
  ok(result === 'EXTENDED', '§6 — Ctrl+Shift+LMB returns EXTENDED');
  ok(state.items.length === 5, '§6 — r_arm already linked, 4 additions');
  ok(state.legacyActive === 'head', '§6 — active head = clicked bone');
}

{
  // Ctrl+Shift+LMB with a non-linked seed already in selection
  const state = {
    items: [
      { type: 'group', id: 'r_arm' },         // arm1
      { type: 'group', id: 'unrelated_id' },  // hypothetical foreign
    ],
    legacyActive: 'unrelated_id',
  };
  ctrlShiftLMBExtend(state, 'head', arm1);
  ok(state.items.find((it) => it.id === 'unrelated_id'),
    '§6 — Ctrl+Shift+LMB preserves existing non-linked items');
  ok(state.items.length === 6,
    '§6 — 4 new linked + 2 existing = 6 total');
}

// ── §7 — handler dispatch table (modifiers) ─────────────────────────

function dispatch(modifiers) {
  if (modifiers.ctrl || modifiers.meta) {
    return modifiers.shift ? 'CTRL_SHIFT_LMB_EXTEND' : 'CTRL_LMB_REPLACE';
  }
  if (modifiers.shift) return 'SHIFT_LMB_TOGGLE';
  return 'BARE_LMB_REPLACE';
}

ok(dispatch({ ctrl: true }) === 'CTRL_LMB_REPLACE',
  '§7 — Ctrl+LMB → linked-pick replace');
ok(dispatch({ meta: true }) === 'CTRL_LMB_REPLACE',
  '§7 — Cmd+LMB (macOS) → same as Ctrl+LMB');
ok(dispatch({ ctrl: true, shift: true }) === 'CTRL_SHIFT_LMB_EXTEND',
  '§7 — Ctrl+Shift+LMB → linked-pick extend');
ok(dispatch({ shift: true }) === 'SHIFT_LMB_TOGGLE',
  '§7 — Shift+LMB → toggle (unchanged from c080e8e)');
ok(dispatch({}) === 'BARE_LMB_REPLACE',
  '§7 — bare LMB → single replace (unchanged baseline)');
ok(dispatch({ alt: true }) === 'BARE_LMB_REPLACE',
  '§7 — Alt+LMB falls through to bare (Alt reserved for future)');

// ── §8 — isBoneGroupNode helper ─────────────────────────────────────

ok(isBoneGroupNode({ type: 'group', boneRole: 'head' }) === true,
  '§8 — group with non-empty boneRole IS a bone');
ok(isBoneGroupNode({ type: 'group', boneRole: '' }) === false,
  '§8 — group with empty-string boneRole is NOT a bone');
ok(isBoneGroupNode({ type: 'group' }) === false,
  '§8 — group with no boneRole is NOT a bone (armature root)');
ok(isBoneGroupNode({ type: 'part', boneRole: 'head' }) === false,
  '§8 — non-group type is never a bone');
ok(isBoneGroupNode(null) === false, '§8 — null safely returns false');
ok(isBoneGroupNode(undefined) === false, '§8 — undefined safely returns false');

console.log(`poseCtrlLMBLinkedPick: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
