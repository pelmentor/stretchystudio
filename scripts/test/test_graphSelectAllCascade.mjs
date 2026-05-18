// Animation Phase 5 Slice 5.DD — tests for
// src/anim/graphSelectAllCascade.js (GRAPH-region select-all
// `do_channels=true` cascade + active-restore pass).
//
// Coverage:
//   - guards (null/empty/bad-mode/no-orderedIds)
//   - 'add' / 'clear' / 'invert' cascade to fc.selected
//   - cascade-clear of fc.active on in-scope fcurves
//   - active-restore: previouslyActive in scope → re-elevated
//   - active-restore: previouslyActive OUT of scope → skipped
//   - EXCLUSIVE re-elevation: stale out-of-scope active cleared
//   - preflight matches setter across scenarios
//
// Run: node scripts/test/test_graphSelectAllCascade.mjs

import {
  applyGraphSelectAllChannelCascade,
  wouldGraphSelectAllChannelCascadeChange,
} from '../../src/anim/graphSelectAllCascade.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function fc(id, extras = {}) {
  return { id, rnaPath: `objects["__params__"].values["${id}"]`, keyforms: [], ...extras };
}

function makeAction(fcurves = []) {
  return { id: 'act1', fcurves };
}

function idsSelected(action) {
  return action.fcurves.filter((f) => f && f.selected === true).map((f) => f.id);
}

function idsActive(action) {
  return action.fcurves.filter((f) => f && f.active === true).map((f) => f.id);
}

// ── Guards ─────────────────────────────────────────────────────────
{
  eq(applyGraphSelectAllChannelCascade(null, 'add', { orderedIds: ['a'] }).changed, false, 'null action → no change');
  eq(applyGraphSelectAllChannelCascade({}, 'add', { orderedIds: ['a'] }).changed, false, 'action without fcurves → no change');
  eq(applyGraphSelectAllChannelCascade(makeAction([fc('a')]), 'bogus', { orderedIds: ['a'] }).changed, false, 'bad mode → no change');
  eq(applyGraphSelectAllChannelCascade(makeAction([fc('a')]), 'add', null).changed, false, 'no ctx → no change');
  eq(applyGraphSelectAllChannelCascade(makeAction([fc('a')]), 'add', { orderedIds: [] }).changed, false, 'empty orderedIds → no change');
  eq(applyGraphSelectAllChannelCascade(makeAction([fc('a')]), 'add', { orderedIds: 'not-array' }).changed, false, 'non-array orderedIds → no change');
}

// ── 'add' cascade — selects every in-scope fcurve ─────────────────
{
  const a = makeAction([fc('a'), fc('b'), fc('c')]);
  const r = applyGraphSelectAllChannelCascade(a, 'add', { orderedIds: ['a', 'b', 'c'] });
  eq(r.changed, true, 'add: changed');
  eq(r.cascadedSelected, 3, 'add: 3 cascaded');
  eq(idsSelected(a).length, 3, 'add: all 3 selected');
}

// ── 'add' on already-selected — no change ─────────────────────────
{
  const a = makeAction([fc('a', { selected: true }), fc('b', { selected: true })]);
  const r = applyGraphSelectAllChannelCascade(a, 'add', { orderedIds: ['a', 'b'] });
  eq(r.changed, false, 'add no-op: no change');
}

// ── 'clear' cascade — deselects every in-scope ─────────────────────
{
  const a = makeAction([fc('a', { selected: true }), fc('b', { selected: true }), fc('c')]);
  const r = applyGraphSelectAllChannelCascade(a, 'clear', { orderedIds: ['a', 'b', 'c'] });
  eq(r.changed, true, 'clear: changed');
  eq(r.cascadedSelected, 2, 'clear: 2 cascaded');
  eq(idsSelected(a).length, 0, 'clear: none selected');
}

