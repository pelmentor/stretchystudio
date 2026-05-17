// Animation Phase 5 Slice 5.Q — tests for
// src/v3/editors/fcurve/activeKeyformPanelData.js (Active Keyframe
// N-panel data layer).
//
// Coverage:
//   - resolveActiveKeyformContext: null guards, no-active sentinel,
//     resolved context shape
//   - applyEditKeyformValue + wouldEditKeyformValueChange:
//     no-active no-op, same-value no-op, value write, sparse-tolerance
//   - applyEditKeyformFrame + wouldEditKeyformFrameChange:
//     time write + re-sort + active-index relocation across neighbor
//     boundaries, same-time no-op
//   - applyEditKeyformInterpolation + wouldEditKeyformInterpolationChange:
//     interp write, sparse-default 'linear' handling (write 'linear'
//     onto sparse → no-op; write 'linear' onto explicit non-linear
//     → delete field to keep schema sparse)
//   - Preflight symmetry (Slice 5.M HIGH-A1 lesson) for all 3 fields
//
// Run: node scripts/test/test_activeKeyformPanelData.mjs

import {
  resolveActiveKeyformContext,
  wouldEditKeyformValueChange,
  applyEditKeyformValue,
  wouldEditKeyformFrameChange,
  applyEditKeyformFrame,
  wouldEditKeyformInterpolationChange,
  applyEditKeyformInterpolation,
} from '../../src/v3/editors/fcurve/activeKeyformPanelData.js';
import { FCURVE_ACTIVE_KEYFORM_NONE } from '../../src/anim/fcurveActiveKeyform.js';

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

function makeKeyform(time, value, extra = {}) {
  return {
    time, value,
    handleLeft: { time, value },
    handleRight: { time, value },
    handleType: { left: 'auto', right: 'auto' },
    interpolation: 'linear',
    ...extra,
  };
}

function makeAction(fcurves) {
  return { id: 'A', fcurves };
}

function fc(id, keyforms, activeIdx) {
  return {
    id,
    rnaPath: `objects["__params__"].values["${id}"]`,
    keyforms,
    ...(typeof activeIdx === 'number' ? { activeKeyformIndex: activeIdx } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// resolveActiveKeyformContext

{
  // Null/undefined/empty guards.
  eq(resolveActiveKeyformContext(null, 'a'),                   null, 'resolve: null action');
  eq(resolveActiveKeyformContext(undefined, 'a'),              null, 'resolve: undefined action');
  eq(resolveActiveKeyformContext({ fcurves: null }, 'a'),      null, 'resolve: null fcurves');
  eq(resolveActiveKeyformContext(makeAction([]), 'a'),         null, 'resolve: empty fcurves');
  eq(resolveActiveKeyformContext(makeAction([fc('a', [], 0)]), null), null, 'resolve: null fcurveId');
  eq(resolveActiveKeyformContext(makeAction([fc('a', [], 0)]), ''), null, 'resolve: empty fcurveId');
  eq(resolveActiveKeyformContext(makeAction([fc('a', [], 0)]), 'nonexistent'), null, 'resolve: unknown id');
}

{
  // No active set (missing activeKeyformIndex) → null.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)])]);
  eq(resolveActiveKeyformContext(a, 'a'), null, 'resolve: no active set');
}

{
  // Active sentinel (= -1) → null.
  const f = fc('a', [makeKeyform(0, 0)]);
  f.activeKeyformIndex = FCURVE_ACTIVE_KEYFORM_NONE;
  const a = makeAction([f]);
  eq(resolveActiveKeyformContext(a, 'a'), null, 'resolve: NONE sentinel');
}

{
  // Out-of-bounds active index → null (getActiveKeyformIndex handles
  // the bounds check).
  const f = fc('a', [makeKeyform(0, 0)], 99);
  const a = makeAction([f]);
  eq(resolveActiveKeyformContext(a, 'a'), null, 'resolve: OOB index → null');
}

{
  // Resolved context.
  const f = fc('a', [makeKeyform(0, 0.5), makeKeyform(100, 0.8)], 1);
  const a = makeAction([f]);
  const ctx = resolveActiveKeyformContext(a, 'a');
  assert(ctx !== null,              'resolve: non-null context');
  eq(ctx?.fcurve.id, 'a',           'resolve: fcurve.id');
  eq(ctx?.kfIndex, 1,               'resolve: kfIndex=1');
  eq(ctx?.kf.time, 100,             'resolve: kf.time=100');
  eq(ctx?.kf.value, 0.8,            'resolve: kf.value=0.8');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformValue + preflight

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformValue(a, 'a', 0.5).changed, false, 'editValue no-active: no-op');
  eq(wouldEditKeyformValueChange(a, 'a', 0.5), false,   'preflight no-active: false');
}

{
  // Same value → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0.5), makeKeyform(100, 0.8)], 0)]);
  eq(applyEditKeyformValue(a, 'a', 0.5).changed, false, 'editValue same: no-op');
  eq(wouldEditKeyformValueChange(a, 'a', 0.5), false,   'preflight same: false');
  eq(a.fcurves[0].keyforms[0].value, 0.5,               'editValue same: value unchanged');
}

{
  // Different value → write.
  const a = makeAction([fc('a', [makeKeyform(0, 0.5), makeKeyform(100, 0.8)], 0)]);
  eq(wouldEditKeyformValueChange(a, 'a', 1.2), true,    'preflight different: true');
  const r = applyEditKeyformValue(a, 'a', 1.2);
  eq(r.changed, true,                                   'editValue different: changed');
  eq(a.fcurves[0].keyforms[0].value, 1.2,               'editValue different: value=1.2');
  eq(a.fcurves[0].keyforms[1].value, 0.8,               'editValue different: peer unchanged');
}

{
  // NaN / Infinity → guard returns no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0.5)], 0)]);
  eq(applyEditKeyformValue(a, 'a', NaN).changed, false,       'editValue NaN: guard');
  eq(applyEditKeyformValue(a, 'a', Infinity).changed, false,  'editValue Infinity: guard');
  eq(wouldEditKeyformValueChange(a, 'a', NaN), false,         'preflight NaN: false');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformFrame + preflight + re-sort + active-index relocation

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 0)])]);
  eq(applyEditKeyformFrame(a, 'a', 50).changed, false,  'editFrame no-active: no-op');
  eq(wouldEditKeyformFrameChange(a, 'a', 50), false,    'preflight no-active: false');
}

