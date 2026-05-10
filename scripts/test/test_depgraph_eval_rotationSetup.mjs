// Phase D-3b — ROTATION_SETUP_PROBE byte-fidelity vs
// chainEval's getRotationSetup.
//
// Three cases mirroring the chainEval port:
//   1. Root-parented rotation: setup carries authored values verbatim.
//   2. Warp-parented rotation: FD probe at pivot through parent's
//      lifted grid; canvas-final pivot + effective angle compensate
//      for parent's local rotation.
//   3. Rotation-parented rotation: probe walks via parent's matrix.
//
// Run: node scripts/test/test_depgraph_eval_rotationSetup.mjs

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

// ---- 1. Root-parented rotation: identity probe ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 100, originY: 200, scale: 1, opacity: 1 },
          { keyTuple: [0],   angle: 0,   originX: 100, originY: 200, scale: 1, opacity: 1 },
          { keyTuple: [30],  angle: 30,  originX: 100, originY: 200, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 0]]) });
  const setup = ctx.outputs.get('R/GEOMETRY/ROTATION_SETUP_PROBE');
  assert(setup != null, 'root: setup produced');
  assertNear(setup.canvasFinalPivot[0], 100, 1e-9,
    'root: canvasFinalPivot.x = authored originX');
  assertNear(setup.canvasFinalPivot[1], 200, 1e-9,
    'root: canvasFinalPivot.y = authored originY');
  assertNear(setup.effectiveAngleDeg, 0, 1e-9,
    'root: effectiveAngle = keyform.angle (no probe compensation)');
}

// ---- 2. Warp-parented rotation: pivot probed through identity warp ----

// Identity warp: a 2x2 grid spanning canvas (0,0)→(800,600) with
// control points at corners + interior. Every input position passes
// through unchanged.

function makeIdentityWarp(id, parent, w = 800, h = 600) {
  const cols = 1, rows = 1;
  const positions = [
    0, 0,    w, 0,
    0, h,    w, h,
  ];
  return {
    id, type: 'deformer', deformerKind: 'warp', parent,
    gridSize: { rows, cols },
    bindings: [],
    keyforms: [{ keyTuple: [], positions, opacity: 1 }],
    isQuadTransform: false,
  };
}

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      makeIdentityWarp('IdW', null),
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: 'IdW',
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 0.25, originY: 0.5, scale: 1, opacity: 1 },
          { keyTuple: [0],   angle: 0,   originX: 0.25, originY: 0.5, scale: 1, opacity: 1 },
          { keyTuple: [30],  angle: 30,  originX: 0.25, originY: 0.5, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 0]]) });
  const setup = ctx.outputs.get('R/GEOMETRY/ROTATION_SETUP_PROBE');
  assert(setup != null, 'warp parent: setup produced');
  // Identity warp at (0.25, 0.5) → canvas-px (0.25*800, 0.5*600) = (200, 300).
  assertNear(setup.canvasFinalPivot[0], 200, 0.5,
    'warp parent: canvasFinalPivot.x = 0.25 in unit warp → 200 px');
  assertNear(setup.canvasFinalPivot[1], 300, 0.5,
    'warp parent: canvasFinalPivot.y = 0.5 in unit warp → 300 px');
  // Identity warp's local rotation at any point is 0 → effectiveAngleDeg = keyform.
  assertNear(setup.effectiveAngleDeg, 0, 1e-2,
    'warp parent (identity): effectiveAngle ≈ keyform (no compensation)');
}

// ---- 3. Setup output drives MATRIX_BUILD canvas-final mode ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      makeIdentityWarp('IdW', null),
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: 'IdW',
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], angle: 0,  originX: 0.5, originY: 0.5, scale: 1, opacity: 1 },
          { keyTuple: [1], angle: 90, originX: 0.5, originY: 0.5, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 1]]) });
  const matrix = ctx.outputs.get('R/GEOMETRY/MATRIX_BUILD');
  assert(matrix != null, 'matrix produced');
  assert(matrix.isCanvasFinal === true,
    'D-3b: setup-driven matrix is canvas-final');
  // angle=90, canvas-final pivot = (400, 300). Row-major layout:
  //   m[0]=cos·sx=0, m[1]=-sin·sy=-1, m[2]=tx
  //   m[3]=sin·sx=1, m[4]=cos·sy=0,   m[5]=ty
  assertNear(matrix.mat[0],  0, 1e-9, 'canvas-final 90° m[0]=cos·sx=0');
  assertNear(matrix.mat[1], -1, 1e-9, 'canvas-final 90° m[1]=-sin·sy=-1');
  assertNear(matrix.mat[2], 400, 0.5, 'canvas-final m[2]=tx ≈ 400');
  assertNear(matrix.mat[3],  1, 1e-9, 'canvas-final 90° m[3]=sin·sx=1');
  assertNear(matrix.mat[4],  0, 1e-9, 'canvas-final 90° m[4]=cos·sy=0');
  assertNear(matrix.mat[5], 300, 0.5, 'canvas-final m[5]=ty ≈ 300');
}

// ---- 4. Rotation-parented rotation: chains through parent matrix ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      // Parent: identity rotation at canvas-px pivot (10, 20).
      { id: 'P_rot', type: 'deformer', deformerKind: 'rotation', parent: null,
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], angle: 0, originX: 10, originY: 20, scale: 1, opacity: 1 },
          { keyTuple: [1], angle: 0, originX: 10, originY: 20, scale: 1, opacity: 1 },
        ] },
      // Child rotation parented to P_rot, pivot offset (5, 5) from P_rot.
      { id: 'C_rot', type: 'deformer', deformerKind: 'rotation', parent: 'P_rot',
        baseAngle: 0,
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], angle: 0,  originX: 5, originY: 5, scale: 1, opacity: 1 },
          { keyTuple: [1], angle: 30, originX: 5, originY: 5, scale: 1, opacity: 1 },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', 0]]) });
  const setup = ctx.outputs.get('C_rot/GEOMETRY/ROTATION_SETUP_PROBE');
  assert(setup != null, 'rotation-parented setup produced');
  // P_rot is identity-rotate canvas-final → applies (10, 20) translation.
  // C_rot's authored pivot (5, 5) → canvas-final pivot ≈ (15, 25).
  assertNear(setup.canvasFinalPivot[0], 15, 1.0,
    'rot-parent: canvasFinalPivot.x ≈ parent.tx + child.pivot.x');
  assertNear(setup.canvasFinalPivot[1], 25, 1.0,
    'rot-parent: canvasFinalPivot.y ≈ parent.ty + child.pivot.y');
}

// ---- Result ----

console.log(`depgraph_eval_rotationSetup: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
