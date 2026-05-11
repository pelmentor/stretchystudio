// Phase D-1 — DepGraph build pass tests. Verifies that
// `buildDepGraph(project, opts)` produces:
//   - Time/Param/Animation/Physics IDNodes for the project.
//   - Per-deformer IDNodes with the right ops per kind.
//   - Per-part IDNodes with GEOMETRY_EVAL_DEFORMED ops.
//   - Relations: time→track, track→param, param→keyform, parent
//     keyform→child keyform, modifier-stack→part.
//
// Run: node scripts/test/test_depgraph_build.mjs

import {
  buildDepGraph,
  buildNodes,
  buildRelations,
  TIME_ID_REF,
  PARAM_ID_REF,
  ACTION_ID_REF,
} from '../../src/anim/depgraph/build.js';
import {
  NodeType,
  OperationCode,
  DepGraph,
} from '../../src/anim/depgraph/types.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

function makeShelbyLite() {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [
      { id: 'ParamBodyAngleZ', default: 0 },
      { id: 'ParamBodyAngleY', default: 0 },
      { id: 'ParamBreath', default: 0 },
    ],
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null,
        bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-30, 0, 30] }] },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ',
        bindings: [{ parameterId: 'ParamBodyAngleY', keys: [-30, 0, 30] }] },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY',
        bindings: [{ parameterId: 'ParamBreath', keys: [0, 1] }] },
      { id: 'face', type: 'part', rigParent: 'BreathWarp',
        modifiers: [
          { type: 'warp', deformerId: 'BreathWarp', enabled: true },
          { type: 'warp', deformerId: 'BodyWarpY', enabled: true },
          { type: 'warp', deformerId: 'BodyWarpZ', enabled: true },
        ] },
    ],
    animations: [],
    physicsRules: [],
  };
}

// ---- buildNodes pass populates structure ----

{
  const graph = new DepGraph();
  const project = makeShelbyLite();
  buildNodes(graph, project, {});
  // Time source IDNode + TIME_TICK op.
  const timeId = graph.findIdNode(TIME_ID_REF, 'time');
  assert(timeId !== null, 'time IDNode created');
  assert(graph.timeSource === timeId, 'graph.timeSource set');
  const timeOp = timeId.findComponent(NodeType.PARAMETERS)
    ?.findOperation(OperationCode.TIME_TICK);
  assert(timeOp !== null && timeOp !== undefined, 'TIME_TICK op exists');

  // Param IDNode + PARAM_EVAL per parameter.
  const paramId = graph.findIdNode(PARAM_ID_REF, 'params');
  const paramComp = paramId?.findComponent(NodeType.PARAMETERS);
  assert(paramId !== null, 'params IDNode created');
  for (const id of ['ParamBodyAngleZ', 'ParamBodyAngleY', 'ParamBreath']) {
    assert(paramComp?.findOperation(OperationCode.PARAM_EVAL, id) !== null,
      `PARAM_EVAL for ${id}`);
  }

  // Per-deformer IDNodes.
  for (const id of ['BodyWarpZ', 'BodyWarpY', 'BreathWarp']) {
    const def = graph.findIdNode(id, 'deformer');
    assert(def !== null, `${id} IDNode`);
    const geom = def.findComponent(NodeType.GEOMETRY);
    assert(geom?.findOperation(OperationCode.KEYFORM_EVAL) !== null,
      `${id} KEYFORM_EVAL`);
    assert(geom?.findOperation(OperationCode.GRID_LIFT_TO_PARENT) !== null,
      `${id} GRID_LIFT_TO_PARENT (warp kind)`);
    assert(geom?.findOperation(OperationCode.MATRIX_BUILD) === null,
      `${id} MATRIX_BUILD absent (warp, not rotation)`);
  }

  // Per-part IDNode with GEOMETRY_EVAL_DEFORMED.
  const faceId = graph.findIdNode('face', 'part');
  const faceGeom = faceId?.findComponent(NodeType.GEOMETRY);
  assert(faceGeom?.findOperation(OperationCode.GEOMETRY_EVAL_DEFORMED) !== null,
    'face GEOMETRY_EVAL_DEFORMED');
}

