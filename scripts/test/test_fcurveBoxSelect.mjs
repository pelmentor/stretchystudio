// Animation Phase 5 Slice 5.Y — tests for
// src/anim/fcurveBoxSelect.js (channel-list box-select port of
// Blender's ANIM_OT_channels_select_box).
//
// Coverage:
//   - applyChannelBoxSelect:
//       null/undefined/bad-shape action guards
//       bad-mode guard
//       missing/empty orderedIds → no-op
//       'replace': pre-clear visible + ADD in-rect (clears active)
//       'extend': no pre-clear + ADD in-rect (preserves active)
//       'deselect': pre-clear visible + CLEAR in-rect (literal Blender)
//       active-clear gates: in-scope vs out-of-scope active
//       ghost ids (in orderedIds, not in action.fcurves)
//       inRect contains out-of-scope ids → ignored
//       sparse `selected` (missing field treated as false)
//   - wouldChannelBoxSelectChange:
//       preflight matches setter for every scenario
//
// Run: node scripts/test/test_fcurveBoxSelect.mjs

import {
  applyChannelBoxSelect,
  wouldChannelBoxSelectChange,
} from '../../src/anim/fcurveBoxSelect.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function deep(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
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

// ── applyChannelBoxSelect: guards ──────────────────────────────────
{
  const r1 = applyChannelBoxSelect(null, ['a'], 'replace', { orderedIds: ['a'] });
  eq(r1.changed, false, 'null action → no change');
  eq(r1.resultMode, null, 'null action → resultMode null');

  const r2 = applyChannelBoxSelect({}, ['a'], 'replace', { orderedIds: ['a'] });
  eq(r2.changed, false, 'action without fcurves → no change');

  const r3 = applyChannelBoxSelect(makeAction([fc('a')]), ['a'], 'bogus', { orderedIds: ['a'] });
  eq(r3.changed, false, 'bad mode → no change');

  const r4 = applyChannelBoxSelect(makeAction([fc('a')]), ['a'], 'replace', null);
  eq(r4.changed, false, 'no ctx → no change');

  const r5 = applyChannelBoxSelect(makeAction([fc('a')]), ['a'], 'replace', { orderedIds: [] });
  eq(r5.changed, false, 'empty orderedIds → no change');

  const r6 = applyChannelBoxSelect(makeAction([fc('a')]), ['a'], 'replace', { orderedIds: 'not-array' });
  eq(r6.changed, false, 'non-array orderedIds → no change');
}

// ── 'replace': pre-clear visible + ADD in-rect ─────────────────────
{
  const action = makeAction([
    fc('a', { selected: true }),
    fc('b'),
    fc('c', { selected: true }),
    fc('d'),
  ]);
  const r = applyChannelBoxSelect(action, ['b', 'c'], 'replace', {
    orderedIds: ['a', 'b', 'c', 'd'],
  });
  eq(r.changed, true, 'replace: changed');
  eq(r.resultMode, 'replace', 'replace: resultMode');
  eq(r.touchedCount, 2, 'replace: 2 in-rect ids');
  eq(r.selectedAfter, 2, 'replace: 2 selected after (b + c)');
  deep(idsSelected(action), ['b', 'c'], 'replace: b + c selected, a + d wiped');
}

// ── 'replace': active in scope → cleared (no re-elevation) ────────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
    fc('c'),
  ]);
  const r = applyChannelBoxSelect(action, ['a'], 'replace', {
    orderedIds: ['a', 'b', 'c'],
    activeFCurveId: 'a',
  });
  eq(r.changed, true, 'replace+active-in-rect: changed');
  eq(r.clearedActive, true, 'replace: active cleared (even though re-selected in rect)');
  deep(idsSelected(action), ['a'], 'a re-selected as in-rect');
  deep(idsActive(action), [], 'box-select never re-elevates active');
}

