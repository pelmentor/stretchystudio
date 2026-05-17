// Animation Phase 5 Slice 5.S — tests for
// src/v3/editors/fcurve/driverEditorData.js (Driver editor data layer).
//
// Coverage:
//   - resolveDriverEditorContext: null guards, missing-fcurve, no-driver,
//     resolved context shape with `variables: []` fallback
//   - applyEditDriverType + wouldEditDriverTypeChange:
//     no-driver no-op, unknown-token no-op, same-type no-op, write, expression-preserved
//   - applyEditDriverExpression + wouldEditDriverExpressionChange:
//     no-driver, sparse-fallback compare, write, sparse-default '' deletes
//   - nextVariableName: 'var' → 'var_001' → 'var_002' uniquification
//   - applyAddDriverVariable + wouldAddDriverVariableChange:
//     push to variables[], default shape, sparse-init when variables missing
//   - applyRemoveDriverVariable + wouldRemoveDriverVariableChange:
//     out-of-bounds, splice
//   - applyEditDriverVariableName / RnaPath + preflights:
//     index guards, same-value no-op, write, sparse target.rnaPath fallback
//   - Preflight↔mutator symmetry loop
//   - DRIVER_TYPES enum shape (5 entries, Blender labels verbatim)
//
// Run: node scripts/test/test_driverEditorData.mjs

import {
  DRIVER_TYPES,
  resolveDriverEditorContext,
  wouldEditDriverTypeChange,
  applyEditDriverType,
  wouldEditDriverExpressionChange,
  applyEditDriverExpression,
  nextVariableName,
  wouldAddDriverVariableChange,
  applyAddDriverVariable,
  wouldRemoveDriverVariableChange,
  applyRemoveDriverVariable,
  wouldEditDriverVariableNameChange,
  applyEditDriverVariableName,
  wouldEditDriverVariableRnaPathChange,
  applyEditDriverVariableRnaPath,
} from '../../src/v3/editors/fcurve/driverEditorData.js';

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

function deepEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function makeAction(driverShape = null, fcurveId = 'fc1') {
  const fcurve = { id: fcurveId, keyforms: [] };
  if (driverShape) fcurve.driver = driverShape;
  return { id: 'act1', fcurves: [fcurve] };
}

// ── DRIVER_TYPES enum shape ──────────────────────────────────────────
{
  eq(DRIVER_TYPES.length, 5, 'DRIVER_TYPES: 5 entries');
  const labels = DRIVER_TYPES.map((d) => d.label);
  const tokens = DRIVER_TYPES.map((d) => d.token);
  // Verbatim from rna_fcurve.cc:2221-2227 — order: AVERAGE, SUM, SCRIPTED, MIN, MAX
  deepEq(labels, ['Averaged Value', 'Sum Values', 'Scripted Expression', 'Minimum Value', 'Maximum Value'], 'DRIVER_TYPES: Blender label order verbatim');
  deepEq(tokens, ['avg', 'sum', 'scripted', 'min', 'max'], 'DRIVER_TYPES: SS token order matches Blender enum order');
}

// ── resolveDriverEditorContext ──────────────────────────────────────
{
  eq(resolveDriverEditorContext(null, 'fc1'), null, 'resolve: null action → null');
  eq(resolveDriverEditorContext({}, null), null, 'resolve: null fcurveId → null');
  eq(resolveDriverEditorContext({ fcurves: 'not-array' }, 'fc1'), null, 'resolve: non-array fcurves → null');
  eq(resolveDriverEditorContext({ fcurves: [] }, 'fc1'), null, 'resolve: empty fcurves → null');
  eq(resolveDriverEditorContext(makeAction(null), 'fc1'), null, 'resolve: no driver → null');

  const action = makeAction({ type: 'sum' });
  const ctx = resolveDriverEditorContext(action, 'fc1');
  assert(ctx !== null, 'resolve: found context');
  eq(ctx.driver.type, 'sum', 'resolve: driver.type accessible');
  deepEq(ctx.variables, [], 'resolve: variables defaults to []');

  const action2 = makeAction({ type: 'scripted', expression: 'var * 2', variables: [{ name: 'var', type: 'singleProp', target: { id: '', rnaPath: 'x' } }] });
  const ctx2 = resolveDriverEditorContext(action2, 'fc1');
  eq(ctx2.variables.length, 1, 'resolve: variables array surfaced');
  eq(ctx2.driver.expression, 'var * 2', 'resolve: expression surfaced');
}

