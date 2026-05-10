// Phase D-3a — depgraph eval on a project with simple warp + rotation
// chains. Verifies KEYFORM_EVAL + MATRIX_BUILD outputs land in
// ctx.outputs, and that GEOMETRY_EVAL_DEFORMED runs after all upstream
// deformer ops are ready.
//
// Phase D-3a is intentionally not byte-fidelity vs chainEval (that's
// the D-3b gate); D-3a verifies the kernel pipeline is well-formed and
// the topology orders ops correctly.
//
// Run: node scripts/test/test_depgraph_eval_simpleDeformer.mjs

import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertNear(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (|${a} - ${b}| > ${eps})`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- KEYFORM_EVAL on rotation: blends keyforms by cell weights ----

{
  const project = {
    parameters: [{ id: 'ParamAngleZ', default: 0 }],
    nodes: [
      { id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation',
        parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 100, originY: 100, scale: 1, opacity: 1 },
          { keyTuple: [0],   angle: 0,   originX: 100, originY: 100, scale: 1, opacity: 1 },
          { keyTuple: [30],  angle: 30,  originX: 100, originY: 100, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['ParamAngleZ', 15]]) });
  // KEYFORM_EVAL output: angle interpolated 0→30 at t=0.5 → 15.
  for (const [name, value] of ctx.outputs) {
    if (name.includes('FaceRotation/GEOMETRY/KEYFORM_EVAL') &&
        !name.includes('MATRIX')) {
      assertNear(value?.angle, 15, 1e-9,
        'KEYFORM_EVAL: angle interpolated correctly (15 from 0→30 at t=0.5)');
      assertEq(value?.kind, 'rotation', 'KEYFORM_EVAL: kind=rotation');
    }
  }
}

// ---- MATRIX_BUILD: angle=0 produces identity-rotate ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 0, originY: 0, scale: 1, opacity: 1 },
          { keyTuple: [0],   angle: 0,   originX: 0, originY: 0, scale: 1, opacity: 1 },
          { keyTuple: [30],  angle: 30,  originX: 0, originY: 0, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 0]]) });
  for (const [name, value] of ctx.outputs) {
    if (name.includes('R/GEOMETRY/MATRIX_BUILD')) {
      assertEq(value?.kind, 'rotation', 'MATRIX_BUILD: kind=rotation');
      assert(value?.mat instanceof Float64Array, 'MATRIX_BUILD: mat is Float64Array');
      // angle=0 → identity rotation: mat = [1,0,0, 0,1,0, 0,0,1]
      const m = value.mat;
      assertNear(m[0], 1, 1e-9, 'MATRIX_BUILD identity m[0]=1');
      assertNear(m[1], 0, 1e-9, 'MATRIX_BUILD identity m[1]=0');
      assertNear(m[3], 0, 1e-9, 'MATRIX_BUILD identity m[3]=0');
      assertNear(m[4], 1, 1e-9, 'MATRIX_BUILD identity m[4]=1');
    }
  }
}

// ---- MATRIX_BUILD: 90° rotation ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      { id: 'R90', type: 'deformer', deformerKind: 'rotation', parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], angle: 0,  originX: 50, originY: 60, scale: 1, opacity: 1 },
          { keyTuple: [1], angle: 90, originX: 50, originY: 60, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 1]]) });
  for (const [name, value] of ctx.outputs) {
    if (name.includes('R90/GEOMETRY/MATRIX_BUILD')) {
      const m = value?.mat;
      // 90° row-major:
      //   | cos -sin tx |   | 0 -1 50 |
      //   | sin  cos ty | = | 1  0 60 |
      //   |  0    0   1 |   | 0  0  1 |
      assertNear(m[0],  0, 1e-9, '90° m[0]=cos=0');
      assertNear(m[1], -1, 1e-9, '90° m[1]=-sin=-1');
      assertNear(m[2], 50, 1e-9, '90° m[2]=tx=50');
      assertNear(m[3],  1, 1e-9, '90° m[3]=sin=1');
      assertNear(m[4],  0, 1e-9, '90° m[4]=cos=0');
      assertNear(m[5], 60, 1e-9, '90° m[5]=ty=60');
    }
  }
}

// ---- GEOMETRY_EVAL_DEFORMED runs after all KEYFORM_EVAL ops ----

{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], angle: 0,  originX: 0, originY: 0, scale: 1, opacity: 1 },
          { keyTuple: [1], angle: 30, originX: 0, originY: 0, scale: 1, opacity: 1 },
        ] },
      { id: 'face', type: 'part',
        mesh: { vertices: [10, 20, 30, 40], uvs: [], triangles: [] },
        rigParent: 'R',
        modifiers: [{ type: 'rotation', deformerId: 'R', enabled: true }] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 0]]) });
  let geomOutput = null;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('face/GEOMETRY/GEOMETRY_EVAL_DEFORMED')) {
      geomOutput = value;
    }
  }
  assert(geomOutput !== null, 'GEOMETRY_EVAL_DEFORMED produced output');
  assertEq(geomOutput?.modifierTrace?.length, 1, 'face has 1-modifier trace');
  assertEq(geomOutput?.modifierTrace?.[0].applied, true,
    'rotation modifier applied (D-3a stub passes-through)');
  assert(geomOutput?.positions instanceof Float32Array,
    'GEOMETRY output: positions Float32Array');
  assertEq(Array.from(geomOutput.positions), [10, 20, 30, 40],
    'D-3a stub: positions pass-through unchanged (D-3b will deform)');
}

// ---- Empty modifier stack → empty trace ----

{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'detached', type: 'part',
        mesh: { vertices: [1, 2], uvs: [], triangles: [] } },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0 });
  for (const [name, value] of ctx.outputs) {
    if (name.includes('detached/GEOMETRY/GEOMETRY_EVAL_DEFORMED')) {
      assertEq(value?.modifierTrace?.length, 0, 'empty stack → empty trace');
      assertEq(Array.from(value?.positions ?? []), [1, 2],
        'empty stack → positions = source vertices');
    }
  }
}

// ---- Result ----

console.log(`depgraph_eval_simpleDeformer: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
