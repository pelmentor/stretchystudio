// Tests for src/io/live2d/rig/rotationDeformerConfig.js — Stage 8
// (rotation deformer config: skipRotationRoles + paramAngleRange +
// groupRotation/faceRotation paramKey→angle mappings).
// Run: node scripts/test_rotationDeformerConfig.mjs

import {
  DEFAULT_ROTATION_DEFORMER_CONFIG,
  buildRotationDeformerConfigFromProject,
  resolveRotationDeformerConfig,
  seedRotationDeformerConfig,
} from '../../src/io/live2d/rig/rotationDeformerConfig.js';
import {
  buildFaceRotationSpec,
  buildGroupRotationSpec,
} from '../../src/io/live2d/rig/rotationDeformers.js';
import { buildParameterSpec } from '../../src/io/live2d/rig/paramSpec.js';

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

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// --- DEFAULT contract ---

{
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.skipRotationRoles,
    ['torso', 'eyes', 'neck'],
    'DEFAULT skipRotationRoles'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.paramAngleRange,
    { min: -30, max: 30 },
    'DEFAULT paramAngleRange'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.groupRotation.paramKeys,
    [-30, 0, 30],
    'DEFAULT groupRotation.paramKeys'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.groupRotation.angles,
    [-30, 0, 30],
    'DEFAULT groupRotation.angles (1:1)'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.faceRotation.paramKeys,
    [-30, 0, 30],
    'DEFAULT faceRotation.paramKeys'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.faceRotation.angles,
    [-10, 0, 10],
    'DEFAULT faceRotation.angles (±10° cap)'
  );
  assert(Object.isFrozen(DEFAULT_ROTATION_DEFORMER_CONFIG), 'DEFAULT is frozen');
}

// --- buildRotationDeformerConfigFromProject: returns mutable copy ---

{
  const cfg = buildRotationDeformerConfigFromProject({});
  assertEq(cfg.skipRotationRoles, ['torso', 'eyes', 'neck'], 'build returns DEFAULT skip');
  assert(!Object.isFrozen(cfg.skipRotationRoles), 'skip array mutable');
  assert(!Object.isFrozen(cfg.groupRotation.paramKeys), 'paramKeys mutable');
  cfg.skipRotationRoles.push('hip');
  cfg.groupRotation.paramKeys.push(60);
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.skipRotationRoles,
    ['torso', 'eyes', 'neck'],
    'mutation does not leak into frozen DEFAULT'
  );
  assertEq(
    DEFAULT_ROTATION_DEFORMER_CONFIG.groupRotation.paramKeys,
    [-30, 0, 30],
    'paramKeys mutation does not leak'
  );
}

// --- resolveRotationDeformerConfig: populated → use as-is ---

{
  const project = {
    rotationDeformerConfig: {
      skipRotationRoles: ['torso'],
      paramAngleRange: { min: -45, max: 45 },
      groupRotation: { paramKeys: [-45, 0, 45], angles: [-30, 0, 30] },
      faceRotation: { paramKeys: [-45, 0, 45], angles: [-15, 0, 15] },
    },
  };
  const cfg = resolveRotationDeformerConfig(project);
  assert(cfg === project.rotationDeformerConfig, 'same reference returned');
  assertEq(cfg.skipRotationRoles, ['torso'], 'custom skip roles preserved');
  assertEq(cfg.paramAngleRange, { min: -45, max: 45 }, 'custom range preserved');
}

// --- resolveRotationDeformerConfig: missing/null/malformed → DEFAULT ---

{
  const def = buildRotationDeformerConfigFromProject({});

  assertEq(resolveRotationDeformerConfig({}), def, 'no config → DEFAULT');
  assertEq(resolveRotationDeformerConfig({ rotationDeformerConfig: null }), def, 'null → DEFAULT');
  assertEq(
    resolveRotationDeformerConfig({ rotationDeformerConfig: {} }),
    def,
    'empty object → DEFAULT'
  );
  assertEq(
    resolveRotationDeformerConfig({
      rotationDeformerConfig: {
        skipRotationRoles: ['x'],
        paramAngleRange: { min: NaN, max: 30 },
        groupRotation: { paramKeys: [0], angles: [0] },
        faceRotation: { paramKeys: [0], angles: [0] },
      },
    }),
    def,
    'NaN min → DEFAULT'
  );
  assertEq(
    resolveRotationDeformerConfig({
      rotationDeformerConfig: {
        skipRotationRoles: ['x'],
        paramAngleRange: { min: -30, max: 30 },
        groupRotation: { paramKeys: [-30, 0, 30], angles: [-30, 0] }, // length mismatch
        faceRotation: { paramKeys: [0], angles: [0] },
      },
    }),
    def,
    'paramKeys/angles length mismatch → DEFAULT'
  );
  assertEq(
    resolveRotationDeformerConfig({
      rotationDeformerConfig: {
        skipRotationRoles: ['x'],
        paramAngleRange: { min: -30, max: 30 },
        groupRotation: { paramKeys: [], angles: [] }, // empty
        faceRotation: { paramKeys: [0], angles: [0] },
      },
    }),
    def,
    'empty paramKeys → DEFAULT'
  );
}

