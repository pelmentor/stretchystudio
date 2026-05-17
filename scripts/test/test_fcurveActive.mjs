// Animation Phase 5 Slice 5.X — tests for
// src/anim/fcurveActive.js (per-FCurve FCURVE_ACTIVE port).
//
// Coverage:
//   - isFCurveActive: null/undefined guards, strict === true
//   - getActiveFCurve: null/undefined/empty action, first-match invariant
//   - setActiveFCurve: EXCLUSIVE flag (clears all siblings, sets target)
//     - sparse-write (delete sibling fields, not write false)
//     - normalises explicit `active: false` to missing
//     - null/empty/missing fcurveId → clears all
//     - idempotent: re-setting same fcurve → changed:false
//   - clearActiveFCurves: sparse delete + count returned
//   - wouldSetActiveFCurveChange: preflight matches setter
//
// Run: node scripts/test/test_fcurveActive.mjs

import {
  isFCurveActive,
  getActiveFCurve,
  setActiveFCurve,
  clearActiveFCurves,
  wouldSetActiveFCurveChange,
} from '../../src/anim/fcurveActive.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeAction(fcurves = []) {
  return { id: 'act1', fcurves };
}

function fc(id, extras = {}) {
  return { id, rnaPath: `objects["__params__"].values["${id}"]`, keyforms: [], ...extras };
}

// ── isFCurveActive ─────────────────────────────────────────────────
{
  eq(isFCurveActive(null), false, 'null fcurve → false');
  eq(isFCurveActive(undefined), false, 'undefined fcurve → false');
  eq(isFCurveActive({}), false, 'empty fcurve → false');
  eq(isFCurveActive({ active: true }), true, 'active=true → true');
  eq(isFCurveActive({ active: false }), false, 'active=false → false');
  eq(isFCurveActive({ active: 1 }), false, 'active=1 → false (strict === true)');
  eq(isFCurveActive({ active: 'yes' }), false, 'active="yes" → false (strict)');
  eq(isFCurveActive({ active: null }), false, 'active=null → false');
}

// ── getActiveFCurve ────────────────────────────────────────────────
{
  eq(getActiveFCurve(null), null, 'null action → null');
  eq(getActiveFCurve(undefined), null, 'undefined action → null');
  eq(getActiveFCurve({}), null, 'action without fcurves → null');
  eq(getActiveFCurve({ fcurves: 'not-array' }), null, 'non-array fcurves → null');
  eq(getActiveFCurve(makeAction([])), null, 'empty fcurves → null');
  eq(getActiveFCurve(makeAction([fc('a'), fc('b')])), null, 'no active flag → null');

  const action = makeAction([fc('a'), fc('b', { active: true })]);
  eq(getActiveFCurve(action)?.id, 'b', 'returns the active fcurve');

  // First-match invariant when corrupt data has multiple actives.
  const corrupt = makeAction([fc('a', { active: true }), fc('b', { active: true })]);
  eq(getActiveFCurve(corrupt)?.id, 'a', 'first match wins on corrupt multi-active');
}

// ── setActiveFCurve: basic set ─────────────────────────────────────
{
  const action = makeAction([fc('a'), fc('b')]);
  const r = setActiveFCurve(action, 'b');
  eq(r.activeNow, 'b', 'set target activeNow=b');
  eq(r.changed, true, 'first set → changed=true');
  eq(action.fcurves[0].active, undefined, 'sibling a has no active field (sparse)');
  eq(action.fcurves[1].active, true, 'target b has active=true');
}

// ── setActiveFCurve: EXCLUSIVE — clears prior active ───────────────
{
  const action = makeAction([fc('a', { active: true }), fc('b'), fc('c')]);
  const r = setActiveFCurve(action, 'c');
  eq(r.activeNow, 'c', 'switched to c');
  eq(r.changed, true, 'switch counts as changed');
  eq(action.fcurves[0].active, undefined, 'prior active cleared (sparse delete)');
  eq(action.fcurves[2].active, true, 'new target carries the flag');
  // Verify only ONE active in the action after exclusive write
  const actives = action.fcurves.filter((f) => f.active === true);
  eq(actives.length, 1, 'exactly one fcurve carries active flag after set');
}

