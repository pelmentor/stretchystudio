// Tests for `src/anim/actionRegistry.js` — Animation Phase 1 Stage 1.C.
// Covers the five lifecycle helpers + the projectStore deleteAction
// cascade hook-up.
//
// Run: node scripts/test/test_actionRegistry.mjs

import {
  getActionUsers,
  assignAction,
  unassignAction,
  cloneAction,
  deleteAction,
} from '../../src/anim/actionRegistry.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

/**
 * Build a fresh test project — two Object nodes with v36-shape animData
 * + two actions with one fcurve each. Each test mutates its own copy.
 */
function makeProject() {
  return {
    schemaVersion: 36,
    actions: [
      {
        id: 'action-1',
        name: 'Idle',
        fps: 60,
        duration: 2000,
        fcurves: [
          {
            id: 'fc-1a',
            rnaPath: 'objects["__params__"].values["ParamAngleX"]',
            arrayIndex: 0,
            keyforms: [
              { time: 0, value: 0, easing: 'linear', type: 'linear' },
              { time: 1000, value: 30, easing: 'linear', type: 'linear' },
            ],
            modifiers: [],
            extrapolation: 'linear',
          },
        ],
        audioTracks: [],
        flag: 0,
        meta: { createdAt: 100, modifiedAt: 200, source: 'authored' },
      },
      {
        id: 'action-2',
        name: 'Wave',
        fps: 60,
        duration: 1500,
        fcurves: [
          {
            id: 'fc-2a',
            rnaPath: 'objects["leftArm"].pose.rotation',
            arrayIndex: 0,
            keyforms: [
              { time: 0, value: 0, easing: 'linear', type: 'linear' },
              { time: 750, value: 45, easing: 'linear', type: 'linear' },
            ],
            modifiers: [],
            extrapolation: 'constant',
            driver: { variables: [], expression: '0' },
          },
        ],
        audioTracks: [],
        flag: 0,
        meta: { createdAt: null, modifiedAt: null, source: 'imported_motion3' },
      },
    ],
    nodes: [
      {
        id: 'leftArm',
        name: 'leftArm',
        type: 'group',
        animData: {
          actionId: null,
          actionInfluence: 1,
          actionBlendmode: 'replace',
          actionExtendmode: 'hold',
          slotHandle: 0,
          nlaTracks: [],
          drivers: [],
          flag: 0,
        },
      },
      {
        id: 'rightArm',
        name: 'rightArm',
        type: 'group',
        animData: {
          actionId: null,
          actionInfluence: 1,
          actionBlendmode: 'replace',
          actionExtendmode: 'hold',
          slotHandle: 0,
          nlaTracks: [],
          drivers: [],
          flag: 0,
        },
      },
    ],
  };
}

// ── getActionUsers ──────────────────────────────────────────────────────────

{
  const project = makeProject();
  assert(getActionUsers(project, 'action-1').length === 0,
    'getActionUsers: empty when no Object is bound');
  assert(getActionUsers(project, 'action-99').length === 0,
    'getActionUsers: empty when actionId does not exist');
}

{
  const project = makeProject();
  project.nodes[0].animData.actionId = 'action-1';
  project.nodes[1].animData.actionId = 'action-1';
  const users = getActionUsers(project, 'action-1');
  assert(users.length === 2, 'getActionUsers: counts both bound Objects');
  assert(users[0].id === 'leftArm' && users[1].id === 'rightArm',
    'getActionUsers: returns nodes in nodes[] order');
  assert(getActionUsers(project, 'action-2').length === 0,
    'getActionUsers: filter is exact-match');
}

{
  // Defensive shape checks
  assert(getActionUsers(null, 'action-1').length === 0,
    'getActionUsers: null project → []');
  assert(getActionUsers({}, 'action-1').length === 0,
    'getActionUsers: empty project → []');
  assert(getActionUsers(makeProject(), '').length === 0,
    'getActionUsers: empty actionId → []');
  assert(getActionUsers(makeProject(), null).length === 0,
    'getActionUsers: null actionId → []');
}

// ── assignAction ────────────────────────────────────────────────────────────

{
  const project = makeProject();
  const ok = assignAction(project, 'leftArm', 'action-1');
  assert(ok === true, 'assignAction: returns true on success');
  assert(project.nodes[0].animData.actionId === 'action-1',
    'assignAction: writes actionId');
  assert(project.nodes[0].animData.slotHandle === 0,
    'assignAction: defaults slotHandle to 0');
}

