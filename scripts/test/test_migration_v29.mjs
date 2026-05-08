// v29 migration — clear `lastInitRigCompletedAt` so pre-v29 projects
// re-run Init Rig and populate the new `mesh.runtime` field via
// `seedAllRig`'s persistence pass.
//
// Run: node scripts/test/test_migration_v29.mjs

import { migrateArtMeshRuntimePersist } from '../../src/store/migrations/v29_artmesh_runtime_persist.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// 1. Pre-v29 project with `lastInitRigCompletedAt` set: gets cleared so
//    the next viewport render forces an async Init Rig.
{
  const project = {
    schemaVersion: 28,
    lastInitRigCompletedAt: '2026-05-07T13:56:17.028Z',
    nodes: [],
  };
  migrateArtMeshRuntimePersist(project);
  assert(project.lastInitRigCompletedAt === null,
    'lastInitRigCompletedAt cleared post-migration');
  assert(project.nodes.length === 0, 'nodes left untouched');
}

// 2. Project that never ran Init Rig (no marker) — migration is a no-op
//    on the marker, doesn't introduce any field.
{
  const project = { schemaVersion: 28, nodes: [] };
  migrateArtMeshRuntimePersist(project);
  assert(project.lastInitRigCompletedAt === null,
    'no-marker → null marker');
}

// 3. Defensive — null / undefined / non-object don't throw.
{
  migrateArtMeshRuntimePersist(null);
  migrateArtMeshRuntimePersist(undefined);
  migrateArtMeshRuntimePersist({});
  passed += 3;
}

// 4. Idempotence — running twice on the same project gives the same
//    result (marker stays null, no other state changes).
{
  const project = {
    schemaVersion: 28,
    lastInitRigCompletedAt: '2026-05-07T13:56:17.028Z',
    nodes: [{ id: 'a', type: 'part', mesh: { vertices: [] } }],
  };
  migrateArtMeshRuntimePersist(project);
  const snapshot = JSON.stringify(project);
  migrateArtMeshRuntimePersist(project);
  assert(JSON.stringify(project) === snapshot,
    'second migration is a no-op on already-migrated state');
}

console.log(`migration_v29: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