// ── setActiveFCurve: idempotent — same target = no change ──────────
{
  const action = makeAction([fc('a', { active: true }), fc('b')]);
  const r = setActiveFCurve(action, 'a');
  eq(r.activeNow, 'a', 'a still active');
  eq(r.changed, false, 'idempotent re-set → changed=false');
}

// ── setActiveFCurve: normalises explicit active:false ──────────────
{
  const action = makeAction([fc('a', { active: false }), fc('b', { active: true })]);
  const r = setActiveFCurve(action, 'b');
  eq(r.changed, true, 'cleanup of stale false counts as changed');
  eq(Object.prototype.hasOwnProperty.call(action.fcurves[0], 'active'), false, 'stale false deleted (sparse)');
  eq(action.fcurves[1].active, true, 'target still active');
}

// ── setActiveFCurve: cleanup-during-already-active (audit-fix MED-3) ─
// Target IS already active AND a sibling carries stale `active: false`.
// Setter should normalise the sibling AND return changed=true (because
// SOMETHING changed — the sibling normalisation). The target's
// `active: true` field is unchanged.
{
  const action = makeAction([fc('a', { active: false }), fc('b', { active: true })]);
  const r = setActiveFCurve(action, 'b');
  eq(r.changed, true, 'cleanup-during-already-active → changed=true (because sibling normalised)');
  eq(r.activeNow, 'b', 'target identity preserved');
  eq(action.fcurves[1].active, true, 'target still carries active=true');
  eq(Object.prototype.hasOwnProperty.call(action.fcurves[0], 'active'), false, 'sibling stale false deleted (sparse)');
}

// ── setActiveFCurve: ID-based compare survives non-immer call sites ──
// Audit-fix MED-1 (Slice 5.X arch audit 2026-05-17): the implementation
// uses `fc.id === fcurveId` (not reference identity), so passing a
// fcurveId that matches `id` of an array element correctly finds the
// target even if the caller wasn't inside an immer recipe.
{
  const action = makeAction([fc('a', { active: true }), fc('b'), fc('c')]);
  // Deep clone, then set-active on the clone using just the string id
  // — verifies no reference-identity coupling.
  const cloned = JSON.parse(JSON.stringify(action));
  const r = setActiveFCurve(cloned, 'c');
  eq(r.activeNow, 'c', 'ID-based compare picks c in cloned action');
  eq(r.changed, true, 'changed=true');
  eq(cloned.fcurves[0].active, undefined, 'prior active (a) cleared');
  eq(cloned.fcurves[2].active, true, 'new target (c) active');
}

// ── setActiveFCurve: null/empty/missing fcurveId → clears all ──────
{
  const action = makeAction([fc('a', { active: true }), fc('b')]);
  const r = setActiveFCurve(action, null);
  eq(r.activeNow, null, 'null id → activeNow=null');
  eq(r.changed, true, 'cleared prior active');
  eq(action.fcurves[0].active, undefined, 'prior active sparse-cleared');
}
{
  const action = makeAction([fc('a', { active: true })]);
  const r = setActiveFCurve(action, '');
  eq(r.activeNow, null, 'empty string id → null');
  eq(r.changed, true, 'cleared');
}
{
  const action = makeAction([fc('a', { active: true })]);
  const r = setActiveFCurve(action, 'nonexistent');
  eq(r.activeNow, null, 'no-match id → null');
  eq(r.changed, true, 'cleared (no target found)');
  eq(action.fcurves[0].active, undefined, 'previous active dropped because no new target');
}

// ── setActiveFCurve: empty action ──────────────────────────────────
{
  const r = setActiveFCurve(makeAction([]), 'whatever');
  eq(r.activeNow, null, 'empty fcurves → null');
  eq(r.changed, false, 'no fcurves → no change');
}
{
  const r = setActiveFCurve(null, 'whatever');
  eq(r.activeNow, null, 'null action → null');
  eq(r.changed, false, 'null action → no change');
}

