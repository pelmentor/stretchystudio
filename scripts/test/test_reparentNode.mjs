// BVR-006 — projectStore.reparentNode validation.
//
// Properties verified:
//   1. Reparent to a sibling/descendant-of-sibling works.
//   2. Reparent to root (newParentId = null) works.
//   3. Reparent to self is rejected (no-op).
//   4. Reparent to a descendant (cycle) is rejected.
//   5. Reparent of a bone onto a part is rejected (type mismatch).
//   6. Reparent to a dangling target id is rejected (no-op).
//   7. transformVersion bumps on success only.
//
// Run: node scripts/test/test_reparentNode.mjs

import { useProjectStore } from '../../src/store/projectStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function setupTree() {
  // root bone (b-torso)
  //   ├ b-head (bone child)
  //   ├ b-larm (bone child)
  //   │  └ b-lelbow (bone grandchild)
  //   └ p-shirt (part child)
  // g-collection (non-bone group)
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 17,
      canvas: { width: 1024, height: 1024 },
      textures: [],
      nodes: [
        { id: 'b-torso', type: 'group', boneRole: 'torso', parent: null },
        { id: 'b-head',  type: 'group', boneRole: 'head',  parent: 'b-torso' },
        { id: 'b-larm',  type: 'group', boneRole: 'leftArm', parent: 'b-torso' },
        { id: 'b-lelbow', type: 'group', boneRole: 'leftElbow', parent: 'b-larm' },
        { id: 'p-shirt', type: 'part',  parent: 'b-torso', mesh: { vertices: [] } },
        { id: 'g-collection', type: 'group', parent: null },
      ],
      animations: [], parameters: [], physics_groups: [],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0, textureVersion: 0 },
    hasUnsavedChanges: false,
  });
}

// ── Test 1: reparent bone to a sibling bone (head → larm) ──
{
  setupTree();
  useProjectStore.getState().reparentNode('b-head', 'b-larm');
  const head = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-head');
  assert(head.parent === 'b-larm', `Test 1: head parent → b-larm (got ${head.parent})`);
}

// ── Test 2: reparent to root (null) ──
{
  setupTree();
  useProjectStore.getState().reparentNode('b-head', null);
  const head = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-head');
  assert(head.parent === null, `Test 2: head parent → null (got ${head.parent})`);
}

// ── Test 3: reparent to self is rejected ──
{
  setupTree();
  const before = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-torso').parent;
  useProjectStore.getState().reparentNode('b-torso', 'b-torso');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-torso').parent;
  assert(before === after, `Test 3: self-reparent rejected (parent unchanged: ${after})`);
}

// ── Test 4: cycle rejected (torso → lelbow would create cycle) ──
{
  setupTree();
  useProjectStore.getState().reparentNode('b-torso', 'b-lelbow');
  const torso = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-torso');
  assert(torso.parent === null, `Test 4: cycle rejected (torso parent stays null, got ${torso.parent})`);
}

// ── Test 5: bone → part parent rejected ──
{
  setupTree();
  useProjectStore.getState().reparentNode('b-head', 'p-shirt');
  const head = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-head');
  assert(head.parent === 'b-torso',
    `Test 5: bone-onto-part rejected (head parent stays b-torso, got ${head.parent})`);
}

// ── Test 6: dangling target rejected ──
{
  setupTree();
  useProjectStore.getState().reparentNode('b-head', 'does-not-exist');
  const head = useProjectStore.getState().project.nodes.find((n) => n.id === 'b-head');
  assert(head.parent === 'b-torso',
    `Test 6: dangling target rejected (head parent stays b-torso, got ${head.parent})`);
}

// ── Test 7: transformVersion bumps on success only ──
{
  setupTree();
  const v0 = useProjectStore.getState().versionControl.transformVersion;
  useProjectStore.getState().reparentNode('b-torso', 'b-lelbow'); // rejected (cycle)
  const v1 = useProjectStore.getState().versionControl.transformVersion;
  assert(v0 === v1, `Test 7: rejected reparent leaves transformVersion alone (${v0} → ${v1})`);
  useProjectStore.getState().reparentNode('b-head', 'b-larm'); // succeeds
  const v2 = useProjectStore.getState().versionControl.transformVersion;
  assert(v2 === v1 + 1, `Test 7: successful reparent bumps transformVersion (${v1} → ${v2})`);
}

// ── Test 8: part → group reparent works (parts can re-collection) ──
{
  setupTree();
  useProjectStore.getState().reparentNode('p-shirt', 'g-collection');
  const shirt = useProjectStore.getState().project.nodes.find((n) => n.id === 'p-shirt');
  assert(shirt.parent === 'g-collection',
    `Test 8: part → group reparent (got ${shirt.parent})`);
}

console.log(`\nreparentNode: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