// ── 'invert' cascade — channel-level identical to 'add' per Blender
// `:407-408` (audit-fix HIGH-1 2026-05-18). The per-keyform flip is
// the user's intent at the BezTriple level (caller's
// setSelectedHandles); the channel-level cascade always sets
// fc.selected=true regardless of prior state — Blender's else branch
// fires for both SELECT_ADD and SELECT_INVERT.
{
  const a = makeAction([fc('a', { selected: true }), fc('b'), fc('c', { selected: true })]);
  const r = applyGraphSelectAllChannelCascade(a, 'invert', { orderedIds: ['a', 'b', 'c'] });
  eq(r.changed, true, 'invert: changed');
  eq(idsSelected(a).join(','), 'a,b,c', 'invert: ALL channels selected (Blender :407-408 unconditional set)');
}

// ── Cascade-clear fc.active on in-scope ───────────────────────────
{
  const a = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b', { selected: true }),
  ]);
  const r = applyGraphSelectAllChannelCascade(a, 'add', { orderedIds: ['a', 'b'] });
  eq(r.clearedActiveCount, 1, 'add: 1 active cleared (a was active)');
  eq(idsActive(a).length, 0, 'add: no fcurve carries active=true (no restore — no previouslyActive)');
}

// ── Restore: previouslyActive in scope → re-elevated ──────────────
{
  const a = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
    fc('c'),
  ]);
  const r = applyGraphSelectAllChannelCascade(a, 'clear', {
    orderedIds: ['a', 'b', 'c'],
    previouslyActive: 'a',
  });
  eq(r.changed, true, 'restore: changed');
  eq(r.restoredActive, true, 'restore: restoredActive=true');
  eq(idsSelected(a).join(','), 'a', 'restore: a re-selected (others cleared by clear+restore)');
  eq(idsActive(a).join(','), 'a', 'restore: a re-elevated to active');
}

// ── Restore on 'add' — previouslyActive in scope → preserved across
// Step 2 (skipped per optimization) and Step 3 (confirms restoredActive
// path executed). r.changed=true ONLY when something net-mutates.
{
  const a = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
  ]);
  const r = applyGraphSelectAllChannelCascade(a, 'add', {
    orderedIds: ['a', 'b'],
    previouslyActive: 'a',
  });
  // a was already selected+active. Only mutation: b.selected = true.
  eq(r.changed, true, 'add+restore: changed=true (b.selected newly set)');
  eq(r.restoredActive, true, 'add+restore: restoredActive=true (path executed)');
  eq(r.clearedActiveCount, 0, 'add+restore: 0 actives cleared (a skipped per Step 2 optimization)');
  eq(idsActive(a).join(','), 'a', 'add+restore: a still active');
  eq(idsSelected(a).join(','), 'a,b', 'add+restore: all in scope selected');
}

// ── Restore: previouslyActive OUT of scope → skipped (matches
// Blender's `get_active_fcurve_channel` visibility gate) ───────────
{
  const a = makeAction([
    fc('a', { active: true }),  // out of scope (hidden)
    fc('b', { selected: true }),
  ]);
  const r = applyGraphSelectAllChannelCascade(a, 'clear', {
    orderedIds: ['b'],  // only b is visible
    previouslyActive: 'a',
  });
  eq(r.restoredActive, false, 'restore-skipped: previouslyActive out of scope');
  eq(a.fcurves[0].active, true, 'restore-skipped: a still active (out of scope, Step 2 didn\'t touch)');
  eq(a.fcurves[1].selected, false, 'restore-skipped: b cleared');
}

