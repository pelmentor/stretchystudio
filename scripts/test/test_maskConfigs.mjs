// Tests for src/io/live2d/rig/maskConfigs.js — Stage 3 (mask configs).
// Run: node scripts/test_maskConfigs.mjs
// Exits non-zero on first failure.

import {
  CLIP_RULES,
  buildMaskConfigsFromProject,
  resolveMaskConfigs,
  seedMaskConfigs,
} from '../../src/io/live2d/rig/maskConfigs.js';

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

// --- CLIP_RULES contract ---

{
  assertEq(CLIP_RULES.irides, 'eyewhite', 'CLIP_RULES.irides');
  assertEq(CLIP_RULES['irides-l'], 'eyewhite-l', 'CLIP_RULES.irides-l');
  assertEq(CLIP_RULES['irides-r'], 'eyewhite-r', 'CLIP_RULES.irides-r');
}

// --- Synthetic projects ---

function meshNode(id, name, opts = {}) {
  return {
    id,
    type: 'part',
    name,
    visible: opts.visible ?? true,
    mesh: opts.mesh ?? { vertices: [], uvs: [], triangles: [] },
    variantSuffix: opts.variantSuffix ?? null,
    variantRole: opts.variantRole ?? null,
  };
}

// --- Base case: irides masked by eyewhite ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
      meshNode('m3', 'eyewhite-r'),
      meshNode('m4', 'irides-r'),
      meshNode('m5', 'face'),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  assertEq(pairs.length, 2, 'two iris meshes get pairs');
  // Find the irides-l pair
  const lPair = pairs.find(p => p.maskedMeshId === 'm2');
  const rPair = pairs.find(p => p.maskedMeshId === 'm4');
  assertEq(lPair.maskMeshIds, ['m1'], 'irides-l masked by eyewhite-l');
  assertEq(rPair.maskMeshIds, ['m3'], 'irides-r masked by eyewhite-r');
}

// --- Non-iris meshes get no pair ---

{
  const project = {
    nodes: [
      meshNode('m1', 'face'),
      meshNode('m2', 'mouth'),
      meshNode('m3', 'eyebrow-l'),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  assertEq(pairs, [], 'no iris → no mask pairs');
}

// --- Variant pairing: variant iris paired with variant eyewhite ---

{
  const project = {
    nodes: [
      meshNode('base_eye_l', 'eyewhite-l'),
      meshNode('base_iris_l', 'irides-l'),
      meshNode('smile_eye_l', 'eyewhite-l', { variantSuffix: 'smile' }),
      meshNode('smile_iris_l', 'irides-l', { variantSuffix: 'smile' }),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  const baseIris = pairs.find(p => p.maskedMeshId === 'base_iris_l');
  const smileIris = pairs.find(p => p.maskedMeshId === 'smile_iris_l');
  assertEq(baseIris.maskMeshIds, ['base_eye_l'], 'base iris → base eyewhite');
  assertEq(smileIris.maskMeshIds, ['smile_eye_l'], 'variant iris → variant eyewhite (NOT base)');
}

// --- Variant fallback: variant iris with no variant eyewhite falls back to base ---

{
  const project = {
    nodes: [
      meshNode('base_eye_l', 'eyewhite-l'),
      meshNode('smile_iris_l', 'irides-l', { variantSuffix: 'smile' }),
      // Note: no smile_eye_l. Variant iris must fall back to base.
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  const smileIris = pairs.find(p => p.maskedMeshId === 'smile_iris_l');
  assertEq(smileIris.maskMeshIds, ['base_eye_l'], 'variant iris falls back to base eyewhite when variant missing');
}

// --- Iris with no eyewhite at all → no pair ---

{
  const project = {
    nodes: [
      meshNode('iris_only', 'irides-l'),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  assertEq(pairs, [], 'iris without eyewhite → no pair');
}

// --- Invisible meshes ignored ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l', { visible: false }),
      meshNode('m2', 'irides-l'),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  assertEq(pairs, [], 'invisible eyewhite → no pair (mask not selectable)');
}

// --- Ordering: pairs follow node iteration order ---

{
  const project = {
    nodes: [
      meshNode('eye_r', 'eyewhite-r'),
      meshNode('eye_l', 'eyewhite-l'),
      meshNode('iris_r', 'irides-r'),
      meshNode('iris_l', 'irides-l'),
    ],
  };
  const pairs = buildMaskConfigsFromProject(project);
  assertEq(
    pairs.map(p => p.maskedMeshId),
    ['iris_r', 'iris_l'],
    'pair order follows node iteration'
  );
}

// --- resolveMaskConfigs: populated → return as-is ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
    ],
    maskConfigs: [
      { maskedMeshId: 'CUSTOM_OVERRIDE', maskMeshIds: ['CUSTOM_MASK'] },
    ],
  };
  const result = resolveMaskConfigs(project);
  assertEq(result, project.maskConfigs, 'populated maskConfigs returned as-is');
  assert(result !== project.maskConfigs ? false : true, 'returned the same array reference');
}

// --- resolveMaskConfigs: empty → compute ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
    ],
    maskConfigs: [],
  };
  const result = resolveMaskConfigs(project);
  assertEq(result.length, 1, 'empty maskConfigs → computed');
  assertEq(result[0].maskedMeshId, 'm2', 'computed pair correct');
}

// --- resolveMaskConfigs: missing field → compute (defensive) ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
    ],
    // no maskConfigs at all
  };
  const result = resolveMaskConfigs(project);
  assertEq(result.length, 1, 'missing maskConfigs → computed');
}