{
  // Same time → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]);
  eq(applyEditKeyformFrame(a, 'a', 100).changed, false, 'editFrame same: no-op');
  eq(wouldEditKeyformFrameChange(a, 'a', 100), false,   'preflight same: false');
}

{
  // Move within bounds (no crossing) → index unchanged.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1), makeKeyform(200, 2)], 1)]);
  const r = applyEditKeyformFrame(a, 'a', 150);
  eq(r.changed, true,                                   'editFrame mid: changed');
  eq(r.newIndex, 1,                                     'editFrame mid: index stays 1');
  eq(a.fcurves[0].keyforms[1].time, 150,                'editFrame mid: time=150');
  eq(a.fcurves[0].activeKeyformIndex, 1,                'editFrame mid: activeIdx=1');
}

{
  // Move past next neighbor → index shifts forward, kfs sorted.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1), makeKeyform(200, 2)], 1)]);
  // Move kf[1] (time=100, active) past kf[2] (time=200) → new time 250.
  const r = applyEditKeyformFrame(a, 'a', 250);
  eq(r.changed, true,                                   'editFrame cross-fwd: changed');
  eq(r.newIndex, 2,                                     'editFrame cross-fwd: new index=2');
  eq(a.fcurves[0].keyforms.map((k) => k.time).join(','), '0,200,250', 'editFrame cross-fwd: sort order');
  eq(a.fcurves[0].keyforms[2].value, 1,                 'editFrame cross-fwd: value preserved');
  eq(a.fcurves[0].activeKeyformIndex, 2,                'editFrame cross-fwd: activeIdx=2');
}

{
  // Move BEFORE prev neighbor → index shifts backward.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1), makeKeyform(200, 2)], 1)]);
  // Move kf[1] (time=100, active) before kf[0] (time=0) → new time -50.
  const r = applyEditKeyformFrame(a, 'a', -50);
  eq(r.changed, true,                                   'editFrame cross-bwd: changed');
  eq(r.newIndex, 0,                                     'editFrame cross-bwd: new index=0');
  eq(a.fcurves[0].keyforms.map((k) => k.time).join(','), '-50,0,200', 'editFrame cross-bwd: sort order');
  eq(a.fcurves[0].keyforms[0].value, 1,                 'editFrame cross-bwd: value preserved');
}

{
  // NaN / Infinity → guard.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  eq(applyEditKeyformFrame(a, 'a', NaN).changed, false,      'editFrame NaN: guard');
  eq(applyEditKeyformFrame(a, 'a', Infinity).changed, false, 'editFrame Infinity: guard');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformInterpolation + preflight

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformInterpolation(a, 'a', 'bezier').changed, false, 'editInterp no-active: no-op');
  eq(wouldEditKeyformInterpolationChange(a, 'a', 'bezier'), false,   'preflight no-active: false');
}

