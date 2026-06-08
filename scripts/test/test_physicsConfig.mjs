// Tests for src/io/live2d/rig/physicsConfig.js — post-v50 per-node
// physicsModifier port (Blender per-object physics parity, 2026-06-08).
//
// Old surfaces (resolvePhysicsRules / seedPhysicsRules) are retired —
// see git log for the pre-v50 version of this file.
//
// Run: node scripts/test/test_physicsConfig.mjs

import {
  DEFAULT_PHYSICS_RULES,
  buildPhysicsRulesFromProject,
  seedPhysicsModifiers,
  gatherPhysicsRules,
  installImportedPhysicsRules,
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

function countPhysicsModifiers(project) {
  let n = 0;
  for (const node of project?.nodes ?? []) {
    for (const m of node?.modifiers ?? []) {
      if (m && m.type === 'physicsModifier') n += 1;
    }
  }
  return n;
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

  const hairFront = rules.find(r => r.id === 'PhysicsSetting1');
  assert(hairFront, 'Hair Front present');
  assertEq(hairFront.outputs.length, 1, 'Hair Front has 1 output');
  assertEq(hairFront.outputs[0].paramId, 'ParamHairFront', 'Hair Front output paramId');
  assertEq(hairFront.outputs[0].vertexIndex, 1, 'Hair Front output vertexIndex = last');
  assertEq(hairFront.outputs[0].scale, 1.522, 'Hair Front output scale');
}

// --- buildPhysicsRulesFromProject: boneOutputs resolved against groups ---

{
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

// --- gatherPhysicsRules: empty project → empty ---

{
  const project = { nodes: [] };
  assertEq(gatherPhysicsRules(project), [], 'empty project → empty gather');
}

// --- seedPhysicsModifiers: attaches per-output modifiers on owner nodes ---

{
  // Single hair part + one bone for arm sway. Hair Front owns p-fh.
  // Arm Sway splits across left+right elbow.
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
      { id: 'p-shirt', name: 'topwear', type: 'part' },
      { id: 'p-skirt', name: 'bottomwear', type: 'part' },
      { id: 'g_left', name: 'leftElbow', type: 'group', boneRole: 'leftElbow' },
      { id: 'g_right', name: 'rightElbow', type: 'group', boneRole: 'rightElbow' },
    ],
  };
  seedPhysicsModifiers(project);

  // Hair Front lands on p-fh
  const fh = project.nodes.find(n => n.id === 'p-fh');
  assert(Array.isArray(fh.modifiers), 'p-fh has modifiers[]');
  const fhPhys = fh.modifiers.filter(m => m.type === 'physicsModifier');
  assert(fhPhys.length >= 1, 'p-fh has at least one physicsModifier');
  assert(fhPhys.some(m => m.ruleId === 'PhysicsSetting1'),
    'p-fh has Hair Front modifier');

  // Arm Sway lands on both elbows (split)
  const left = project.nodes.find(n => n.id === 'g_left');
  const right = project.nodes.find(n => n.id === 'g_right');
  assert(left.modifiers?.some(m => m.type === 'physicsModifier' && m.ruleId === 'PhysicsSetting_ArmSnake'),
    'left elbow has Arm Sway modifier');
  assert(right.modifiers?.some(m => m.type === 'physicsModifier' && m.ruleId === 'PhysicsSetting_ArmSnake'),
    'right elbow has Arm Sway modifier');

  // Each modifier carries a SINGLE output (the split semantic)
  const leftArm = left.modifiers.find(m => m.ruleId === 'PhysicsSetting_ArmSnake');
  assertEq(leftArm.output.paramId, 'ParamRotation_leftElbow', 'left arm output paramId');
  assertEq(leftArm.output.isReverse, false, 'left arm output not reversed');
  const rightArm = right.modifiers.find(m => m.ruleId === 'PhysicsSetting_ArmSnake');
  assertEq(rightArm.output.paramId, 'ParamRotation_rightElbow', 'right arm output paramId');
  assertEq(rightArm.output.isReverse, true, 'right arm output reversed');
}

// --- gatherPhysicsRules: re-merges per-ruleId after split ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
      { id: 'g_left', name: 'leftElbow', type: 'group', boneRole: 'leftElbow' },
      { id: 'g_right', name: 'rightElbow', type: 'group', boneRole: 'rightElbow' },
    ],
  };
  seedPhysicsModifiers(project);

  const rules = gatherPhysicsRules(project);
  const armRule = rules.find(r => r.id === 'PhysicsSetting_ArmSnake');
  assert(armRule, 'gather merges arm modifiers back into 1 rule');
  assertEq(armRule.outputs.length, 2, 'arm rule has 2 outputs after merge');
  const paramIds = armRule.outputs.map(o => o.paramId).sort();
  assertEq(paramIds, ['ParamRotation_leftElbow', 'ParamRotation_rightElbow'],
    'arm rule outputs cover both elbows');
}

// --- gatherPhysicsRules: skips disabled modifiers ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
    ],
  };
  seedPhysicsModifiers(project);
  const fh = project.nodes.find(n => n.id === 'p-fh');
  // Force-disable
  for (const m of fh.modifiers) m.enabled = false;
  assertEq(gatherPhysicsRules(project).length, 0, 'all disabled → 0 gathered');

  for (const m of fh.modifiers) m.enabled = true;
  assert(gatherPhysicsRules(project).length > 0, 're-enabled → gathered');
}