// ── 'replace': active in scope, NOT in rect → still cleared ───────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
    fc('c'),
  ]);
  const r = applyChannelBoxSelect(action, ['b'], 'replace', {
    orderedIds: ['a', 'b', 'c'],
    activeFCurveId: 'a',
  });
  eq(r.clearedActive, true, 'replace+active-out-of-rect: active cleared');
  deep(idsSelected(action), ['b'], 'only b selected');
  deep(idsActive(action), [], 'active cleared');
}

// ── 'replace': active OUT of visible scope → preserved ────────────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
  ]);
  const r = applyChannelBoxSelect(action, ['b'], 'replace', {
    orderedIds: ['b'],  // 'a' is hidden / filtered out of visible
    activeFCurveId: 'a',
  });
  eq(r.clearedActive, false, 'replace: active out-of-scope preserved');
  deep(idsActive(action), ['a'], 'a still active');
  // a's `selected` is NOT cleared because it's outside the visible scope
  deep(idsSelected(action), ['a', 'b'], 'a still selected (out-of-scope), b newly selected');
}

// ── 'extend': no pre-clear + ADD in-rect (preserves active) ───────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b'),
    fc('c'),
    fc('d'),
  ]);
  const r = applyChannelBoxSelect(action, ['c', 'd'], 'extend', {
    orderedIds: ['a', 'b', 'c', 'd'],
    activeFCurveId: 'a',
  });
  eq(r.changed, true, 'extend: changed');
  eq(r.clearedActive, false, 'extend: active preserved');
  deep(idsSelected(action), ['a', 'c', 'd'], 'extend: a (kept) + c + d (added)');
  deep(idsActive(action), ['a'], 'active still on a');
}

// ── 'extend': no-op when in-rect already selected ─────────────────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b', { selected: true }),
  ]);
  const r = applyChannelBoxSelect(action, ['b'], 'extend', {
    orderedIds: ['a', 'b'],
    activeFCurveId: 'a',
  });
  eq(r.changed, false, 'extend: already-selected in-rect → no-op');
  eq(r.clearedActive, false, 'extend: active preserved on no-op');
}

// ── 'deselect': pre-clear + CLEAR in-rect (net = full clear) ──────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b', { selected: true }),
    fc('c'),
    fc('d', { selected: true }),
  ]);
  const r = applyChannelBoxSelect(action, ['a', 'b'], 'deselect', {
    orderedIds: ['a', 'b', 'c', 'd'],
    activeFCurveId: 'a',
  });
  eq(r.changed, true, 'deselect: changed');
  eq(r.clearedActive, true, 'deselect: active cleared (in scope)');
  deep(idsSelected(action), [], 'deselect: every visible cleared (literal Blender)');
  deep(idsActive(action), [], 'active cleared');
}

// ── 'deselect': out-of-scope selections survive ───────────────────
{
  const action = makeAction([
    fc('a', { selected: true }),
    fc('b', { selected: true }),
  ]);
  const r = applyChannelBoxSelect(action, ['b'], 'deselect', {
    orderedIds: ['b'],  // 'a' out of visible scope
  });
  eq(r.changed, true, 'deselect: changed');
  deep(idsSelected(action), ['a'], 'out-of-scope a preserved; visible b cleared');
}

// ── ghost ids in orderedIds (not in action.fcurves) ───────────────
{
  const action = makeAction([
    fc('a', { selected: true }),
    fc('b'),
  ]);
  const r = applyChannelBoxSelect(action, ['ghost', 'b'], 'replace', {
    orderedIds: ['a', 'ghost', 'b'],
  });
  eq(r.changed, true, 'ghost ids tolerated');
  deep(idsSelected(action), ['b'], 'ghost ignored; b selected');
  eq(r.touchedCount, 1, 'touchedCount only counts real fcurves');
}

