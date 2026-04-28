// Tests for src/io/live2d/rig/eyeClosureConfig.js — Stage 5
// (eye closure config: closureTags + lashStripFrac + binCount).
// Run: node scripts/test_eyeClosureConfig.mjs

import {
  DEFAULT_EYE_CLOSURE_TAGS,
  DEFAULT_LASH_STRIP_FRAC,
  DEFAULT_BIN_COUNT,
  buildEyeClosureConfigFromProject,
  resolveEyeClosureConfig,
  seedEyeClosureConfig,
} from '../../src/io/live2d/rig/eyeClosureConfig.js';

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
  assertEq(
    DEFAULT_EYE_CLOSURE_TAGS,
    ['eyelash-l', 'eyewhite-l', 'irides-l', 'eyelash-r', 'eyewhite-r', 'irides-r'],
    'DEFAULT closure tags'
  );
  assert(Object.isFrozen(DEFAULT_EYE_CLOSURE_TAGS), 'DEFAULT tags is frozen');
  assertEq(DEFAULT_LASH_STRIP_FRAC, 0.06, 'DEFAULT lash strip frac');
  assertEq(DEFAULT_BIN_COUNT, 6, 'DEFAULT bin count');
}

// --- buildEyeClosureConfigFromProject: returns mutable copy ---

{
  const cfg = buildEyeClosureConfigFromProject({});
  assertEq(cfg.closureTags, [...DEFAULT_EYE_CLOSURE_TAGS], 'build returns DEFAULT tags');
  assertEq(cfg.lashStripFrac, DEFAULT_LASH_STRIP_FRAC, 'build returns DEFAULT lashStripFrac');
  assertEq(cfg.binCount, DEFAULT_BIN_COUNT, 'build returns DEFAULT binCount');
  assert(!Object.isFrozen(cfg.closureTags), 'returned array is mutable');
  cfg.closureTags.push('extra');
  assertEq(
    DEFAULT_EYE_CLOSURE_TAGS,
    ['eyelash-l', 'eyewhite-l', 'irides-l', 'eyelash-r', 'eyewhite-r', 'irides-r'],
    'mutation does not affect frozen DEFAULT'
  );
}

// --- resolveEyeClosureConfig: populated → use as-is ---

{
  const project = {
    eyeClosureConfig: {
      closureTags: ['eyelash-l', 'eyelash-r'],
      lashStripFrac: 0.10,
      binCount: 8,
    },
  };
  const cfg = resolveEyeClosureConfig(project);
  assertEq(cfg.closureTags, ['eyelash-l', 'eyelash-r'], 'populated tags used');
  assertEq(cfg.lashStripFrac, 0.10, 'populated lashStripFrac used');
  assertEq(cfg.binCount, 8, 'populated binCount used');
  assert(cfg === project.eyeClosureConfig, 'same reference returned');
}

// --- resolveEyeClosureConfig: missing/null/malformed → DEFAULT ---

{
  const def = buildEyeClosureConfigFromProject({});

  assertEq(resolveEyeClosureConfig({}), def, 'no eyeClosureConfig → DEFAULT');
  assertEq(resolveEyeClosureConfig({ eyeClosureConfig: null }), def, 'null → DEFAULT');
  assertEq(
    resolveEyeClosureConfig({ eyeClosureConfig: { closureTags: [], lashStripFrac: 0.06, binCount: 6 } }),
    def,
    'empty closureTags → DEFAULT'
  );
  assertEq(
    resolveEyeClosureConfig({ eyeClosureConfig: { closureTags: ['x'], lashStripFrac: NaN, binCount: 6 } }),
    def,
    'NaN lashStripFrac → DEFAULT'
  );
  assertEq(
    resolveEyeClosureConfig({ eyeClosureConfig: { closureTags: ['x'], lashStripFrac: 0.06, binCount: 0 } }),
    def,
    'zero binCount → DEFAULT'
  );
  assertEq(
    resolveEyeClosureConfig({ eyeClosureConfig: { closureTags: ['x'], lashStripFrac: 0.06, binCount: -3 } }),
    def,
    'negative binCount → DEFAULT'
  );
  assertEq(resolveEyeClosureConfig({ eyeClosureConfig: {} }), def, 'empty object → DEFAULT');
}

// --- seedEyeClosureConfig: writes + destructive ---

{
  const project = {
    eyeClosureConfig: {
      closureTags: ['custom'],
      lashStripFrac: 0.20,
      binCount: 12,
      extraField: 'gone',
    },
  };
  seedEyeClosureConfig(project);
  assertEq(
    project.eyeClosureConfig.closureTags,
    [...DEFAULT_EYE_CLOSURE_TAGS],
    'seed overwrites closureTags'
  );
  assertEq(project.eyeClosureConfig.lashStripFrac, 0.06, 'seed overwrites lashStripFrac');
  assertEq(project.eyeClosureConfig.binCount, 6, 'seed overwrites binCount');
  assert(!project.eyeClosureConfig.extraField, 'destructive: replaces entire eyeClosureConfig');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  const project = {};
  const generatorCfg = buildEyeClosureConfigFromProject(project);
  seedEyeClosureConfig(project);
  const seededCfg = resolveEyeClosureConfig(project);
  assertEq(seededCfg, generatorCfg, 'EQUIVALENCE: seeded == generator');
}

// --- Custom config use case ---

{
  // Anime character with extreme eye geometry — needs thicker strip and
  // higher bin count for accurate fit.
  const project = {
    eyeClosureConfig: {
      closureTags: ['eyelash-l', 'eyewhite-l', 'irides-l', 'eyelash-r', 'eyewhite-r', 'irides-r'],
      lashStripFrac: 0.12,
      binCount: 10,
    },
  };
  const cfg = resolveEyeClosureConfig(project);
  assertEq(cfg.lashStripFrac, 0.12, 'custom lashStripFrac preserved');
  assertEq(cfg.binCount, 10, 'custom binCount preserved');
}

// --- Round-trip JSON ---

{
  const project = {};
  seedEyeClosureConfig(project);
  const serialized = JSON.stringify(project.eyeClosureConfig);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { eyeClosureConfig: reloaded };
  const after = resolveEyeClosureConfig(reloadedProject);
  assertEq(after.closureTags, [...DEFAULT_EYE_CLOSURE_TAGS], 'round-trip preserves tags');
  assertEq(after.lashStripFrac, 0.06, 'round-trip preserves lashStripFrac');
  assertEq(after.binCount, 6, 'round-trip preserves binCount');
}

// --- Round-trip with custom values ---

{
  const project = {};
  project.eyeClosureConfig = {
    closureTags: ['eyelash-l'],
    lashStripFrac: 0.04,
    binCount: 4,
  };
  const serialized = JSON.stringify(project.eyeClosureConfig);
  const reloaded = JSON.parse(serialized);
  const after = resolveEyeClosureConfig({ eyeClosureConfig: reloaded });
  assertEq(after.closureTags, ['eyelash-l'], 'custom tags round-trip');
  assertEq(after.lashStripFrac, 0.04, 'custom frac round-trip');
  assertEq(after.binCount, 4, 'custom bin round-trip');
}

// --- Summary ---

console.log(`eyeClosureConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
