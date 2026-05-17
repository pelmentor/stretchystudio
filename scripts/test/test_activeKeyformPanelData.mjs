// Animation Phase 5 Slices 5.Q + 5.R — tests for
// src/v3/editors/fcurve/activeKeyformPanelData.js (Active Keyframe
// N-panel data layer).
//
// 5.Q coverage:
//   - resolveActiveKeyformContext: null guards, no-active sentinel,
//     resolved context shape (now includes prevKf per 5.R extension)
//   - applyEditKeyformValue + wouldEditKeyformValueChange:
//     no-active no-op, same-value no-op, value write, sparse-tolerance
//   - applyEditKeyformFrame + wouldEditKeyformFrameChange:
//     time write + re-sort + active-index relocation across neighbor
//     boundaries, same-time no-op
//   - applyEditKeyformInterpolation + wouldEditKeyformInterpolationChange:
//     interp write, sparse-default 'linear' handling
//   - Preflight symmetry (Slice 5.M HIGH-A1 lesson) for all 3 fields
//
// 5.R coverage:
//   - resolveActiveKeyformContext: prevKf shape (null at idx 0,
//     keyform at idx-1 otherwise)
//   - shouldShowLeftHandleSection: predicate fires only when prevKf
//     is bezier
//   - shouldShowRightHandleSection: predicate fires only when current
//     kf is bezier
//   - shouldShowEasingDirection: predicate fires only for named
//     easings (matches Blender `ipo > BEZT_IPO_BEZ`)
//   - shouldShowBackExtras / shouldShowElasticExtras
//   - readHandleCoord: sparse-default falls back to {kf.time, kf.value}
//   - applyEditKeyformHandleType: write + sparse-default delete branch
//     + downstream recalcKeyformHandles invocation evidence
//   - applyEditKeyformHandleCoord: routes through applyHandleDrag
//     (AUTO→ALIGN both sides), per-axis sparse semantics, re-sort
//   - applyEditKeyformEaseMode: write + sparse-default 'auto' delete
//   - applyEditKeyformEasingExtra: back/amplitude/period write +
//     sparse-default delete + Blender default constants
//   - Preflight symmetry for all new mutators
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
  shouldShowLeftHandleSection,
  shouldShowRightHandleSection,
  shouldShowEasingDirection,
  shouldShowBackExtras,
  shouldShowElasticExtras,
  readHandleCoord,
  wouldEditKeyformHandleTypeChange,
  applyEditKeyformHandleType,
  wouldEditKeyformHandleCoordChange,
  applyEditKeyformHandleCoord,
  wouldEditKeyformEaseModeChange,
  applyEditKeyformEaseMode,
  wouldEditKeyformEasingExtraChange,
  applyEditKeyformEasingExtra,
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

// ═════════════════════════════════════════════════════════════════════
// SLICE 5.R — handle / easing recipes
// ═════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// resolveActiveKeyformContext — prevKf shape

{
  // Active at index 0 → prevKf is null.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 0)]);
  const ctx = resolveActiveKeyformContext(a, 'a');
  eq(ctx?.prevKf, null, 'resolve prevKf: idx=0 → null');
}

{
  // Active at index 1 → prevKf = keyforms[0].
  const a = makeAction([fc('a', [makeKeyform(0, 0.5), makeKeyform(100, 0.8)], 1)]);
  const ctx = resolveActiveKeyformContext(a, 'a');
  eq(ctx?.prevKf?.time, 0,    'resolve prevKf: idx=1 → prev.time=0');
  eq(ctx?.prevKf?.value, 0.5, 'resolve prevKf: idx=1 → prev.value=0.5');
}

// ─────────────────────────────────────────────────────────────────────
// Visibility predicates

{
  // shouldShowLeftHandleSection
  eq(shouldShowLeftHandleSection(null), false, 'showLeft: null ctx');
  const a1 = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 0)]);
  eq(shouldShowLeftHandleSection(resolveActiveKeyformContext(a1, 'a')), false, 'showLeft: no prev');
  const a2 = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]);
  eq(shouldShowLeftHandleSection(resolveActiveKeyformContext(a2, 'a')), false, 'showLeft: prev is linear');
  const a3 = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' }), makeKeyform(100, 1)], 1)]);
  eq(shouldShowLeftHandleSection(resolveActiveKeyformContext(a3, 'a')), true,  'showLeft: prev is bezier');
}