// --- seedRotationDeformerConfig: writes + destructive ---

{
  const project = {
    rotationDeformerConfig: {
      skipRotationRoles: ['custom'],
      extraField: 'gone',
      paramAngleRange: { min: -45, max: 45 },
      groupRotation: { paramKeys: [-45, 0, 45], angles: [-45, 0, 45] },
      faceRotation: { paramKeys: [-45, 0, 45], angles: [-15, 0, 15] },
    },
  };
  seedRotationDeformerConfig(project);
  const cfg = project.rotationDeformerConfig;
  assertEq(cfg.skipRotationRoles, ['torso', 'eyes', 'neck'], 'seed overwrites skip roles');
  assertEq(cfg.paramAngleRange, { min: -30, max: 30 }, 'seed overwrites range');
  assertEq(cfg.groupRotation.angles, [-30, 0, 30], 'seed overwrites group angles');
  assertEq(cfg.faceRotation.angles, [-10, 0, 10], 'seed overwrites face angles');
  assert(!cfg.extraField, 'destructive: replaces entire config');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  const project = {};
  const generatorCfg = buildRotationDeformerConfigFromProject(project);
  seedRotationDeformerConfig(project);
  const seededCfg = resolveRotationDeformerConfig(project);
  assertEq(seededCfg, generatorCfg, 'EQUIVALENCE: seeded == generator');
}

// --- buildFaceRotationSpec: paramKeys/angles override ---

{
  const { spec } = buildFaceRotationSpec({
    facePivotCanvasX: 100, facePivotCanvasY: 200,
    parentType: 'warp',
    parentDeformerId: 'BodyXWarp',
    canvasToBodyXX: (x) => x / 1024,
    canvasToBodyXY: (y) => y / 1024,
  });
  assertEq(spec.bindings[0].keys, [-30, 0, 30], 'face rotation default keys');
  assertEq(spec.keyforms.map(k => k.angle), [-10, 0, 10], 'face rotation default angles');
}

{
  const { spec } = buildFaceRotationSpec({
    facePivotCanvasX: 100, facePivotCanvasY: 200,
    parentType: 'warp',
    parentDeformerId: 'BodyXWarp',
    canvasToBodyXX: (x) => x / 1024,
    canvasToBodyXY: (y) => y / 1024,
    paramKeys: [-45, 0, 45],
    angles:    [-15, 0, 15],
  });
  assertEq(spec.bindings[0].keys, [-45, 0, 45], 'face rotation custom keys');
  assertEq(spec.keyforms.map(k => k.angle), [-15, 0, 15], 'face rotation custom angles');
}

{
  // Length mismatch must throw (defensive invariant — buildSpec rejects
  // malformed input even though resolveRotationDeformerConfig also gates).
  assertThrows(() => buildFaceRotationSpec({
    facePivotCanvasX: 100, facePivotCanvasY: 200,
    parentType: 'warp',
    parentDeformerId: 'BodyXWarp',
    canvasToBodyXX: (x) => x,
    canvasToBodyXY: (y) => y,
    paramKeys: [-30, 0, 30],
    angles:    [-10, 10],
  }), 'face rotation length mismatch throws');
}

// --- buildGroupRotationSpec: paramKeys/angles override ---

{
  const { spec } = buildGroupRotationSpec({
    id: 'GroupRotation_test', name: 'Test', paramId: 'ParamRotation_test',
    pivotCanvas: { x: 50, y: 50 },
  });
  assertEq(spec.bindings[0].keys, [-30, 0, 30], 'group rotation default keys');
  assertEq(spec.keyforms.map(k => k.angle), [-30, 0, 30], 'group rotation default angles (1:1)');
}

