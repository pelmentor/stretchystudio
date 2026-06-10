// Phase D-4 — depgraph ANIMATION_TRACK_EVAL kernel byte-fidelity vs
// `computeParamOverrides` + `computePoseOverrides` from animationEngine.
//
// Post-v36: actions carry fcurves with rnaPath addressing instead of
// legacy paramId/nodeId/property fields. The kernel matches fcurves by
// rnaPath and dispatches param vs node target via decodeFCurveTarget.
//
// Run: node scripts/test/test_depgraph_eval_animation.mjs

import {
  computeParamOverrides,
  computePoseOverrides,
} from '../../src/renderer/animationEngine.js';
import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';
import { buildParamFCurve, buildNodeFCurve } from '../../src/anim/animationFCurve.js';

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

// ---- Param fcurve byte-fidelity ----

{
  const project = {
    parameters: [{ id: 'ParamSmile', default: 0 }],
    nodes: [], actions: [], physicsRules: [],
  };
  const action = {
    fcurves: [buildParamFCurve('ParamSmile', [
      { time: 0,    value: 0, easing: 'linear' },
      { time: 1000, value: 1, easing: 'linear' },
    ])],
  };
  const timeMs = 500;
  const ref = computeParamOverrides(action, timeMs, false, 0);
  const refValue = ref.get('ParamSmile');
  assert(typeof refValue === 'number', 'reference: param produced number');

  const graph = buildDepGraph(project, { action });
  const ctx = evalDepGraph(graph, { project, timeMs, action });
  const dep = ctx.paramOverrides.get('ParamSmile');
  assertNear(dep, refValue, 1e-6,
    'depgraph param fcurve: byte-equal to computeParamOverrides');
}

// ---- Pose fcurve ends up in poseOverrides map ----

{
  const project = {
    parameters: [],
    nodes: [{ id: 'face', type: 'group' }],
    actions: [], physicsRules: [],
  };
  const action = {
    fcurves: [buildNodeFCurve('face', 'rotation', [
      { time: 0,    value: 0,  easing: 'linear' },
      { time: 1000, value: 30, easing: 'linear' },
    ])],
  };
  const graph = buildDepGraph(project, { action });
  const poseOverrides = new Map();
  evalDepGraph(graph, {
    project, timeMs: 500, action, poseOverrides,
  });
  const faceMap = poseOverrides.get('face');
  assert(faceMap instanceof Map, 'pose fcurve: poseOverrides has face entry');
  const rot = faceMap?.get('rotation');
  assertNear(rot, 15, 1e-6,
    'pose fcurve: rotation lerps 0→30 at t=0.5 → 15');

  // Reference computePoseOverrides also produces 15.
  const ref = computePoseOverrides(action, 500, false, 0);
  const refRot = ref.get('face')?.rotation;
  assertNear(refRot, 15, 1e-6,
    'reference computePoseOverrides: matches');
  assertNear(rot, refRot, 1e-6,
    'depgraph pose fcurve: byte-equal to computePoseOverrides');
}

// ---- I-key (keying-set) prefixed-rnaPath bone pose fcurve normalisation ----
//
// The K-key path (`insertAllProperties`) emits bare rnaPaths like
// `objects["bone"].rotation`. The I-key path (`anim/keyingSets.js`
// built-in sets) emits RNA-faithful prefixed rnaPaths like
// `objects["bone"].pose.rotation` for bones and
// `objects["part"].transform.rotation` for non-bones.
//
// Pre-fix the prefixed shape stored under `entry.set('pose.rotation', v)`
// (and `{ 'pose.rotation': v }` in the engine path), but every consumer
// — `applyPoseOverrides`, `buildPoseOverrideIndex`, CanvasViewport's
// `kfOv[k]` reads — addresses by bare channel name. The skeleton overlay
// would visually rotate the bone but the mesh stayed at rest because the
// override never reached skinning. Pin the normalisation here so K-key
// and I-key fcurves are indistinguishable downstream.

