// Animation Phase 5 Slice 5.V — tests for
// src/anim/fcurveGroups.js (FCurveGroup substrate + cascade helpers).
//
// Coverage:
//   - getFCurveGroupById: null guards, missing group, found
//   - isFCurveGroupMuted / Hidden / Selected: strict === true
//   - isFCurveGroupExpanded: default true on missing field
//   - isFCurveEffectivelyMuted / Hidden: per-curve OR group cascade
//   - Preflight + mutator pairs: mute / hide / expanded
//   - Sparse-write convention (default false → field deleted)
//   - groupFCurvesByTarget: auto-population, param-targets stay ungrouped,
//     idempotent re-run, existing groups preserved, name lookup wired
//
// Run: node scripts/test/test_fcurveGroups.mjs

import {
  getFCurveGroupById,
  isFCurveGroupMuted,
  isFCurveGroupHidden,
  isFCurveGroupExpanded,
  isFCurveGroupSelected,
  isFCurveEffectivelyMuted,
  isFCurveEffectivelyHidden,
  wouldToggleFCurveGroupMuteChange,
  applyToggleFCurveGroupMute,
  wouldToggleFCurveGroupHiddenChange,
  applyToggleFCurveGroupHidden,
  wouldToggleFCurveGroupExpandedChange,
  applyToggleFCurveGroupExpanded,
  groupFCurvesByTarget,
} from '../../src/anim/fcurveGroups.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function makeAction(groups = [], fcurves = []) {
  return { id: 'act1', fcurves, groups };
}

// ── getFCurveGroupById ──────────────────────────────────────────────
{
  eq(getFCurveGroupById(null, 'g1'), null, 'getFCurveGroupById: null action → null');
  eq(getFCurveGroupById({}, 'g1'), null, 'getFCurveGroupById: action without groups → null');
  eq(getFCurveGroupById({ groups: 'not-array' }, 'g1'), null, 'getFCurveGroupById: non-array groups → null');
  eq(getFCurveGroupById({ groups: [] }, 'g1'), null, 'getFCurveGroupById: empty groups → null');
  eq(getFCurveGroupById(makeAction([{ id: 'g1', name: 'G1' }]), null), null, 'getFCurveGroupById: null id → null');
  eq(getFCurveGroupById(makeAction([{ id: 'g1', name: 'G1' }]), ''), null, 'getFCurveGroupById: empty id → null');

  const g = { id: 'g1', name: 'G1' };
  eq(getFCurveGroupById(makeAction([g]), 'g1'), g, 'getFCurveGroupById: found returns the group object');
  eq(getFCurveGroupById(makeAction([g]), 'g2'), null, 'getFCurveGroupById: not found → null');
}

// ── isFCurveGroup* readers (strict === true, defensive) ─────────────
{
  eq(isFCurveGroupMuted(null), false, 'isFCurveGroupMuted: null → false');
  eq(isFCurveGroupMuted({}), false, 'isFCurveGroupMuted: missing → false');
  eq(isFCurveGroupMuted({ mute: true }), true, 'isFCurveGroupMuted: true → true');
  eq(isFCurveGroupMuted({ mute: 1 }), false, 'isFCurveGroupMuted: truthy non-bool → false (strict)');

  eq(isFCurveGroupHidden(null), false, 'isFCurveGroupHidden: null → false');
  eq(isFCurveGroupHidden({ hide: true }), true, 'isFCurveGroupHidden: true → true');
  eq(isFCurveGroupHidden({ hide: false }), false, 'isFCurveGroupHidden: false → false');
  eq(isFCurveGroupHidden({ hide: 'yes' }), false, 'isFCurveGroupHidden: string → false (strict)');

  eq(isFCurveGroupSelected(null), false, 'isFCurveGroupSelected: null → false');
  eq(isFCurveGroupSelected({ selected: true }), true, 'isFCurveGroupSelected: true → true');

  // Default-FALSE semantic for expanded (Blender-fidelity: groups created
  // collapsed per `action.cc:2333` `flag = AGRP_SELECTED` only — see
  // module JSDoc audit-fix FAB-2). Migration writes expanded:true
  // explicitly on auto-created groups so user data stays visible.
  eq(isFCurveGroupExpanded(null), false, 'isFCurveGroupExpanded: null → false (default)');
  eq(isFCurveGroupExpanded({}), false, 'isFCurveGroupExpanded: missing field → false (default collapsed)');
  eq(isFCurveGroupExpanded({ expanded: false }), false, 'isFCurveGroupExpanded: explicit false');
  eq(isFCurveGroupExpanded({ expanded: true }), true, 'isFCurveGroupExpanded: explicit true');
}

