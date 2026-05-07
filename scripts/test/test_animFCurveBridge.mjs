// Tests for the Phase 5 wire-in bridge (animation tracks → FCurves and
// project-wide driver pass).
//
// Run: node scripts/test/test_animFCurveBridge.mjs

import {
  trackToFCurve,
  tracksToFCurves,
  evaluateAnimationFCurves,
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

// ── trackToFCurve: param track → objects[__params__] rnaPath ──
{
  const track = {
    paramId: 'ParamAngleX',
    keyframes: [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1000, value: 30, easing: 'ease-both' },
    ],
  };
  const fc = trackToFCurve(track);
  assertEq(fc.rnaPath, "objects['__params__'].values['ParamAngleX']",
    'param track rnaPath uses canonical objects[__params__].values shape');
  assertEq(fc.id, 'param:ParamAngleX', 'param track id');
  assertEq(fc.keyforms.length, 2, 'param track keyforms preserved');
  assertEq(fc.keyforms[0].type, 'linear', 'easing linear → linear');
}

// ── trackToFCurve: node track → objects[id].field rnaPath ──
{
  const track = {
    nodeId: 'partA',
    property: 'rotation',
    keyframes: [
      { time: 0, value: 0 },
      { time: 500, value: 1.5, easing: 'hold' },
    ],
  };
  const fc = trackToFCurve(track);
  assertEq(fc.rnaPath, "objects['partA'].rotation", 'node track rnaPath');
  assertEq(fc.id, 'partA.rotation', 'node track id');
  assertEq(fc.keyforms[1].type, 'constant', 'hold easing → constant');
}

// ── trackToFCurve: empty / malformed inputs ──
{
  assert(trackToFCurve(null) === null, 'null track → null');
  assert(trackToFCurve({}) === null, 'empty track → null');
  assert(trackToFCurve({ paramId: 'P', keyframes: [] }) === null,
    'param track no keyframes → null');
  assert(trackToFCurve({ nodeId: 'A', keyframes: [{ time: 0, value: 1 }] }) === null,
    'node track no property → null');
}

// ── trackToFCurve: invalid keyframe records dropped silently ──
{
  const track = {
    paramId: 'P',
    keyframes: [
      { time: 0, value: 1 },
      { time: 'bad', value: 2 },
      { time: 100, value: 'bad' },
      { time: 200, value: 3 },
    ],
  };
  const fc = trackToFCurve(track);
  assertEq(fc.keyforms.length, 2, 'malformed keyframes filtered out');
  assertEq(fc.keyforms[1].time, 200, 'remaining keyforms preserve order');
}

// ── tracksToFCurves: skips bad tracks ──
{
  const animation = {
    tracks: [
      { paramId: 'A', keyframes: [{ time: 0, value: 1 }] },
      null,
      {},
      { nodeId: 'p', property: 'x', keyframes: [{ time: 0, value: 5 }] },
    ],
  };
  const fcs = tracksToFCurves(animation);
  assertEq(fcs.length, 2, 'tracksToFCurves filters bad tracks');
  assertEq(fcs[0].id, 'param:A', 'first surviving FCurve');
  assertEq(fcs[1].id, 'p.x', 'second surviving FCurve');
}

// ── evaluateAnimationFCurves: produces rnaPath → value map ──
{
  const animation = {
    tracks: [
      { paramId: 'P1', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 10 }] },
      { paramId: 'P2', keyframes: [{ time: 0, value: 5, easing: 'hold' }, { time: 1000, value: 20 }] },
      { nodeId: 'partA', property: 'x',
        keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] },
    ],
  };
  const out = evaluateAnimationFCurves(animation, 500);
  assertNear(out.get("objects['__params__'].values['P1']"), 5, 1e-9,
    'P1 lerps to 5 at 500ms');
  assertNear(out.get("objects['__params__'].values['P2']"), 5, 1e-9,
    'P2 holds first value (hold easing)');
  assertNear(out.get("objects['partA'].x"), 50, 1e-9, 'partA.x lerps to 50');
}

