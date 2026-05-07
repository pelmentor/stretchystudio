// Phase D-4 — depgraph ANIMATION_TRACK_EVAL kernel byte-fidelity vs
// `computeParamOverrides` + `computePoseOverrides` from animationEngine.
//
// Run: node scripts/test/test_depgraph_eval_animation.mjs

import {
  computeParamOverrides,
  computePoseOverrides,
} from '../../src/renderer/animationEngine.js';
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

// ---- Param track byte-fidelity ----

{
  const project = {
    parameters: [{ id: 'ParamSmile', default: 0 }],
    nodes: [], animations: [], physicsRules: [],
  };
  const animation = {
    tracks: [{
      paramId: 'ParamSmile',
      keyframes: [
        { time: 0,    value: 0,   easing: 'linear' },
        { time: 1000, value: 1,   easing: 'linear' },
      ],
    }],
  };
  const timeMs = 500;
  const ref = computeParamOverrides(animation, timeMs, false, 0);
  const refValue = ref.get('ParamSmile');
  assert(typeof refValue === 'number', 'reference: param produced number');

  const graph = buildDepGraph(project, { animation });
  // The build pass needs the track for tag generation. Convert
  // paramId-track to the SS-canonical {targetId, property} the build
  // pass expects (currently it reads track.targetId).
  // We work around: pass a bridged animation using paramId AS targetId.
  const bridged = {
    tracks: [{
      targetId: 'ParamSmile',
      property: 'value',
      paramId: 'ParamSmile',
      keyframes: animation.tracks[0].keyframes,
    }],
  };
  const graph2 = buildDepGraph(project, { animation: bridged });
  const ctx = evalDepGraph(graph2, {
    project, time: timeMs / 1000, animation: bridged,
  });
  const dep = ctx.paramOverrides.get('ParamSmile');
  assertNear(dep, refValue, 1e-6,
    'depgraph param track: byte-equal to computeParamOverrides');
}

// ---- Pose track ends up in poseOverrides map ----

{
  const project = {
    parameters: [],
    nodes: [{ id: 'face', type: 'group' }],
    animations: [], physicsRules: [],
  };
  const bridged = {
    tracks: [{
      targetId: 'face',
      property: 'rotation',
      nodeId: 'face',
      keyframes: [
        { time: 0,    value: 0,  easing: 'linear' },
        { time: 1000, value: 30, easing: 'linear' },
      ],
    }],
  };
  const graph = buildDepGraph(project, { animation: bridged });
  const poseOverrides = new Map();
  const ctx = evalDepGraph(graph, {
    project, time: 0.5, animation: bridged, poseOverrides,
  });
  const faceMap = poseOverrides.get('face');
  assert(faceMap instanceof Map, 'pose track: poseOverrides has face entry');
  const rot = faceMap?.get('rotation');
  assertNear(rot, 15, 1e-6,
    'pose track: rotation lerps 0→30 at t=0.5 → 15');

  // Reference computePoseOverrides also produces 15.
  const ref = computePoseOverrides(bridged, 500, false, 0);
  const refRot = ref.get('face')?.rotation;
  assertNear(refRot, 15, 1e-6,
    'reference computePoseOverrides: matches');
  assertNear(rot, refRot, 1e-6,
    'depgraph pose track: byte-equal to computePoseOverrides');
}

// ---- mesh_verts track returns undefined (deferred to Phase N-3) ----

{
  const project = {
    parameters: [],
    nodes: [{ id: 'face', type: 'part' }],
    animations: [], physicsRules: [],
  };
  const bridged = {
    tracks: [{
      targetId: 'face',
      property: 'mesh_verts',
      nodeId: 'face',
      keyframes: [
        { time: 0,    value: [{ x: 0, y: 0 }] },
        { time: 1000, value: [{ x: 1, y: 1 }] },
      ],
    }],
  };
  const graph = buildDepGraph(project, { animation: bridged });
  const poseOverrides = new Map();
  evalDepGraph(graph, {
    project, time: 0.5, animation: bridged, poseOverrides,
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