{
  // shouldShowRightHandleSection
  eq(shouldShowRightHandleSection(null), false, 'showRight: null ctx');
  const a1 = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  eq(shouldShowRightHandleSection(resolveActiveKeyformContext(a1, 'a')), false, 'showRight: linear');
  const a2 = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'bezier' })], 0)]);
  eq(shouldShowRightHandleSection(resolveActiveKeyformContext(a2, 'a')), true,  'showRight: bezier');
  const a3 = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine' })], 0)]);
  eq(shouldShowRightHandleSection(resolveActiveKeyformContext(a3, 'a')), false, 'showRight: named easing ≠ bezier');
}

{
  // shouldShowEasingDirection — fires only for named easings
  // (ipo > BEZT_IPO_BEZ in Blender enum).
  eq(shouldShowEasingDirection(null), false, 'showEasing: null ctx');
  for (const interp of ['constant', 'linear', 'bezier']) {
    const f = fc('a', [makeKeyform(0, 0, { interpolation: interp })], 0);
    eq(shouldShowEasingDirection(resolveActiveKeyformContext(makeAction([f]), 'a')), false,
       `showEasing: ${interp} → false`);
  }
  for (const interp of ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'bounce', 'elastic']) {
    const f = fc('a', [makeKeyform(0, 0, { interpolation: interp })], 0);
    eq(shouldShowEasingDirection(resolveActiveKeyformContext(makeAction([f]), 'a')), true,
       `showEasing: ${interp} → true`);
  }
  // Sparse (no interpolation field) → linear → false.
  const f = fc('a', [makeKeyform(0, 0)], 0);
  delete f.keyforms[0].interpolation;
  eq(shouldShowEasingDirection(resolveActiveKeyformContext(makeAction([f]), 'a')), false,
     'showEasing: sparse interp → false (sparse-default linear)');
}

