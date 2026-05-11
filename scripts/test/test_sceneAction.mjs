// Tests for `src/anim/sceneAction.js` — Animation Phase 1 Stage 1.D
// scene-action selector.
//
// Coverage:
//   1. getSceneNode finds the __scene__ node when present
//   2. getSceneAction reads __scene__.animData.actionId and resolves to
//      a project.actions[] entry
//   3. getActiveSceneAction prefers scene binding over fallback
//   4. Fallback fires when scene binding is null
//   5. Defensive null/missing checks
//
// Run: node scripts/test/test_sceneAction.mjs

import {
  getSceneNode,
  getSceneAction,
  getActiveSceneAction,
} from '../../src/anim/sceneAction.js';
import { makeSceneNode } from '../../src/store/migrations/v37_scene_anim_data.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeProject() {
  return {
    schemaVersion: 37,
    actions: [
      { id: 'action-idle', name: 'Idle', fcurves: [] },
      { id: 'action-wave', name: 'Wave', fcurves: [] },
    ],
    nodes: [
      makeSceneNode(),
      { id: 'leftArm', type: 'group', animData: { actionId: null, slotHandle: 0 } },
    ],
  };
}

// ── getSceneNode ────────────────────────────────────────────────────────────

{
  const project = makeProject();
  const scene = getSceneNode(project);
  assert(scene !== null, 'getSceneNode: returns the scene node when present');
  assert(scene.id === '__scene__', 'getSceneNode: id is __scene__');
}

{
  const project = { schemaVersion: 36, actions: [], nodes: [] };
  assert(getSceneNode(project) === null,
    'getSceneNode: null when no scene node exists');
}

{
  // A node with id __scene__ but wrong type (collision-defence) should
  // NOT be treated as the scene.
  const project = {
    schemaVersion: 37,
    nodes: [{ id: '__scene__', type: 'group' }],
  };
  assert(getSceneNode(project) === null,
    'getSceneNode: rejects __scene__ id with wrong type');
}

// Defensive
assert(getSceneNode(null) === null, 'getSceneNode: null project → null');
assert(getSceneNode(undefined) === null, 'getSceneNode: undefined project → null');
assert(getSceneNode({}) === null, 'getSceneNode: empty project → null');
assert(getSceneNode({ nodes: 'not-an-array' }) === null,
  'getSceneNode: non-array nodes → null');

// ── getSceneAction ─────────────────────────────────────────────────────────

{
  const project = makeProject();
  // No binding yet
  assert(getSceneAction(project) === null,
    'getSceneAction: null when scene has no binding');
}

{
  const project = makeProject();
  const scene = getSceneNode(project);
  scene.animData.actionId = 'action-idle';
  const action = getSceneAction(project);
  assert(action !== null, 'getSceneAction: returns action when bound');
  assert(action.id === 'action-idle', 'getSceneAction: returns the right action');
  assert(action.name === 'Idle', 'getSceneAction: returns full action object');
}

{
  // Orphan pointer — scene bound to a deleted action. Defensive null.
  const project = makeProject();
  getSceneNode(project).animData.actionId = 'action-deleted';
  assert(getSceneAction(project) === null,
    'getSceneAction: orphan pointer resolves to null');
}

{
  // No scene node
  const project = { schemaVersion: 36, actions: [], nodes: [] };
  assert(getSceneAction(project) === null,
    'getSceneAction: no scene node → null');
}

assert(getSceneAction(null) === null, 'getSceneAction: null project → null');
assert(getSceneAction({}) === null, 'getSceneAction: empty project → null');

// ── getActiveSceneAction ───────────────────────────────────────────────────

{
  // Scene binding wins over fallback
  const project = makeProject();
  getSceneNode(project).animData.actionId = 'action-idle';
  const action = getActiveSceneAction(project, 'action-wave');
  assert(action !== null && action.id === 'action-idle',
    'getActiveSceneAction: scene binding wins over fallback');
}

{
  // Fallback fires when scene unbound
  const project = makeProject();
  const action = getActiveSceneAction(project, 'action-wave');
  assert(action !== null && action.id === 'action-wave',
    'getActiveSceneAction: fallback fires when scene is unbound');
}

{
  // Both null → null
  const project = makeProject();
  assert(getActiveSceneAction(project, null) === null,
    'getActiveSceneAction: scene unbound + fallback null → null');
  assert(getActiveSceneAction(project, undefined) === null,
    'getActiveSceneAction: undefined fallback → null');
  assert(getActiveSceneAction(project, '') === null,
    'getActiveSceneAction: empty-string fallback → null');
}

{
  // Fallback that does not resolve → null (no orphan-fallback)
  const project = makeProject();
  assert(getActiveSceneAction(project, 'action-deleted') === null,
    'getActiveSceneAction: unresolvable fallback → null (defensive)');
}

{
  // No scene node at all → fallback path still works
  const project = {
    schemaVersion: 36,
    actions: [{ id: 'action-only', name: 'Only', fcurves: [] }],
    nodes: [],
  };
  const action = getActiveSceneAction(project, 'action-only');
  assert(action !== null && action.id === 'action-only',
    'getActiveSceneAction: no scene node + valid fallback → fallback action');
}

// Defensive
assert(getActiveSceneAction(null, 'action-idle') === null,
  'getActiveSceneAction: null project → null');
assert(getActiveSceneAction(undefined, 'action-idle') === null,
  'getActiveSceneAction: undefined project → null');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
