// Tests for src/io/live2d/rig/variantFadeRules.js — Stage 5
// (variant fade rules: backdrop tag list).
// Run: node scripts/test_variantFadeRules.mjs

import {
  DEFAULT_BACKDROP_TAGS,
  buildVariantFadeRulesFromProject,
  resolveVariantFadeRules,
  seedVariantFadeRules,
} from '../src/io/live2d/rig/variantFadeRules.js';

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
    DEFAULT_BACKDROP_TAGS,
    ['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair'],
    'DEFAULT backdrop tags'
  );
  assert(Object.isFrozen(DEFAULT_BACKDROP_TAGS), 'DEFAULT is frozen');
}

// --- buildVariantFadeRulesFromProject: returns mutable copy ---

{
  const cfg = buildVariantFadeRulesFromProject({});
  assertEq(cfg.backdropTags, [...DEFAULT_BACKDROP_TAGS], 'build returns DEFAULT tags');
  assert(!Object.isFrozen(cfg.backdropTags), 'returned array is mutable');
  cfg.backdropTags.push('hat');
  assertEq(
    DEFAULT_BACKDROP_TAGS,
    ['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair'],
    'mutation does not affect frozen DEFAULT'
  );
}

// --- resolveVariantFadeRules: populated → use as-is ---

{
  const project = {
    variantFadeRules: { backdropTags: ['face', 'helmet'] },
  };
  const cfg = resolveVariantFadeRules(project);
  assertEq(cfg.backdropTags, ['face', 'helmet'], 'populated rules used');
  assert(cfg === project.variantFadeRules, 'same reference returned');
}

// --- resolveVariantFadeRules: missing/null/empty → DEFAULT ---

{
  assertEq(
    resolveVariantFadeRules({}).backdropTags,
    [...DEFAULT_BACKDROP_TAGS],
    'no variantFadeRules → DEFAULT'
  );
  assertEq(
    resolveVariantFadeRules({ variantFadeRules: null }).backdropTags,
    [...DEFAULT_BACKDROP_TAGS],
    'null variantFadeRules → DEFAULT'
  );
  assertEq(
    resolveVariantFadeRules({ variantFadeRules: { backdropTags: [] } }).backdropTags,
    [...DEFAULT_BACKDROP_TAGS],
    'empty array → DEFAULT'
  );
  assertEq(
    resolveVariantFadeRules({ variantFadeRules: {} }).backdropTags,
    [...DEFAULT_BACKDROP_TAGS],
    'missing backdropTags field → DEFAULT'
  );
}

// --- seedVariantFadeRules: writes + destructive ---

{
  const project = {
    variantFadeRules: { backdropTags: ['custom'], extraField: 'gone' },
  };
  seedVariantFadeRules(project);
  assertEq(
    project.variantFadeRules.backdropTags,
    [...DEFAULT_BACKDROP_TAGS],
    'seed overwrites backdropTags'
  );
  assert(!project.variantFadeRules.extraField, 'destructive: replaces entire variantFadeRules');
}

// --- EQUIVALENCE: seeded path === generator path ---

{
  const project = {};
  const generatorCfg = buildVariantFadeRulesFromProject(project);
  seedVariantFadeRules(project);
  const seededCfg = resolveVariantFadeRules(project);
  assertEq(seededCfg, generatorCfg, 'EQUIVALENCE: seeded == generator');
}

// --- Custom backdrop set use case ---

{
  // Helmeted character: hair is hidden under a helmet, so the helmet is
  // the backdrop instead.
  const project = {
    variantFadeRules: { backdropTags: ['face', 'helmet'] },
  };
  const cfg = resolveVariantFadeRules(project);
  assertEq(cfg.backdropTags.length, 2, 'custom backdrop count preserved');
  assert(cfg.backdropTags.includes('helmet'), 'helmet preserved');
  assert(!cfg.backdropTags.includes('front hair'), 'default front hair NOT included');
}

// --- Round-trip JSON ---

{
  const project = {};
  seedVariantFadeRules(project);
  const serialized = JSON.stringify(project.variantFadeRules);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { variantFadeRules: reloaded };
  const after = resolveVariantFadeRules(reloadedProject);
  assertEq(after.backdropTags, [...DEFAULT_BACKDROP_TAGS], 'round-trip preserves');
}

// --- Round-trip with custom tags ---

{
  const project = {};
  project.variantFadeRules = { backdropTags: ['face', 'mask', 'hood'] };
  const serialized = JSON.stringify(project.variantFadeRules);
  const reloaded = JSON.parse(serialized);
  const after = resolveVariantFadeRules({ variantFadeRules: reloaded });
  assertEq(after.backdropTags, ['face', 'mask', 'hood'], 'custom round-trip preserves');
}

// --- Summary ---

console.log(`variantFadeRules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
