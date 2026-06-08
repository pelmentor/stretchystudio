// Tests for src/io/live2d/moc3/meshBindingPlan.js
//
// Regression coverage for the v49 variant-opacity bug: post-v49 variants
// carry `part.opacity = 0` (runtime rest marker). Pre-fix the moc3
// meshBindingPlan read `[0, part.opacity ?? 1]` for the variant fade-in,
// which evaluated to `[0, 0]` and made variants invisible at every slider
// value in the exported moc3 (worked in SS because the runtime depgraph
// uses the rigSpec.artMeshes keyforms which hardcode 0/1 like cmo3).
//
// Run: node scripts/test/test_meshBindingPlan.mjs

import { buildMeshBindingPlan } from '../../src/io/live2d/moc3/meshBindingPlan.js';

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
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${e}`);
  console.error(`  actual:   ${a}`);
}

const BACKDROP = new Set(['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair']);

function makeMesh(numVerts = 3) {
  const verts = [];
  for (let i = 0; i < numVerts; i++) verts.push({ x: i * 10, y: i * 10 });
  return {
    vertices: verts,
    triangles: [[0, 1, 2]],
  };
}

// ─── Variant fade-in: opacity must ramp [0, 1] regardless of part.opacity ───

{
  const baseFace = {
    id: 'face_base', name: 'face', type: 'part',
    visible: true, opacity: 1, mesh: makeMesh(),
    variantSuffix: null, variantOf: null,
  };
  const variantFace = {
    id: 'face_smile', name: 'face.smile', type: 'part',
    visible: true,
    opacity: 0,  // v49 runtime-rest marker
    mesh: makeMesh(),
    variantSuffix: 'smile',
    variantOf: 'face_base',
  };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [baseFace, variantFace],
    groups: [],
    rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: BACKDROP,
  });

  // base is backdrop tag 'face' → skips base-fade → default 1-keyform ParamOpacity[1]
  assertEq(meshBindingPlan[0].paramId, 'ParamOpacity', 'backdrop base → ParamOpacity');
  assertEq(meshBindingPlan[0].keyformOpacities, [1], 'backdrop base → opacity [1]');

  // variant face.smile → 2-keyform on ParamSmile, opacities [0, 1] (NOT [0, 0])
  assertEq(meshBindingPlan[1].paramId, 'ParamSmile', 'variant → ParamSmile');
  assertEq(meshBindingPlan[1].keys, [0, 1], 'variant → keys [0,1]');
  assertEq(meshBindingPlan[1].keyformOpacities, [0, 1],
    'variant fade-in peak is 1 (not part.opacity=0) — v49 regression guard');
}

// ─── Base fade-out for non-backdrop tag: opacity [1, 0] ───

{
  const baseHair = {
    id: 'hair_base', name: 'side hair', type: 'part',
    visible: true, opacity: 1, mesh: makeMesh(),
    variantSuffix: null,
  };
  const variantHair = {
    id: 'hair_alt', name: 'side hair.alt', type: 'part',
    visible: true, opacity: 0, mesh: makeMesh(),
    variantSuffix: 'alt',
    variantOf: 'hair_base',
  };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [baseHair, variantHair],
    groups: [],
    rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: BACKDROP,
  });

  // 'side hair' is NOT a backdrop tag → base-fade emits [1, 0] on ParamAlt
  assertEq(meshBindingPlan[0].paramId, 'ParamAlt', 'non-backdrop base → ParamAlt');
  assertEq(meshBindingPlan[0].keyformOpacities, [1, 0], 'base fade-out hardcoded [1,0]');
  // Variant
  assertEq(meshBindingPlan[1].keyformOpacities, [0, 1], 'variant fade-in hardcoded [0,1]');
}

// ─── Default branch: single ParamOpacity[1] keyform ───

{
  const plainPart = {
    id: 'p', name: 'random', type: 'part',
    visible: true, opacity: 1, mesh: makeMesh(),
  };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [plainPart],
    groups: [],
    rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: BACKDROP,
  });
  assertEq(meshBindingPlan[0].paramId, 'ParamOpacity', 'plain → ParamOpacity');
  assertEq(meshBindingPlan[0].keys, [1], 'plain → keys [1]');
  assertEq(meshBindingPlan[0].keyformOpacities, [1], 'plain → opacity [1]');
}

// ─── Eye closure: both keyforms opacity 1 ───

{
  const eyewhite = {
    id: 'ew_l', name: 'eyewhite-l', type: 'part',
    visible: true, opacity: 1, mesh: makeMesh(),
  };
  const rigSpec = {
    eyeClosure: new Map([[
      'ew_l',
      {
        closureSide: 'l',
        closedCanvasVerts: new Float32Array([0,0, 5,0, 10,0]),
      },
    ]]),
  };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [eyewhite],
    groups: [],
    rigSpec,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: BACKDROP,
  });
  assertEq(meshBindingPlan[0].paramId, 'ParamEyeLOpen', 'eye closure → ParamEyeLOpen');
  assertEq(meshBindingPlan[0].keys, [0, 1], 'eye closure → keys [0,1]');
  assertEq(meshBindingPlan[0].keyformOpacities, [1, 1], 'eye closure → opacities [1,1]');
}

// ─── Bone-baked: all 5 keyforms opacity 1 ───

{
  const armBone = {
    id: 'bone_arm', name: 'leftArm', type: 'group',
    transform: { pivotX: 100, pivotY: 200 },
  };
  const armPart = {
    id: 'arm_part', name: 'arm', type: 'part',
    visible: true, opacity: 1,
    mesh: { vertices: [{x:100,y:200},{x:150,y:200}], boneWeights: [1, 1], jointBoneId: 'bone_arm' },
  };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [armPart],
    groups: [armBone],
    rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: BACKDROP,
  });
  assertEq(meshBindingPlan[0].paramId, 'ParamRotation_leftArm', 'bone-baked param id');
  assertEq(meshBindingPlan[0].keyformOpacities, [1, 1, 1, 1, 1], 'bone-baked → all 1');
}

console.log(`meshBindingPlan: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
