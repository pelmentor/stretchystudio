// End-to-end equivalence test across all migrated subsystems (Stage 1a + 3 + 6 + 7).
//
// Per-subsystem unit tests prove "seeded == generator" PER SUBSYSTEM. This
// test proves they all compose correctly: a fully-seeded project produces
// the same JSON outputs from physics3 / cdi3 / model3 generators as an
// unseeded project. If this test fails, the seed→re-export round-trip is
// broken even though individual subsystems pass their unit tests.
//
// Run: node scripts/test_e2e_equivalence.mjs

import { buildParameterSpec, seedParameters } from '../../src/io/live2d/rig/paramSpec.js';
import { resolveMaskConfigs, seedMaskConfigs } from '../../src/io/live2d/rig/maskConfigs.js';
import { resolvePhysicsRules, seedPhysicsRules } from '../../src/io/live2d/rig/physicsConfig.js';
import { resolveBoneConfig, seedBoneConfig } from '../../src/io/live2d/rig/boneConfig.js';
import {
  resolveVariantFadeRules,
  seedVariantFadeRules,
} from '../../src/io/live2d/rig/variantFadeRules.js';
import {
  resolveEyeClosureConfig,
  seedEyeClosureConfig,
} from '../../src/io/live2d/rig/eyeClosureConfig.js';
import {
  resolveRotationDeformerConfig,
  seedRotationDeformerConfig,
} from '../../src/io/live2d/rig/rotationDeformerConfig.js';
import { generatePhysics3Json } from '../../src/io/live2d/physics3json.js';
import { generateCdi3Json } from '../../src/io/live2d/cdi3json.js';
import { migrateProject } from '../../src/store/projectMigrations.js';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  // Find first divergence for easier debugging
  const minLen = Math.min(a.length, e.length);
  let i = 0;
  while (i < minLen && a[i] === e[i]) i++;
  console.error(`  divergence at char ${i}:`);
  console.error(`  expected: ${e.slice(Math.max(0, i - 30), i + 70)}`);
  console.error(`  actual:   ${a.slice(Math.max(0, i - 30), i + 70)}`);
}

// --- Build a representative synthetic project covering all migrated subsystems ---
//
// Mesh inventory mirrors a typical Hiyori-style PSD: face + variant face,
// front/back hair, irides L/R + variant smile irides, eyewhite L/R + variant
// smile eyewhite, mouth, eyebrows, topwear, bottomwear, two arm groups
// with bone roles. This exercises:
//   - parameters (variants → ParamSmile, bones → ParamRotation_*)
//   - mask configs (irides↔eyewhite, variant-aware)
//   - physics rules (hair tags trigger PhysicsSetting1/2, topwear → 4/6,
//     bottomwear → 3, handwear → ArmSnake, etc.)
//   - bone config (arm rotation params)

function meshNode(id, name, tag, opts = {}) {
  return {
    id,
    type: 'part',
    name,
    visible: true,
    tag,
    mesh: opts.mesh ?? {
      vertices: [0, 0, 1, 0, 1, 1, 0, 1],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      jointBoneId: opts.jointBoneId,
      boneWeights: opts.boneWeights,
    },
    variantSuffix: opts.variantSuffix ?? null,
    variantRole: opts.variantRole ?? null,
  };
}
function groupNode(id, name, opts = {}) {
  return {
    id,
    type: 'group',
    name,
    boneRole: opts.boneRole ?? null,
  };
}