// ---- Rotation deformers get MATRIX_BUILD + ROTATION_SETUP_PROBE ----

{
  const graph = new DepGraph();
  const project = {
    parameters: [],
    nodes: [
      { id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation', parent: null },
    ],
    animations: [],
    physicsRules: [],
  };
  buildNodes(graph, project, {});
  const def = graph.findIdNode('FaceRotation', 'deformer');
  const geom = def?.findComponent(NodeType.GEOMETRY);
  assert(geom?.findOperation(OperationCode.MATRIX_BUILD) !== null,
    'rotation: MATRIX_BUILD present');
  assert(geom?.findOperation(OperationCode.ROTATION_SETUP_PROBE) !== null,
    'rotation: ROTATION_SETUP_PROBE present');
  assert(geom?.findOperation(OperationCode.GRID_LIFT_TO_PARENT) === null,
    'rotation: GRID_LIFT_TO_PARENT absent');
}

// ---- Animation tracks get ANIMATION_TRACK_EVAL ----

{
  const graph = new DepGraph();
  const project = {
    parameters: [{ id: 'ParamSmile' }],
    nodes: [],
    animations: [],
    physicsRules: [],
  };
  // Post-v36: action carries fcurves with rnaPath; build pass tags
  // each ANIMATION_TRACK_EVAL op with the fcurve's rnaPath verbatim.
  const action = {
    fcurves: [
      {
        id: 'param:ParamSmile',
        rnaPath: 'objects["__params__"].values["ParamSmile"]',
        arrayIndex: 0,
        keyforms: [],
        modifiers: [],
        extrapolation: 'constant',
      },
    ],
  };
  buildNodes(graph, project, { action });
  const animId = graph.findIdNode(ACTION_ID_REF, 'action');
  const animComp = animId?.findComponent(NodeType.ANIMATION);
  assert(animComp?.findOperation(OperationCode.ANIMATION_TRACK_EVAL,
    'objects["__params__"].values["ParamSmile"]') !== null,
    'ANIMATION_TRACK_EVAL with rnaPath tag');
}

// ---- buildRelations: param → keyform ----

{
  const project = makeShelbyLite();
  const graph = buildDepGraph(project, {});
  const paramOp = graph.findIdNode(PARAM_ID_REF, 'params')
    ?.findComponent(NodeType.PARAMETERS)
    ?.findOperation(OperationCode.PARAM_EVAL, 'ParamBodyAngleZ');
  const defOp = graph.findIdNode('BodyWarpZ', 'deformer')
    ?.findComponent(NodeType.GEOMETRY)
    ?.findOperation(OperationCode.KEYFORM_EVAL);
  assert(paramOp && defOp, 'looked-up ops exist');
  // Edge from paramOp to defOp via outlinks.
  const found = paramOp.outlinks.some((r) => r.to === defOp && r.name.includes('param -> keyform'));
  assert(found, 'PARAM_EVAL → KEYFORM_EVAL relation present');
}

// ---- buildRelations: parent keyform → child keyform (chain) ----

{
  const project = makeShelbyLite();
  const graph = buildDepGraph(project, {});
  const parentLift = graph.findIdNode('BodyWarpZ', 'deformer')
    ?.findComponent(NodeType.GEOMETRY)
    ?.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
  const childLift = graph.findIdNode('BodyWarpY', 'deformer')
    ?.findComponent(NodeType.GEOMETRY)
    ?.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
  const found = parentLift.outlinks.some((r) => r.to === childLift && r.name.includes('parent lift -> child lift'));
  assert(found, 'parent GRID_LIFT_TO_PARENT → child GRID_LIFT_TO_PARENT');
}

// ---- buildRelations: modifier stack → part ----

{
  const project = makeShelbyLite();
  const graph = buildDepGraph(project, {});
  const partOp = graph.findIdNode('face', 'part')
    ?.findComponent(NodeType.GEOMETRY)
    ?.findOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
  // Each non-disabled modifier should have wired its def op as upstream.
  const inLinks = partOp.inlinks.length;
  assertEq(inLinks, 3, 'face has 3 modifier-stack upstream relations');
}

// ---- buildRelations: disabled modifier excluded ----

{
  const project = makeShelbyLite();
  // Disable the middle modifier.
  project.nodes.find((n) => n.id === 'face').modifiers[1].enabled = false;
  const graph = buildDepGraph(project, {});
  const partOp = graph.findIdNode('face', 'part')
    ?.findComponent(NodeType.GEOMETRY)
    ?.findOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
  assertEq(partOp.inlinks.length, 2,
    'disabled modifier excluded from part relations');
}

// ---- buildRelations: animation track → param ----

{
  const project = makeShelbyLite();
  // Post-v36: fcurve rnaPath is the op tag; the build pass wires the
  // rnaPath-tagged TRACK_EVAL op as upstream of the matching PARAM_EVAL op.
  const action = {
    fcurves: [
      {
        id: 'param:ParamBreath',
        rnaPath: 'objects["__params__"].values["ParamBreath"]',
        arrayIndex: 0,
        keyforms: [],
        modifiers: [],
        extrapolation: 'constant',
      },
    ],
  };
  const graph = buildDepGraph(project, { action });
  const trackOp = graph.findIdNode(ACTION_ID_REF, 'action')
    ?.findComponent(NodeType.ANIMATION)
    ?.findOperation(OperationCode.ANIMATION_TRACK_EVAL,
      'objects["__params__"].values["ParamBreath"]');
  const paramOp = graph.findIdNode(PARAM_ID_REF, 'params')
    ?.findComponent(NodeType.PARAMETERS)
    ?.findOperation(OperationCode.PARAM_EVAL, 'ParamBreath');
  assert(trackOp.outlinks.some((r) => r.to === paramOp),
    'fcurve -> param edge present');
  // Time → track also wired.
  const timeOp = graph.timeSource?.findComponent(NodeType.PARAMETERS)
    ?.findOperation(OperationCode.TIME_TICK);
  assert(timeOp.outlinks.some((r) => r.to === trackOp),
    'time -> track edge present');
}

// ---- Driver wiring: variable → driver → target ----

{
  const project = {
    parameters: [
      { id: 'ParamA', default: 0 },
      { id: 'ParamB', default: 0,
        driver: {
          type: 'scripted',
          expression: 'ParamA * 2',
          variables: [{ name: 'ParamA',
            target: { id: 'ParamA',
              rnaPath: 'objects["__params__"].values["ParamA"]' } }],
        } },
    ],
    nodes: [],
    animations: [],
    physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')
    ?.findComponent(NodeType.PARAMETERS);
  const driverOp = paramComp?.findOperation(OperationCode.DRIVER_EVAL, 'ParamB');
  const targetOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, 'ParamB');
  const sourceOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, 'ParamA');
  assert(driverOp && targetOp && sourceOp, 'driver / target / source ops');
  assert(sourceOp.outlinks.some((r) => r.to === driverOp), 'source -> driver edge');
  assert(driverOp.outlinks.some((r) => r.to === targetOp), 'driver -> target edge');
}

// ---- Cycle detection ----

{
  const project = {
    parameters: [
      { id: 'A', default: 0,
        driver: {
          type: 'scripted', expression: 'B * 2',
          variables: [{ name: 'B',
            target: { rnaPath: 'objects["__params__"].values["B"]' } }],
        } },
      { id: 'B', default: 0,
        driver: {
          type: 'scripted', expression: 'A * 2',
          variables: [{ name: 'A',
            target: { rnaPath: 'objects["__params__"].values["A"]' } }],
        } },
    ],
    nodes: [],
    animations: [],
    physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const cyclicCount = graph.relations.filter((r) => (r.flag & 1) !== 0).length;
  assert(cyclicCount > 0, 'cycle detected: at least one relation tagged CYCLIC');
}

// ---- Empty project produces minimal graph ----

{
  const graph = buildDepGraph({
    canvas: { width: 800, height: 600 },
    nodes: [], parameters: [], animations: [], physicsRules: [],
  }, {});
  assert(graph.timeSource !== null, 'empty project still has timesource');
  assertEq(graph.allOperations().length, 1, 'empty project: only TIME_TICK op');
}

// ---- Result ----

console.log(`depgraph_build: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
