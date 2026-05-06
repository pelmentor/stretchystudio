// V4 Phase 4b — tests for src/io/live2d/rig/meshSync.js
//
// Locks in:
//   - ensureWeightGroups: legacy → modern migration is idempotent + non-destructive
//   - syncBoneWeightsFromActive: mirrors active group → mesh.boneWeights + jointBoneId
//   - applyWeightStroke: clamps [0,1], skips epsilon-equal updates,
//     auto-syncs legacy fields after each stroke
//
// Run: node scripts/test/test_meshSync.mjs

import {
  ensureWeightGroups,
  syncBoneWeightsFromActive,
  applyWeightStroke,
} from '../../src/io/live2d/rig/meshSync.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// ── ensureWeightGroups: migration from legacy ──────────────────────

{
  const mesh = {
    vertices: [{}, {}, {}, {}],
    boneWeights: [0.1, 0.2, 0.3, 0.4],
    jointBoneId: 'leftElbow',
  };
  const bones = [{ id: 'leftElbow', name: 'L Elbow' }];
  const changed = ensureWeightGroups(mesh, bones);
  assert(changed === true, 'migration: returns true on change');
  assert(typeof mesh.weightGroups === 'object', 'migration: weightGroups created');
  assert('L Elbow' in mesh.weightGroups, 'migration: keyed by bone group name');
  assert(JSON.stringify(mesh.weightGroups['L Elbow']) === '[0.1,0.2,0.3,0.4]',
    'migration: weights copied');
  assert(mesh.activeWeightGroup === 'L Elbow', 'migration: active group set');
  assert(mesh.boneWeights.length === 4, 'migration: legacy boneWeights kept');
  assert(mesh.jointBoneId === 'leftElbow', 'migration: legacy jointBoneId kept');
}

// ── ensureWeightGroups: bone group missing → fallback to id ────────

{
  const mesh = {
    vertices: [{}, {}],
    boneWeights: [0.5, 1.0],
    jointBoneId: 'orphanedBone',
  };
  ensureWeightGroups(mesh, []);
  assert('orphanedBone' in mesh.weightGroups,
    'migration fallback: keyed by boneId when group not found');
}

// ── ensureWeightGroups: jointBoneId only (no weights yet) ──────────

{
  const mesh = {
    vertices: [{}, {}, {}],
    jointBoneId: 'arm1',
  };
  ensureWeightGroups(mesh, [{ id: 'arm1', name: 'arm' }]);
  assert(JSON.stringify(mesh.weightGroups.arm) === '[0,0,0]',
    'migration: zero-fill when jointBoneId set but no weights');
  assert(mesh.activeWeightGroup === 'arm', 'migration: active set even on zero-fill');
}

// ── ensureWeightGroups: idempotent on already-migrated mesh ────────

{
  const mesh = {
    vertices: [{}, {}],
    weightGroups: { existing: [0.5, 0.5] },
    activeWeightGroup: 'existing',
  };
  const changed = ensureWeightGroups(mesh, []);
  assert(changed === false, 'idempotent: no change on already-migrated');
  assert(JSON.stringify(mesh.weightGroups.existing) === '[0.5,0.5]',
    'idempotent: weights untouched');
}

// ── ensureWeightGroups: empty mesh = no-op ─────────────────────────

{
  const mesh = { vertices: [] };
  const changed = ensureWeightGroups(mesh, []);
  assert(changed === false, 'empty mesh: no-op');
  assert(mesh.weightGroups === undefined, 'empty mesh: no weightGroups created');
}

// ── syncBoneWeightsFromActive ──────────────────────────────────────