// ── EXCLUSIVE re-elevation: stale out-of-scope active cleared ─────
// previouslyActive is 'a' (in scope). 'hidden' fcurve OUT of scope
// has stale active=true (Slice 5.X invariant breach). Step 2 doesn't
// touch hidden (out of scope), but Step 3's setActiveFCurve is
// EXCLUSIVE — clears 'hidden' active too.
{
  const a = makeAction([
    fc('a', { selected: true, active: true }),
    fc('hidden', { active: true }),  // invariant breach: 2 actives pre-state
    fc('b'),
  ]);
  const r = applyGraphSelectAllChannelCascade(a, 'clear', {
    orderedIds: ['a', 'b'],
    previouslyActive: 'a',
  });
  eq(r.restoredActive, true, 'EXCLUSIVE: restoredActive=true');
  eq(idsActive(a).join(','), 'a', 'EXCLUSIVE: only previouslyActive carries active (stale "hidden" cleared)');
}

// ── Preflight matches setter (integration) ────────────────────────
{
  const scenarios = [
    () => ({
      action: makeAction([fc('a'), fc('b')]),
      mode: 'add',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true }), fc('b', { selected: true })]),
      mode: 'add',
      ctx: { orderedIds: ['a', 'b'] },  // no-op
    }),
    () => ({
      action: makeAction([fc('a', { selected: true }), fc('b')]),
      mode: 'clear',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a'), fc('b')]),
      mode: 'clear',
      ctx: { orderedIds: ['a', 'b'] },  // no-op
    }),
    () => ({
      action: makeAction([fc('a', { selected: true }), fc('b')]),
      mode: 'invert',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true, active: true }), fc('b')]),
      mode: 'clear',
      ctx: { orderedIds: ['a', 'b'], previouslyActive: 'a' },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true, active: true })]),
      mode: 'add',
      ctx: { orderedIds: ['a'], previouslyActive: 'a' },
    }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sA = scenarios[i]();
    const sB = scenarios[i]();
    const predicted = wouldGraphSelectAllChannelCascadeChange(sA.action, sA.mode, sA.ctx);
    const r = applyGraphSelectAllChannelCascade(sB.action, sB.mode, sB.ctx);
    eq(predicted, r.changed, `scenario ${i} (${sA.mode}): preflight matches setter`);
  }
}

// Audit-fix MED-4 (2026-05-18): empty action — all steps no-op.
{
  const a = makeAction([]);
  const r = applyGraphSelectAllChannelCascade(a, 'invert', { orderedIds: ['x'], previouslyActive: 'x' });
  eq(r.changed, false, 'MED-4 empty fcurves: no change even with invert');
  eq(r.restoredActive, false, 'MED-4 empty fcurves: restoredActive=false (no fc to restore)');
}

// Audit-fix MED-4 (2026-05-18): deleted previouslyActive — restore
// gracefully skips because byId.get(previouslyActive) returns
// undefined; the `if (fc)` guard at Step 3 prevents a crash and
// restoredActive stays false (the restore SEMANTIC requires a real
// fcurve to restore to).
{
  const a = makeAction([fc('b', { selected: true })]);
  const r = applyGraphSelectAllChannelCascade(a, 'clear', {
    orderedIds: ['deleted', 'b'],
    previouslyActive: 'deleted',
  });
  eq(r.restoredActive, false, 'MED-4 deleted previouslyActive: restore skipped (fc not found)');
  eq(r.changed, true, 'MED-4 deleted previouslyActive: b.selected cleared');
  eq(a.fcurves[0].selected, false, 'MED-4: b.selected actually cleared');
}

// ── Preflight guards ──────────────────────────────────────────────
{
  eq(wouldGraphSelectAllChannelCascadeChange(null, 'add', { orderedIds: ['a'] }), false, 'preflight: null action → false');
  eq(wouldGraphSelectAllChannelCascadeChange({}, 'add', { orderedIds: ['a'] }), false, 'preflight: empty action → false');
  eq(wouldGraphSelectAllChannelCascadeChange(makeAction([fc('a')]), 'bogus', { orderedIds: ['a'] }), false, 'preflight: bad mode → false');
  eq(wouldGraphSelectAllChannelCascadeChange(makeAction([fc('a')]), 'add', { orderedIds: [] }), false, 'preflight: empty orderedIds → false');
}

// ── final report ───────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} graphSelectAllCascade assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