// ── setActiveFCurve: nullish fcurves skipped ───────────────────────
{
  const action = { id: 'a', fcurves: [null, fc('b'), undefined, fc('c', { active: true })] };
  const r = setActiveFCurve(action, 'b');
  eq(r.activeNow, 'b', 'set b active despite null siblings');
  eq(r.changed, true, 'changed');
  eq(action.fcurves[1].active, true, 'b activated');
  eq(action.fcurves[3].active, undefined, 'c deactivated');
}

// ── clearActiveFCurves ─────────────────────────────────────────────
{
  const action = makeAction([fc('a', { active: true }), fc('b'), fc('c', { active: false })]);
  const r = clearActiveFCurves(action);
  eq(r.cleared, 2, 'cleared 2 entries (one true + one false)');
  eq(action.fcurves[0].active, undefined, 'true cleared');
  eq(action.fcurves[2].active, undefined, 'false cleared (sparse normalisation)');
}
{
  const action = makeAction([fc('a'), fc('b')]);
  const r = clearActiveFCurves(action);
  eq(r.cleared, 0, 'nothing to clear → 0');
}
{
  eq(clearActiveFCurves(null).cleared, 0, 'null action → 0');
  eq(clearActiveFCurves(undefined).cleared, 0, 'undefined action → 0');
  eq(clearActiveFCurves({}).cleared, 0, 'action without fcurves → 0');
}

// ── wouldSetActiveFCurveChange ─────────────────────────────────────
{
  const action = makeAction([fc('a'), fc('b')]);
  eq(wouldSetActiveFCurveChange(action, 'b'), true, 'first-time set → true');
}
{
  const action = makeAction([fc('a', { active: true }), fc('b')]);
  eq(wouldSetActiveFCurveChange(action, 'a'), false, 'idempotent re-set → false');
}
{
  const action = makeAction([fc('a', { active: true }), fc('b')]);
  eq(wouldSetActiveFCurveChange(action, 'b'), true, 'switch → true');
}
{
  const action = makeAction([fc('a', { active: true })]);
  eq(wouldSetActiveFCurveChange(action, null), true, 'clear from active → true');
}
{
  const action = makeAction([fc('a'), fc('b')]);
  eq(wouldSetActiveFCurveChange(action, null), false, 'clear when nothing active → false');
}
{
  // Stale `active: false` field counts as needing cleanup.
  const action = makeAction([fc('a', { active: false }), fc('b')]);
  eq(wouldSetActiveFCurveChange(action, 'b'), true, 'stale false sibling → needs cleanup');
}
{
  eq(wouldSetActiveFCurveChange(null, 'a'), false, 'null action → false');
  eq(wouldSetActiveFCurveChange({}, 'a'), false, 'action without fcurves → false');
}

// ── preflight matches setter (integration) ─────────────────────────
{
  // For every scenario, the preflight result should match `r.changed`.
  const scenarios = [
    () => ({ action: makeAction([fc('a'), fc('b')]), id: 'b' }),
    () => ({ action: makeAction([fc('a', { active: true }), fc('b')]), id: 'a' }),
    () => ({ action: makeAction([fc('a', { active: true }), fc('b')]), id: 'b' }),
    () => ({ action: makeAction([fc('a', { active: true })]), id: null }),
    () => ({ action: makeAction([fc('a'), fc('b')]), id: null }),
    () => ({ action: makeAction([fc('a', { active: false }), fc('b')]), id: 'b' }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sA = scenarios[i]();
    const sB = scenarios[i]();
    const predicted = wouldSetActiveFCurveChange(sA.action, sA.id);
    const r = setActiveFCurve(sB.action, sB.id);
    eq(predicted, r.changed, `scenario ${i} preflight matches setter changed`);
  }
}

// ── final report ────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} fcurveActive assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