// ── isFCurveEffectivelyMuted (cascade) ──────────────────────────────
{
  const action = makeAction(
    [{ id: 'g1', name: 'G1', mute: true }, { id: 'g2', name: 'G2' }],
    [],
  );
  eq(isFCurveEffectivelyMuted(null, action), false, 'effMuted: null fcurve → false');
  eq(isFCurveEffectivelyMuted({}, action), false, 'effMuted: no mute + no groupId → false');
  eq(isFCurveEffectivelyMuted({ mute: true }, action), true, 'effMuted: per-curve mute true → true (skip group lookup)');
  eq(isFCurveEffectivelyMuted({ groupId: 'g1' }, action), true, 'effMuted: groupId points at muted group → true (cascade)');
  eq(isFCurveEffectivelyMuted({ groupId: 'g2' }, action), false, 'effMuted: groupId points at unmuted group → false');
  eq(isFCurveEffectivelyMuted({ groupId: 'gMissing' }, action), false, 'effMuted: unknown groupId → false (no group to cascade)');
  eq(isFCurveEffectivelyMuted({ groupId: 'g1' }, null), false, 'effMuted: null action → no cascade possible → false');
  eq(isFCurveEffectivelyMuted({ mute: true, groupId: 'g2' }, action), true, 'effMuted: short-circuits on per-curve true before group lookup');
}

// ── isFCurveEffectivelyHidden (cascade) ─────────────────────────────
{
  const action = makeAction(
    [{ id: 'g1', name: 'G1', hide: true }, { id: 'g2', name: 'G2' }],
    [],
  );
  eq(isFCurveEffectivelyHidden(null, action), false, 'effHidden: null fcurve → false');
  eq(isFCurveEffectivelyHidden({ hide: true }, action), true, 'effHidden: per-curve hide true → true');
  eq(isFCurveEffectivelyHidden({ groupId: 'g1' }, action), true, 'effHidden: groupId points at hidden group → true (cascade)');
  eq(isFCurveEffectivelyHidden({ groupId: 'g2' }, action), false, 'effHidden: groupId points at non-hidden group → false');
  eq(isFCurveEffectivelyHidden({}, action), false, 'effHidden: no hide + no groupId → false');
}

// ── applyToggleFCurveGroupMute (sparse-write convention) ────────────
{
  const action = makeAction([{ id: 'g1', name: 'G1' }]);

  // Preflight: existing group → true; missing → false
  eq(wouldToggleFCurveGroupMuteChange(action, 'g1'), true, 'wouldToggle*Mute: existing group → true');
  eq(wouldToggleFCurveGroupMuteChange(action, 'gMissing'), false, 'wouldToggle*Mute: missing → false');

  // First toggle: writes mute: true
  const r1 = applyToggleFCurveGroupMute(action, 'g1');
  eq(r1, true, 'applyToggleMute: first toggle returns true');
  eq(action.groups[0].mute, true, 'applyToggleMute: first toggle writes mute:true');

  // Second toggle: DELETES the field (sparse default)
  const r2 = applyToggleFCurveGroupMute(action, 'g1');
  eq(r2, false, 'applyToggleMute: second toggle returns false');
  assert(!('mute' in action.groups[0]), 'applyToggleMute: second toggle DELETES mute field (sparse)');

  // Mutator on missing group → null
  eq(applyToggleFCurveGroupMute(action, 'gMissing'), null, 'applyToggleMute: missing group → null');
}

