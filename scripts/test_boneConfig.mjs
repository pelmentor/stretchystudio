// Tests for src/io/live2d/rig/boneConfig.js — Stage 7 (bone config).
// Run: node scripts/test_boneConfig.mjs

import {
  DEFAULT_BAKED_KEYFORM_ANGLES,
  buildBoneConfigFromProject,
  resolveBoneConfig,
  seedBoneConfig,
} from '../src/io/live2d/rig/boneConfig.js';

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

// --- DEFAULT contract ---

{
  assertEq(DEFAULT_BAKED_KEYFORM_ANGLES, [-90, -45, 0, 45, 90], 'DEFAULT angles');
  assert(Object.isFrozen(DEFAULT_BAKED_KEYFORM_ANGLES), 'DEFAULT is frozen');
}

// --- buildBoneConfigFromProject: returns mutable copy ---

{
  const cfg = buildBoneConfigFromProject({});
  assertEq(cfg.bakedKeyformAngles, [...DEFAULT_BAKED_KEYFORM_ANGLES], 'build returns DEFAULT angles');
  assert(!Object.isFrozen(cfg.bakedKeyformAngles), 'returned array is mutable');
  cfg.bakedKeyformAngles.push(120);
  assertEq(DEFAULT_BAKED_KEYFORM_ANGLES, [-90, -45, 0, 45, 90], 'mutation does not affect frozen DEFAULT');
}

// --- resolveBoneConfig: populated → use as-is ---

{
  const project = {
    boneConfig: { bakedKeyformAngles: [-60, -30, 0, 30, 60] },
  };
  const cfg = resolveBoneConfig(project);
  assertEq(cfg.bakedKeyformAngles, [-60, -30, 0, 30, 60], 'populated boneConfig used');
  assert(cfg === project.boneConfig, 'same reference returned');
}

// --- resolveBoneConfig: missing/null/empty → DEFAULT ---

{
  assertEq(
    resolveBoneConfig({}).bakedKeyformAngles,
    [...DEFAULT_BAKED_KEYFORM_ANGLES],
    'no boneConfig → DEFAULT'
  );
  assertEq(
    resolveBoneConfig({ boneConfig: null }).bakedKeyformAngles,
    [...DEFAULT_BAKED_KEYFORM_ANGLES],
    'null boneConfig → DEFAULT'
  );
  assertEq(
    resolveBoneConfig({ boneConfig: { bakedKeyformAngles: [] } }).bakedKeyformAngles,
    [...DEFAULT_BAKED_KEYFORM_ANGLES],
    'empty array → DEFAULT'
  );
  assertEq(
    resolveBoneConfig({ boneConfig: {} }).bakedKeyformAngles,
    [...DEFAULT_BAKED_KEYFORM_ANGLES],
    'missing bakedKeyformAngles field → DEFAULT'
  );
}

// --- seedBoneConfig: writes + destructive ---

{
  const project = {
    boneConfig: { bakedKeyformAngles: [-60, -30, 0, 30, 60], extraField: 'preserved?' },
  };
  seedBoneConfig(project);
  assertEq(
    project.boneConfig.bakedKeyformAngles,
    [...DEFAULT_BAKED_KEYFORM_ANGLES],
    'seed overwrites bakedKeyformAngles'
  );
  // Note: seed replaces the entire boneConfig — no field merging guarantee.
  assert(!project.boneConfig.extraField, 'destructive: replaces entire boneConfig');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  const project = {};
  const generatorCfg = buildBoneConfigFromProject(project);
  seedBoneConfig(project);
  const seededCfg = resolveBoneConfig(project);
  assertEq(seededCfg, generatorCfg, 'EQUIVALENCE: seeded == generator');
}

// --- Custom angle set use case ---

{
  // User has tuned their character's range to be smaller — chibi with
  // limited shoulder mobility.
  const project = {
    boneConfig: { bakedKeyformAngles: [-30, -15, 0, 15, 30] },
  };
  const cfg = resolveBoneConfig(project);
  assertEq(cfg.bakedKeyformAngles[0], -30, 'custom min preserved');
  assertEq(cfg.bakedKeyformAngles[4], 30, 'custom max preserved');
}

// --- Non-symmetric set works (no symmetry assumption) ---

{
  const project = {
    boneConfig: { bakedKeyformAngles: [-90, 0, 30, 60] },
  };
  const cfg = resolveBoneConfig(project);
  assertEq(cfg.bakedKeyformAngles, [-90, 0, 30, 60], 'asymmetric set preserved');
}

// --- Round-trip JSON ---

{
  const project = {};
  seedBoneConfig(project);
  const serialized = JSON.stringify(project.boneConfig);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { boneConfig: reloaded };
  const after = resolveBoneConfig(reloadedProject);
  assertEq(after.bakedKeyformAngles, [...DEFAULT_BAKED_KEYFORM_ANGLES], 'round-trip preserves');
}

// --- Summary ---

console.log(`boneConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