// ── applyEditDriverType + preflight ──────────────────────────────────
{
  // unknown type → no change
  eq(wouldEditDriverTypeChange(makeAction({ type: 'sum' }), 'fc1', 'garbage'), false, 'wouldEditType: unknown → false');
  eq(applyEditDriverType(makeAction({ type: 'sum' }), 'fc1', 'garbage').changed, false, 'applyEditType: unknown → no-op');

  // no driver
  eq(wouldEditDriverTypeChange(makeAction(null), 'fc1', 'sum'), false, 'wouldEditType: no driver → false');
  eq(applyEditDriverType(makeAction(null), 'fc1', 'sum').changed, false, 'applyEditType: no driver → no-op');

  // same value
  eq(wouldEditDriverTypeChange(makeAction({ type: 'sum' }), 'fc1', 'sum'), false, 'wouldEditType: same → false');
  eq(applyEditDriverType(makeAction({ type: 'sum' }), 'fc1', 'sum').changed, false, 'applyEditType: same → no-op');

  // write
  eq(wouldEditDriverTypeChange(makeAction({ type: 'sum' }), 'fc1', 'max'), true, 'wouldEditType: differ → true');
  const action = makeAction({ type: 'sum' });
  eq(applyEditDriverType(action, 'fc1', 'max').changed, true, 'applyEditType: differ → changed');
  eq(action.fcurves[0].driver.type, 'max', 'applyEditType: wrote new type');

  // expression preserved across type change (Blender parity)
  const action2 = makeAction({ type: 'scripted', expression: 'var + 1' });
  applyEditDriverType(action2, 'fc1', 'sum');
  eq(action2.fcurves[0].driver.expression, 'var + 1', 'applyEditType: expression preserved across type switch');

  // all 5 types are valid tokens
  for (const { token } of DRIVER_TYPES) {
    const a = makeAction({ type: 'avg' });
    if (token !== 'avg') {
      eq(applyEditDriverType(a, 'fc1', token).changed, true, `applyEditType: ${token} accepted`);
    }
  }
}

// ── applyEditDriverExpression + preflight ────────────────────────────
{
  // no driver
  eq(wouldEditDriverExpressionChange(makeAction(null), 'fc1', 'x'), false, 'wouldEditExpr: no driver → false');
  eq(applyEditDriverExpression(makeAction(null), 'fc1', 'x').changed, false, 'applyEditExpr: no driver → no-op');

  // non-string
  eq(wouldEditDriverExpressionChange(makeAction({ type: 'scripted' }), 'fc1', 42), false, 'wouldEditExpr: non-string → false');
  eq(applyEditDriverExpression(makeAction({ type: 'scripted' }), 'fc1', 42).changed, false, 'applyEditExpr: non-string → no-op');

  // sparse fallback compare (missing field = '')
  eq(wouldEditDriverExpressionChange(makeAction({ type: 'scripted' }), 'fc1', ''), false, 'wouldEditExpr: missing→empty same → false');
  eq(applyEditDriverExpression(makeAction({ type: 'scripted' }), 'fc1', '').changed, false, 'applyEditExpr: missing→empty same → no-op');

  // sparse → write
  const action = makeAction({ type: 'scripted' });
  eq(wouldEditDriverExpressionChange(action, 'fc1', 'var * 2'), true, 'wouldEditExpr: sparse → typed → true');
  eq(applyEditDriverExpression(action, 'fc1', 'var * 2').changed, true, 'applyEditExpr: sparse → typed → changed');
  eq(action.fcurves[0].driver.expression, 'var * 2', 'applyEditExpr: wrote expression');

  // explicit → DELETE on sparse default
  const action2 = makeAction({ type: 'scripted', expression: 'x' });
  eq(applyEditDriverExpression(action2, 'fc1', '').changed, true, 'applyEditExpr: explicit → empty → changed (delete)');
  eq('expression' in action2.fcurves[0].driver, false, 'applyEditExpr: empty deletes field (sparse discipline)');

  // explicit → explicit (write, no delete)
  const action3 = makeAction({ type: 'scripted', expression: 'x' });
  applyEditDriverExpression(action3, 'fc1', 'y');
  eq(action3.fcurves[0].driver.expression, 'y', 'applyEditExpr: explicit→explicit writes');
}

