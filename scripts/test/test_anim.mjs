// Tests for src/anim/ — Phase 5 scaffold primitives.
//   - rnaPath.parseRnaPath / evaluateRnaPath / setRnaPath
//   - fcurve.evaluateFCurve / upsertKeyframe
//   - driver.evaluateDriver (sum / min / max / avg / scripted)
//
// The anim primitives aren't yet wired into the live evaluator — these
// tests verify the surface compiles + behaves before downstream callers
// get added.
//
// Run: node scripts/test/test_anim.mjs

import {
  parseRnaPath,
  evaluateRnaPath,
  setRnaPath,
} from '../../src/anim/rnaPath.js';
import { evaluateFCurve, upsertKeyframe } from '../../src/anim/fcurve.js';
import { evaluateDriver } from '../../src/anim/driver.js';

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
function assertClose(actual, expected, name, eps = 1e-6) {
  if (Math.abs(actual - expected) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected ~${expected}\n  actual    ${actual}`);
}

// ── parseRnaPath ──
{
  assertEq(
    parseRnaPath('objects'),
    [{ kind: 'field', value: 'objects' }],
    'parse single field',
  );
  assertEq(
    parseRnaPath('objects["p1"]'),
    [
      { kind: 'field', value: 'objects' },
      { kind: 'key', value: 'p1' },
    ],
    'parse single key',
  );
  assertEq(
    parseRnaPath('objects["p1"].transform.rotation'),
    [
      { kind: 'field', value: 'objects' },
      { kind: 'key', value: 'p1' },
      { kind: 'field', value: 'transform' },
      { kind: 'field', value: 'rotation' },
    ],
    'parse object/key/field/field',
  );
  assertEq(
    parseRnaPath('objects["p1"].mesh.vertices[3].x'),
    [
      { kind: 'field', value: 'objects' },
      { kind: 'key', value: 'p1' },
      { kind: 'field', value: 'mesh' },
      { kind: 'field', value: 'vertices' },
      { kind: 'index', value: 3 },
      { kind: 'field', value: 'x' },
    ],
    'parse with numeric index',
  );

  // Malformed → null.
  assert(parseRnaPath('') === null, 'empty string → null');
  assert(parseRnaPath('123') === null, 'leading digit → null');
  assert(parseRnaPath("objects['unclosed") === null, 'unclosed bracket → null');
  assert(parseRnaPath(null) === null, 'null → null');
}

// ── evaluateRnaPath ──
{
  const project = {
    nodes: [
      {
        id: 'p1',
        type: 'part',
        opacity: 0.7,
        transform: { rotation: 30, x: 100, y: 200, pivotX: 50, pivotY: 60 },
        mesh: { vertices: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
        blendShapeValues: { smile: 0.4 },
      },
      {
        id: 'g1',
        type: 'group',
        boneRole: 'head',
        transform: { pivotX: 10, pivotY: 20 },
        pose: { rotation: 5, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
    ],
    parameters: [{ id: 'ParamAngleZ', default: 0 }, { id: 'ParamSmile', default: 0.5 }],
  };

  assertEq(evaluateRnaPath(project, 'objects["p1"].opacity'), 0.7, 'read opacity');
  assertEq(evaluateRnaPath(project, 'objects["p1"].transform.rotation'), 30, 'read transform.rotation');
  assertEq(evaluateRnaPath(project, 'objects["p1"].mesh.vertices[1].x'), 3, 'read mesh.vertices[1].x via getMesh');
  assertEq(
    evaluateRnaPath(project, 'objects["p1"].blendShapeValues["smile"]'),
    0.4,
    'read blendShapeValues key',
  );
  assertEq(evaluateRnaPath(project, 'objects["g1"].pose.rotation'), 5, 'read bone pose');

  // Synthetic __params__ resolves to the parameters defaults map.
  assertEq(
    evaluateRnaPath(project, 'objects["__params__"].values["ParamSmile"]'),
    0.5,
    'read __params__ default',
  );

  // Synthetic __armature__ resolves to ArmatureView.
  assertEq(
    evaluateRnaPath(project, 'objects["__armature__"].id'),
    '__armature__',
    'read __armature__.id',
  );

  // Missing object / field → undefined.
  assert(evaluateRnaPath(project, 'objects["nonexistent"].opacity') === undefined, 'unknown id → undefined');
  assert(evaluateRnaPath(project, 'objects["p1"].nonexistent') === undefined, 'unknown field → undefined');
}

// ── setRnaPath ──
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', transform: { rotation: 0 } },
    ],
  };

  assert(setRnaPath(project, 'objects["p1"].transform.rotation', 45) === true, 'set rotation');
  assertEq(project.nodes[0].transform.rotation, 45, 'rotation written');

  // Creating a missing nested field works.
  assert(setRnaPath(project, 'objects["p1"].newField', 'hello') === true, 'set new field');
  assertEq(project.nodes[0].newField, 'hello', 'new field exists');

  // Unknown object id fails.
  assert(setRnaPath(project, 'objects["ghost"].opacity', 1) === false, 'unknown id rejected');
}

// ── upsertKeyframe / evaluateFCurve ──
{
  /** @type {{id:string, rnaPath:string, keyforms:any[]}} */
  const fc = { id: 'fc1', rnaPath: 'objects["p1"].opacity', keyforms: [] };

  upsertKeyframe(fc, 0, 0);
  upsertKeyframe(fc, 10, 1);
  upsertKeyframe(fc, 5, 0.5); // sorted insert

  assertEq(fc.keyforms.map((k) => k.time), [0, 5, 10], 'sorted-insert preserved');

  // Linear interpolation.
  assertClose(evaluateFCurve(fc, 0), 0, 'eval at first keyframe');
  assertClose(evaluateFCurve(fc, 10), 1, 'eval at last keyframe');
  assertClose(evaluateFCurve(fc, 2.5), 0.25, 'eval midpoint of first segment');
  assertClose(evaluateFCurve(fc, 7.5), 0.75, 'eval midpoint of second segment');

  // Constant extrapolation outside range.
  assertClose(evaluateFCurve(fc, -100), 0, 'extrapolate before → first kf');
  assertClose(evaluateFCurve(fc, 1000), 1, 'extrapolate after → last kf');

  // upsert at existing time replaces value.
  upsertKeyframe(fc, 5, 0.9);
  assertEq(fc.keyforms.find((k) => k.time === 5).value, 0.9, 'upsert replaces existing');
  assertEq(fc.keyforms.length, 3, 'upsert does not duplicate');

  // Empty curves return 0.
  assert(evaluateFCurve({ keyforms: [] }, 0) === 0, 'empty fcurve → 0');
  assert(evaluateFCurve(null, 0) === 0, 'null fcurve → 0');
}

// ── evaluateFCurve constant interpolation ──
{
  const fc = {
    keyforms: [
      { time: 0, value: 10, type: 'constant' },
      { time: 10, value: 20 },
    ],
  };
  // Constant means hold the LEFT keyframe value through to the next.
  assertClose(evaluateFCurve(fc, 5), 10, 'constant interp holds left value');
  assertClose(evaluateFCurve(fc, 0), 10, 'constant at left edge');
  // At the right edge, eval picks the right keyframe.
  assertClose(evaluateFCurve(fc, 10), 20, 'constant at right edge');
}

// ── evaluateDriver: sum / min / max / avg ──
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', opacity: 0.6, transform: { rotation: 30 } },
      { id: 'p2', type: 'part', opacity: 0.4, transform: { rotation: 90 } },
    ],
  };

  const variables = [
    { name: 'a', target: { rnaPath: 'objects["p1"].opacity' } },
    { name: 'b', target: { rnaPath: 'objects["p2"].opacity' } },
  ];

  assertClose(evaluateDriver({ type: 'sum', variables }, { project }), 1.0, 'sum');
  assertClose(evaluateDriver({ type: 'min', variables }, { project }), 0.4, 'min');
  assertClose(evaluateDriver({ type: 'max', variables }, { project }), 0.6, 'max');
  assertClose(evaluateDriver({ type: 'avg', variables }, { project }), 0.5, 'avg');

  // No-variable drivers return safe defaults.
  assertEq(evaluateDriver({ type: 'sum', variables: [] }, { project }), 0, 'sum []');
  assertEq(evaluateDriver({ type: 'min', variables: [] }, { project }), 0, 'min []');
  assertEq(evaluateDriver({ type: 'max', variables: [] }, { project }), 0, 'max []');
  assertEq(evaluateDriver({ type: 'avg', variables: [] }, { project }), 0, 'avg []');
}

// ── evaluateDriver: scripted (safe expressions) ──
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', transform: { rotation: 30 } },
      { id: 'p2', type: 'part', transform: { rotation: 60 } },
    ],
  };
  const variables = [
    { name: 'rot1', target: { rnaPath: 'objects["p1"].transform.rotation' } },
    { name: 'rot2', target: { rnaPath: 'objects["p2"].transform.rotation' } },
  ];

  assertClose(
    evaluateDriver({ type: 'scripted', expression: 'rot1 + rot2', variables }, { project }),
    90,
    'scripted: addition',
  );
  assertClose(
    evaluateDriver({ type: 'scripted', expression: '(rot1 + rot2) / 2', variables }, { project }),
    45,
    'scripted: parens + division',
  );
  assertClose(
    evaluateDriver({ type: 'scripted', expression: 'min(rot1, rot2)', variables }, { project }),
    30,
    'scripted: built-in min()',
  );
  assertClose(
    evaluateDriver({ type: 'scripted', expression: 'clamp(rot1, 0, 20)', variables }, { project }),
    20,
    'scripted: built-in clamp()',
  );
  assertClose(
    evaluateDriver({ type: 'scripted', expression: 'PI', variables: [] }, { project }),
    Math.PI,
    'scripted: PI constant',
  );
}

// ── evaluateDriver: scripted hardening ──
{
  const project = { nodes: [] };
  const variables = [];

  // Unsafe expressions return NaN. The FCurve evaluator interprets
  // NaN as "fall back to keyframe value."
  for (const expr of [
    "this.constructor",                     // property access
    "globalThis",                           // banned identifier
    "function() { return 1 }",              // function keyword
    "return 1",                             // return keyword
    "x = 5",                                // assignment
    "obj.foo",                              // dot access on identifier
    "let x = 5; x",                         // let keyword
    "new Date()",                           // new
    "eval('1+1')",                          // eval
    "arr['key']",                           // bracket access
    "import('./bad.js')",                   // import
  ]) {
    const result = evaluateDriver(
      { type: 'scripted', expression: expr, variables },
      { project },
    );
    assert(Number.isNaN(result), `scripted unsafe expr rejected: ${expr.slice(0, 30)}`);
  }

  // Unknown driver type → NaN.
  assert(Number.isNaN(evaluateDriver({ type: 'unknown', variables }, { project })),
    'unknown driver type → NaN');
  // Null driver → NaN.
  assert(Number.isNaN(evaluateDriver(null, { project })), 'null driver → NaN');
}

// ── FCurve + Driver integration: driver overrides keyframes ──
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', opacity: 0.42, transform: { rotation: 0 } }],
  };
  const fc = {
    id: 'fc1',
    keyforms: [{ time: 0, value: 0 }, { time: 10, value: 1 }],
    driver: {
      type: 'scripted',
      expression: 'a * 2',
      variables: [{ name: 'a', target: { rnaPath: 'objects["p1"].opacity' } }],
    },
  };
  // Without driver: keyframe interpolation gives 0.5 at t=5.
  // With driver: 0.42 * 2 = 0.84 overrides.
  assertClose(evaluateFCurve(fc, 5, { project }), 0.84, 'driver overrides keyframe');

  // Disabling the driver (set type to unknown) falls back to keyframe.
  fc.driver.type = 'unknown';
  assertClose(evaluateFCurve(fc, 5, { project }), 0.5, 'invalid driver → keyframe value');
}

console.log(`anim: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