{
  // Same interp (explicit) → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]);
  eq(applyEditKeyformInterpolation(a, 'a', 'bezier').changed, false, 'editInterp same: no-op');
  eq(wouldEditKeyformInterpolationChange(a, 'a', 'bezier'), false,   'preflight same: false');
}

{
  // Sparse → 'linear' → no-op (sparse defaults to linear).
  const f = fc('a', [makeKeyform(0, 0)], 0);
  delete f.keyforms[0].interpolation; // make sparse
  const a = makeAction([f]);
  eq(applyEditKeyformInterpolation(a, 'a', 'linear').changed, false, 'editInterp sparse→linear: no-op');
  eq(wouldEditKeyformInterpolationChange(a, 'a', 'linear'), false,   'preflight sparse→linear: false');
  assert(!('interpolation' in a.fcurves[0].keyforms[0]), 'editInterp sparse→linear: stays sparse');
}

{
  // Sparse → 'bezier' → writes 'bezier'.
  const f = fc('a', [makeKeyform(0, 0)], 0);
  delete f.keyforms[0].interpolation;
  const a = makeAction([f]);
  eq(wouldEditKeyformInterpolationChange(a, 'a', 'bezier'), true, 'preflight sparse→bezier: true');
  const r = applyEditKeyformInterpolation(a, 'a', 'bezier');
  eq(r.changed, true,                                              'editInterp sparse→bezier: changed');
  eq(a.fcurves[0].keyforms[0].interpolation, 'bezier',             'editInterp sparse→bezier: value');
}

{
  // 'bezier' → 'linear' → DELETES the field (sparse discipline).
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]);
  const r = applyEditKeyformInterpolation(a, 'a', 'linear');
  eq(r.changed, true,                                              'editInterp bezier→linear: changed');
  assert(!('interpolation' in a.fcurves[0].keyforms[0]),           'editInterp bezier→linear: field deleted (sparse)');
}

{
  // 'bezier' → 'sine' → writes 'sine'.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]);
  const r = applyEditKeyformInterpolation(a, 'a', 'sine');
  eq(r.changed, true,                                              'editInterp bezier→sine: changed');
  eq(a.fcurves[0].keyforms[0].interpolation, 'sine',               'editInterp bezier→sine: value');
}

{
  // Empty string / non-string → guard.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]);
  eq(applyEditKeyformInterpolation(a, 'a', '').changed, false,     'editInterp empty: guard');
  // @ts-expect-error — testing runtime guard against invalid input.
  eq(applyEditKeyformInterpolation(a, 'a', null).changed, false,   'editInterp null: guard');
  // @ts-expect-error — testing runtime guard against invalid input.
  eq(applyEditKeyformInterpolation(a, 'a', 123).changed, false,    'editInterp number: guard');
  eq(a.fcurves[0].keyforms[0].interpolation, 'bezier',             'editInterp guarded: no write');
}

// ─────────────────────────────────────────────────────────────────────
// Preflight symmetry — for every mutator + input combination, the
// preflight result must match `changed`. This is the Slice 5.M HIGH-A1
// drift-protection invariant.

{
  const cases = [
    // [action factory, fcurveId, mutator, preflight, input]
    [() => makeAction([fc('a', [makeKeyform(0, 0.5)], 0)]),                 'a', applyEditKeyformValue,         wouldEditKeyformValueChange,         0.5],
    [() => makeAction([fc('a', [makeKeyform(0, 0.5)], 0)]),                 'a', applyEditKeyformValue,         wouldEditKeyformValueChange,         1.2],
    [() => makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 0)], 0)]), 'a', applyEditKeyformFrame,      wouldEditKeyformFrameChange,         0],
    [() => makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 0)], 0)]), 'a', applyEditKeyformFrame,      wouldEditKeyformFrameChange,         50],
    [() => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]), 'a', applyEditKeyformInterpolation, wouldEditKeyformInterpolationChange, 'bezier'],
    [() => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]), 'a', applyEditKeyformInterpolation, wouldEditKeyformInterpolationChange, 'sine'],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [factory, id, mutator, pre, input] = cases[i];
    const aRead = factory();
    const aWrite = factory();
    const preResult = pre(aRead, id, input);
    const mResult = mutator(aWrite, id, input);
    eq(preResult, mResult.changed, `preflight↔mutator symmetry case ${i}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