// ── nextVariableName ────────────────────────────────────────────────
{
  eq(nextVariableName([]), 'var', 'nextVarName: empty → var');
  eq(nextVariableName([{ name: 'var' }]), 'var_001', 'nextVarName: var taken → var_001');
  eq(nextVariableName([{ name: 'var' }, { name: 'var_001' }]), 'var_002', 'nextVarName: var,var_001 → var_002');
  eq(nextVariableName([{ name: 'var_005' }]), 'var', 'nextVarName: gap → first available');
  eq(nextVariableName([{ name: 'foo' }]), 'var', 'nextVarName: unrelated name → var');
  // Skips entries with no/invalid name
  eq(nextVariableName([{ name: 'var' }, {}, { name: null }, { name: 'var_001' }]), 'var_002', 'nextVarName: skips invalid');
}

// ── applyAddDriverVariable + preflight ──────────────────────────────
{
  eq(wouldAddDriverVariableChange(makeAction(null), 'fc1'), false, 'wouldAddVar: no driver → false');
  eq(wouldAddDriverVariableChange(makeAction({ type: 'sum' }), 'fc1'), true, 'wouldAddVar: driver present → true');

  // sparse init (no variables field)
  const action = makeAction({ type: 'sum' });
  const r = applyAddDriverVariable(action, 'fc1');
  eq(r.changed, true, 'applyAddVar: changed');
  eq(r.index, 0, 'applyAddVar: index 0');
  eq(r.name, 'var', 'applyAddVar: default name var');
  eq(action.fcurves[0].driver.variables.length, 1, 'applyAddVar: variables array initialized');
  const v0 = action.fcurves[0].driver.variables[0];
  eq(v0.name, 'var', 'applyAddVar: variable.name');
  eq(v0.type, 'singleProp', 'applyAddVar: variable.type defaults to singleProp');
  deepEq(v0.target, { id: '', rnaPath: '' }, 'applyAddVar: variable.target shape');

  // second add → var_001
  const r2 = applyAddDriverVariable(action, 'fc1');
  eq(r2.name, 'var_001', 'applyAddVar: second add unique');
  eq(action.fcurves[0].driver.variables.length, 2, 'applyAddVar: length=2');

  // third add → var_002
  const r3 = applyAddDriverVariable(action, 'fc1');
  eq(r3.name, 'var_002', 'applyAddVar: third add unique');
}

// ── applyRemoveDriverVariable + preflight ───────────────────────────
{
  const mk = () => makeAction({
    type: 'scripted',
    variables: [
      { name: 'a', type: 'singleProp', target: { id: '', rnaPath: 'x' } },
      { name: 'b', type: 'singleProp', target: { id: '', rnaPath: 'y' } },
    ],
  });

  eq(wouldRemoveDriverVariableChange(mk(), 'fc1', -1), false, 'wouldRemoveVar: negative → false');
  eq(wouldRemoveDriverVariableChange(mk(), 'fc1', 5), false, 'wouldRemoveVar: out-of-bounds → false');
  eq(wouldRemoveDriverVariableChange(mk(), 'fc1', 0.5), false, 'wouldRemoveVar: non-integer → false');
  eq(wouldRemoveDriverVariableChange(makeAction(null), 'fc1', 0), false, 'wouldRemoveVar: no driver → false');
  eq(wouldRemoveDriverVariableChange(mk(), 'fc1', 0), true, 'wouldRemoveVar: valid idx → true');

  eq(applyRemoveDriverVariable(mk(), 'fc1', -1).changed, false, 'applyRemoveVar: negative → no-op');
  eq(applyRemoveDriverVariable(mk(), 'fc1', 5).changed, false, 'applyRemoveVar: oob → no-op');

  const action = mk();
  eq(applyRemoveDriverVariable(action, 'fc1', 0).changed, true, 'applyRemoveVar: changed');
  eq(action.fcurves[0].driver.variables.length, 1, 'applyRemoveVar: length=1 after splice');
  eq(action.fcurves[0].driver.variables[0].name, 'b', 'applyRemoveVar: kept the right one');
}

