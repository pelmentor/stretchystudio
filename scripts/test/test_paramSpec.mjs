// Tests for src/io/live2d/rig/paramSpec.js — Stage 1 (parameters native rig).
// Run: node scripts/test_paramSpec.mjs
// Exits non-zero on first failure.
//
// Core invariant being tested: after `seedParameters(project)`, the
// `buildParameterSpec({ baseParameters: project.parameters })` output
// equals the original generator-path output. This is the Stage 1 "diff
// harness" — equivalence is what gates the merge.

import {
  buildParameterSpec,
  seedParameters,
} from '../../src/io/live2d/rig/paramSpec.js';

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

// --- Test fixture: synthetic project covering all parameter sources ---

function makeFixture() {
  // A mesh with a variant suffix → triggers ParamSmile.
  // A mesh with jointBoneId + boneWeights → triggers ParamRotation_<bone>.
  // Plain groups → trigger ParamRotation_<group> (when generateRig).
  // One torso-role group → skipped (SKIP_ROTATION_ROLES).
  const groups = [
    { id: 'g_head',  type: 'group', name: 'head',  boneRole: null },
    { id: 'g_torso', type: 'group', name: 'torso', boneRole: 'torso' },
    { id: 'g_arm',   type: 'group', name: 'rightArm', boneRole: null },
  ];

  const nodes = [
    ...groups,
    {
      id: 'm_face', type: 'part', visible: true, mesh: { vertices: [], uvs: [], triangles: [] },
      variantSuffix: null,
    },
    {
      id: 'm_face_smile', type: 'part', visible: true, mesh: { vertices: [], uvs: [], triangles: [] },
      variantSuffix: 'smile',
    },
    {
      id: 'm_arm', type: 'part', visible: true,
      mesh: { vertices: [], uvs: [], triangles: [], jointBoneId: 'g_arm', boneWeights: [[1, 0]] },
      variantSuffix: null,
    },
  ];

  return { nodes, parameters: [] };
}

function generatorPathSpec(project) {
  const meshes = project.nodes.filter(n => n.type === 'part' && n.mesh && n.visible !== false);
  const groups = project.nodes.filter(n => n.type === 'group');
  return buildParameterSpec({
    baseParameters: [],
    meshes: meshes.map(n => ({
      variantSuffix: n.variantSuffix,
      jointBoneId: n.mesh?.jointBoneId,
      boneWeights: n.mesh?.boneWeights,
    })),
    groups,
    generateRig: true,
  });
}

// --- Generator path produces expected shape ---

{
  const project = makeFixture();
  const spec = generatorPathSpec(project);
  const ids = spec.map(s => s.id);

  assert(ids[0] === 'ParamOpacity', 'opacity is index 0');
  assert(ids.includes('ParamSmile'), 'variant suffix produces ParamSmile');
  assert(ids.includes('ParamAngleX'), 'standard ParamAngleX present (generateRig)');
  assert(ids.includes('ParamRotation_rightArm'), 'bone produces ParamRotation_rightArm');
  assert(ids.includes('ParamRotation_head'), 'non-bone group produces ParamRotation_head');
  assert(!ids.includes('ParamRotation_torso'), 'torso role skipped');

  const smile = spec.find(s => s.id === 'ParamSmile');
  assert(smile && smile.role === 'variant' && smile.variantSuffix === 'smile', 'variant role + suffix set');

  const arm = spec.find(s => s.id === 'ParamRotation_rightArm');
  assert(arm && arm.role === 'bone' && arm.boneId === 'g_arm', 'bone role + boneId set');

  const head = spec.find(s => s.id === 'ParamRotation_head');
  assert(head && head.role === 'rotation_deformer' && head.groupId === 'g_head', 'rotation_deformer role + groupId set');
}

// --- Equivalence: seedParameters then native path === generator path ---

{
  const project = makeFixture();
  const generatorSpec = generatorPathSpec(project);

  seedParameters(project);  // mutates project.parameters
  assert(Array.isArray(project.parameters) && project.parameters.length > 1, 'seeded parameters non-empty');

  // Native path (after seed): build with baseParameters = project.parameters.
  const nativeSpec = buildParameterSpec({
    baseParameters: project.parameters,
    // meshes/groups intentionally not passed — native path must ignore them.
    generateRig: true,
  });

  assertEq(nativeSpec, generatorSpec, 'EQUIVALENCE: native path == generator path after seed');
}

// --- Native path does NOT synthesize when meshes/groups are passed ---

{
  // Even with meshes that would trigger variant params, native path skips
  // synthesis. The seeded baseParameters is authoritative.
  const project = makeFixture();
  seedParameters(project);

  const meshesWithExtraVariant = [
    ...project.nodes.filter(n => n.type === 'part').map(n => ({
      variantSuffix: n.variantSuffix,
      jointBoneId: n.mesh?.jointBoneId, boneWeights: n.mesh?.boneWeights,
    })),
    // A NEW variant the seeded list doesn't know about. Native path
    // ignores meshes entirely, so this would-be ParamSad is NOT added.
    { variantSuffix: 'sad', jointBoneId: null, boneWeights: null },
  ];
  const nativeSpec = buildParameterSpec({
    baseParameters: project.parameters,
    meshes: meshesWithExtraVariant,
    groups: project.nodes.filter(n => n.type === 'group'),
    generateRig: true,
  });

  assert(!nativeSpec.some(s => s.id === 'ParamSad'), 'native path ignores new mesh — no ParamSad synthesized');
}