function buildSyntheticProject() {
  const project = {
    schemaVersion: 0,
    canvas: { width: 1024, height: 1024 },
    nodes: [
      // groups
      groupNode('g_face', 'face_group'),
      groupNode('g_hair', 'hair_group'),
      groupNode('g_body', 'body_group'),
      groupNode('g_left_elbow', 'leftElbowDeformer', { boneRole: 'leftElbow' }),
      groupNode('g_right_elbow', 'rightElbowDeformer', { boneRole: 'rightElbow' }),

      // meshes
      meshNode('m_face', 'face', 'face'),
      meshNode('m_face_smile', 'face.smile', 'face', { variantSuffix: 'smile' }),
      meshNode('m_front_hair', 'front_hair_layer', 'front hair'),
      meshNode('m_back_hair', 'back_hair_layer', 'back hair'),
      meshNode('m_irides_l', 'irides-l', 'irides-l'),
      meshNode('m_irides_r', 'irides-r', 'irides-r'),
      meshNode('m_irides_l_smile', 'irides-l.smile', 'irides-l', { variantSuffix: 'smile' }),
      meshNode('m_irides_r_smile', 'irides-r.smile', 'irides-r', { variantSuffix: 'smile' }),
      meshNode('m_eyewhite_l', 'eyewhite-l', 'eyewhite-l'),
      meshNode('m_eyewhite_r', 'eyewhite-r', 'eyewhite-r'),
      meshNode('m_eyewhite_l_smile', 'eyewhite-l.smile', 'eyewhite-l', { variantSuffix: 'smile' }),
      meshNode('m_eyewhite_r_smile', 'eyewhite-r.smile', 'eyewhite-r', { variantSuffix: 'smile' }),
      meshNode('m_mouth', 'mouth', 'mouth'),
      meshNode('m_topwear', 'shirt', 'topwear'),
      meshNode('m_bottomwear', 'skirt', 'bottomwear'),
      meshNode('m_handwear_l', 'handwear-l', 'handwear-l',
        { jointBoneId: 'g_left_elbow', boneWeights: [[1, 0]] }),
      meshNode('m_handwear_r', 'handwear-r', 'handwear-r',
        { jointBoneId: 'g_right_elbow', boneWeights: [[1, 0]] }),
    ],
    parameters: [],
    physics_groups: [],
    animations: [],
  };
  migrateProject(project); // bring up to current schema version
  return project;
}

// --- Compute the export-time outputs for a project ---
// Only the JSON outputs that are pure-JS (no browser deps).

function computeOutputs(project) {
  const meshes = project.nodes.filter(n => n.type === 'part' && n.mesh && n.visible !== false);
  const groups = project.nodes.filter(n => n.type === 'group');
  const boneCfg = resolveBoneConfig(project);
  const rotCfg  = resolveRotationDeformerConfig(project);

  const paramSpec = buildParameterSpec({
    baseParameters: project.parameters ?? [],
    meshes: meshes.map(n => ({
      variantSuffix: n.variantSuffix,
      variantRole: n.variantRole,
      jointBoneId: n.mesh?.jointBoneId,
      boneWeights: n.mesh?.boneWeights,
    })),
    groups,
    generateRig: true,
    bakedKeyformAngles: boneCfg.bakedKeyformAngles,
    rotationDeformerConfig: rotCfg,
  });

  const physicsRules = resolvePhysicsRules(project);
  const physics3 = generatePhysics3Json({
    paramDefs: paramSpec,
    meshes: meshes.map(m => ({ tag: m.tag })),
    rules: physicsRules,
    disabledCategories: null,
  });

  const cdi3 = generateCdi3Json({
    parameters: paramSpec.map(p => ({ id: p.id, name: p.name, groupId: p.groupId })),
    parts: groups.map(g => ({ id: g.id, name: g.name })),
  });

  const maskConfigs = resolveMaskConfigs(project);
  const variantFadeRules = resolveVariantFadeRules(project);
  const eyeClosureConfig = resolveEyeClosureConfig(project);
  const rotationDeformerConfig = rotCfg;

  return {
    paramSpec, physics3, cdi3, maskConfigs,
    variantFadeRules, eyeClosureConfig, rotationDeformerConfig,
  };
}

// --- Run the test ---

const projectA = buildSyntheticProject();
const generatorOutputs = computeOutputs(projectA);

const projectB = buildSyntheticProject();
seedParameters(projectB);
seedMaskConfigs(projectB);
seedPhysicsRules(projectB);
seedBoneConfig(projectB);
seedVariantFadeRules(projectB);
seedEyeClosureConfig(projectB);
seedRotationDeformerConfig(projectB);
const seededOutputs = computeOutputs(projectB);

// --- Sanity checks: outputs are non-trivial ---

assertEq(generatorOutputs.paramSpec.length > 5, true, 'generator path produced multiple params');
assertEq(generatorOutputs.physics3.PhysicsSettings.length > 0, true, 'generator path produced physics settings');
assertEq(generatorOutputs.maskConfigs.length > 0, true, 'generator path produced mask configs');

// --- Equivalence: each output identical between paths ---