// --- seedPhysicsModifiers: subsystem opt-out (category-based) ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
      { id: 'p-shirt', name: 'topwear', type: 'part' },
    ],
    autoRigConfig: { subsystems: { hairRig: false } },
  };
  seedPhysicsModifiers(project);
  const rules = gatherPhysicsRules(project);
  const hairRules = rules.filter(r => r.category === 'hair');
  assertEq(hairRules.length, 0, 'hairRig=false → no hair rules seeded');
  const clothingRules = rules.filter(r => r.category === 'clothing');
  assert(clothingRules.length > 0, 'clothingRig still on → clothing seeded');
}

// --- seedPhysicsModifiers: replace mode wipes prior non-user-authored ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part', modifiers: [{
        type: 'physicsModifier', ruleId: 'OLD',
        inputs: [], vertices: [], normalization: {},
        output: { paramId: 'X', vertexIndex: 0, scale: 0, isReverse: false },
        enabled: true, mode: 7,
      }] },
    ],
  };
  seedPhysicsModifiers(project, 'replace');
  const fh = project.nodes.find(n => n.id === 'p-fh');
  assert(!fh.modifiers.some(m => m.ruleId === 'OLD'),
    'replace mode: prior modifier wiped');
  assert(fh.modifiers.some(m => m.ruleId === 'PhysicsSetting1'),
    'replace mode: default seeded');
}

// --- seedPhysicsModifiers: merge mode preserves _userAuthored ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part', modifiers: [{
        type: 'physicsModifier', ruleId: 'PhysicsSetting1',
        name: 'Hair Front',
        category: 'hair',
        inputs: [{ paramId: 'ParamAngleX', type: 'SRC_TO_X', weight: 99 }],
        vertices: [
          { x: 0, y: 0, mobility: 1, delay: 1, acceleration: 1, radius: 0 },
          { x: 0, y: 99, mobility: 1, delay: 1, acceleration: 1, radius: 99 },
        ],
        normalization: { posMin: -1, posMax: 1, posDef: 0, angleMin: -1, angleMax: 1, angleDef: 0 },
        output: { paramId: 'ParamHairFront', vertexIndex: 1, scale: 99, isReverse: false },
        enabled: true, mode: 7,
        _userAuthored: true,
      }] },
    ],
  };
  seedPhysicsModifiers(project, 'merge');
  const fh = project.nodes.find(n => n.id === 'p-fh');
  const hf = fh.modifiers.filter(m => m.ruleId === 'PhysicsSetting1');
  assertEq(hf.length, 1, 'merge: single Hair Front modifier');
  assertEq(hf[0].vertices[1].y, 99, 'merge: user-authored pendulum length preserved');
}

// --- installImportedPhysicsRules: project-wide install ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
      { id: 'g_root', name: 'rig_root', type: 'group' },
    ],
  };
  const imported = [{
    id: 'IMPORTED1',
    name: 'imported physics',
    category: 'imported',
    inputs: [{ paramId: 'ParamAngleX', type: 'SRC_TO_X', weight: 100 }],
    vertices: [
      { x: 0, y: 0, mobility: 1, delay: 1, acceleration: 1, radius: 0 },
      { x: 0, y: 5, mobility: 1, delay: 1, acceleration: 1, radius: 5 },
    ],
    normalization: { posMin: -10, posMax: 10, posDef: 0, angleMin: -10, angleMax: 10, angleDef: 0 },
    outputs: [{ paramId: 'ParamCustom', vertexIndex: 1, scale: 5, isReverse: false }],
    _userAuthored: true,
  }];
  const n = installImportedPhysicsRules(project, imported);
  assertEq(n, 1, 'installed 1 modifier');
  assertEq(countPhysicsModifiers(project), 1, 'one physicsModifier total');
  // Owner picker: no rotation match + no tag → root group
  const root = project.nodes.find(x => x.id === 'g_root');
  assert(root.modifiers?.some(m => m.ruleId === 'IMPORTED1'),
    'imported rule landed on root group');
}

// --- Round-trip: seed → gather identical to fresh build minus userAuthored bookkeeping ---

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
      { id: 'p-bh', name: 'back hair', type: 'part' },
      { id: 'p-shirt', name: 'topwear', type: 'part' },
      { id: 'p-skirt', name: 'bottomwear', type: 'part' },
      { id: 'p-pants', name: 'legwear', type: 'part' },
      { id: 'g_left', name: 'leftElbow', type: 'group', boneRole: 'leftElbow' },
      { id: 'g_right', name: 'rightElbow', type: 'group', boneRole: 'rightElbow' },
    ],
  };
  seedPhysicsModifiers(project);
  const rules = gatherPhysicsRules(project);
  // Skirt + Shirt + Pants + Bust + Hair Front + Hair Back + Arm Sway = 7
  assertEq(rules.length, 7, 'gather returns 7 baseline rules after seed');
  const ids = new Set(rules.map(r => r.id));
  for (const r of DEFAULT_PHYSICS_RULES) {
    assert(ids.has(r.id), `gather has ${r.id}`);
  }
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

console.log(`physicsConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
