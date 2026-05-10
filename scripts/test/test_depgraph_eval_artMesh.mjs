// Phase 0.D.0 — ART_MESH_EVAL kernel + evalProjectFrameViaDepgraph
// parity tests against chainEval's `evalRig`.
//
// The depgraph runner must produce byte-equal `ArtMeshFrame[]` output
// for the production rAF callback to swap engines transparently.
//
// Run: node scripts/test/test_depgraph_eval_artMesh.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

function maxDelta(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

// ---------------------------------------------------------------------
// Helpers: synthesise a 4-vert quad part with a `runtime` payload.
// ---------------------------------------------------------------------

function quadVerts() {
  return [100, 50,  300, 50,  100, 250,  300, 250];
}

function makeBareRuntime() {
  return {
    parent: { type: 'root', id: null },
    bindings: [],
    keyforms: [
      { keyTuple: [], opacity: 1, vertexPositions: quadVerts() },
    ],
  };
}

// ---------------------------------------------------------------------
// Test 1: root-parented part — no modifiers, identity passthrough.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: null, modifiers: [],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: quadVerts(),
          runtime: makeBareRuntime(),
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(ce.length === 1, 'root-only: chainEval emits 1 frame');
  assert(dg.length === 1, 'root-only: depgraph emits 1 frame');
  assert(ce[0].id === dg[0].id, `root-only: id matches (${ce[0].id} vs ${dg[0].id})`);
  const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-5, `root-only: vertexPositions byte-equal (delta=${d})`);
  assert(Math.abs(ce[0].opacity - dg[0].opacity) < 1e-9,
    `root-only: opacity matches (${ce[0].opacity} vs ${dg[0].opacity})`);
}

// ---------------------------------------------------------------------
// Test 2: part under a single rotation deformer (parent='Rotation_face').
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const verts = quadVerts();           // canvas-px
  // Pivot-relative version (offsets from rotation pivot at 400,300):
  const pivotRel = verts.map((v, i) => v - (i % 2 === 0 ? 400 : 300));
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      { id: 'Rotation_face', type: 'deformer', deformerKind: 'rotation', name: 'Rotation_face',
        visible: true, parent: null,
        bindings: [],
        keyforms: [
          { keyTuple: [], angle: 0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'Rotation_face',
        modifiers: [
          { type: 'rotation', deformerId: 'Rotation_face', enabled: true, mode: 7 },
        ],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: verts,
          runtime: {
            parent: { type: 'rotation', id: 'Rotation_face' },
            bindings: [],
            keyforms: [
              { keyTuple: [], opacity: 1, vertexPositions: pivotRel },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(ce.length === 1 && dg.length === 1, 'rotation parent: 1 frame each');
  const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `rotation parent: depgraph matches chainEval (delta=${d})`,
    `chainEval=${Array.from(ce[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
}

// ---------------------------------------------------------------------
// Test 3: part driven by a parameter — keyform blend follows paramValue.
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const restVerts = quadVerts();
  const offsetVerts = restVerts.map((v, i) => v + (i % 2 === 0 ? 50 : 0));
  const project = {
    canvas: { width: W, height: H },
    parameters: [
      { id: 'ParamX', name: 'ParamX', default: 0, defaultValue: 0, minValue: 0, maxValue: 1 },
    ],
    nodes: [
      { id: 'shape', type: 'part', name: 'shape', visible: true, draw_order: 100,
        rigParent: null, modifiers: [],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: restVerts,
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [
              { parameterId: 'ParamX', keys: [0, 1], interpolation: 'LINEAR' },
            ],
            keyforms: [
              { keyTuple: [0], opacity: 1, vertexPositions: restVerts },
              { keyTuple: [1], opacity: 1, vertexPositions: offsetVerts },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);

  // Param=0 → rest verts.
  {
    const ce = evalRig(rigSpec, { ParamX: 0 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 0 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=0: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 100) < 1e-4, 'param=0: x[0]=100');
  }
  // Param=1 → offset verts.
  {
    const ce = evalRig(rigSpec, { ParamX: 1 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 1 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=1: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 150) < 1e-4, 'param=1: x[0]=150 (offset applied)');
  }
  // Param=0.5 → blended (rest + offset)/2.
  {
    const ce = evalRig(rigSpec, { ParamX: 0.5 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 0.5 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=0.5: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 125) < 1e-4, 'param=0.5: x[0]=125 (blended)');
  }
}

console.log(`depgraph_eval_artMesh: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
