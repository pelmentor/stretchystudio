// BUG-028 — post-Apply Armature decoupling.
//
// After applying the Armature modifier, the part has bone weights
// (Blender keeps vertex groups on Apply) but no enabled Armature
// modifier. Pre-fix, the renderer fell through to the rigid overlay-
// matrix path and the bone's world matrix double-applied on top of the
// already-baked keyforms — visible as "Apply didn't decouple from the
// armature." The fix: a third composition state (`kind: 'none'`) for
// `hasWeights && !armatureMod`. This test pins that decision matrix.
//
// Run: node scripts/test/test_bonePostChainComposition.mjs

import { pickBonePostChainComposition } from '../../src/renderer/bonePostChainComposition.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── Test 1: weighted + enabled modifier → LBS ────────────────────────

{
  const node = {
    id: 'handwear-l',
    type: 'part',
    modifiers: [{
      type: 'armature',
      enabled: true,
      mode: 3,
      data: { jointBoneId: 'leftElbow', parentBoneId: 'leftArm' },
    }],
  };
  const mesh = {
    boneWeights: [0.5, 1.0, 0.7],
    jointBoneId: 'leftElbow',
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'lbs', `Test 1: kind === 'lbs' (got ${result.kind})`);
  assert(result.jointBoneId === 'leftElbow', 'Test 1: jointBoneId from modifier.data');
  assert(result.parentBoneId === 'leftArm', 'Test 1: parentBoneId from modifier.data');
}

// ── Test 2: weighted but NO modifier → none/applied (BUG-028) ────────

{
  // The exact post-Apply state: vertex groups present, modifier removed.
  const node = {
    id: 'handwear-l',
    type: 'part',
    modifiers: [],  // Apply Modifier removed it
  };
  const mesh = {
    boneWeights: [0.5, 1.0, 0.7],   // Apply Modifier KEEPS these
    jointBoneId: 'leftElbow',
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'none', `Test 2: kind === 'none' (got ${result.kind})`);
  assert(result.reason === 'applied', `Test 2: reason === 'applied' (got ${result.reason})`);
}

// ── Test 3: unweighted → overlay (rigid bone-follow) ─────────────────

{
  const node = {
    id: 'topwear',
    type: 'part',
    parent: 'torso',  // bone group
  };
  const mesh = {
    // No boneWeights — never bound to armature
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'overlay', `Test 3: kind === 'overlay' (got ${result.kind})`);
}

// ── Test 4: weighted + DISABLED modifier → none/applied ─────────────

{
  // A user-disabled modifier behaves like a removed one for render gating
  // (Blender's `BKE_modifier_is_enabled`). Vertex groups still on mesh,
  // but the binding is inactive — the part should NOT follow the armature.
  const node = {
    id: 'handwear-l',
    type: 'part',
    modifiers: [{
      type: 'armature',
      enabled: false,                                   // disabled
      mode: 3,
      data: { jointBoneId: 'leftElbow' },
    }],
  };
  const mesh = {
    boneWeights: [1.0, 1.0],
    jointBoneId: 'leftElbow',
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'none', `Test 4: disabled modifier → kind 'none' (got ${result.kind})`);
}

// ── Test 5: weighted + non-REALTIME-mode modifier → none/applied ────

{
  // Mode bitmask without REALTIME bit: the modifier exists but is
  // hidden from the viewport. Same render gating.
  const node = {
    id: 'handwear-l',
    type: 'part',
    modifiers: [{
      type: 'armature',
      enabled: true,
      mode: 2,                                          // RENDER only, no REALTIME
      data: { jointBoneId: 'leftElbow' },
    }],
  };
  const mesh = {
    boneWeights: [1.0],
    jointBoneId: 'leftElbow',
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'none', `Test 5: non-REALTIME mode → kind 'none' (got ${result.kind})`);
}

// ── Test 6: weighted + modifier WITHOUT data.jointBoneId → falls to mesh ─

{
  // Defensive: modifier present but missing data fields. Falls back to
  // mesh.jointBoneId (the vertex group source).
  const node = {
    id: 'handwear-l',
    type: 'part',
    modifiers: [{
      type: 'armature',
      enabled: true,
      mode: 3,
      data: {},  // empty
    }],
  };
  const mesh = {
    boneWeights: [1.0],
    jointBoneId: 'leftElbow',
  };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'lbs', `Test 6: kind === 'lbs' (got ${result.kind})`);
  assert(result.jointBoneId === 'leftElbow', 'Test 6: falls back to mesh.jointBoneId');
}

// ── Test 7: no mesh at all → overlay (defensive) ────────────────────

{
  const node = { id: 'empty', type: 'part', modifiers: [] };
  const result = pickBonePostChainComposition(node, null);
  assert(result.kind === 'overlay', `Test 7: kind === 'overlay' (got ${result.kind})`);
}

// ── Test 8: empty boneWeights array → overlay ───────────────────────

{
  const node = { id: 'p', type: 'part' };
  const mesh = { boneWeights: [], jointBoneId: 'leftElbow' };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'overlay', `Test 8: empty array → overlay (got ${result.kind})`);
}

// ── Test 9: mode field absent → defaults to REALTIME|RENDER ─────────

{
  // Pre-v21 modifier records lack the mode field. Default treats them
  // as REALTIME-active (matches the v21 migration's
  // DEFAULT_MIGRATED_MODE).
  const node = {
    id: 'p',
    type: 'part',
    modifiers: [{
      type: 'armature',
      enabled: true,
      // no mode field
      data: { jointBoneId: 'leftArm' },
    }],
  };
  const mesh = { boneWeights: [1.0], jointBoneId: 'leftArm' };
  const result = pickBonePostChainComposition(node, mesh);
  assert(result.kind === 'lbs', `Test 9: missing mode → 'lbs' (got ${result.kind})`);
}

console.log(`\nbonePostChainComposition: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
