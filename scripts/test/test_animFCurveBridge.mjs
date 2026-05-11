// Tests for the FCurve construction + helper module + project-wide
// driver pass. Post-v36 the legacy track-shape bridge is gone; what
// remains is the canonical fcurve constructor (used by the idle
// generator and motion3 import) plus the rnaPath identity helpers
// (used by paramReferences + projectStore mutations).
//
// Run: node scripts/test/test_animFCurveBridge.mjs

import {
  buildParamFCurve,
  buildNodeFCurve,
  decodeFCurveTarget,
  fcurveTargetsParam,
  fcurveTargetsNode,
  renameFCurveParam,
  renameFCurveNode,
  evaluateActionFCurves,
  normalizeKeyforms,
} from '../../src/anim/animationFCurve.js';
import {
  collectDrivers,
  evaluateProjectDrivers,
  driverOverridesToParamMap,
} from '../../src/anim/driverPass.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`);
}
function assertNear(actual, expected, eps, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

// ── buildParamFCurve: assembles canonical param-target fcurve ─────────────
{
  const fc = buildParamFCurve('ParamAngleX', [
    { time: 0, value: 0, easing: 'linear' },
    { time: 1000, value: 30, easing: 'ease-both' },
  ]);
  assertEq(fc.rnaPath, 'objects["__params__"].values["ParamAngleX"]',
    'param rnaPath canonical');
  assertEq(fc.id, 'param:ParamAngleX', 'param id naming');
  assertEq(fc.arrayIndex, 0, 'arrayIndex defaults to 0');
  assertEq(fc.modifiers, [], 'modifiers empty');
  assertEq(fc.extrapolation, 'constant', 'extrapolation defaults to constant');
  assertEq(fc.keyforms.length, 2, 'keyforms preserved');
  assertEq(fc.keyforms[0].easing, 'linear', 'kf0 easing preserved');
  assertEq(fc.keyforms[0].type, 'linear', 'kf0 type derived from easing');
  assertEq(fc.keyforms[1].type, 'linear', 'ease-both → linear (not constant)');
}

// ── buildNodeFCurve: assembles canonical node-target fcurve ───────────────
{
  const fc = buildNodeFCurve('partA', 'rotation', [
    { time: 0, value: 0 },
    { time: 500, value: 1.5, easing: 'hold' },
  ]);
  assertEq(fc.rnaPath, 'objects["partA"].rotation', 'node rnaPath canonical');
  assertEq(fc.id, 'partA.rotation', 'node id naming');
  assertEq(fc.keyforms[1].type, 'constant', 'hold easing → type constant');
}

// ── builders return null for unaddressable / empty input ──────────────────
{
  assert(buildParamFCurve(null, [{ time: 0, value: 0 }]) === null, 'null paramId → null');
  assert(buildParamFCurve('', [{ time: 0, value: 0 }]) === null, 'empty paramId → null');
  assert(buildParamFCurve('P', []) === null, 'empty keyforms → null');
  assert(buildParamFCurve('P', null) === null, 'null keyforms → null');
  assert(buildNodeFCurve('A', null, [{ time: 0, value: 0 }]) === null, 'null property → null');
  assert(buildNodeFCurve('A', '', [{ time: 0, value: 0 }]) === null, 'empty property → null');
}

// ── normalizeKeyforms: filters malformed entries; defaults easing ─────────
{
  const kfs = normalizeKeyforms([
    { time: 0, value: 1 },                   // missing easing → default linear
    { time: 'bad', value: 2 },               // bad time → drop
    { time: 100, value: 'bad' },             // bad value → drop
    { time: 200, value: 3, easing: 'hold' }, // hold → type constant
  ]);
  assertEq(kfs.length, 2, 'malformed entries dropped');
  assertEq(kfs[0].easing, 'linear', 'missing easing defaults to linear');
  assertEq(kfs[1].easing, 'hold', 'hold easing preserved');
  assertEq(kfs[1].type, 'constant', 'hold → constant');
}

// ── decodeFCurveTarget: recognises both target shapes ─────────────────────
{
  const paramFc = buildParamFCurve('PA', [{ time: 0, value: 1 }]);
  const t1 = decodeFCurveTarget(paramFc);
  assertEq(t1, { kind: 'param', paramId: 'PA' }, 'param decode');
  const nodeFc = buildNodeFCurve('partB', 'opacity', [{ time: 0, value: 1 }]);
  const t2 = decodeFCurveTarget(nodeFc);
  assertEq(t2, { kind: 'node', nodeId: 'partB', property: 'opacity' }, 'node decode');
  assert(decodeFCurveTarget(null) === null, 'null fc → null');
  assert(decodeFCurveTarget({ rnaPath: 'malformed' }) === null, 'malformed rnaPath → null');
}

// ── fcurveTargetsParam / fcurveTargetsNode predicates ─────────────────────
{
  const fc = buildParamFCurve('ParamA', [{ time: 0, value: 1 }]);
  assert(fcurveTargetsParam(fc, 'ParamA') === true, 'positive param match');
  assert(fcurveTargetsParam(fc, 'ParamB') === false, 'negative param mismatch');
  assert(fcurveTargetsNode(fc, 'ParamA') === false, 'param fcurve is NOT node target');
  const nodeFc = buildNodeFCurve('p1', 'x', [{ time: 0, value: 0 }]);
  assert(fcurveTargetsNode(nodeFc, 'p1') === true, 'positive node match');
  assert(fcurveTargetsNode(nodeFc, 'p2') === false, 'negative node mismatch');
}

// ── renameFCurveParam: rewrites rnaPath + id ──────────────────────────────
{
  const fc = buildParamFCurve('Old', [{ time: 0, value: 1 }]);
  renameFCurveParam(fc, 'Old', 'New');
  assertEq(fc.rnaPath, 'objects["__params__"].values["New"]', 'param rnaPath rewritten');
  assertEq(fc.id, 'param:New', 'param id rewritten');
  // No-op when target doesn't match
  const fc2 = buildParamFCurve('OtherParam', [{ time: 0, value: 1 }]);
  renameFCurveParam(fc2, 'NotMatching', 'NewName');
  assertEq(fc2.rnaPath, 'objects["__params__"].values["OtherParam"]', 'no-op when not matching');
}

// ── renameFCurveNode: rewrites rnaPath + id, preserves property ───────────
{
  const fc = buildNodeFCurve('oldId', 'opacity', [{ time: 0, value: 1 }]);
  renameFCurveNode(fc, 'oldId', 'newId');
  assertEq(fc.rnaPath, 'objects["newId"].opacity', 'node rnaPath rewritten');
  assertEq(fc.id, 'newId.opacity', 'node id rewritten');
  // Property suffix preserved
  const fc2 = buildNodeFCurve('a', 'transform.rotation', [{ time: 0, value: 0 }]);
  renameFCurveNode(fc2, 'a', 'b');
  assertEq(fc2.rnaPath, 'objects["b"].transform.rotation', 'compound property preserved');
}

// ── evaluateActionFCurves: produces rnaPath → value map ───────────────────
{
  const action = {
    fcurves: [
      buildParamFCurve('P1', [{ time: 0, value: 0 }, { time: 1000, value: 10 }]),
      buildParamFCurve('P2', [{ time: 0, value: 5, easing: 'hold' }, { time: 1000, value: 20 }]),
      buildNodeFCurve('partA', 'x', [{ time: 0, value: 0 }, { time: 1000, value: 100 }]),
    ],
  };
  const out = evaluateActionFCurves(action, 500);
  assertNear(out.get('objects["__params__"].values["P1"]'), 5, 1e-9, 'P1 lerps to 5');
  assertNear(out.get('objects["__params__"].values["P2"]'), 5, 1e-9, 'P2 holds first');
  assertNear(out.get('objects["partA"].x'), 50, 1e-9, 'partA.x lerps to 50');
}

// ── evaluateActionFCurves: empty / null inputs → empty map ────────────────
{
  assertEq(evaluateActionFCurves(null, 0).size, 0, 'null action → empty map');
  assertEq(evaluateActionFCurves({ fcurves: [] }, 0).size, 0, 'empty fcurves → empty map');
  assertEq(evaluateActionFCurves({}, 0).size, 0, 'no fcurves field → empty map');
}

// ── collectDrivers: param + transform driver discovery ────────────────────
{
  const project = {
    parameters: [
      { id: 'PA', driver: { type: 'sum', variables: [] } },
      { id: 'PB' },
    ],
    nodes: [
      { id: 'partA', type: 'part', transformDrivers: {
        rotation: { type: 'sum', variables: [] },
        x: { type: 'avg', variables: [] },
      }},
      { id: 'partB', type: 'part' },
    ],
  };
  const drivers = collectDrivers(project);
  assertEq(drivers.length, 3, 'collectDrivers: 3 records');
  const paths = drivers.map((d) => d.rnaPath).sort();
  assertEq(paths, [
    'objects["__params__"].values["PA"]',
    'objects["partA"].transform.rotation',
    'objects["partA"].transform.x',
  ], 'collectDrivers: rnaPaths assembled correctly');
}

// ── evaluateProjectDrivers: sum type with no variables ────────────────────
{
  const project = {
    parameters: [{ id: 'PA', driver: { type: 'sum', variables: [] } }],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get('objects["__params__"].values["PA"]'), 0, 1e-9, 'sum no-vars → 0');
}

// ── evaluateProjectDrivers: scripted driver returning constant ────────────
{
  const project = {
    parameters: [{ id: 'PB', driver: { type: 'scripted', expression: '7 + 3', variables: [] } }],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get('objects["__params__"].values["PB"]'), 10, 1e-9, 'scripted constant → 10');
}

// ── evaluateProjectDrivers: scripted with variable resolves through rnaPath
{
  const project = {
    parameters: [
      { id: 'P_INPUT', default: 5 },
      {
        id: 'P_OUTPUT',
        driver: {
          type: 'scripted',
          expression: 'a * 2',
          variables: [
            { name: 'a', target: { rnaPath: 'objects["__params__"].values["P_INPUT"]' } },
          ],
        },
      },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get('objects["__params__"].values["P_OUTPUT"]'), 10, 1e-9,
    'scripted: var resolved + multiplied');
}

// ── evaluateProjectDrivers: bad scripted expression doesn't crash pass ────
{
  const project = {
    parameters: [
      { id: 'PA', driver: { type: 'scripted', expression: 'eval("evil")', variables: [] } },
      { id: 'PB', driver: { type: 'scripted', expression: '5 + 5', variables: [] } },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assert(!out.has('objects["__params__"].values["PA"]'), 'bad driver swallowed');
  assertNear(out.get('objects["__params__"].values["PB"]'), 10, 1e-9, 'good driver still resolves');
}

// ── driverOverridesToParamMap projection ──────────────────────────────────
{
  const ov = new Map([
    ['objects["__params__"].values["ParamA"]', 1.5],
    ['objects["__params__"].values["ParamB"]', -2.0],
    ['objects["partA"].transform.rotation', 0.7],
  ]);
  const paramMap = driverOverridesToParamMap(ov);
  assertEq(paramMap, { ParamA: 1.5, ParamB: -2.0 }, 'projection extracts params only');
}

console.log(`animFCurveBridge: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
