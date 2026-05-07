// v27 migration — rename 'skeleton' editMode → 'pose'.
//
// Tests:
//   - Pre-v27 nodes with `node.mode === 'skeleton'` get rewritten to 'pose'.
//   - Other mode values pass through unchanged.
//   - `viewLayers.skeleton` (the layer-visibility flag) is NOT touched.
//   - Idempotent.
//
// Run: node scripts/test/test_migration_v27.mjs

import { migrateSkeletonToPoseRename } from '../../src/store/migrations/v27_skeleton_to_pose_rename.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ---- 1. Rewrites skeleton → pose on every node ----
{
  const project = {
    nodes: [
      { id: 'g1', type: 'group', boneRole: 'head', mode: 'skeleton' },
      { id: 'g2', type: 'group', boneRole: 'leftArm', mode: 'skeleton' },
      { id: 'p1', type: 'part', mode: 'edit' },
      { id: 'g3', type: 'group', boneRole: 'root' /* no mode */ },
    ],
  };
  migrateSkeletonToPoseRename(project);
  assert(project.nodes[0].mode === 'pose', 'g1: skeleton → pose');
  assert(project.nodes[1].mode === 'pose', 'g2: skeleton → pose');
  assert(project.nodes[2].mode === 'edit', 'p1: edit untouched');
  assert(project.nodes[3].mode === undefined, 'g3: no mode field stays undefined');
}

// ---- 2. Idempotent ----
{
  const project = { nodes: [{ id: 'g1', mode: 'skeleton' }] };
  migrateSkeletonToPoseRename(project);
  assert(project.nodes[0].mode === 'pose', '1st run: skeleton → pose');
  migrateSkeletonToPoseRename(project);
  assert(project.nodes[0].mode === 'pose', '2nd run idempotent (still pose)');
}

// ---- 3. Defensive ----
{
  const project = { nodes: [] };
  migrateSkeletonToPoseRename(project);
  assert(project.nodes.length === 0, 'empty nodes array survives');
}
{
  migrateSkeletonToPoseRename(null);
  passed++;
  migrateSkeletonToPoseRename({});
  passed++;
}

// ---- 4. viewLayers.skeleton is NOT mode and NOT touched ----
// The migration only rewrites node.mode. viewLayers lives on the
// editorStore (in-memory), not on project nodes, but defensively
// confirm we don't touch fields that happen to contain 'skeleton'
// somewhere unrelated.
{
  const project = {
    nodes: [
      { id: 'g1', mode: 'skeleton', boneRole: 'skeleton' /* unrelated string */ },
    ],
    // Mock a project-level field with 'skeleton' in it (defensive — SS
    // doesn't put viewLayers on the project, but a future schema might).
    viewLayers: { skeleton: true },
  };
  migrateSkeletonToPoseRename(project);
  assert(project.nodes[0].mode === 'pose', 'mode rewritten');
  assert(project.nodes[0].boneRole === 'skeleton',
    'unrelated boneRole string preserved');
  assert(project.viewLayers?.skeleton === true,
    'project-level viewLayers.skeleton (if present) preserved');
}

console.log(`migration_v27: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