// --- ParamOpacity is always at index 0, prepended if missing from baseParameters ---

{
  // baseParameters lacking opacity → opacity prepended.
  const baseWithoutOpacity = [
    { id: 'ParamCustom', name: 'Custom', min: 0, max: 1, default: 0, role: 'project' },
  ];
  const spec = buildParameterSpec({ baseParameters: baseWithoutOpacity });
  assertEq(spec.map(s => s.id), ['ParamOpacity', 'ParamCustom'], 'opacity prepended when missing');

  // baseParameters with opacity already → not duplicated.
  const baseWithOpacity = [
    { id: 'ParamOpacity', name: 'Opacity', min: 0, max: 1, default: 1, decimalPlaces: 1, repeat: false, role: 'opacity' },
    { id: 'ParamCustom', name: 'Custom', min: 0, max: 1, default: 0, role: 'project' },
  ];
  const spec2 = buildParameterSpec({ baseParameters: baseWithOpacity });
  assertEq(spec2.map(s => s.id), ['ParamOpacity', 'ParamCustom'], 'opacity not duplicated when present');
}

// --- Legacy partial-shape baseParameters get sensible defaults ---

{
  // Older saves might have parameters without role/decimalPlaces. After
  // Stage 1 these go through normaliseStoredParameter — defaults are
  // role='project', decimalPlaces=3, repeat=false.
  const partialShape = [
    { id: 'ParamLegacy', name: 'Legacy', min: -1, max: 1, default: 0 },
  ];
  const spec = buildParameterSpec({ baseParameters: partialShape });
  const legacy = spec.find(s => s.id === 'ParamLegacy');
  assertEq(legacy.role, 'project', 'legacy partial: role default project');
  assertEq(legacy.decimalPlaces, 3, 'legacy partial: decimalPlaces default 3');
  assertEq(legacy.repeat, false, 'legacy partial: repeat default false');
}

// --- Native path is order-preserving ---

{
  const ordered = [
    { id: 'ParamA', name: 'A', min: 0, max: 1, default: 0, role: 'project' },
    { id: 'ParamB', name: 'B', min: 0, max: 1, default: 0, role: 'project' },
    { id: 'ParamC', name: 'C', min: 0, max: 1, default: 0, role: 'project' },
  ];
  const spec = buildParameterSpec({ baseParameters: ordered });
  assertEq(spec.map(s => s.id), ['ParamOpacity', 'ParamA', 'ParamB', 'ParamC'], 'order preserved through native path');
}

// --- Empty baseParameters takes generator path even without generateRig ---

{
  const spec = buildParameterSpec({ baseParameters: [], meshes: [], groups: [], generateRig: false });
  assertEq(spec.map(s => s.id), ['ParamOpacity'], 'empty + no generateRig: only opacity');
}

// --- Round-trip: seed → JSON.stringify → JSON.parse → use as baseParameters ---

{
  // Simulates what happens across a save/load cycle.
  const project = makeFixture();
  const generatorSpec = generatorPathSpec(project);

  seedParameters(project);
  const serialized = JSON.stringify(project.parameters);
  const deserialized = JSON.parse(serialized);

  const afterRoundTrip = buildParameterSpec({ baseParameters: deserialized });
  assertEq(afterRoundTrip, generatorSpec, 'ROUND-TRIP: JSON serialize/parse preserves spec');
}

// --- seedParameters is repeatable ---

{
  // Calling seed twice in a row produces the same result. (Different from
  // re-seed after user edits, which intentionally overwrites — that's a
  // UX concern, not a function-level one.)
  const project = makeFixture();
  seedParameters(project);
  const first = JSON.stringify(project.parameters);
  seedParameters(project);
  const second = JSON.stringify(project.parameters);
  assertEq(first, second, 'seedParameters is deterministic across calls');
}

// --- 2026-06-11 audit I2/I3 — unweighted-bone path coverage ---
// Pre-2026-06-11 paramSpec emitted ParamRotation_<bone> ONLY for bones
// with a weighted mesh. cbce63f's second pass emits one for every bone
// with `boneRole` (excluding SKIP_ROTATION_ROLES + subsystem opt-outs).
// The audit flagged that no fixture exercised an unweighted bone going
// through the full generator → seed → native equivalence cycle. These
// tests close that gap.