// ── applyEditDriverVariableName + preflight ─────────────────────────
{
  const mk = () => makeAction({
    type: 'scripted',
    variables: [
      { name: 'a', type: 'singleProp', target: { id: '', rnaPath: '' } },
    ],
  });

  eq(wouldEditDriverVariableNameChange(mk(), 'fc1', 0, 'a'), false, 'wouldEditVarName: same → false');
  eq(wouldEditDriverVariableNameChange(mk(), 'fc1', 0, 'b'), true, 'wouldEditVarName: differ → true');
  eq(wouldEditDriverVariableNameChange(mk(), 'fc1', -1, 'b'), false, 'wouldEditVarName: negative idx → false');
  eq(wouldEditDriverVariableNameChange(mk(), 'fc1', 5, 'b'), false, 'wouldEditVarName: oob → false');
  eq(wouldEditDriverVariableNameChange(makeAction(null), 'fc1', 0, 'b'), false, 'wouldEditVarName: no driver → false');
  eq(wouldEditDriverVariableNameChange(mk(), 'fc1', 0, 42), false, 'wouldEditVarName: non-string → false');

  const action = mk();
  eq(applyEditDriverVariableName(action, 'fc1', 0, 'b').changed, true, 'applyEditVarName: write');
  eq(action.fcurves[0].driver.variables[0].name, 'b', 'applyEditVarName: name updated');

  // same-value no-op
  const action2 = mk();
  eq(applyEditDriverVariableName(action2, 'fc1', 0, 'a').changed, false, 'applyEditVarName: same → no-op');
}

// ── applyEditDriverVariableRnaPath + preflight ──────────────────────
{
  const mk = () => makeAction({
    type: 'scripted',
    variables: [
      { name: 'a', type: 'singleProp', target: { id: '', rnaPath: 'old' } },
    ],
  });

  eq(wouldEditDriverVariableRnaPathChange(mk(), 'fc1', 0, 'old'), false, 'wouldEditVarRna: same → false');
  eq(wouldEditDriverVariableRnaPathChange(mk(), 'fc1', 0, 'new'), true, 'wouldEditVarRna: differ → true');
  eq(wouldEditDriverVariableRnaPathChange(mk(), 'fc1', 5, 'x'), false, 'wouldEditVarRna: oob → false');
  eq(wouldEditDriverVariableRnaPathChange(mk(), 'fc1', -1, 'x'), false, 'wouldEditVarRna: negative idx → false');
  eq(wouldEditDriverVariableRnaPathChange(makeAction(null), 'fc1', 0, 'x'), false, 'wouldEditVarRna: no driver → false');
  // Audit-fix MED-A3 (Slice 5.S dual-audit 2026-05-17): non-string
  // guard parallel to wouldEditDriverVariableNameChange's coverage.
  eq(wouldEditDriverVariableRnaPathChange(mk(), 'fc1', 0, 42), false, 'wouldEditVarRna: non-string → false');
  eq(applyEditDriverVariableRnaPath(mk(), 'fc1', 0, 42).changed, false, 'applyEditVarRna: non-string → no-op');

  // missing target (sparse) → fallback compare against ''
  const sparseAction = makeAction({
    type: 'scripted',
    variables: [{ name: 'a', type: 'singleProp' }],
  });
  eq(wouldEditDriverVariableRnaPathChange(sparseAction, 'fc1', 0, ''), false, 'wouldEditVarRna: missing target → empty same → false');
  eq(wouldEditDriverVariableRnaPathChange(sparseAction, 'fc1', 0, 'x'), true, 'wouldEditVarRna: missing target → typed → true');

  // sparse → initializes target then writes
  eq(applyEditDriverVariableRnaPath(sparseAction, 'fc1', 0, 'y').changed, true, 'applyEditVarRna: sparse → write');
  deepEq(sparseAction.fcurves[0].driver.variables[0].target, { id: '', rnaPath: 'y' }, 'applyEditVarRna: target initialized');

  // explicit → write
  const action = mk();
  eq(applyEditDriverVariableRnaPath(action, 'fc1', 0, 'new').changed, true, 'applyEditVarRna: explicit → write');
  eq(action.fcurves[0].driver.variables[0].target.rnaPath, 'new', 'applyEditVarRna: rnaPath updated');
}