// ── inRect contains out-of-scope ids → ignored ────────────────────
{
  const action = makeAction([
    fc('a'),
    fc('b'),
    fc('c'),
  ]);
  const r = applyChannelBoxSelect(action, ['a', 'b', 'c'], 'replace', {
    orderedIds: ['a', 'b'],  // c is out of visible scope
  });
  eq(r.changed, true, 'changed');
  deep(idsSelected(action), ['a', 'b'], 'only visible-scope ids in inRect count');
  eq(r.touchedCount, 2, 'c not counted (out of scope)');
}

// ── inRect with bad entries (null/non-strings) ────────────────────
{
  const action = makeAction([fc('a'), fc('b')]);
  const r = applyChannelBoxSelect(action, [null, 'a', '', undefined, 42, 'b'], 'replace', {
    orderedIds: ['a', 'b'],
  });
  eq(r.changed, true, 'bad inRect entries tolerated');
  deep(idsSelected(action), ['a', 'b'], 'both selected');
}

// ── sparse `selected` (missing field treated as false) ────────────
{
  const action = makeAction([fc('a'), fc('b')]);
  const r = applyChannelBoxSelect(action, ['b'], 'replace', { orderedIds: ['a', 'b'] });
  eq(r.changed, true, 'sparse → changed');
  deep(idsSelected(action), ['b'], 'b selected from sparse-false start');
}

// ── empty inRect under 'replace' → wipes visible scope ────────────
{
  const action = makeAction([
    fc('a', { selected: true, active: true }),
    fc('b', { selected: true }),
  ]);
  const r = applyChannelBoxSelect(action, [], 'replace', {
    orderedIds: ['a', 'b'],
    activeFCurveId: 'a',
  });
  eq(r.changed, true, 'empty inRect + replace = pre-clear only');
  eq(r.clearedActive, true, 'active cleared');
  deep(idsSelected(action), [], 'all visible cleared');
}

// ── 'replace' no-op when nothing changes ──────────────────────────
{
  // Pre-clear is a no-op (no one selected), in-rect targets are already selected (none).
  const action = makeAction([fc('a'), fc('b')]);
  const r = applyChannelBoxSelect(action, [], 'replace', { orderedIds: ['a', 'b'] });
  eq(r.changed, false, 'replace no-op: nothing selected before, nothing in rect');
  eq(r.clearedActive, false, 'no active, no clear');
}

// ── wouldChannelBoxSelectChange: matches setter (integration) ─────
// Audit-fix MED-4 (Slice 5.Y arch audit 2026-05-17): the comparator
// is `r.changed || r.clearedActive` because the helper's `changed`
// field only reflects `selected` mutations — when the only mutation is
// the active-clear cascade (selected unchanged, active dropped), the
// preflight correctly returns true while `changed` stays false. The
// dispatcher gates on the preflight, not on `changed`, so this is the
// right equivalence to assert. See active-clear-only scenario below.
{
  const scenarios = [
    () => ({
      action: makeAction([fc('a', { selected: true }), fc('b'), fc('c', { selected: true })]),
      ids: ['b'],
      mode: 'replace',
      ctx: { orderedIds: ['a', 'b', 'c'] },
    }),
    () => ({
      action: makeAction([fc('a'), fc('b', { selected: true })]),
      ids: ['b'],
      mode: 'extend',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a'), fc('b')]),
      ids: ['a', 'b'],
      mode: 'extend',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true }), fc('b', { selected: true })]),
      ids: ['a'],
      mode: 'deselect',
      ctx: { orderedIds: ['a', 'b'] },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true, active: true })]),
      ids: ['a'],
      mode: 'replace',
      ctx: { orderedIds: ['a'], activeFCurveId: 'a' },
    }),
    () => ({
      action: makeAction([fc('a', { selected: true })]),
      ids: ['a'],
      mode: 'replace',
      ctx: { orderedIds: ['a'] }, // no-op: was selected, still selected
    }),
    () => ({
      action: makeAction([fc('a')]),
      ids: [],
      mode: 'replace',
      ctx: { orderedIds: ['a'] }, // no-op
    }),
    () => ({
      action: makeAction([fc('a', { selected: true })]),
      ids: ['a'],
      mode: 'deselect',
      ctx: { orderedIds: ['a'] }, // pre-clear flips a to false (changed)
    }),
    () => ({
      action: makeAction([fc('a'), fc('b'), fc('c')]),
      ids: ['b', 'c'],
      mode: 'extend',
      ctx: { orderedIds: ['a', 'b', 'c'] },
    }),
    // Audit-fix MED-4 scenario: only the active flag changes.
    // a is NOT selected, IS active, NOT in rect, mode=replace.
    // - Pre-clear: a.selected=false → nothing to flip.
    // - In-rect: empty → nothing to add.
    // - Active-clear: pre-clear ran AND active in scope → clearActiveFCurves.
    // Setter returns changed=false (no `selected` flips) but clearedActive=true.
    // Preflight correctly returns true (something mutates).
    () => ({
      action: makeAction([fc('a', { active: true })]),
      ids: [],
      mode: 'replace',
      ctx: { orderedIds: ['a'], activeFCurveId: 'a' },
    }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sA = scenarios[i]();
    const sB = scenarios[i]();
    const predicted = wouldChannelBoxSelectChange(sA.action, sA.ids, sA.mode, sA.ctx);
    const r = applyChannelBoxSelect(sB.action, sB.ids, sB.mode, sB.ctx);
    const anyMutation = r.changed || r.clearedActive;
    eq(predicted, anyMutation, `scenario ${i} (${sA.mode}): preflight matches setter (changed||clearedActive)`);
  }
}

