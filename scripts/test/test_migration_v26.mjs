// v26 migration — fold 'blendShape' editMode into 'edit'.
//
// Tests:
//   - Pre-v26 nodes with `node.mode === 'blendShape'` get rewritten to 'edit'.
//   - Other mode values pass through unchanged.
//   - Idempotent: re-running on already-migrated data is a no-op.
//   - Empty / nodeless project survives without throwing.
//
// Run: node scripts/test/test_migration_v26.mjs

import { migrateBlendShapeModeFold } from '../../src/store/migrations/v26_blendshape_mode_fold.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ---- 1. Rewrites blendShape → edit on every node ----
{
  const project = {
    nodes: [
      { id: 'n1', type: 'part', mode: 'blendShape' },
      { id: 'n2', type: 'group', mode: 'blendShape' },
      { id: 'n3', type: 'group', mode: 'skeleton' },
      { id: 'n4', type: 'part', mode: 'edit' },
      { id: 'n5', type: 'part' /* no mode */ },
    ],
  };
  migrateBlendShapeModeFold(project);
  assert(project.nodes[0].mode === 'edit', 'n1: blendShape → edit');
  assert(project.nodes[1].mode === 'edit', 'n2: blendShape → edit');
  assert(project.nodes[2].mode === 'skeleton', 'n3: skeleton untouched');
  assert(project.nodes[3].mode === 'edit', 'n4: edit untouched');
  assert(project.nodes[4].mode === undefined, 'n5: no mode field stays undefined');
}

// ---- 2. Idempotent ----
{
  const project = { nodes: [{ id: 'n1', mode: 'blendShape' }] };
  migrateBlendShapeModeFold(project);
  assert(project.nodes[0].mode === 'edit', '1st run: blendShape → edit');
  migrateBlendShapeModeFold(project);
  assert(project.nodes[0].mode === 'edit', '2nd run idempotent (still edit)');
}

// ---- 3. Defensive — empty / null / no nodes ----
{
  const project = { nodes: [] };
  migrateBlendShapeModeFold(project);
  assert(project.nodes.length === 0, 'empty nodes array survives');
}
{
  migrateBlendShapeModeFold(null);
  passed++;
  migrateBlendShapeModeFold({});
  passed++;
}

// ---- 4. Other 'blendShape' fields not touched ----
// node.blendShapes (the actual shape-key data array) and
// node.blendShapeValues (per-shape influence dict) are NOT modes —
// they must survive unchanged.
{
  const project = {
    nodes: [
      {
        id: 'n1',
        type: 'part',
        mode: 'blendShape',
        blendShapes: [{ id: 's1', name: 'smile', deltas: [] }],
        blendShapeValues: { s1: 0.5 },
      },
    ],
  };
  migrateBlendShapeModeFold(project);
  assert(project.nodes[0].mode === 'edit', 'mode rewritten');
  assert(Array.isArray(project.nodes[0].blendShapes)
    && project.nodes[0].blendShapes.length === 1,
    'blendShapes data array preserved');
  assert(project.nodes[0].blendShapeValues.s1 === 0.5,
    'blendShapeValues preserved');
}

console.log(`migration_v26: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
