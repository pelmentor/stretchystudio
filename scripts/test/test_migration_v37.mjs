// Tests for `src/store/migrations/v37_scene_anim_data.js` —
// Animation Phase 1 Stage 1.D `__scene__` pseudo-Object migration.
//
// Coverage:
//   1. v36 → v37 creates the `__scene__` node with default animData
//   2. v37 → v37 is idempotent (no duplicate node, no animData reset)
//   3. Pre-existing `__scene__` from a hand-edited project is upgraded
//      in place (animData added if missing, otherwise preserved)
//   4. The fresh-project initial state in projectStore matches the
//      migration's `makeSceneNode` shape (drift safety net per the
//      v36-style inlined-shape convention)
//
// Run: node scripts/test/test_migration_v37.mjs

import {
  migrateSceneAnimData,
  makeSceneNode,
  isSceneNode,
} from '../../src/store/migrations/v37_scene_anim_data.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Default animData shape (sanity) ─────────────────────────────────────────

{
  const node = makeSceneNode();
  assert(node.id === '__scene__', 'makeSceneNode: id is __scene__');
  assert(node.type === 'scene', 'makeSceneNode: type is "scene" (matches Blender Scene ID)');
  assert(node.name === 'Scene', 'makeSceneNode: name is Scene');
  assert(node.parent === null, 'makeSceneNode: parent is null');
  assert(typeof node.animData === 'object' && node.animData !== null,
    'makeSceneNode: animData is an object');
  assert(node.animData.actionId === null, 'makeSceneNode: actionId starts null');
  assert(node.animData.actionInfluence === 1, 'makeSceneNode: actionInfluence = 1');
  assert(node.animData.actionBlendmode === 'replace',
    'makeSceneNode: actionBlendmode = replace');
  assert(node.animData.actionExtendmode === 'hold',
    'makeSceneNode: actionExtendmode = hold');
  assert(node.animData.slotHandle === 0, 'makeSceneNode: slotHandle = 0');
  assert(Array.isArray(node.animData.nlaTracks) && node.animData.nlaTracks.length === 0,
    'makeSceneNode: nlaTracks = []');
  assert(Array.isArray(node.animData.drivers) && node.animData.drivers.length === 0,
    'makeSceneNode: drivers = []');
  assert(node.animData.flag === 0, 'makeSceneNode: flag = 0');
}

// ── isSceneNode predicate ───────────────────────────────────────────────────

{
  assert(isSceneNode(makeSceneNode()) === true,
    'isSceneNode: true for makeSceneNode output');
  assert(isSceneNode({ id: '__scene__', type: 'group' }) === false,
    'isSceneNode: false for wrong type');
  assert(isSceneNode({ id: 'leftArm', type: 'scene' }) === false,
    'isSceneNode: false for wrong id');
  assert(isSceneNode(null) === false, 'isSceneNode: false for null');
  assert(isSceneNode(undefined) === false, 'isSceneNode: false for undefined');
  assert(isSceneNode('__scene__') === false, 'isSceneNode: false for string');
  assert(isSceneNode({}) === false, 'isSceneNode: false for empty object');
}

// ── v36 → v37 happy path ────────────────────────────────────────────────────

{
  const project = {
    schemaVersion: 36,
    actions: [],
    nodes: [
      { id: 'arm', type: 'group', animData: { actionId: null } },
    ],
  };
  const result = migrateSceneAnimData(project);
  assert(result.sceneNodeAdded === true, 'v36→v37: sceneNodeAdded telemetry true');
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene !== undefined, 'v36→v37: __scene__ node present');
  assert(isSceneNode(scene), 'v36→v37: __scene__ passes isSceneNode predicate');
  assert(scene.animData.actionId === null,
    'v36→v37: scene starts with no action bound');
  assert(project.nodes.find((n) => n && n.id === 'arm') !== undefined,
    'v36→v37: existing nodes preserved');
}

// ── Idempotency: v37 → v37 ─────────────────────────────────────────────────

{
  const project = {
    schemaVersion: 37,
    actions: [],
    nodes: [makeSceneNode()],
  };
  const before = JSON.parse(JSON.stringify(project.nodes));
  const result = migrateSceneAnimData(project);
  assert(result.sceneNodeAdded === false,
    'v37→v37: sceneNodeAdded telemetry false (idempotent)');
  assert(project.nodes.length === 1,
    'v37→v37: no duplicate __scene__ node');
  assert(deepEqual(project.nodes, before),
    'v37→v37: nodes unchanged byte-for-byte');
}

// ── Idempotency: scene action already bound, migration preserves binding ──

{
  const scene = makeSceneNode();
  scene.animData.actionId = 'action-existing';
  scene.animData.slotHandle = 7;
  const project = {
    schemaVersion: 37,
    actions: [{ id: 'action-existing', name: 'Bound', fcurves: [] }],
    nodes: [scene],
  };
  migrateSceneAnimData(project);
  const post = project.nodes.find((n) => n && n.id === '__scene__');
  assert(post.animData.actionId === 'action-existing',
    'v37→v37: pre-existing scene binding survives');
  assert(post.animData.slotHandle === 7,
    'v37→v37: pre-existing slotHandle survives');
}

// ── Hand-edited project: __scene__ exists with no animData slot ─────────────

{
  const project = {
    schemaVersion: 36,
    actions: [],
    nodes: [
      { id: '__scene__', type: 'scene', name: 'Scene', parent: null },
    ],
  };
  const result = migrateSceneAnimData(project);
  assert(result.sceneNodeAdded === false,
    'hand-edited: sceneNodeAdded false (id collision skips push)');
  assert(project.nodes.length === 1,
    'hand-edited: no duplicate __scene__ node');
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene.animData && typeof scene.animData === 'object',
    'hand-edited: animData slot was added in place');
  assert(scene.animData.actionId === null,
    'hand-edited: added animData starts null');
}