{
  // §6a — unweighted bone with non-skip boneRole gets ParamRotation_<bone>.
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'g_left_arm', type: 'group', name: 'leftArm', boneRole: 'leftArm' },
      // No mesh references g_left_arm — pre-fix this bone got NO param.
      { id: 'm_face', type: 'part', visible: true,
        mesh: { vertices: [], uvs: [], triangles: [] },
        variantSuffix: null },
    ],
    parameters: [],
  };
  const spec = generatorPathSpec(project);
  const ids = spec.map(s => s.id);
  assert(ids.includes('ParamRotation_leftArm'),
    '§6a — unweighted bone with boneRole produces ParamRotation_<bone> (audit I2)');
  const arm = spec.find(s => s.id === 'ParamRotation_leftArm');
  assert(arm && arm.role === 'bone' && arm.boneId === 'g_left_arm',
    '§6a — role=bone + boneId set on unweighted-bone param');
}

{
  // §6b — SKIP_ROTATION_ROLES (torso/eyes/neck) excluded from second
  // pass even when no weighted mesh exists.
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'g_torso', type: 'group', name: 'torso', boneRole: 'torso' },
      { id: 'g_eyes', type: 'group', name: 'eyes', boneRole: 'eyes' },
      { id: 'g_neck', type: 'group', name: 'neck', boneRole: 'neck' },
      { id: 'g_head', type: 'group', name: 'head', boneRole: 'head' },
      { id: 'm_face', type: 'part', visible: true,
        mesh: { vertices: [], uvs: [], triangles: [] }, variantSuffix: null },
    ],
    parameters: [],
  };
  const spec = generatorPathSpec(project);
  const ids = spec.map(s => s.id);
  assert(!ids.includes('ParamRotation_torso'),
    '§6b — torso role skipped (SKIP_ROTATION_ROLES)');
  assert(!ids.includes('ParamRotation_eyes'),
    '§6b — eyes role skipped');
  assert(!ids.includes('ParamRotation_neck'),
    '§6b — neck role skipped');
  assert(ids.includes('ParamRotation_head'),
    '§6b — head role NOT skipped (not in SKIP_ROTATION_ROLES) — gets param');
}

{
  // §6c — full equivalence cycle through seedParameters → native path
  // works for unweighted bones too. Catches the regression "second
  // pass fires in generator but stored params don't round-trip".
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'g_left_arm', type: 'group', name: 'leftArm', boneRole: 'leftArm' },
      { id: 'g_right_arm', type: 'group', name: 'rightArm', boneRole: 'rightArm' },
      { id: 'g_torso', type: 'group', name: 'torso', boneRole: 'torso' },
      // Mesh weighted to leftArm — first pass picks it up.
      { id: 'm_arm', type: 'part', visible: true,
        mesh: { vertices: [], uvs: [], triangles: [],
                jointBoneId: 'g_left_arm', boneWeights: [[1, 0]] },
        variantSuffix: null },
      // No mesh references g_right_arm — second pass picks it up.
    ],
    parameters: [],
  };
  const generatorSpec = generatorPathSpec(project);
  const genIds = generatorSpec.map(s => s.id);
  assert(genIds.includes('ParamRotation_leftArm'),
    '§6c — first pass (weighted): ParamRotation_leftArm');
  assert(genIds.includes('ParamRotation_rightArm'),
    '§6c — second pass (unweighted): ParamRotation_rightArm');

  seedParameters(project);
  const nativeSpec = buildParameterSpec({
    baseParameters: project.parameters,
    generateRig: true,
  });
  assertEq(nativeSpec, generatorSpec,
    '§6c — EQUIVALENCE: native path == generator path with unweighted-bone params (audit I3)');
}

{
  // §6d — subsystem opt-out filters second-pass bones too.
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'g_hair_root', type: 'group', name: 'hair_root', boneRole: 'head' },
      { id: 'g_shirt', type: 'group', name: 'shirt', boneRole: 'head' },
      { id: 'g_arm', type: 'group', name: 'leftArm', boneRole: 'leftArm' },
      { id: 'm_face', type: 'part', visible: true,
        mesh: { vertices: [], uvs: [], triangles: [] }, variantSuffix: null },
    ],
    parameters: [],
    autoRigConfig: { subsystems: { hairRig: false, clothingRig: false } },
  };
  const meshes = project.nodes.filter(n => n.type === 'part' && n.mesh && n.visible !== false);
  const groups = project.nodes.filter(n => n.type === 'group');
  const spec = buildParameterSpec({
    baseParameters: [],
    meshes: meshes.map(n => ({
      variantSuffix: n.variantSuffix,
      jointBoneId: n.mesh?.jointBoneId,
      boneWeights: n.mesh?.boneWeights,
    })),
    groups,
    generateRig: true,
    subsystems: project.autoRigConfig.subsystems,
  });
  const ids = spec.map(s => s.id);
  assert(!ids.includes('ParamRotation_hair_root'),
    '§6d — hairRig=false drops ParamRotation_hair_root from second pass');
  assert(!ids.includes('ParamRotation_shirt'),
    '§6d — clothingRig=false drops ParamRotation_shirt from second pass');
  assert(ids.includes('ParamRotation_leftArm'),
    '§6d — unrelated bone (leftArm) still emitted');
}

// --- Summary ---

console.log(`paramSpec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
