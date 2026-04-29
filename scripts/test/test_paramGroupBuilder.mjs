// v3 Phase 1D - tests for src/v3/editors/parameters/groupBuilder.js
//
// Run: node scripts/test/test_paramGroupBuilder.mjs

import { buildParamGroups } from '../../src/v3/editors/parameters/groupBuilder.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Empty / invalid input ───────────────────────────────────────────

{
  assert(buildParamGroups([]).length === 0, 'empty input');
  assert(buildParamGroups(null).length === 0, 'null input');
  assert(buildParamGroups(undefined).length === 0, 'undefined input');
}

// ── Classification ──────────────────────────────────────────────────

{
  const params = [
    { id: 'ParamOpacity', role: 'opacity' },
    { id: 'ParamAngleX', role: 'standard' },
    { id: 'ParamAngleY', role: 'standard' },
    { id: 'ParamHairBack', role: 'variant', variantSuffix: 'hairBack' },
    { id: 'ParamRotation_torso', role: 'bone', boneId: 'torso' },
    { id: 'CustomThing' },                                    // no role → project
    { id: 'GroupParam', role: 'group', groupId: 'g1' },
  ];
  const groups = buildParamGroups(params);
  const keys = groups.map((g) => g.key);
  assert(keys.includes('opacity'), 'opacity group present');
  assert(keys.includes('standard'), 'standard group present');
  assert(keys.includes('variants'), 'variants group present');
  assert(keys.includes('bones'), 'bones group present');
  assert(keys.includes('groups'), 'groups (rotation deformer) present');
  assert(keys.includes('project'), 'project (catch-all) group present');
}

// ── Ordering ────────────────────────────────────────────────────────

{
  // Mixed-up insertion order — output order should still be canonical.
  const params = [
    { id: 'a', role: 'project' },
    { id: 'b', role: 'opacity' },
    { id: 'c', role: 'bone',     boneId: 'x' },
    { id: 'd', role: 'standard' },
    { id: 'e', role: 'variant',  variantSuffix: 's' },
    { id: 'f', role: 'group',    groupId: 'g' },
  ];
  const groups = buildParamGroups(params);
  const keys = groups.map((g) => g.key);
  // opacity → standard → variants → bones → groups → project
  assert(JSON.stringify(keys) === '["opacity","standard","variants","bones","groups","project"]',
    'canonical group order');
}

// ── Empty groups dropped ────────────────────────────────────────────

{
  const params = [{ id: 'only', role: 'standard' }];
  const groups = buildParamGroups(params);
  assert(groups.length === 1, 'one group when only one role used');
  assert(groups[0].key === 'standard', 'lone group is standard');
}

// ── Within-group order = insertion order ────────────────────────────

{
  const params = [
    { id: 'p3', role: 'standard' },
    { id: 'p1', role: 'standard' },
    { id: 'p2', role: 'standard' },
  ];
  const ids = buildParamGroups(params)[0].params.map((p) => p.id);
  assert(JSON.stringify(ids) === '["p3","p1","p2"]', 'in-group order preserved');
}

// ── boneId/variantSuffix without explicit role ──────────────────────

{
  const params = [
    { id: 'a', boneId: 'x' },
    { id: 'b', variantSuffix: 'y' },
    { id: 'c', groupId: 'z' },
  ];
  const groups = buildParamGroups(params);
  const map = Object.fromEntries(groups.map((g) => [g.key, g.params.map((p) => p.id)]));
  assert(map.bones?.[0] === 'a', 'bone classified by boneId alone');
  assert(map.variants?.[0] === 'b', 'variant classified by variantSuffix alone');
  assert(map.groups?.[0] === 'c', 'group classified by groupId alone');
}

// ── Malformed entries dropped ───────────────────────────────────────

{
  const params = [
    { id: 'good', role: 'standard' },
    null,
    { role: 'standard' },                  // missing id
    { id: '', role: 'standard' },          // empty id
    { id: 'good2', role: 'standard' },
  ];
  const ids = buildParamGroups(params)[0].params.map((p) => p.id);
  assert(JSON.stringify(ids) === '["good","good2"]', 'malformed dropped, valid kept');
}

// ── Labels ──────────────────────────────────────────────────────────

{
  const groups = buildParamGroups([
    { id: 'a', role: 'opacity' },
    { id: 'b', role: 'standard' },
    { id: 'c', role: 'bone' },
    { id: 'd', role: 'variant' },
    { id: 'e', role: 'group' },
    { id: 'f', role: 'project' },
  ]);
  const map = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  assert(map.opacity === 'Opacity',   'opacity label');
  assert(map.standard === 'Standard', 'standard label');
  assert(map.variants === 'Variants', 'variants label');
  assert(map.bones === 'Bones',       'bones label');
  assert(map.groups === 'Groups',     'groups label');
  assert(map.project === 'Project',   'project label');
}

// ── Output ──────────────────────────────────────────────────────────

console.log(`paramGroupBuilder: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