// ── Hand-edited collision: __scene__ exists with WRONG type ────────────────
// Audit-fix D-12 (Stage 1.D): the migration must force-correct the type
// so the read/write asymmetry can't reopen via a hand-edited
// `{id: '__scene__', type: 'group'}` collision.

{
  const project = {
    schemaVersion: 36,
    actions: [],
    nodes: [
      { id: '__scene__', type: 'group', parent: 'someParent' },
    ],
  };
  migrateSceneAnimData(project);
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene.type === 'scene',
    'D-12: type force-corrected from "group" to "scene"');
  assert(scene.name === 'Scene',
    'D-12: missing name backfilled to "Scene"');
  assert(scene.parent === null,
    'D-12: foreign parent reset to null');
  assert(scene.animData && scene.animData.actionId === null,
    'D-12: animData added when missing');
  assert(isSceneNode(scene),
    'D-12: predicate now accepts the corrected node');
}

// ── Hand-edited corruption: animData is a non-object truthy value ──────────
// Audit-fix D-16 (Stage 1.D): mirror Blender's `BKE_animdata_ensure_id`
// strict contract — only repair when missing, fail loud for corrupt
// truthy values rather than silently overwriting user data.

{
  const project = {
    schemaVersion: 36,
    actions: [],
    nodes: [
      { id: '__scene__', type: 'scene', name: 'Scene', parent: null, animData: 'broken' },
    ],
  };
  let threw = false;
  try {
    migrateSceneAnimData(project);
  } catch (e) {
    threw = true;
    assert(/corrupt animData/.test(String(e.message)),
      'D-16: throws with a useful message about corrupt animData');
  }
  assert(threw, 'D-16: corrupt animData triggers a thrown Error (not silent overwrite)');
}

// ── Foreign-parent idempotency (Audit-fix G-17) ────────────────────────────
// Tests the scenario flagged by G-17: a hand-edited project with
// `{id:'__scene__', parent:'foreignNode'}` must end up with parent=null
// after the D-12 force-correct.

{
  const project = {
    schemaVersion: 36,
    actions: [],
    nodes: [
      { id: 'foreignNode', type: 'group', parent: null },
      { id: '__scene__', type: 'scene', name: 'Scene', parent: 'foreignNode',
        animData: { actionId: null, actionInfluence: 1, actionBlendmode: 'replace',
                    actionExtendmode: 'hold', slotHandle: 0, nlaTracks: [], drivers: [], flag: 0 } },
    ],
  };
  migrateSceneAnimData(project);
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene.parent === null,
    'G-17: foreign parent reset to null even when animData already correct');
}

// ── Defensive shape checks ─────────────────────────────────────────────────

{
  // Empty project gets nodes[] + scene node added.
  const project = { schemaVersion: 36 };
  const result = migrateSceneAnimData(project);
  assert(result.sceneNodeAdded === true,
    'defensive: missing nodes array gets initialised + scene added');
  assert(Array.isArray(project.nodes) && project.nodes.length === 1,
    'defensive: nodes array exists with scene');
}

{
  const result = migrateSceneAnimData(null);
  assert(result.sceneNodeAdded === false, 'defensive: null project returns no-op');
}

// ── Drift safety: projectStore initial state matches makeSceneNode shape ───
//
// The v36-style "inlined shape" convention duplicates the scene-node
// shape between the migration's makeSceneNode() and the projectStore
// initial state in `src/store/projectStore.js`. The convention exists
// because migrations are time-locked code (they can't import from
// 'current' code without breaking that property), so the duplication
// is intentional. This test is the safety net — if either site drifts,
// fresh projects and migrated v36 projects would have different scene
// node shapes, breaking save/load round-trips. Catch the drift here.

{
  // Read the projectStore source file and parse out the inlined scene
  // node literal. The literal is identifiable by its `id: '__scene__'`
  // marker on a line by itself.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const storeSrc = await fs.readFile(
    path.join(here, '..', '..', 'src', 'store', 'projectStore.js'),
    'utf8',
  );
  // Substring match on the canonical fields. We don't try to literally
  // eval the JS — we just confirm every field name + value in
  // makeSceneNode() appears in the projectStore source.
  const ref = makeSceneNode();
  const checks = [
    `id: '__scene__'`,
    `type: 'scene'`,
    `name: 'Scene'`,
    `actionId: null`,
    `actionInfluence: 1`,
    `actionBlendmode: 'replace'`,
    `actionExtendmode: 'hold'`,
    `slotHandle: 0`,
    `nlaTracks: []`,
    `drivers: []`,
    `flag: 0`,
    // v42 Slice 4.A — NLA tweak-mode backup pointers. Added so a
    // fresh projectStore.initial-state scene node matches what v42's
    // migration writes for already-migrated projects (see
    // src/store/migrations/v42_nla_substrate.js).
    `tmpActionId: null`,
    `tmpSlotHandle: 0`,
    `tweakTrackId: null`,
    `tweakStripId: null`,
  ];
  for (const literal of checks) {
    assert(storeSrc.includes(literal),
      `drift safety: projectStore initial state contains ${literal}`);
  }
  // Also confirm all of those fields are present on makeSceneNode's
  // animData (otherwise this drift test would silently miss new fields).
  // Bumped 8 → 12 in Phase 4 Slice 4.A (v42 NLA substrate).
  const ad = ref.animData;
  assert(Object.keys(ad).length === 12,
    'drift safety: makeSceneNode animData has 12 fields (lock-in for new-field detection)');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
