// Tests for src/io/live2d/rig/physicsConfig.js — Stage 6 (physics rules).
// Run: node scripts/test_physicsConfig.mjs
// Exits non-zero on first failure.

import {
  DEFAULT_PHYSICS_RULES,
  buildPhysicsRulesFromProject,
  resolvePhysicsRules,
  seedPhysicsRules,
} from '../../src/io/live2d/rig/physicsConfig.js';

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

// --- DEFAULT_PHYSICS_RULES contract ---

{
  assert(Array.isArray(DEFAULT_PHYSICS_RULES), 'DEFAULT_PHYSICS_RULES is array');
  assert(DEFAULT_PHYSICS_RULES.length === 7, 'DEFAULT_PHYSICS_RULES has 7 entries');
  const ids = DEFAULT_PHYSICS_RULES.map(r => r.id);
  assert(ids.includes('PhysicsSetting1'), 'has PhysicsSetting1 (Hair Front)');
  assert(ids.includes('PhysicsSetting_ArmSnake'), 'has Arm Snake');
}

// --- buildPhysicsRulesFromProject: outputs[] resolution ---

{
  const project = { nodes: [] };
  const rules = buildPhysicsRulesFromProject(project);
  assertEq(rules.length, DEFAULT_PHYSICS_RULES.length, 'all rules returned');

  // Hair Front (rule 0): outputParamId=ParamHairFront → outputs[0].paramId=ParamHairFront
  const hairFront = rules.find(r => r.id === 'PhysicsSetting1');
  assert(hairFront, 'Hair Front present');
  assertEq(hairFront.outputs.length, 1, 'Hair Front has 1 output');
  assertEq(hairFront.outputs[0].paramId, 'ParamHairFront', 'Hair Front output paramId');
  assertEq(hairFront.outputs[0].vertexIndex, 1, 'Hair Front output vertexIndex = last');
  assertEq(hairFront.outputs[0].scale, 1.522, 'Hair Front output scale');
}

// --- buildPhysicsRulesFromProject: boneOutputs resolved against groups ---

{
  // Project with two arm groups (boneRole). Arm Snake rule has 2 boneOutputs.
  const project = {
    nodes: [
      { id: 'g_left', type: 'group', name: 'leftElbowDeformer', boneRole: 'leftElbow' },
      { id: 'g_right', type: 'group', name: 'rightElbowDeformer', boneRole: 'rightElbow' },
    ],
  };
  const rules = buildPhysicsRulesFromProject(project);
  const armRule = rules.find(r => r.id === 'PhysicsSetting_ArmSnake');
  assert(armRule, 'Arm Snake present');
  assertEq(armRule.outputs.length, 2, 'Arm Snake has 2 outputs (left + right)');
  const paramIds = armRule.outputs.map(o => o.paramId);
  assert(paramIds.includes('ParamRotation_leftElbowDeformer'), 'left elbow paramId');
  assert(paramIds.includes('ParamRotation_rightElbowDeformer'), 'right elbow paramId');
  // Right side has isReverse: true
  const rightOutput = armRule.outputs.find(o => o.paramId === 'ParamRotation_rightElbowDeformer');
  assertEq(rightOutput.isReverse, true, 'right output has isReverse=true');
  assertEq(rightOutput.scale, 4.0, 'right output scale=4');
}

// --- buildPhysicsRulesFromProject: no boneRole groups → empty boneOutputs ---

{
  const project = { nodes: [] };
  const rules = buildPhysicsRulesFromProject(project);
  const armRule = rules.find(r => r.id === 'PhysicsSetting_ArmSnake');
  assertEq(armRule.outputs.length, 0, 'Arm Snake with no groups → no outputs');
}

// --- buildPhysicsRulesFromProject: non-bone rule unchanged by groups ---

{
  const project = { nodes: [{ id: 'g', type: 'group', name: 'foo', boneRole: 'leftElbow' }] };
  const rules = buildPhysicsRulesFromProject(project);
  const skirt = rules.find(r => r.id === 'PhysicsSetting3');
  assertEq(skirt.outputs.length, 1, 'Skirt: 1 output (no boneOutputs in spec)');
  assertEq(skirt.outputs[0].paramId, 'ParamSkirt', 'Skirt output unchanged');
}

// --- resolvePhysicsRules: populated → return as-is ---

{
  const project = {
    nodes: [],
    physicsRules: [{ id: 'CUSTOM', outputs: [], inputs: [], vertices: [], normalization: {} }],
  };
  const result = resolvePhysicsRules(project);
  assertEq(result.length, 1, 'populated physicsRules returned as-is');
  assertEq(result[0].id, 'CUSTOM', 'custom rule preserved');
}

// --- resolvePhysicsRules: empty → build ---

{
  const project = { nodes: [], physicsRules: [] };
  const result = resolvePhysicsRules(project);
  assertEq(result.length, DEFAULT_PHYSICS_RULES.length, 'empty → built from defaults');
}

// --- seedPhysicsRules: writes + destructive ---

{
  const project = {
    nodes: [
      { id: 'g_left', type: 'group', name: 'leftElbow', boneRole: 'leftElbow' },
      { id: 'g_right', type: 'group', name: 'rightElbow', boneRole: 'rightElbow' },
    ],
    physicsRules: [{ id: 'OLD' }],
  };
  seedPhysicsRules(project);
  assert(!project.physicsRules.some(r => r.id === 'OLD'), 'destructive: old wiped');
  assertEq(project.physicsRules.length, DEFAULT_PHYSICS_RULES.length, 'all defaults seeded');
  const armRule = project.physicsRules.find(r => r.id === 'PhysicsSetting_ArmSnake');
  assertEq(armRule.outputs.length, 2, 'arm outputs resolved at seed time');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  // After seeding, resolvePhysicsRules returns identical to a fresh build.
  const project = {
    nodes: [
      { id: 'g_left', type: 'group', name: 'leftElbowDef', boneRole: 'leftElbow' },
      { id: 'g_right', type: 'group', name: 'rightElbowDef', boneRole: 'rightElbow' },
    ],
  };
  const generatorRules = buildPhysicsRulesFromProject(project);

  seedPhysicsRules(project);
  const seededRules = resolvePhysicsRules(project);

  assertEq(seededRules, generatorRules, 'EQUIVALENCE: seeded path == generator path');
}

// --- Round-trip: seed → JSON → use ---

{
  const project = { nodes: [] };
  const before = buildPhysicsRulesFromProject(project);
  seedPhysicsRules(project);
  const serialized = JSON.stringify(project.physicsRules);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { ...project, physicsRules: reloaded };
  const after = resolvePhysicsRules(reloadedProject);
  assertEq(after, before, 'ROUND-TRIP: JSON serialize preserves rules');
}

// --- All rules have required structural fields ---

{
  const project = { nodes: [] };
  const rules = buildPhysicsRulesFromProject(project);
  for (const rule of rules) {
    assert(rule.id, `${rule.id || '?'}: has id`);
    assert(rule.name, `${rule.id}: has name`);
    assert(rule.category, `${rule.id}: has category`);
    assert(Array.isArray(rule.inputs), `${rule.id}: inputs array`);
    assert(Array.isArray(rule.vertices), `${rule.id}: vertices array`);
    assert(Array.isArray(rule.outputs), `${rule.id}: outputs array`);
    assert(rule.normalization, `${rule.id}: has normalization`);
    assert('posMin' in rule.normalization, `${rule.id}: normalization.posMin`);
  }
}

// --- Summary ---

console.log(`physicsConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
