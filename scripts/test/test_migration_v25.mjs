// v25 migration — rename editMode slot value 'mesh' → 'edit'.
//
// Tests:
//   - Pre-v25 nodes with `node.mode === 'mesh'` get rewritten to 'edit'.
//   - Other mode values pass through unchanged.
//   - Idempotent: re-running on already-migrated data is a no-op.
//   - Empty / nodeless project survives without throwing.
//
// Run: node scripts/test/test_migration_v25.mjs

import { migrateEditModeSlotRename } from '../../src/store/migrations/v25_editmode_slot_rename.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ---- 1. Rewrites mesh → edit on every node ----
{
  const project = {
    nodes: [
      { id: 'n1', type: 'part', mode: 'mesh' },
      { id: 'n2', type: 'group', mode: 'mesh' },
      { id: 'n3', type: 'group', mode: 'skeleton' },
      { id: 'n4', type: 'part' /* no mode */ },
      { id: 'n5', type: 'part', mode: null },
    ],
  };
  migrateEditModeSlotRename(project);
  assert(project.nodes[0].mode === 'edit', 'n1: mesh → edit');
  assert(project.nodes[1].mode === 'edit', 'n2: mesh → edit');
  assert(project.nodes[2].mode === 'skeleton', 'n3: skeleton untouched');
  assert(project.nodes[3].mode === undefined, 'n4: no mode field stays undefined');
  assert(project.nodes[4].mode === null, 'n5: null mode stays null');
}

// ---- 2. Idempotent ----
{
  const project = {
    nodes: [{ id: 'n1', mode: 'mesh' }],
  };
  migrateEditModeSlotRename(project);
  assert(project.nodes[0].mode === 'edit', '1st run: mesh → edit');
  migrateEditModeSlotRename(project);
  assert(project.nodes[0].mode === 'edit', '2nd run idempotent (still edit)');
}

// ---- 3. Defensive — empty project / no nodes ----
{
  const project = { nodes: [] };
  migrateEditModeSlotRename(project);
  assert(project.nodes.length === 0, 'empty nodes array survives');
}
{
  migrateEditModeSlotRename(null);
  passed++; // didn't throw
  migrateEditModeSlotRename({});
  passed++;
}

// ---- 4. Other 'mesh'-valued fields not touched ----
{
  const project = {
    nodes: [
      { id: 'n1', type: 'mesh' /* type==='mesh' is dataKind, NOT mode */ },
      { id: 'n2', meshName: 'mesh' /* unrelated string field */, mode: 'mesh' },
    ],
  };
  migrateEditModeSlotRename(project);
  assert(project.nodes[0].type === 'mesh', "node.type 'mesh' (dataKind) untouched");
  assert(project.nodes[1].meshName === 'mesh', "unrelated 'mesh' string untouched");
  assert(project.nodes[1].mode === 'edit', "node.mode rewritten on the same node");
}

console.log(`migration_v25: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