{
  const project = makeProject();
  assignAction(project, 'rightArm', 'action-2', 7);
  assert(project.nodes[1].animData.slotHandle === 7,
    'assignAction: passes slot through to slotHandle');
}

{
  const project = makeProject();
  assert(assignAction(project, 'leftArm', 'action-99') === false,
    'assignAction: false when actionId missing');
  assert(project.nodes[0].animData.actionId === null,
    'assignAction: no mutation on miss');
}

{
  const project = makeProject();
  assert(assignAction(project, 'no-such-node', 'action-1') === false,
    'assignAction: false when objectId missing');
}

{
  // animData missing on synthetic node — not a runtime contingency,
  // but the function distinguishes for debuggability
  const project = makeProject();
  project.nodes.push({ id: '__params__', type: 'paramHost' });
  assert(assignAction(project, '__params__', 'action-1') === false,
    'assignAction: false when target node has no animData slot');
}

{
  // Defensive shape checks
  assert(assignAction(null, 'a', 'b') === false, 'assignAction: null project → false');
  assert(assignAction({}, '', 'a') === false, 'assignAction: empty objectId → false');
  assert(assignAction({}, 'a', '') === false, 'assignAction: empty actionId → false');
}

// ── unassignAction ──────────────────────────────────────────────────────────

{
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1', 3);
  const ok = unassignAction(project, 'leftArm');
  assert(ok === true, 'unassignAction: returns true when binding existed');
  assert(project.nodes[0].animData.actionId === null,
    'unassignAction: nulls actionId');
  assert(project.nodes[0].animData.slotHandle === 0,
    'unassignAction: resets slotHandle to 0');
}

{
  // Object-level fields preserved (slot kept, only the binding cleared)
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  unassignAction(project, 'leftArm');
  const ad = project.nodes[0].animData;
  assert(typeof ad === 'object' && ad !== null,
    'unassignAction: animData slot itself is preserved');
  assert(ad.actionInfluence === 1 && ad.actionBlendmode === 'replace',
    'unassignAction: other animData fields untouched');
}

{
  const project = makeProject();
  assert(unassignAction(project, 'leftArm') === false,
    'unassignAction: false when actionId already null');
  assert(unassignAction(project, 'no-such-node') === false,
    'unassignAction: false when objectId missing');
}

// ── cloneAction ─────────────────────────────────────────────────────────────

{
  const project = makeProject();
  const newId = cloneAction(project, 'action-1');
  assert(typeof newId === 'string' && newId.length > 0,
    'cloneAction: returns a fresh string id');
  assert(newId !== 'action-1', 'cloneAction: new id differs from source');
  assert(project.actions.length === 3, 'cloneAction: appends to project.actions');
  const clone = project.actions.find((a) => a.id === newId);
  assert(clone, 'cloneAction: clone is locatable by returned id');
}

{
  const project = makeProject();
  const newId = cloneAction(project, 'action-1', 'Idle Variant');
  const clone = project.actions.find((a) => a.id === newId);
  assert(clone.name === 'Idle Variant', 'cloneAction: passes newName through');
}

{
  const project = makeProject();
  const newId = cloneAction(project, 'action-1');
  const clone = project.actions.find((a) => a.id === newId);
  assert(clone.name === 'Idle Copy', 'cloneAction: defaults to "<source.name> Copy"');
}

{
  // Deep-copy semantics: source and clone fcurves are separate objects
  const project = makeProject();
  const newId = cloneAction(project, 'action-1');
  const src = project.actions.find((a) => a.id === 'action-1');
  const clone = project.actions.find((a) => a.id === newId);
  assert(src.fcurves[0] !== clone.fcurves[0],
    'cloneAction: fcurve objects are separate (no shared reference)');
  assert(src.fcurves[0].keyforms[0] !== clone.fcurves[0].keyforms[0],
    'cloneAction: keyform objects are separate');
  assert(src.fcurves[0].rnaPath === clone.fcurves[0].rnaPath,
    'cloneAction: rnaPath survives unchanged (same target)');
  assert(src.fcurves[0].id === clone.fcurves[0].id,
    'cloneAction: deterministic param:<X> fcurve ids preserved');

  // Mutating the clone does NOT bleed into the source.
  clone.fcurves[0].keyforms[0].value = 999;
  assert(src.fcurves[0].keyforms[0].value === 0,
    'cloneAction: mutating clone keyform does not bleed into source');
}