{
  // shouldShowBackExtras / shouldShowElasticExtras
  eq(shouldShowBackExtras(null), false, 'showBack: null ctx');
  eq(shouldShowElasticExtras(null), false, 'showElastic: null ctx');
  for (const interp of ['back', 'elastic', 'sine', 'bezier', 'linear']) {
    const f = fc('a', [makeKeyform(0, 0, { interpolation: interp })], 0);
    const ctx = resolveActiveKeyformContext(makeAction([f]), 'a');
    eq(shouldShowBackExtras(ctx),    interp === 'back',    `showBack: ${interp}`);
    eq(shouldShowElasticExtras(ctx), interp === 'elastic', `showElastic: ${interp}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// readHandleCoord — sparse-default falls back to kf.{time,value}

{
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]);
  const ctx = resolveActiveKeyformContext(a, 'a');
  eq(ctx?.kf.handleLeft?.time, 100,  'readHandle setup: handleLeft.time = kf.time');
  eq(readHandleCoord(ctx, 'left')?.time,  100, 'readHandleCoord left.time');
  eq(readHandleCoord(ctx, 'left')?.value, 1,   'readHandleCoord left.value');
  eq(readHandleCoord(ctx, 'right')?.time, 100, 'readHandleCoord right.time');
  eq(readHandleCoord(null, 'left'),  null, 'readHandleCoord: null ctx');
  // @ts-expect-error — testing runtime guard.
  eq(readHandleCoord(ctx, 'bogus'),  null, 'readHandleCoord: bad side');

  // Sparse handleLeft → falls back to kf coords.
  const f = fc('a', [makeKeyform(0, 0), makeKeyform(100, 0.5)], 1);
  delete f.keyforms[1].handleLeft;
  const ctxSparse = resolveActiveKeyformContext(makeAction([f]), 'a');
  eq(readHandleCoord(ctxSparse, 'left')?.time,  100, 'readHandleCoord sparse left.time → kf.time');
  eq(readHandleCoord(ctxSparse, 'left')?.value, 0.5, 'readHandleCoord sparse left.value → kf.value');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformHandleType + preflight

{
  // No active → no-op + preflight false.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformHandleType(a, 'a', 'left', 'aligned').changed, false, 'editHandleType no-active: no-op');
  eq(wouldEditKeyformHandleTypeChange(a, 'a', 'left', 'aligned'), false,  'preflight no-active: false');
}

{
  // Same type → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  eq(applyEditKeyformHandleType(a, 'a', 'left', 'auto').changed, false, 'editHandleType same: no-op');
  eq(wouldEditKeyformHandleTypeChange(a, 'a', 'left', 'auto'), false,   'preflight same: false');
}

{
  // Different type → write + BKE_fcurve_update_handle_flag_from_opposite
  // port flips the OPPOSITE side to match (Blender semantic: picking
  // ALIGN on LEFT promotes RIGHT to ALIGN so the pair can mirror).
  // Audit-fix MED-B3 (5.R dual-audit 2026-05-17) ported the helper —
  // pre-fix RIGHT would have stayed 'auto'.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 0)]);
  eq(wouldEditKeyformHandleTypeChange(a, 'a', 'left', 'aligned'), true, 'preflight different: true');
  const r = applyEditKeyformHandleType(a, 'a', 'left', 'aligned');
  eq(r.changed, true,                                          'editHandleType different: changed');
  eq(a.fcurves[0].keyforms[0].handleType?.left, 'aligned',     'editHandleType: left=aligned');
  eq(a.fcurves[0].keyforms[0].handleType?.right, 'aligned',    'editHandleType MED-B3 port: right→aligned (opposite promoted)');
}

{
  // MED-B3 port — source=FREE, opposite was auto → opposite becomes FREE.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  applyEditKeyformHandleType(a, 'a', 'left', 'free');
  eq(a.fcurves[0].keyforms[0].handleType?.left,  'free', 'editHandleType free: left=free');
  eq(a.fcurves[0].keyforms[0].handleType?.right, 'free', 'editHandleType free: right=free (auto→free per port)');
}

{
  // MED-B3 port — source=VECTOR, opposite was already FREE → opposite stays FREE.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { handleType: { left: 'auto', right: 'free' } })], 0)]);
  applyEditKeyformHandleType(a, 'a', 'left', 'vector');
  eq(a.fcurves[0].keyforms[0].handleType?.left,  'vector', 'editHandleType vector→free-opposite: left=vector');
  eq(a.fcurves[0].keyforms[0].handleType?.right, 'free',   'editHandleType vector→free-opposite: right stays free');
}

{
  // MED-B3 port — source=auto_clamped (mapped to HD_AUTO_ANIM in
  // Blender's switch), opposite promoted to auto_clamped too.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { handleType: { left: 'free', right: 'aligned' } })], 0)]);
  applyEditKeyformHandleType(a, 'a', 'right', 'auto_clamped');
  eq(a.fcurves[0].keyforms[0].handleType?.right, 'auto_clamped', 'editHandleType auto_clamped: right=auto_clamped');
  eq(a.fcurves[0].keyforms[0].handleType?.left,  'auto_clamped', 'editHandleType auto_clamped: left→auto_clamped (free→source per port)');
}

{
  // Sparse-default delete via the MED-B3 port: setting one side to
  // 'auto' propagates to the opposite (auto is in the matching switch
  // case at `fcurve.cc:1252-1257`), and both-auto collapses to a
  // deleted handleType. ONE edit closes the schema sparsity goal.
  // Pre-MED-B3, the opposite side stayed at its previous value and a
  // second edit was needed — that path no longer exists.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { handleType: { left: 'aligned', right: 'aligned' } }),
                                  makeKeyform(100, 1)], 0)]);
  applyEditKeyformHandleType(a, 'a', 'left', 'auto');
  assert(!('handleType' in a.fcurves[0].keyforms[0]),          'editHandleType MED-B3: left→auto deletes via opposite promote');
  // Second call is now a no-op (sparse handleType already collapsed).
  eq(applyEditKeyformHandleType(a, 'a', 'right', 'auto').changed, false, 'editHandleType post-collapse: no-op');
}

{
  // Bad side / bad type → guard.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  // @ts-expect-error — runtime guard test.
  eq(applyEditKeyformHandleType(a, 'a', 'bogus', 'aligned').changed, false, 'editHandleType bad side: guard');
  // @ts-expect-error — runtime guard test.
  eq(applyEditKeyformHandleType(a, 'a', 'left', null).changed, false,      'editHandleType null type: guard');
  eq(applyEditKeyformHandleType(a, 'a', 'left', '').changed, false,        'editHandleType empty type: guard');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformHandleCoord + preflight

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformHandleCoord(a, 'a', 'left', 'time', 50).changed, false, 'editHandleCoord no-active');
  eq(wouldEditKeyformHandleCoordChange(a, 'a', 'left', 'time', 50), false,   'preflight no-active');
}

{
  // Same coord → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]);
  // handleLeft = {time:100, value:1} by makeKeyform default.
  eq(applyEditKeyformHandleCoord(a, 'a', 'left', 'time', 100).changed, false, 'editHandleCoord same time');
  eq(applyEditKeyformHandleCoord(a, 'a', 'left', 'value', 1).changed, false,  'editHandleCoord same value');
}

{
  // Different coord → AUTO→ALIGN on BOTH sides (Blender
  // BKE_nurb_bezt_handle_test) and handle position written.
  //
  // Real sessions populate AUTO handles via recalcKeyformHandles before
  // user interaction. Sim that by starting with already-aligned handles
  // at non-degenerate positions (the auto calc would have produced
  // similar non-kf-coord positions for {(0,0), (100,1)}). Editing with
  // initial handles AT the kf coords (the upsertKeyframe baseline)
  // would hit the aligned-mirror degenerate case where lenB=0 snaps
  // the edited handle back through the kf — that IS Blender-faithful
  // (curve.cc:3266-3282) but isn't a sensible test for the panel edit
  // path.
  const initialHandleLeft  = { time: 80,  value: 0.7 };
  const initialHandleRight = { time: 120, value: 1.3 };
  const a = makeAction([fc('a', [
    makeKeyform(0, 0),
    makeKeyform(100, 1, {
      handleLeft:  initialHandleLeft,
      handleRight: initialHandleRight,
    }),
  ], 1)]);
  const r = applyEditKeyformHandleCoord(a, 'a', 'left', 'time', 70);
  eq(r.changed, true,                                                 'editHandleCoord changed');
  eq(a.fcurves[0].keyforms[1].handleType?.left,  'aligned',           'editHandleCoord: left auto→aligned');
  eq(a.fcurves[0].keyforms[1].handleType?.right, 'aligned',           'editHandleCoord: right auto→aligned (both!)');
  eq(a.fcurves[0].keyforms[1].handleLeft?.time,  70,                  'editHandleCoord: handleLeft.time=70');
  eq(a.fcurves[0].keyforms[1].handleLeft?.value, 0.7,                 'editHandleCoord: handleLeft.value preserved');
}

{
  // Edit handle.value alone — same AUTO→ALIGN side effect.
  const a = makeAction([fc('a', [
    makeKeyform(0, 0),
    makeKeyform(100, 1, {
      handleLeft:  { time: 80,  value: 0.7 },
      handleRight: { time: 120, value: 1.3 },
    }),
  ], 1)]);
  const r = applyEditKeyformHandleCoord(a, 'a', 'right', 'value', 0.5);
  eq(r.changed, true,                                                 'editHandleCoord value: changed');
  eq(a.fcurves[0].keyforms[1].handleRight?.value, 0.5,                'editHandleCoord value write');
  eq(a.fcurves[0].keyforms[1].handleRight?.time,  120,                'editHandleCoord value: time preserved');
}

{
  // Bad input → guard.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  // @ts-expect-error — runtime guard test.
  eq(applyEditKeyformHandleCoord(a, 'a', 'bogus', 'time', 5).changed, false, 'editHandleCoord bad side');
  // @ts-expect-error — runtime guard test.
  eq(applyEditKeyformHandleCoord(a, 'a', 'left',  'bogus', 5).changed, false, 'editHandleCoord bad axis');
  eq(applyEditKeyformHandleCoord(a, 'a', 'left',  'time', NaN).changed, false, 'editHandleCoord NaN');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformEaseMode + preflight

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformEaseMode(a, 'a', 'in').changed, false, 'editEaseMode no-active');
  eq(wouldEditKeyformEaseModeChange(a, 'a', 'in'), false,   'preflight no-active');
}

{
  // Sparse → 'auto' → no-op (sparse defaults to auto).
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine' })], 0)]);
  eq(applyEditKeyformEaseMode(a, 'a', 'auto').changed, false, 'editEaseMode sparse→auto: no-op');
  assert(!('easeMode' in a.fcurves[0].keyforms[0]), 'editEaseMode sparse→auto: stays sparse');
}

{
  // Sparse → 'in' → writes.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine' })], 0)]);
  eq(wouldEditKeyformEaseModeChange(a, 'a', 'in'), true, 'preflight sparse→in: true');
  const r = applyEditKeyformEaseMode(a, 'a', 'in');
  eq(r.changed, true,                                    'editEaseMode sparse→in: changed');
  eq(a.fcurves[0].keyforms[0].easeMode, 'in',            'editEaseMode sparse→in: value');
}

{
  // 'in' → 'auto' → DELETES (sparse discipline).
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine', easeMode: 'in' })], 0)]);
  const r = applyEditKeyformEaseMode(a, 'a', 'auto');
  eq(r.changed, true,                                    'editEaseMode in→auto: changed');
  assert(!('easeMode' in a.fcurves[0].keyforms[0]),      'editEaseMode in→auto: field deleted');
}

{
  // Same → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine', easeMode: 'inout' })], 0)]);
  eq(applyEditKeyformEaseMode(a, 'a', 'inout').changed, false, 'editEaseMode same: no-op');
}

// ─────────────────────────────────────────────────────────────────────
// applyEditKeyformEasingExtra + preflight (back / amplitude / period)

{
  // No active → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0)])]);
  eq(applyEditKeyformEasingExtra(a, 'a', 'back', 2.0).changed, false, 'editExtra no-active');
  eq(wouldEditKeyformEasingExtraChange(a, 'a', 'back', 2.0), false,   'preflight no-active');
}

{
  // Sparse back → Blender default (1.70158) → no-op.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'back' })], 0)]);
  eq(applyEditKeyformEasingExtra(a, 'a', 'back', 1.70158).changed, false, 'editExtra sparse-back→default: no-op');
  assert(!('back' in a.fcurves[0].keyforms[0]), 'editExtra back: stays sparse');
}

{
  // Sparse back → non-default → write.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'back' })], 0)]);
  const r = applyEditKeyformEasingExtra(a, 'a', 'back', 2.5);
  eq(r.changed, true,                                                     'editExtra sparse→2.5: changed');
  eq(a.fcurves[0].keyforms[0].back, 2.5,                                  'editExtra: back=2.5');
}

{
  // Explicit back → Blender default → DELETE.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'back', back: 2.5 })], 0)]);
  const r = applyEditKeyformEasingExtra(a, 'a', 'back', 1.70158);
  eq(r.changed, true,                                                     'editExtra explicit→default: changed');
  assert(!('back' in a.fcurves[0].keyforms[0]),                           'editExtra: back deleted (sparse)');
}

{
  // Amplitude + period (ELASTIC) — Blender defaults are 0.8 / 4.1
  // (`animrig/intern/fcurve.cc:344-345`). Audit-fix HIGH-B1 (5.R
  // dual-audit 2026-05-17): the old test asserted defaults of 0/0
  // matching the pre-audit `DEFAULT_ELASTIC_AMPLITUDE/PERIOD = 0`
  // constants; those constants were corrected in the same audit-fix
  // sweep, so the sparse-equality tests now check against 0.8 / 4.1.
  const a = makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'elastic' })], 0)]);
  // Sparse → Blender-default → no-op.
  eq(applyEditKeyformEasingExtra(a, 'a', 'amplitude', 0.8).changed, false, 'editExtra amplitude sparse→0.8: no-op');
  eq(applyEditKeyformEasingExtra(a, 'a', 'period', 4.1).changed, false,    'editExtra period sparse→4.1: no-op');
  assert(!('amplitude' in a.fcurves[0].keyforms[0]), 'editExtra: amplitude stays sparse');
  assert(!('period' in a.fcurves[0].keyforms[0]),    'editExtra: period stays sparse');
  // Sparse → non-default → write.
  eq(applyEditKeyformEasingExtra(a, 'a', 'amplitude', 0.5).changed, true, 'editExtra amplitude→0.5: changed');
  eq(applyEditKeyformEasingExtra(a, 'a', 'period', 0.3).changed, true,    'editExtra period→0.3: changed');
  eq(a.fcurves[0].keyforms[0].amplitude, 0.5, 'editExtra: amplitude=0.5');
  eq(a.fcurves[0].keyforms[0].period, 0.3,    'editExtra: period=0.3');
  // Explicit → Blender-default → DELETE.
  applyEditKeyformEasingExtra(a, 'a', 'amplitude', 0.8);
  applyEditKeyformEasingExtra(a, 'a', 'period', 4.1);
  assert(!('amplitude' in a.fcurves[0].keyforms[0]), 'editExtra: amplitude deleted');
  assert(!('period' in a.fcurves[0].keyforms[0]),    'editExtra: period deleted');
}

{
  // Bad field name → guard.
  const a = makeAction([fc('a', [makeKeyform(0, 0)], 0)]);
  // @ts-expect-error — runtime guard test.
  eq(applyEditKeyformEasingExtra(a, 'a', 'bogus', 1).changed, false, 'editExtra bad field: guard');
  eq(applyEditKeyformEasingExtra(a, 'a', 'back', NaN).changed, false, 'editExtra NaN: guard');
}

// ─────────────────────────────────────────────────────────────────────
// 5.R preflight↔mutator symmetry

{
  // Each case: same input runs both preflight and mutator; results
  // must agree (drift protection — Slice 5.M HIGH-A1 lesson).

  // Handle type.
  const cases5R = [
    // [factory, args..., applyFn, preFn]
    [
      () => makeAction([fc('a', [makeKeyform(0, 0)], 0)]),
      ['left', 'auto'],
      applyEditKeyformHandleType, wouldEditKeyformHandleTypeChange,
    ],
    [
      () => makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 0)]),
      ['left', 'aligned'],
      applyEditKeyformHandleType, wouldEditKeyformHandleTypeChange,
    ],
    // Handle coord.
    [
      () => makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]),
      ['left', 'time', 100],
      applyEditKeyformHandleCoord, wouldEditKeyformHandleCoordChange,
    ],
    [
      () => makeAction([fc('a', [makeKeyform(0, 0), makeKeyform(100, 1)], 1)]),
      ['left', 'value', 0.5],
      applyEditKeyformHandleCoord, wouldEditKeyformHandleCoordChange,
    ],
    // Ease mode.
    [
      () => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine' })], 0)]),
      ['auto'],
      applyEditKeyformEaseMode, wouldEditKeyformEaseModeChange,
    ],
    [
      () => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'sine' })], 0)]),
      ['in'],
      applyEditKeyformEaseMode, wouldEditKeyformEaseModeChange,
    ],
    // Easing extras.
    [
      () => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'back' })], 0)]),
      ['back', 1.70158],
      applyEditKeyformEasingExtra, wouldEditKeyformEasingExtraChange,
    ],
    [
      () => makeAction([fc('a', [makeKeyform(0, 0, { interpolation: 'back' })], 0)]),
      ['back', 2.0],
      applyEditKeyformEasingExtra, wouldEditKeyformEasingExtraChange,
    ],
  ];

  for (let i = 0; i < cases5R.length; i++) {
    const [factory, args, applyFn, preFn] = cases5R[i];
    const aRead = factory();
    const aWrite = factory();
    const preResult = preFn(aRead, 'a', ...args);
    const mResult = applyFn(aWrite, 'a', ...args);
    eq(preResult, mResult.changed, `5.R preflight↔mutator symmetry case ${i}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