{
  const mesh = {
    vertices: [{}, {}, {}],
    boneWeights: [9, 9, 9],  // stale legacy data — should be overwritten
    jointBoneId: 'old',
    weightGroups: { newGroup: [0.1, 0.2, 0.3] },
    activeWeightGroup: 'newGroup',
  };
  const bones = [{ id: 'b-new', name: 'newGroup' }];
  const synced = syncBoneWeightsFromActive(mesh, bones);
  assert(synced === true, 'sync: returns true on update');
  assert(JSON.stringify(mesh.boneWeights) === '[0.1,0.2,0.3]',
    'sync: legacy boneWeights mirrors active group');
  assert(mesh.jointBoneId === 'b-new',
    'sync: legacy jointBoneId resolves from bone group name');
}

{
  const mesh = {
    vertices: [{}, {}],
    weightGroups: { a: [0.5, 0.5] },
    activeWeightGroup: 'a',
  };
  // No matching bone group: jointBoneId NOT updated.
  syncBoneWeightsFromActive(mesh, []);
  assert(mesh.jointBoneId === undefined,
    'sync: jointBoneId left alone when no bone-name match');
}

{
  const mesh = {
    vertices: [{}],
    weightGroups: { a: [0.5] },
    activeWeightGroup: 'missing',
  };
  const synced = syncBoneWeightsFromActive(mesh, []);
  assert(synced === false,
    'sync: returns false when active group does not exist');
}

// ── applyWeightStroke ──────────────────────────────────────────────

{
  const mesh = {
    vertices: [{}, {}, {}, {}],
    weightGroups: { g: [0, 0, 0, 0] },
    activeWeightGroup: 'g',
  };
  const changed = applyWeightStroke(
    mesh,
    [
      { vertexIndex: 0, weight: 0.5 },
      { vertexIndex: 2, weight: 1.0 },
    ],
    [],
  );
  assert(changed === 2, 'stroke: returns count of changed vertices');
  assert(JSON.stringify(mesh.weightGroups.g) === '[0.5,0,1,0]',
    'stroke: writes to active group');
  assert(JSON.stringify(mesh.boneWeights) === '[0.5,0,1,0]',
    'stroke: legacy boneWeights synced');
}

{
  const mesh = {
    vertices: [{}, {}],
    weightGroups: { g: [0.5, 0.5] },
    activeWeightGroup: 'g',
  };
  applyWeightStroke(
    mesh,
    [
      { vertexIndex: 0, weight: 1.5 },   // clamp to 1
      { vertexIndex: 1, weight: -0.5 },  // clamp to 0
    ],
    [],
  );
  assert(mesh.weightGroups.g[0] === 1, 'stroke: clamps high to 1');
  assert(mesh.weightGroups.g[1] === 0, 'stroke: clamps low to 0');
}

{
  const mesh = {
    vertices: [{}],
    weightGroups: { g: [0.5] },
    activeWeightGroup: 'g',
  };
  // Same value — should be skipped (returns 0 changed).
  const changed = applyWeightStroke(mesh, [{ vertexIndex: 0, weight: 0.5 }], []);
  assert(changed === 0, 'stroke: epsilon-equal value skipped');
  // Tiny change well below epsilon (1e-7) — should be skipped.
  const changed2 = applyWeightStroke(mesh, [{ vertexIndex: 0, weight: 0.5 + 1e-7 }], []);
  assert(changed2 === 0, 'stroke: change below epsilon skipped');
  const changed3 = applyWeightStroke(mesh, [{ vertexIndex: 0, weight: 0.51 }], []);
  assert(changed3 === 1, 'stroke: change above epsilon counted');
}

{
  const mesh = {
    vertices: [{}, {}],
    weightGroups: { g: [0, 0] },
    activeWeightGroup: 'g',
  };
  // Out-of-bounds + non-finite tolerated.
  applyWeightStroke(
    mesh,
    [
      { vertexIndex: 5, weight: 1 },
      { vertexIndex: 0, weight: NaN },
      { vertexIndex: -1, weight: 1 },
      { vertexIndex: 1, weight: 0.5 },
    ],
    [],
  );
  assert(JSON.stringify(mesh.weightGroups.g) === '[0,0.5]',
    'stroke: out-of-bounds + NaN updates dropped, valid one applied');
}

console.log(`meshSync: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