{
  // Driver clone: separate driver object on the clone
  const project = makeProject();
  const newId = cloneAction(project, 'action-2');
  const src = project.actions.find((a) => a.id === 'action-2');
  const clone = project.actions.find((a) => a.id === newId);
  assert(clone.fcurves[0].driver !== undefined,
    'cloneAction: driver carried onto clone');
  assert(src.fcurves[0].driver !== clone.fcurves[0].driver,
    'cloneAction: driver object reference is fresh');
}

{
  // Meta normalisation: clone's meta.source = 'authored', timestamps null
  const project = makeProject();
  const newId = cloneAction(project, 'action-2'); // source = 'imported_motion3'
  const clone = project.actions.find((a) => a.id === newId);
  assert(clone.meta.source === 'authored',
    'cloneAction: meta.source forced to "authored" on clone');
  assert(clone.meta.createdAt === null && clone.meta.modifiedAt === null,
    'cloneAction: meta timestamps reset to null on clone');
}

{
  assert(cloneAction(null, 'action-1') === null,
    'cloneAction: null project → null');
  assert(cloneAction(makeProject(), 'action-99') === null,
    'cloneAction: missing action → null');
  assert(cloneAction(makeProject(), '') === null,
    'cloneAction: empty actionId → null');
}

// ── deleteAction ────────────────────────────────────────────────────────────

{
  const project = makeProject();
  const result = deleteAction(project, 'action-1');
  assert(result.removed === true, 'deleteAction: removed=true on success');
  assert(result.cascaded === 0, 'deleteAction: cascaded=0 when no Objects bound');
  assert(project.actions.length === 1, 'deleteAction: project.actions filtered');
  assert(project.actions[0].id === 'action-2',
    'deleteAction: surviving action preserved');
}

{
  // The cascade — the whole reason this helper exists
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  assignAction(project, 'rightArm', 'action-1', 5);
  const result = deleteAction(project, 'action-1');
  assert(result.removed === true, 'deleteAction (cascade): removed=true');
  assert(result.cascaded === 2, 'deleteAction (cascade): counts every cleared binding');
  assert(project.nodes[0].animData.actionId === null,
    'deleteAction (cascade): leftArm.animData.actionId nulled');
  assert(project.nodes[0].animData.slotHandle === 0,
    'deleteAction (cascade): leftArm.animData.slotHandle reset');
  assert(project.nodes[1].animData.actionId === null,
    'deleteAction (cascade): rightArm.animData.actionId nulled');
  assert(project.nodes[1].animData.slotHandle === 0,
    'deleteAction (cascade): rightArm.animData.slotHandle reset');
}

{
  // Partial cascade — only the bound Object is touched
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  assignAction(project, 'rightArm', 'action-2');
  const result = deleteAction(project, 'action-1');
  assert(result.cascaded === 1, 'deleteAction (partial cascade): only counts matching');
  assert(project.nodes[0].animData.actionId === null,
    'deleteAction (partial cascade): leftArm cleared');
  assert(project.nodes[1].animData.actionId === 'action-2',
    'deleteAction (partial cascade): rightArm preserved');
}

{
  const result = deleteAction(makeProject(), 'action-99');
  assert(result.removed === false && result.cascaded === 0,
    'deleteAction: removed=false on miss');

  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  const r2 = deleteAction(project, 'action-99');
  assert(r2.removed === false && r2.cascaded === 0,
    'deleteAction: no cascade on miss');
  assert(project.nodes[0].animData.actionId === 'action-1',
    'deleteAction: existing binding untouched on miss');
}

{
  assert(deleteAction(null, 'a').removed === false,
    'deleteAction: null project → removed=false');
  assert(deleteAction({}, '').removed === false,
    'deleteAction: empty actionId → removed=false');
}

// ── projectStore.deleteAction delegation ────────────────────────────────────

{
  // Verify projectStore.deleteAction routes through registryDeleteAction —
  // string-grep on the source so future refactors that bypass the
  // registry are caught as a regression.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, '..', '..');
  const src = readFileSync(join(repoRoot, 'src/store/projectStore.js'), 'utf8');
  assert(src.includes("from '../anim/actionRegistry.js'"),
    'projectStore: imports actionRegistry');
  assert(/registryDeleteAction\(state\.project, id\)/.test(src),
    'projectStore.deleteAction: delegates to registryDeleteAction(state.project, id)');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
