// Phase N-3 — AnimationTree migration tests + eval byte-equivalence
// vs `computeParamOverrides` / `computePoseOverrides`.
//
// Run: node scripts/test/test_animationTree_migration.mjs

import { compileAnimationTree } from '../../src/anim/nodetree/animationCompile.js';
import { migrateNodeTreeAnimationTree } from '../../src/store/migrations/v24_nodetree_animationtree.js';
import { evalNodeTree } from '../../src/anim/nodetree/eval.js';
import {
  computeParamOverrides,
  computePoseOverrides,
} from '../../src/renderer/animationEngine.js';
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

// ---- Compile shape ----

{
  const animation = {
    id: 'anim_idle',
    tracks: [
      { paramId: 'ParamSmile', keyframes: [
        { time: 0,    value: 0,   easing: 'linear' },
        { time: 1000, value: 1,   easing: 'linear' },
      ] },
      { nodeId: 'face', property: 'rotation', keyframes: [
        { time: 0,    value: 0,  easing: 'linear' },
        { time: 1000, value: 30, easing: 'linear' },
      ] },
    ],
  };
  const tree = compileAnimationTree(animation);
  assert(tree.id === 'animation:anim_idle',
    'animation tree id = animation:<id>');
  assert(tree.animationId === 'anim_idle', 'tree.animationId set');
  assert(tree.nodes.length === 3,
    '2-track clip → 3 nodes (2 strips + 1 TimelineOutput)');
  const types = tree.nodes.map((n) => n.typeId);
  assert(types.filter((t) => t === 'FCurveStrip').length === 2,
    '2 FCurveStrip nodes for 2 tracks');
  assert(types.includes('TimelineOutput'), 'TimelineOutput present');
}

// ---- Eval byte-equivalence: param track ----

{
  const animation = {
    id: 'anim',
    tracks: [{
      paramId: 'ParamSmile',
      keyframes: [
        { time: 0,    value: 0,   easing: 'linear' },
        { time: 1000, value: 1,   easing: 'linear' },
      ],
    }],
  };
  const tree = compileAnimationTree(animation);

  for (const ms of [0, 250, 500, 750, 1000]) {
    // Reference.
    const ref = computeParamOverrides(animation, ms, false, 0);
    const refValue = ref.get('ParamSmile');
    // Tree eval.
    const overrides = new Map();
    evalNodeTree(tree, {
      project: { parameters: [{ id: 'ParamSmile', default: 0 }] },
      time: ms / 1000,
      paramOverrides: overrides,
    });
    const candidate = overrides.get('ParamSmile');
    assertNear(candidate, refValue, 1e-9,
      `param track @${ms}ms: tree=${candidate} ref=${refValue}`);
  }
}

// ---- Eval byte-equivalence: pose track ----

{
  const animation = {
    id: 'anim2',
    tracks: [{
      nodeId: 'face',
      property: 'rotation',
      keyframes: [
        { time: 0,    value: 0,  easing: 'linear' },
        { time: 1000, value: 30, easing: 'linear' },
      ],
    }],
  };
  const tree = compileAnimationTree(animation);
  const ref = computePoseOverrides(animation, 500, false, 0);
  const refRot = ref.get('face')?.rotation;
  const poseOverrides = new Map();
  evalNodeTree(tree, {
    project: { nodes: [{ id: 'face', type: 'group' }] },
    time: 0.5,
    poseOverrides,
  });
  const treeRot = poseOverrides.get('face')?.get('rotation');
  assertNear(treeRot, refRot, 1e-9,
    `pose track @500ms: tree=${treeRot} ref=${refRot}`);
}

// ---- mesh_verts deferred (returns undefined, no throw) ----

{
  const animation = {
    id: 'anim3',
    tracks: [{
      nodeId: 'face',
      property: 'mesh_verts',
      keyframes: [
        { time: 0,    value: [{ x: 0, y: 0 }] },
        { time: 1000, value: [{ x: 1, y: 1 }] },
      ],
    }],
  };
  const tree = compileAnimationTree(animation);
  const poseOverrides = new Map();
  // Should not throw + should not populate poseOverrides for mesh_verts.
  evalNodeTree(tree, {
    project: { nodes: [] }, time: 0.5, poseOverrides,
  });
  const faceMap = poseOverrides.get('face');
  assert(faceMap == null || !faceMap.has('mesh_verts'),
    'mesh_verts: deferred (no entry in poseOverrides)');
}

// ---- Migration v24 walks every clip ----

{
  const project = {
    parameters: [{ id: 'ParamSmile', default: 0 }],
    nodes: [],
    animations: [
      { id: 'idle', tracks: [{ paramId: 'ParamSmile', keyframes: [
        { time: 0, value: 0 }, { time: 1000, value: 1 },
      ] }] },
      { id: 'wave', tracks: [] },
    ],
  };
  migrateNodeTreeAnimationTree(project);
  assert(project.nodeTrees?.animation?.idle != null,
    'v24: idle has AnimationTree');
  assert(project.nodeTrees?.animation?.wave != null,
    'v24: wave has AnimationTree (even with empty tracks)');
}

// ---- Migration is idempotent ----

{
  const project = {
    animations: [
      { id: 'a', tracks: [
        { paramId: 'P', keyframes: [{ time: 0, value: 0 }] },
      ] },
    ],
    nodes: [],
  };
  migrateNodeTreeAnimationTree(project);
  const len1 = project.nodeTrees.animation.a.nodes.length;
  migrateNodeTreeAnimationTree(project);
  const len2 = project.nodeTrees.animation.a.nodes.length;
  assert(len1 === len2,
    'v24 idempotent: re-run produces same node count');
}

// ---- Result ----

console.log(`animationTree_migration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