// ── evaluateAnimationFCurves: empty animation → empty map ──
{
  const out1 = evaluateAnimationFCurves(null, 0);
  assertEq(out1.size, 0, 'null animation → empty map');
  const out2 = evaluateAnimationFCurves({ tracks: [] }, 0);
  assertEq(out2.size, 0, 'empty tracks → empty map');
}

// ── collectDrivers: param + transform driver discovery ──
{
  const project = {
    parameters: [
      { id: 'PA', driver: { type: 'sum', variables: [] } },
      { id: 'PB' }, // no driver
    ],
    nodes: [
      { id: 'partA', type: 'part', transformDrivers: {
        rotation: { type: 'sum', variables: [] },
        x: { type: 'avg', variables: [] },
      }},
      { id: 'partB', type: 'part' }, // no transformDrivers
    ],
  };
  const drivers = collectDrivers(project);
  assertEq(drivers.length, 3, 'collectDrivers: 3 records (1 param + 2 transform)');
  const paths = drivers.map((d) => d.rnaPath).sort();
  assertEq(paths, [
    "objects['__params__'].values['PA']",
    "objects['partA'].transform.rotation",
    "objects['partA'].transform.x",
  ], 'collectDrivers: rnaPaths assembled correctly');
}

// ── evaluateProjectDrivers: sum type with constant variables ──
{
  // Driver with a 'sum' aggregator over two static expressions —
  // since `evaluateDriver`'s sum walks variables[].targets[].rnaPath
  // through evaluateRnaPath, we just verify a no-variables driver
  // returns 0 (Blender's behaviour).
  const project = {
    parameters: [
      { id: 'PA', driver: { type: 'sum', variables: [] } },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get("objects['__params__'].values['PA']"), 0, 1e-9, 'sum no-vars → 0');
}

// ── evaluateProjectDrivers: scripted driver returning constant ──
{
  const project = {
    parameters: [
      { id: 'PB', driver: { type: 'scripted', expression: '7 + 3', variables: [] } },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get("objects['__params__'].values['PB']"), 10, 1e-9, 'scripted constant → 10');
}

// ── evaluateProjectDrivers: scripted with variable resolves through rnaPath ──
{
  // The rnaPath resolver routes `objects['__params__'].values['<id>']`
  // through `_paramsView`, which reads `parameters[i].default`. So the
  // variable's `rnaPath` reads the param's default; setting
  // `default: 5` makes the resolved value 5.
  const project = {
    parameters: [
      { id: 'P_INPUT', default: 5 },
      {
        id: 'P_OUTPUT',
        driver: {
          type: 'scripted',
          expression: 'a * 2',
          variables: [
            { name: 'a', target: { rnaPath: "objects['__params__'].values['P_INPUT']" } },
          ],
        },
      },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assertNear(out.get("objects['__params__'].values['P_OUTPUT']"), 10, 1e-9,
    'scripted: var resolved + multiplied');
}

// ── evaluateProjectDrivers: bad scripted expression doesn't crash pass ──
{
  const project = {
    parameters: [
      { id: 'PA', driver: { type: 'scripted', expression: 'eval("evil")', variables: [] } },
      { id: 'PB', driver: { type: 'scripted', expression: '5 + 5', variables: [] } },
    ],
    nodes: [],
  };
  const out = evaluateProjectDrivers(project);
  assert(!out.has("objects['__params__'].values['PA']"),
    'bad driver swallowed (no entry in map)');
  assertNear(out.get("objects['__params__'].values['PB']"), 10, 1e-9,
    'good driver still resolves');
}

// ── driverOverridesToParamMap projection ──
{
  const ov = new Map([
    ["objects['__params__'].values['ParamA']", 1.5],
    ["objects['__params__'].values['ParamB']", -2.0],
    ["objects['partA'].transform.rotation", 0.7],
  ]);
  const paramMap = driverOverridesToParamMap(ov);
  assertEq(paramMap, { ParamA: 1.5, ParamB: -2.0 }, 'projection extracts params only');
}

console.log(`animFCurveBridge: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
