// Phase N-3 + Phase 1 Stage 1.F (post-NodeTree-retirement) —
// AnimationTree compile + eval byte-equivalence vs `computeParamOverrides`
// / `computePoseOverrides`.
//
// Post-v38: `compileAnimationTree(action)` is the SOLE compile path
// for the animation node graph; the v24 migration's
// `compileLegacyAnimationTree` (which carried legacy track shape via
// `storage.track`) is gone. This test pins the post-v36 fcurve shape
// (`storage.fcurve` carrying rnaPath strings) + asserts byte-equivalence
// with the canonical `interpolateTrack`-driven animationEngine path.
//
// Replaces the deleted `test_animationTree_migration.mjs` from before
// the NodeTree retirement (Animation Phase 1 Stage 1.F pre-exit).
//
// Run: node scripts/test/test_animationTree_compile.mjs

import { compileAnimationTree } from '../../src/anim/nodetree/animationCompile.js';
import { evalNodeTree } from '../../src/anim/nodetree/eval.js';
import {
  computeParamOverrides,
  computePoseOverrides,
} from '../../src/renderer/animationEngine.js';
import {
  buildParamFCurve,
  buildNodeFCurve,
} from '../../src/anim/animationFCurve.js';
import '../../src/anim/nodetree/nodes/animation.js';

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

// ---- Compile shape (post-v36 action) ----

{
  const action = {
    id: 'anim_idle',
    fcurves: [
      buildParamFCurve('ParamSmile', [
        { time: 0,    value: 0, easing: 'linear' },
        { time: 1000, value: 1, easing: 'linear' },
      ]),
      buildNodeFCurve('face', 'rotation', [
        { time: 0,    value: 0,  easing: 'linear' },
        { time: 1000, value: 30, easing: 'linear' },
      ]),
    ],
  };
  const tree = compileAnimationTree(action);
  assert(tree.id === 'animation:anim_idle',
    'animation tree id = animation:<id>');
  assert(tree.actionId === 'anim_idle', 'tree.actionId set');
  assert(tree.nodes.length === 3,
    '2-fcurve action → 3 nodes (2 strips + 1 TimelineOutput)');
  const types = tree.nodes.map((n) => n.typeId);
  assert(types.filter((t) => t === 'FCurveStrip').length === 2,
    '2 FCurveStrip nodes for 2 fcurves');
  assert(types.includes('TimelineOutput'), 'TimelineOutput present');
}

// ---- Strip shape: every strip carries storage.fcurve (post-v38) ----

{
  const action = {
    id: 'a',
    fcurves: [buildParamFCurve('P', [
      { time: 0, value: 0, easing: 'linear' },
    ])],
  };
  const tree = compileAnimationTree(action);
  const strip = tree.nodes.find((n) => n.typeId === 'FCurveStrip');
  assert(strip != null, 'strip emitted');
  assert(strip.storage?.fcurve != null,
    'strip carries storage.fcurve (post-v36 shape)');
  assert(strip.storage?.track == null,
    'strip does NOT carry storage.track (legacy v24 shape — retired in v38)');
}

// ---- Eval byte-equivalence: param fcurve ----

{
  const action = {
    id: 'anim',
    fcurves: [buildParamFCurve('ParamSmile', [
      { time: 0,    value: 0, easing: 'linear' },
      { time: 1000, value: 1, easing: 'linear' },
    ])],
  };
  const tree = compileAnimationTree(action);

  for (const ms of [0, 250, 500, 750, 1000]) {
    // Reference.
    const ref = computeParamOverrides(action, ms, false, 0);
    const refValue = ref.get('ParamSmile');
    // Tree eval. NOTE: evalNodeTree uses time in seconds (motion3.json
    // boundary), while computeParamOverrides uses ms. We pass both
    // representations to keep the comparison apples-to-apples.
    const overrides = new Map();
    evalNodeTree(tree, {
      project: { parameters: [{ id: 'ParamSmile', default: 0 }] },
      time: ms / 1000,
      paramOverrides: overrides,
    });
    const candidate = overrides.get('ParamSmile');
    assertNear(candidate, refValue, 1e-9,
      `param fcurve @${ms}ms: tree=${candidate} ref=${refValue}`);
  }
}

// ---- Eval byte-equivalence: pose fcurve ----

{
  const action = {
    id: 'anim2',
    fcurves: [buildNodeFCurve('face', 'rotation', [
      { time: 0,    value: 0,  easing: 'linear' },
      { time: 1000, value: 30, easing: 'linear' },
    ])],
  };
  const tree = compileAnimationTree(action);
  const ref = computePoseOverrides(action, 500, false, 0);
  const refRot = ref.get('face')?.rotation;
  const poseOverrides = new Map();
  evalNodeTree(tree, {
    project: { nodes: [{ id: 'face', type: 'group' }] },
    time: 0.5,
    poseOverrides,
  });
  const treeRot = poseOverrides.get('face')?.get('rotation');
  assertNear(treeRot, refRot, 1e-9,
    `pose fcurve @500ms: tree=${treeRot} ref=${refRot}`);
}

// ---- mesh_verts deferred (returns undefined, no throw) ----

{
  const action = {
    id: 'anim3',
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
  const tree = compileAnimationTree(action);
  const poseOverrides = new Map();
  // Should not throw + should not populate poseOverrides for mesh_verts.
  evalNodeTree(tree, {
    project: { nodes: [] }, time: 0.5, poseOverrides,
  });
  const faceMap = poseOverrides.get('face');
  assert(faceMap == null || !faceMap.has('mesh_verts'),
    'mesh_verts: deferred (no entry in poseOverrides)');
}

// ---- Result ----

console.log(`animationTree_compile: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