// ── applyToggleFCurveGroupHidden (sparse-write convention) ──────────
{
  const action = makeAction([{ id: 'g1', name: 'G1' }]);
  eq(applyToggleFCurveGroupHidden(action, 'g1'), true, 'applyToggleHide: first toggle returns true');
  eq(action.groups[0].hide, true, 'applyToggleHide: first toggle writes hide:true');
  eq(applyToggleFCurveGroupHidden(action, 'g1'), false, 'applyToggleHide: second toggle returns false');
  assert(!('hide' in action.groups[0]), 'applyToggleHide: second toggle DELETES hide field');
  eq(applyToggleFCurveGroupHidden(action, 'gMissing'), null, 'applyToggleHide: missing group → null');
}

// ── applyToggleFCurveGroupExpanded (default-FALSE sparseness, Blender-fidelity) ─
{
  const action = makeAction([{ id: 'g1', name: 'G1' }]);

  // Pre-toggle: missing field reads as expanded=false (default collapsed)
  eq(isFCurveGroupExpanded(action.groups[0]), false, 'expanded default-false on missing field');

  // First toggle: writes expanded:true (explicit expanded)
  const r1 = applyToggleFCurveGroupExpanded(action, 'g1');
  eq(r1, true, 'applyToggleExpanded: first toggle returns true (expanded)');
  eq(action.groups[0].expanded, true, 'applyToggleExpanded: first toggle writes expanded:true');

  // Second toggle: DELETES the field (back to default-false collapsed)
  const r2 = applyToggleFCurveGroupExpanded(action, 'g1');
  eq(r2, false, 'applyToggleExpanded: second toggle returns false (collapsed again)');
  assert(!('expanded' in action.groups[0]), 'applyToggleExpanded: second toggle DELETES expanded field');
}

