// Animation Phase 5 Slice 5.LL — tests for
// src/anim/fcurveGroupActive.js (per-FCurveGroup AGRP_ACTIVE port).
//
// Sister test suite to test_fcurveActive.mjs (Slice 5.X). Coverage
// mirrors the FCurve-active suite exactly because the helpers are
// shape-identical (just targeting `action.groups` instead of
// `action.fcurves`).
//
// Run: node scripts/test/test_fcurveGroupActive.mjs

import {
  isFCurveGroupActive,
  getActiveFCurveGroup,
  setActiveFCurveGroup,
  clearActiveFCurveGroups,
  wouldSetActiveFCurveGroupChange,
} from '../../src/anim/fcurveGroupActive.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function makeAction(groups = []) {
  return { id: 'act1', fcurves: [], groups };
}

function grp(id, extras = {}) {
  return { id, name: `Group ${id}`, ...extras };
}

// ── isFCurveGroupActive ────────────────────────────────────────────
{
  eq(isFCurveGroupActive(null), false, 'null group → false');
  eq(isFCurveGroupActive(undefined), false, 'undefined group → false');
  eq(isFCurveGroupActive({}), false, 'empty group → false');
  eq(isFCurveGroupActive({ active: true }), true, 'active=true → true');
  eq(isFCurveGroupActive({ active: false }), false, 'active=false → false');
  eq(isFCurveGroupActive({ active: 1 }), false, 'active=1 → false (strict === true)');
  eq(isFCurveGroupActive({ active: 'yes' }), false, 'active="yes" → false (strict)');
  eq(isFCurveGroupActive({ active: null }), false, 'active=null → false');
}

// ── getActiveFCurveGroup ───────────────────────────────────────────
{
  eq(getActiveFCurveGroup(null), null, 'null action → null');
  eq(getActiveFCurveGroup(undefined), null, 'undefined action → null');
  eq(getActiveFCurveGroup({}), null, 'action without groups → null');
  eq(getActiveFCurveGroup({ groups: 'not-array' }), null, 'non-array groups → null');
  eq(getActiveFCurveGroup(makeAction([])), null, 'empty groups → null');
  eq(getActiveFCurveGroup(makeAction([grp('a'), grp('b')])), null, 'no active flag → null');

  const action = makeAction([grp('a'), grp('b', { active: true })]);
  eq(getActiveFCurveGroup(action)?.id, 'b', 'returns the active group');

  // First-match invariant when corrupt data has multiple actives.
  const corrupt = makeAction([grp('a', { active: true }), grp('b', { active: true })]);
  eq(getActiveFCurveGroup(corrupt)?.id, 'a', 'first match wins on corrupt multi-active');
}

// ── setActiveFCurveGroup: basic set ────────────────────────────────
{
  const action = makeAction([grp('a'), grp('b')]);
  const r = setActiveFCurveGroup(action, 'b');
  eq(r.activeNow, 'b', 'set target activeNow=b');
  eq(r.changed, true, 'first set → changed=true');
  eq(action.groups[0].active, undefined, 'sibling a has no active field (sparse)');
  eq(action.groups[1].active, true, 'target b has active=true');
}

// ── setActiveFCurveGroup: EXCLUSIVE — clears prior active ──────────
{
  const action = makeAction([grp('a', { active: true }), grp('b'), grp('c')]);
  const r = setActiveFCurveGroup(action, 'c');
  eq(r.activeNow, 'c', 'switched to c');
  eq(r.changed, true, 'switch counts as changed');
  eq(action.groups[0].active, undefined, 'prior active cleared (sparse delete)');
  eq(action.groups[2].active, true, 'new target carries the flag');
  const actives = action.groups.filter((g) => g.active === true);
  eq(actives.length, 1, 'exactly one group carries active flag after set');
}

// ── setActiveFCurveGroup: idempotent — same target = no change ─────
{
  const action = makeAction([grp('a', { active: true }), grp('b')]);
  const r = setActiveFCurveGroup(action, 'a');
  eq(r.activeNow, 'a', 'a still active');
  eq(r.changed, false, 'idempotent re-set → changed=false');
}

// ── setActiveFCurveGroup: normalises explicit active:false ─────────
{
  const action = makeAction([grp('a', { active: false }), grp('b', { active: true })]);
  const r = setActiveFCurveGroup(action, 'b');
  eq(r.changed, true, 'cleanup of stale false counts as changed');
  eq(Object.prototype.hasOwnProperty.call(action.groups[0], 'active'), false, 'stale false deleted (sparse)');
  eq(action.groups[1].active, true, 'target still active');
}

// ── setActiveFCurveGroup: cleanup-during-already-active ────────────
// Target IS already active AND a sibling carries stale `active: false`.
// Setter normalises the sibling AND returns changed=true.
{
  const action = makeAction([grp('a', { active: false }), grp('b', { active: true })]);
  const r = setActiveFCurveGroup(action, 'b');
  eq(r.changed, true, 'cleanup-during-already-active → changed=true (sibling normalised)');
  eq(r.activeNow, 'b', 'target identity preserved');
  eq(action.groups[1].active, true, 'target still carries active=true');
  eq(Object.prototype.hasOwnProperty.call(action.groups[0], 'active'), false, 'sibling stale false deleted');
}

// ── setActiveFCurveGroup: ID-based compare survives JSON-clone ─────
{
  const action = makeAction([grp('a', { active: true }), grp('b'), grp('c')]);
  const cloned = JSON.parse(JSON.stringify(action));
  const r = setActiveFCurveGroup(cloned, 'c');
  eq(r.activeNow, 'c', 'ID-based compare picks c in cloned action');
  eq(r.changed, true, 'changed=true');
  eq(cloned.groups[0].active, undefined, 'prior active (a) cleared');
  eq(cloned.groups[2].active, true, 'new target (c) active');
}