// ── HIGH-A1 regression — sparse driver (no variables field) mutators
// must not crash even when called without preflight (bounds check
// uses the normalized `ctx.variables.length`, not raw `driver.variables`).
{
  // Sparse driver — `variables` field missing entirely.
  const mkSparse = () => makeAction({ type: 'sum' }); // no variables field

  // All three mutators that read variable bounds must no-op cleanly.
  eq(applyRemoveDriverVariable(mkSparse(), 'fc1', 0).changed, false, 'HIGH-A1: removeVar sparse-driver no-op');
  eq(applyRemoveDriverVariable(mkSparse(), 'fc1', 5).changed, false, 'HIGH-A1: removeVar sparse-driver oob');
  eq(applyEditDriverVariableName(mkSparse(), 'fc1', 0, 'x').changed, false, 'HIGH-A1: editVarName sparse-driver no-op');
  eq(applyEditDriverVariableRnaPath(mkSparse(), 'fc1', 0, 'x').changed, false, 'HIGH-A1: editVarRna sparse-driver no-op');

  // Verify no crash by checking the action shape is still pristine.
  const a = mkSparse();
  applyEditDriverVariableName(a, 'fc1', 0, 'x');
  eq(a.fcurves[0].driver.type, 'sum', 'HIGH-A1: sparse driver untouched after no-op');
  assert(!('variables' in a.fcurves[0].driver), 'HIGH-A1: sparse driver.variables still missing after no-op');
}

// ── Preflight↔mutator symmetry loop ─────────────────────────────────
// For each pair (would*, apply*): whenever would* returns true, apply* must
// return { changed: true }; whenever would* returns false, apply* must
// return { changed: false }. Mirrors Slice 5.M HIGH-A1 lesson.
{
  const cases = [
    // (label, action-factory, mutator, preflight, args)
    { name: 'editType same', mk: () => makeAction({ type: 'sum' }), args: ['fc1', 'sum'],
      pf: wouldEditDriverTypeChange, mu: applyEditDriverType },
    { name: 'editType diff', mk: () => makeAction({ type: 'sum' }), args: ['fc1', 'max'],
      pf: wouldEditDriverTypeChange, mu: applyEditDriverType },
    { name: 'editExpr sparse same', mk: () => makeAction({ type: 'scripted' }), args: ['fc1', ''],
      pf: wouldEditDriverExpressionChange, mu: applyEditDriverExpression },
    { name: 'editExpr sparse diff', mk: () => makeAction({ type: 'scripted' }), args: ['fc1', 'x'],
      pf: wouldEditDriverExpressionChange, mu: applyEditDriverExpression },
    { name: 'editExpr explicit delete', mk: () => makeAction({ type: 'scripted', expression: 'x' }), args: ['fc1', ''],
      pf: wouldEditDriverExpressionChange, mu: applyEditDriverExpression },
    { name: 'editVarName same', mk: () => makeAction({ type: 'scripted', variables: [{ name: 'a', type: 'singleProp', target: { id: '', rnaPath: '' } }] }), args: ['fc1', 0, 'a'],
      pf: wouldEditDriverVariableNameChange, mu: applyEditDriverVariableName },
    { name: 'editVarName diff', mk: () => makeAction({ type: 'scripted', variables: [{ name: 'a', type: 'singleProp', target: { id: '', rnaPath: '' } }] }), args: ['fc1', 0, 'b'],
      pf: wouldEditDriverVariableNameChange, mu: applyEditDriverVariableName },
    { name: 'editVarRna same', mk: () => makeAction({ type: 'scripted', variables: [{ name: 'a', type: 'singleProp', target: { id: '', rnaPath: 'x' } }] }), args: ['fc1', 0, 'x'],
      pf: wouldEditDriverVariableRnaPathChange, mu: applyEditDriverVariableRnaPath },
    { name: 'editVarRna diff', mk: () => makeAction({ type: 'scripted', variables: [{ name: 'a', type: 'singleProp', target: { id: '', rnaPath: 'x' } }] }), args: ['fc1', 0, 'y'],
      pf: wouldEditDriverVariableRnaPathChange, mu: applyEditDriverVariableRnaPath },
    { name: 'removeVar oob', mk: () => makeAction({ type: 'scripted', variables: [] }), args: ['fc1', 5],
      pf: wouldRemoveDriverVariableChange, mu: applyRemoveDriverVariable },
    { name: 'removeVar valid', mk: () => makeAction({ type: 'scripted', variables: [{ name: 'a', type: 'singleProp', target: { id: '', rnaPath: '' } }] }), args: ['fc1', 0],
      pf: wouldRemoveDriverVariableChange, mu: applyRemoveDriverVariable },
  ];

  for (const c of cases) {
    const a1 = c.mk();
    const wouldChange = c.pf(a1, ...c.args);
    const a2 = c.mk();
    const result = c.mu(a2, ...c.args);
    eq(result.changed, wouldChange, `symmetry: ${c.name} (preflight=${wouldChange} ↔ mutator.changed)`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\nDriver editor data tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