assertEq(seededOutputs.paramSpec, generatorOutputs.paramSpec, 'paramSpec equivalent');
assertEq(seededOutputs.physics3, generatorOutputs.physics3, 'physics3.json equivalent');
assertEq(seededOutputs.cdi3, generatorOutputs.cdi3, 'cdi3.json equivalent');
assertEq(seededOutputs.maskConfigs, generatorOutputs.maskConfigs, 'maskConfigs equivalent');
assertEq(seededOutputs.variantFadeRules, generatorOutputs.variantFadeRules, 'variantFadeRules equivalent');
assertEq(seededOutputs.eyeClosureConfig, generatorOutputs.eyeClosureConfig, 'eyeClosureConfig equivalent');
assertEq(seededOutputs.rotationDeformerConfig, generatorOutputs.rotationDeformerConfig, 'rotationDeformerConfig equivalent');

// --- Detailed inventory checks (catches silent test passes) ---

const paramIds = generatorOutputs.paramSpec.map(p => p.id);
assertEq(paramIds.includes('ParamOpacity'), true, 'has ParamOpacity');
assertEq(paramIds.includes('ParamSmile'), true, 'variant param ParamSmile');
assertEq(paramIds.includes('ParamAngleX'), true, 'standard param ParamAngleX');
assertEq(paramIds.includes('ParamRotation_leftElbowDeformer'), true, 'bone param left');
assertEq(paramIds.includes('ParamRotation_rightElbowDeformer'), true, 'bone param right');

const physicsIds = generatorOutputs.physics3.PhysicsSettings.map(s => s.Id);
assertEq(physicsIds.includes('PhysicsSetting1'), true, 'Hair Front (front hair tag present)');
assertEq(physicsIds.includes('PhysicsSetting2'), true, 'Hair Back');
assertEq(physicsIds.includes('PhysicsSetting3'), true, 'Skirt');
assertEq(physicsIds.includes('PhysicsSetting_ArmSnake'), true, 'Arm Snake');

assertEq(generatorOutputs.maskConfigs.length, 4,
  'mask configs: 4 iris meshes (base L/R + smile L/R)');

// --- Round-trip through JSON serialization (save→load→export) ---

const seededSerialized = JSON.stringify({
  parameters: projectB.parameters,
  maskConfigs: projectB.maskConfigs,
  physicsRules: projectB.physicsRules,
  boneConfig: projectB.boneConfig,
  variantFadeRules: projectB.variantFadeRules,
  eyeClosureConfig: projectB.eyeClosureConfig,
  rotationDeformerConfig: projectB.rotationDeformerConfig,
});
const reloaded = JSON.parse(seededSerialized);
const projectC = buildSyntheticProject();
projectC.parameters = reloaded.parameters;
projectC.maskConfigs = reloaded.maskConfigs;
projectC.physicsRules = reloaded.physicsRules;
projectC.boneConfig = reloaded.boneConfig;
projectC.variantFadeRules = reloaded.variantFadeRules;
projectC.eyeClosureConfig = reloaded.eyeClosureConfig;
projectC.rotationDeformerConfig = reloaded.rotationDeformerConfig;

const reloadedOutputs = computeOutputs(projectC);
assertEq(reloadedOutputs.paramSpec, generatorOutputs.paramSpec, 'ROUND-TRIP: paramSpec via JSON');
assertEq(reloadedOutputs.physics3, generatorOutputs.physics3, 'ROUND-TRIP: physics3 via JSON');
assertEq(reloadedOutputs.cdi3, generatorOutputs.cdi3, 'ROUND-TRIP: cdi3 via JSON');
assertEq(reloadedOutputs.maskConfigs, generatorOutputs.maskConfigs, 'ROUND-TRIP: maskConfigs via JSON');
assertEq(reloadedOutputs.variantFadeRules, generatorOutputs.variantFadeRules, 'ROUND-TRIP: variantFadeRules via JSON');
assertEq(reloadedOutputs.eyeClosureConfig, generatorOutputs.eyeClosureConfig, 'ROUND-TRIP: eyeClosureConfig via JSON');
assertEq(reloadedOutputs.rotationDeformerConfig, generatorOutputs.rotationDeformerConfig, 'ROUND-TRIP: rotationDeformerConfig via JSON');

// --- Summary ---

console.log(`e2e equivalence: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
