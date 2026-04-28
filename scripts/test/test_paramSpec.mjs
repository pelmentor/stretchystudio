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
      variantSuffix: null, variantRole: null,
    },
    {
      id: 'm_face_smile', type: 'part', visible: true, mesh: { vertices: [], uvs: [], triangles: [] },
      variantSuffix: 'smile', variantRole: null,
    },
    {
      id: 'm_arm', type: 'part', visible: true,
      mesh: { vertices: [], uvs: [], triangles: [], jointBoneId: 'g_arm', boneWeights: [[1, 0]] },
      variantSuffix: null, variantRole: null,
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
      variantRole: n.variantRole,
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
      variantSuffix: n.variantSuffix, variantRole: n.variantRole,
      jointBoneId: n.mesh?.jointBoneId, boneWeights: n.mesh?.boneWeights,
    })),
    // A NEW variant the seeded list doesn't know about. Native path
    // ignores meshes entirely, so this would-be ParamSad is NOT added.
    { variantSuffix: 'sad', variantRole: null, jointBoneId: null, boneWeights: null },
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

// --- Summary ---

console.log(`paramSpec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