// ── groupFCurvesByTarget: auto-population from fcurve targets ───────
{
  // 3 node-targeting fcurves on 2 nodes + 2 param-targeting fcurves
  const action = makeAction([], [
    { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x' },
    { id: 'fc2', rnaPath: 'objects["nodeA"].transform.y' },
    { id: 'fc3', rnaPath: 'objects["nodeB"].transform.rotation' },
    { id: 'fc4', rnaPath: 'objects["__params__"].values["paramX"]' },
    { id: 'fc5', rnaPath: 'objects["__params__"].values["paramY"]' },
  ]);
  const names = { nodeA: 'Hair', nodeB: 'Body' };
  const touched = groupFCurvesByTarget(action, (nid) => names[nid] ?? nid);
  eq(touched, 3, 'groupFCurvesByTarget: 3 node-targeting fcurves assigned');
  eq(action.groups.length, 2, 'groupFCurvesByTarget: 2 groups created (one per node)');
  // Audit-fix Slice 5.V FAB-2: auto-created groups carry expanded:true
  // so migrated user data stays visible (Blender's WRITE-time default
  // is collapsed; migration's explicit-expand is the documented
  // deviation for the auto-population path).
  eq(action.groups[0].expanded, true, 'groupFCurvesByTarget: auto-created group has expanded:true');
  eq(action.groups[1].expanded, true, 'groupFCurvesByTarget: second auto-created group has expanded:true');
  // Verify group ids
  const ids = action.groups.map((g) => g.id).sort();
  eq(JSON.stringify(ids), JSON.stringify(['g_node_nodeA', 'g_node_nodeB']), 'groupFCurvesByTarget: stable id format');
  // Verify group names came from nameFromNodeId
  const nameByGid = Object.fromEntries(action.groups.map((g) => [g.id, g.name]));
  eq(nameByGid['g_node_nodeA'], 'Hair', 'groupFCurvesByTarget: name resolved');
  eq(nameByGid['g_node_nodeB'], 'Body', 'groupFCurvesByTarget: name resolved');
  // Verify fc.groupId pointers
  eq(action.fcurves[0].groupId, 'g_node_nodeA', 'fc1 → g_node_nodeA');
  eq(action.fcurves[1].groupId, 'g_node_nodeA', 'fc2 → g_node_nodeA (sibling)');
  eq(action.fcurves[2].groupId, 'g_node_nodeB', 'fc3 → g_node_nodeB');
  // Verify param-targets stay ungrouped
  assert(action.fcurves[3].groupId === undefined, 'fc4 (param) stays ungrouped');
  assert(action.fcurves[4].groupId === undefined, 'fc5 (param) stays ungrouped');
}

// ── groupFCurvesByTarget: idempotent re-run + preserves user data ──
{
  const action = makeAction([], [
    { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x' },
  ]);
  const names = { nodeA: 'Hair' };
  groupFCurvesByTarget(action, (nid) => names[nid]);
  // User renames the group
  action.groups[0].name = 'My Custom Hair Group';
  action.groups[0].mute = true; // user mutes
  // Re-run
  const touched = groupFCurvesByTarget(action, (nid) => names[nid]);
  eq(touched, 0, 'idempotent: re-run touches nothing when state already correct');
  eq(action.groups.length, 1, 'idempotent: no duplicate group created');
  eq(action.groups[0].name, 'My Custom Hair Group', 'idempotent: user-renamed name preserved');
  eq(action.groups[0].mute, true, 'idempotent: user-set mute preserved');
}

// ── groupFCurvesByTarget: missing nameFromNodeId function ───────────
{
  const action = makeAction([], [
    { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x' },
  ]);
  // No name function → falls back to nodeId
  groupFCurvesByTarget(action, null);
  eq(action.groups[0].name, 'nodeA', 'name fallback: nodeId when no resolver');
}

// ── groupFCurvesByTarget: null/empty action guards ──────────────────
{
  eq(groupFCurvesByTarget(null, () => 'x'), 0, 'groupFCurvesByTarget: null action → 0');
  eq(groupFCurvesByTarget({}, () => 'x'), 0, 'groupFCurvesByTarget: action without fcurves → 0');
  eq(groupFCurvesByTarget({ fcurves: [] }, () => 'x'), 0, 'groupFCurvesByTarget: empty fcurves → 0');

  // initializes action.groups when missing
  const action = { fcurves: [] };
  groupFCurvesByTarget(action, () => 'x');
  assert(Array.isArray(action.groups), 'groupFCurvesByTarget: initialises action.groups when missing');
}

// ── groupFCurvesByTarget: changing fcurve target updates groupId ───
{
  // fc1 starts in group A, then its rnaPath changes to point at node B
  const action = makeAction([], [
    { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x' },
  ]);
  groupFCurvesByTarget(action, (nid) => nid);
  eq(action.fcurves[0].groupId, 'g_node_nodeA', 'initial: nodeA group');
  // Repoint fc1 to nodeB
  action.fcurves[0].rnaPath = 'objects["nodeB"].transform.x';
  const touched = groupFCurvesByTarget(action, (nid) => nid);
  eq(touched, 1, 'reassign: touched=1 when groupId moved');
  eq(action.fcurves[0].groupId, 'g_node_nodeB', 'reassign: fc1 moved to nodeB group');
  // Group nodeA still exists (empty, harmless)
  eq(action.groups.length, 2, 'reassign: old group preserved as empty');
}

// ── groupFCurvesByTarget: untyped target → ungrouped ────────────────
{
  const action = makeAction([], [
    { id: 'fc1', rnaPath: 'bogus_path_format_no_match' },
    { id: 'fc2' }, // no rnaPath at all
  ]);
  groupFCurvesByTarget(action, (nid) => nid);
  assert(action.fcurves[0].groupId === undefined, 'untyped: bogus rnaPath stays ungrouped');
  assert(action.fcurves[1].groupId === undefined, 'untyped: no rnaPath stays ungrouped');
  eq(action.groups.length, 0, 'untyped: no spurious groups created');
}

console.log(`\nfcurveGroups: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