// ── setActiveFCurveGroup: null/empty/missing groupId → clears all ──
{
  const action = makeAction([grp('a', { active: true }), grp('b')]);
  const r = setActiveFCurveGroup(action, null);
  eq(r.activeNow, null, 'null id → activeNow=null');
  eq(r.changed, true, 'cleared prior active');
  eq(action.groups[0].active, undefined, 'prior active sparse-cleared');
}
{
  const action = makeAction([grp('a', { active: true })]);
  const r = setActiveFCurveGroup(action, '');
  eq(r.activeNow, null, 'empty string id → null');
  eq(r.changed, true, 'cleared');
}
{
  const action = makeAction([grp('a', { active: true })]);
  const r = setActiveFCurveGroup(action, 'nonexistent');
  eq(r.activeNow, null, 'no-match id → null');
  eq(r.changed, true, 'cleared (no target found)');
  eq(action.groups[0].active, undefined, 'previous active dropped because no new target');
}

// ── setActiveFCurveGroup: empty action ─────────────────────────────
{
  const r = setActiveFCurveGroup(makeAction([]), 'whatever');
  eq(r.activeNow, null, 'empty groups → null');
  eq(r.changed, false, 'no groups → no change');
}
{
  const r = setActiveFCurveGroup(null, 'whatever');
  eq(r.activeNow, null, 'null action → null');
  eq(r.changed, false, 'null action → no change');
}
{
  const r = setActiveFCurveGroup({ fcurves: [] }, 'whatever');
  eq(r.activeNow, null, 'action without groups → null');
  eq(r.changed, false, 'no groups field → no change');
}

// ── setActiveFCurveGroup: nullish entries skipped ──────────────────
{
  const action = { id: 'a', fcurves: [], groups: [null, grp('b'), undefined, grp('c', { active: true })] };
  const r = setActiveFCurveGroup(action, 'b');
  eq(r.activeNow, 'b', 'set b active despite null siblings');
  eq(r.changed, true, 'changed');
  eq(action.groups[1].active, true, 'b activated');
  eq(action.groups[3].active, undefined, 'c deactivated');
}

// ── clearActiveFCurveGroups ────────────────────────────────────────
{
  const action = makeAction([grp('a', { active: true }), grp('b'), grp('c', { active: false })]);
  const r = clearActiveFCurveGroups(action);
  eq(r.cleared, 2, 'cleared 2 entries (one true + one false)');
  eq(action.groups[0].active, undefined, 'true cleared');
  eq(action.groups[2].active, undefined, 'false cleared (sparse normalisation)');
}
{
  const action = makeAction([grp('a'), grp('b')]);
  const r = clearActiveFCurveGroups(action);
  eq(r.cleared, 0, 'nothing to clear → 0');
}
{
  eq(clearActiveFCurveGroups(null).cleared, 0, 'null action → 0');
  eq(clearActiveFCurveGroups(undefined).cleared, 0, 'undefined action → 0');
  eq(clearActiveFCurveGroups({}).cleared, 0, 'action without groups → 0');
}

// ── wouldSetActiveFCurveGroupChange ────────────────────────────────
{
  const action = makeAction([grp('a'), grp('b')]);
  eq(wouldSetActiveFCurveGroupChange(action, 'b'), true, 'first-time set → true');
}
{
  const action = makeAction([grp('a', { active: true }), grp('b')]);
  eq(wouldSetActiveFCurveGroupChange(action, 'a'), false, 'idempotent re-set → false');
}
{
  const action = makeAction([grp('a', { active: true }), grp('b')]);
  eq(wouldSetActiveFCurveGroupChange(action, 'b'), true, 'switch → true');
}
{
  const action = makeAction([grp('a', { active: true })]);
  eq(wouldSetActiveFCurveGroupChange(action, null), true, 'clear from active → true');
}
{
  const action = makeAction([grp('a'), grp('b')]);
  eq(wouldSetActiveFCurveGroupChange(action, null), false, 'clear when nothing active → false');
}
{
  // Stale `active: false` counts as needing cleanup.
  const action = makeAction([grp('a', { active: false }), grp('b')]);
  eq(wouldSetActiveFCurveGroupChange(action, 'b'), true, 'stale false sibling → needs cleanup');
}
{
  eq(wouldSetActiveFCurveGroupChange(null, 'a'), false, 'null action → false');
  eq(wouldSetActiveFCurveGroupChange({}, 'a'), false, 'action without groups → false');
}

// ── preflight matches setter (integration) ─────────────────────────
{
  const scenarios = [
    () => ({ action: makeAction([grp('a'), grp('b')]), id: 'b' }),
    () => ({ action: makeAction([grp('a', { active: true }), grp('b')]), id: 'a' }),
    () => ({ action: makeAction([grp('a', { active: true }), grp('b')]), id: 'b' }),
    () => ({ action: makeAction([grp('a', { active: true })]), id: null }),
    () => ({ action: makeAction([grp('a'), grp('b')]), id: null }),
    () => ({ action: makeAction([grp('a', { active: false }), grp('b')]), id: 'b' }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sA = scenarios[i]();
    const sB = scenarios[i]();
    const predicted = wouldSetActiveFCurveGroupChange(sA.action, sA.id);
    const r = setActiveFCurveGroup(sB.action, sB.id);
    eq(predicted, r.changed, `scenario ${i} preflight matches setter changed`);
  }
}

// ── final report ────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} fcurveGroupActive assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