// ── MED-4 standalone: active-clear-only scenario detail ──────────
{
  const action = makeAction([fc('a', { active: true })]);
  const predicted = wouldChannelBoxSelectChange(action, [], 'replace', {
    orderedIds: ['a'], activeFCurveId: 'a',
  });
  eq(predicted, true, 'preflight: active-only mutation → true');
  const r = applyChannelBoxSelect(action, [], 'replace', {
    orderedIds: ['a'], activeFCurveId: 'a',
  });
  eq(r.changed, false, 'setter: changed=false (no `selected` flips)');
  eq(r.clearedActive, true, 'setter: clearedActive=true');
  eq(action.fcurves[0].active, undefined, 'a.active sparse-deleted');
}

// ── preflight guards mirror setter ────────────────────────────────
{
  eq(wouldChannelBoxSelectChange(null, ['a'], 'replace', { orderedIds: ['a'] }), false, 'preflight: null action → false');
  eq(wouldChannelBoxSelectChange({}, ['a'], 'replace', { orderedIds: ['a'] }), false, 'preflight: empty action → false');
  eq(wouldChannelBoxSelectChange(makeAction([fc('a')]), ['a'], 'bogus', { orderedIds: ['a'] }), false, 'preflight: bad mode → false');
  eq(wouldChannelBoxSelectChange(makeAction([fc('a')]), ['a'], 'replace', null), false, 'preflight: no ctx → false');
  eq(wouldChannelBoxSelectChange(makeAction([fc('a')]), ['a'], 'replace', { orderedIds: [] }), false, 'preflight: empty orderedIds → false');
}

// ── preflight: active-clear gate fires even when selection no-op ──
{
  // Active is in scope, selected, and IS in rect → pre-clear flips, then
  // in-rect re-selects (selection net-unchanged). But active flag IS cleared.
  const action = makeAction([
    fc('a', { selected: true, active: true }),
  ]);
  const predicted = wouldChannelBoxSelectChange(action, ['a'], 'replace', {
    orderedIds: ['a'],
    activeFCurveId: 'a',
  });
  eq(predicted, true, 'preflight: active-clear alone counts as change');
  const r = applyChannelBoxSelect(action, ['a'], 'replace', {
    orderedIds: ['a'],
    activeFCurveId: 'a',
  });
  eq(r.changed, true, 'setter: changed=true (preclear flipped selected)');
  eq(r.clearedActive, true, 'setter: cleared active');
}

// ── final report ───────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} fcurveBoxSelect assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
