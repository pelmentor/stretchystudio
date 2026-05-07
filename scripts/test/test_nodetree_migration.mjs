// Phase N-1 — schema v22 RigTree migration tests.
//
// Validates that lifting `part.modifiers[]` into a derived RigTree
// produces:
//   - One PartInput at the source.
//   - One node per modifier in leaf-first order.
//   - One PartOutput at the sink.
//   - Links forming a single chain.
//   - Idempotency (re-running the migration keeps shape stable).
//   - Empty modifier stack still yields a minimal PartInput → PartOutput tree.
//
// Run: node scripts/test/test_nodetree_migration.mjs

import {
  CURRENT_SCHEMA_VERSION,
  migrateProject,
} from '../../src/store/projectMigrations.js';
import { migrateNodeTreeRigTree } from '../../src/store/migrations/v22_nodetree_rigtree.js';
import { buildRigTreeForPart } from '../../src/anim/nodetree/build.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`);
}

// ---- Linear stack → linear tree ----

{
  const part = {
    id: 'face', type: 'part',
    modifiers: [
      { type: 'warp', deformerId: 'BreathWarp', enabled: true },
      { type: 'warp', deformerId: 'BodyWarpY',  enabled: true },
      { type: 'warp', deformerId: 'BodyWarpZ',  enabled: true },
    ],
  };
  const tree = buildRigTreeForPart(part);
  assertEq(tree.id, 'rig:face', 'tree id = rig:<partId>');
  assertEq(tree.partId, 'face', 'tree.partId set');
  assertEq(tree.type, 'rig', 'tree.type = rig');
  assertEq(tree.nodes.length, 5,
    '3-mod stack → 5 nodes (PartInput + 3 modifiers + PartOutput)');
  assertEq(tree.nodes[0].typeId, 'PartInput',  'node[0] = PartInput');
  assertEq(tree.nodes[1].typeId, 'WarpModifier', 'node[1] = WarpModifier (leaf)');
  assertEq(tree.nodes[1].storage.deformerId, 'BreathWarp',
    'node[1] storage = leaf modifier (BreathWarp)');
  assertEq(tree.nodes[4].typeId, 'PartOutput', 'node[N-1] = PartOutput');
  assertEq(tree.links.length, 4, 'linear chain: 4 links');
  assertEq(tree.links[0].fromNode, 'face__input',
    'link[0] from PartInput');
  assertEq(tree.links[3].toNode, 'face__output',
    'link[N-1] to PartOutput');
}

// ---- Mixed warp+rotation stack ----

{
  const part = {
    id: 'arm', type: 'part',
    modifiers: [
      { type: 'rotation', deformerId: 'ArmRotation', enabled: true },
      { type: 'warp',     deformerId: 'BodyXWarp',   enabled: true },
    ],
  };
  const tree = buildRigTreeForPart(part);
  assertEq(tree.nodes[1].typeId, 'RotationModifier',
    'mixed: node[1] = RotationModifier (leaf)');
  assertEq(tree.nodes[2].typeId, 'WarpModifier',
    'mixed: node[2] = WarpModifier (root-side)');
}

// ---- Empty stack → minimal PartInput → PartOutput tree ----

{
  const part = { id: 'rogue', type: 'part', modifiers: [] };
  const tree = buildRigTreeForPart(part);
  assertEq(tree.nodes.length, 2,
    'empty stack: 2 nodes (PartInput + PartOutput)');
  assertEq(tree.nodes[0].typeId, 'PartInput',  'empty: PartInput');
  assertEq(tree.nodes[1].typeId, 'PartOutput', 'empty: PartOutput');
  assertEq(tree.links.length, 1,
    'empty: 1 link directly bridging input → output');
}

// ---- Idempotency: re-build produces structurally identical tree ----

{
  const part = {
    id: 'shirt', type: 'part',
    modifiers: [
      { type: 'warp', deformerId: 'BodyXWarp', enabled: true },
    ],
  };
  const t1 = buildRigTreeForPart(part);
  const t2 = buildRigTreeForPart(part);
  assertEq(t1.nodes.length, t2.nodes.length, 'idempotent: same node count');
  assertEq(t1.links.length, t2.links.length, 'idempotent: same link count');
  for (let i = 0; i < t1.nodes.length; i++) {
    assertEq(t1.nodes[i].id, t2.nodes[i].id, `idempotent: node[${i}] id`);
    assertEq(t1.nodes[i].typeId, t2.nodes[i].typeId, `idempotent: node[${i}] typeId`);
  }
}

// ---- migrateNodeTreeRigTree creates project.nodeTrees.rig ----

{
  const project = {
    nodes: [
      { id: 'face', type: 'part',
        modifiers: [{ type: 'warp', deformerId: 'BodyXWarp', enabled: true }] },
      { id: 'shirt', type: 'part', modifiers: [] },
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp' },
    ],
  };
  migrateNodeTreeRigTree(project);
  assert(project.nodeTrees && typeof project.nodeTrees === 'object',
    'nodeTrees container created');
  assert(typeof project.nodeTrees.rig === 'object',
    'nodeTrees.rig container present');
  assert(project.nodeTrees.rig.face != null,
    'rig tree built for face');
  assert(project.nodeTrees.rig.shirt != null,
    'rig tree built for shirt (even with empty stack)');
  assert(project.nodeTrees.rig.BodyXWarp == null,
    'no rig tree for non-part nodes');
  assertEq(typeof project.nodeTrees.driver, 'object',
    'driver container scaffolded for v23');
  assertEq(typeof project.nodeTrees.animation, 'object',
    'animation container scaffolded for v24');
}

// ---- End-to-end via migrateProject (v0 → CURRENT_SCHEMA_VERSION) ----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'face', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  migrateProject(project);
  assertEq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    'e2e: schemaVersion bumped to v22+');
  assert(project.nodeTrees?.rig?.face != null,
    'e2e: face has a derived RigTree');
  // The rig tree should match the v20-derived modifier stack on face.
  const tree = project.nodeTrees.rig.face;
  assertEq(tree.partId, 'face', 'e2e: tree.partId = face');
  assert(tree.nodes.length >= 3,
    'e2e: tree has at least PartInput + 1 modifier + PartOutput');
}

// ---- Idempotency at the migration level: re-run keeps shape ----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'face', type: 'part',
        modifiers: [{ type: 'warp', deformerId: 'BodyXWarp', enabled: true }] },
    ],
  };
  migrateNodeTreeRigTree(project);
  const len1 = project.nodeTrees.rig.face.nodes.length;
  migrateNodeTreeRigTree(project);
  const len2 = project.nodeTrees.rig.face.nodes.length;
  assertEq(len1, len2, 'migration idempotent: re-run produces same node count');
}

// ---- Result ----

console.log(`nodetree_migration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