// --- seedMaskConfigs: writes to project.maskConfigs ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
    ],
    maskConfigs: [],
  };
  const result = seedMaskConfigs(project);
  assertEq(project.maskConfigs.length, 1, 'seed wrote to project.maskConfigs');
  assertEq(project.maskConfigs[0].maskedMeshId, 'm2', 'seeded pair correct');
  assertEq(result, project.maskConfigs, 'seedMaskConfigs return value === project.maskConfigs');
}

// --- seedMaskConfigs: destructive (overwrites existing) ---

{
  const project = {
    nodes: [
      meshNode('m1', 'eyewhite-l'),
      meshNode('m2', 'irides-l'),
    ],
    maskConfigs: [
      { maskedMeshId: 'OLD', maskMeshIds: ['OLD_MASK'] },
    ],
  };
  seedMaskConfigs(project);
  assert(!project.maskConfigs.some(p => p.maskedMeshId === 'OLD'), 'old configs wiped');
  assert(project.maskConfigs.some(p => p.maskedMeshId === 'm2'), 'new configs present');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  // The crown-jewel test for Stage 3: after seeding, resolveMaskConfigs
  // must return the same pairs as it would have computed from scratch.
  // This is the equivalence guarantee that lets writers safely fork.
  const project = {
    nodes: [
      meshNode('eye_l', 'eyewhite-l'),
      meshNode('eye_r', 'eyewhite-r'),
      meshNode('iris_l', 'irides-l'),
      meshNode('iris_r', 'irides-r'),
      meshNode('smile_eye_l', 'eyewhite-l', { variantSuffix: 'smile' }),
      meshNode('smile_iris_l', 'irides-l', { variantSuffix: 'smile' }),
      meshNode('face', 'face'),
    ],
  };
  const generatorPairs = buildMaskConfigsFromProject(project);

  seedMaskConfigs(project);
  const seededPairs = resolveMaskConfigs(project);

  assertEq(seededPairs, generatorPairs, 'EQUIVALENCE: resolveMaskConfigs after seed === generator path');
}

// --- Round-trip: seed → JSON → use ---

{
  const project = {
    nodes: [
      meshNode('eye_l', 'eyewhite-l'),
      meshNode('iris_l', 'irides-l'),
    ],
  };
  const before = buildMaskConfigsFromProject(project);
  seedMaskConfigs(project);
  const serialized = JSON.stringify(project.maskConfigs);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { ...project, maskConfigs: reloaded };
  const after = resolveMaskConfigs(reloadedProject);
  assertEq(after, before, 'ROUND-TRIP: JSON serialize preserves mask configs');
}

// --- Summary ---

console.log(`maskConfigs: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