{
  const project = {
    parameters: [],
    nodes: [{ id: 'bone', type: 'group', boneRole: 'rightArm' }],
    actions: [], physicsRules: [],
  };
  // I-key (keying-set) shape — `pose.rotation` rnaPath suffix.
  const action = {
    fcurves: [{
      id: 'bone.pose.rotation',
      rnaPath: 'objects["bone"].pose.rotation',
      arrayIndex: 0,
      keyforms: [
        { time: 0,    value: 0,  easing: 'linear', type: 'linear' },
        { time: 1000, value: 30, easing: 'linear', type: 'linear' },
      ],
      modifiers: [],
      extrapolation: 'constant',
    }],
  };
  const graph = buildDepGraph(project, { action });
  const poseOverrides = new Map();
  evalDepGraph(graph, {
    project, timeMs: 500, action, poseOverrides,
  });
  const boneMap = poseOverrides.get('bone');
  assert(boneMap instanceof Map,
    'pose.rotation fcurve: poseOverrides has bone entry');
  const rotBare = boneMap?.get('rotation');
  assertNear(rotBare, 15, 1e-6,
    'pose.rotation fcurve: stored under bare "rotation" channel key');
  assert(!boneMap?.has('pose.rotation'),
    'pose.rotation fcurve: NOT stored under prefixed "pose.rotation"');

  // Same coverage on the engine path (CanvasViewport calls this BEFORE
  // evalProjectFrameViaDepgraph and passes the result as opts.poseOverrides).
  const ref = computePoseOverrides(action, 500, false, 0);
  const refEntry = ref.get('bone');
  assert(refEntry && typeof refEntry === 'object',
    'computePoseOverrides: bone entry present');
  assertNear(refEntry?.rotation, 15, 1e-6,
    'computePoseOverrides: pose.rotation normalised to bare "rotation"');
  assert(!('pose.rotation' in (refEntry ?? {})),
    'computePoseOverrides: NOT stored under prefixed "pose.rotation"');
}

// Non-bone twin — `transform.rotation` suffix on a part. Same
// normalisation expected.
{
  const project = {
    parameters: [],
    nodes: [{ id: 'part', type: 'part' }],
    actions: [], physicsRules: [],
  };
  const action = {
    fcurves: [{
      id: 'part.transform.rotation',
      rnaPath: 'objects["part"].transform.rotation',
      arrayIndex: 0,
      keyforms: [
        { time: 0,    value: 0,  easing: 'linear', type: 'linear' },
        { time: 1000, value: 45, easing: 'linear', type: 'linear' },
      ],
      modifiers: [],
      extrapolation: 'constant',
    }],
  };
  const graph = buildDepGraph(project, { action });
  const poseOverrides = new Map();
  evalDepGraph(graph, {
    project, timeMs: 500, action, poseOverrides,
  });
  const partMap = poseOverrides.get('part');
  assert(partMap instanceof Map,
    'transform.rotation fcurve: poseOverrides has part entry');
  assertNear(partMap?.get('rotation'), 22.5, 1e-6,
    'transform.rotation fcurve: stored under bare "rotation" channel key');
  assert(!partMap?.has('transform.rotation'),
    'transform.rotation fcurve: NOT stored under prefixed key');
}

// ---- mesh_verts fcurve returns undefined (deferred to Phase N-3) ----
//
// Note: the v36 migration drops mesh_verts keyforms (their value is an
// array, not a number — see v36_action_datablock.js HOLD_EASINGS path).
// To exercise the kernel's mesh_verts skip we construct an fcurve
// directly bypassing the migration; this is artificial but pins the
// kernel's behaviour for when mesh_verts authoring resumes.

{
  const project = {
    parameters: [],
    nodes: [{ id: 'face', type: 'part' }],
    actions: [], physicsRules: [],
  };
  const action = {
    fcurves: [{
      id: 'face.mesh_verts',
      rnaPath: 'objects["face"].mesh_verts',
      arrayIndex: 0,
      keyforms: [
        { time: 0,    value: 0, easing: 'linear', type: 'linear' },
        { time: 1000, value: 1, easing: 'linear', type: 'linear' },
      ],
      modifiers: [],
      extrapolation: 'constant',
    }],
  };
  const graph = buildDepGraph(project, { action });
  const poseOverrides = new Map();
  evalDepGraph(graph, {
    project, timeMs: 500, action, poseOverrides,
  });
  // ANIMATION_TRACK_EVAL skips mesh_verts (returns undefined).
  // poseOverrides.face should NOT carry the mesh_verts entry.
  const faceMap = poseOverrides.get('face');
  assert(faceMap == null || !faceMap.has('mesh_verts'),
    'mesh_verts: deferred (no entry in poseOverrides)');
}

// ---- Result ----

console.log(`depgraph_eval_animation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