{
  // 5 keyforms — denser sampling for non-Hiyori characters.
  const { spec } = buildGroupRotationSpec({
    id: 'GroupRotation_test', name: 'Test', paramId: 'ParamRotation_test',
    pivotCanvas: { x: 50, y: 50 },
    paramKeys: [-30, -15, 0, 15, 30],
    angles:    [-30, -15, 0, 15, 30],
  });
  assertEq(spec.keyforms.length, 5, 'group rotation 5 keyforms');
  assertEq(spec.bindings[0].keys, [-30, -15, 0, 15, 30], 'group rotation 5 keys');
}

{
  assertThrows(() => buildGroupRotationSpec({
    id: 'x', name: 'x', paramId: 'x',
    pivotCanvas: { x: 0, y: 0 },
    paramKeys: [-30, 0, 30],
    angles:    [-30, 30],
  }), 'group rotation length mismatch throws');
}

// --- paramSpec consumes rotationDeformerConfig ---

{
  // Default config — torso/eyes/neck skipped, ±30 range.
  const groups = [
    { id: 'g1', name: 'head', boneRole: 'head' },
    { id: 'g2', name: 'torso', boneRole: 'torso' },
    { id: 'g3', name: 'shoulder', boneRole: 'shoulder' },
  ];
  const specs = buildParameterSpec({
    baseParameters: [],
    meshes: [],
    groups,
    generateRig: true,
  });
  const rotIds = specs.filter(s => s.role === 'rotation_deformer').map(s => s.id);
  assert(rotIds.includes('ParamRotation_head'), 'head gets rotation param (default)');
  assert(!rotIds.includes('ParamRotation_torso'), 'torso skipped (default)');
  assert(rotIds.includes('ParamRotation_shoulder'), 'shoulder gets rotation param');
  const headParam = specs.find(s => s.id === 'ParamRotation_head');
  assertEq(headParam.min, -30, 'default min -30');
  assertEq(headParam.max, 30, 'default max 30');
}

{
  // Custom config — only torso skipped, ±60 range.
  const groups = [
    { id: 'g1', name: 'head', boneRole: 'head' },
    { id: 'g2', name: 'torso', boneRole: 'torso' },
    { id: 'g3', name: 'neck', boneRole: 'neck' },
  ];
  const specs = buildParameterSpec({
    baseParameters: [],
    meshes: [],
    groups,
    generateRig: true,
    rotationDeformerConfig: {
      skipRotationRoles: ['torso'],
      paramAngleRange: { min: -60, max: 60 },
      groupRotation: { paramKeys: [-60, 0, 60], angles: [-60, 0, 60] },
      faceRotation: { paramKeys: [-30, 0, 30], angles: [-10, 0, 10] },
    },
  });
  const rotIds = specs.filter(s => s.role === 'rotation_deformer').map(s => s.id);
  assert(!rotIds.includes('ParamRotation_torso'), 'torso skipped (custom)');
  assert(rotIds.includes('ParamRotation_neck'), 'neck NOT skipped (custom)');
  const headParam = specs.find(s => s.id === 'ParamRotation_head');
  assertEq(headParam.min, -60, 'custom min -60 propagates');
  assertEq(headParam.max, 60, 'custom max 60 propagates');
}

// --- Round-trip JSON ---

{
  const project = {};
  seedRotationDeformerConfig(project);
  const serialized = JSON.stringify(project.rotationDeformerConfig);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { rotationDeformerConfig: reloaded };
  const after = resolveRotationDeformerConfig(reloadedProject);
  const def = buildRotationDeformerConfigFromProject({});
  assertEq(after, def, 'round-trip preserves');
}

{
  // Round-trip with custom values.
  const project = {
    rotationDeformerConfig: {
      skipRotationRoles: ['torso', 'pelvis'],
      paramAngleRange: { min: -45, max: 45 },
      groupRotation: { paramKeys: [-45, 0, 45], angles: [-30, 0, 30] },
      faceRotation: { paramKeys: [-45, 0, 45], angles: [-12, 0, 12] },
    },
  };
  const serialized = JSON.stringify(project.rotationDeformerConfig);
  const reloaded = JSON.parse(serialized);
  const after = resolveRotationDeformerConfig({ rotationDeformerConfig: reloaded });
  assertEq(after.skipRotationRoles, ['torso', 'pelvis'], 'custom skip round-trip');
  assertEq(after.faceRotation.angles, [-12, 0, 12], 'custom face angles round-trip');
}

// --- Summary ---

console.log(`rotationDeformerConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
