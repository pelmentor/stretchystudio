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
  const clone = cloneAction(project, 'action-1');
  assert(clone && typeof clone === 'object',
    'cloneAction: returns the clone object');
  assert(typeof clone.id === 'string' && clone.id !== 'action-1',
    'cloneAction: clone has a fresh id');
  assert(project.actions.length === 3, 'cloneAction: appends to project.actions');
  assert(project.actions[2] === clone,
    'cloneAction: returned object IS the appended one (no extra find)');
}

{
  const project = makeProject();
  const clone = cloneAction(project, 'action-1', 'Idle Variant');
  assert(clone.name === 'Idle Variant', 'cloneAction: passes newName through');
}

{
  const project = makeProject();
  const clone = cloneAction(project, 'action-1');
  assert(clone.name === 'Idle Copy', 'cloneAction: defaults to "<source.name> Copy"');
}

{
  // Deep-copy semantics: source and clone fcurves are separate objects
  const project = makeProject();
  const clone = cloneAction(project, 'action-1');
  const src = project.actions.find((a) => a.id === 'action-1');
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
  // Driver clone: separate driver object on the clone (audit-fix G-1/D-2)
  const project = makeProject();
  // Beef up action-2's driver with a variables array carrying nested
  // target objects — verifies the deep clone reaches inside.
  const action2 = project.actions.find((a) => a.id === 'action-2');
  action2.fcurves[0].driver = {
    expression: 'var',
    variables: [
      { name: 'var', type: 'SINGLE_PROP', target: { id: 'leftArm', rnaPath: 'pose.rotation' } },
    ],
  };
  const clone = cloneAction(project, 'action-2');
  const src = action2;
  assert(clone.fcurves[0].driver !== undefined,
    'cloneAction: driver carried onto clone');
  assert(src.fcurves[0].driver !== clone.fcurves[0].driver,
    'cloneAction: driver object reference is fresh');
  // Audit-fix G-1/D-2 — variables array + per-variable target are deep-cloned
  assert(src.fcurves[0].driver.variables !== clone.fcurves[0].driver.variables,
    'cloneAction (G-1/D-2): driver.variables array reference is fresh');
  assert(src.fcurves[0].driver.variables[0] !== clone.fcurves[0].driver.variables[0],
    'cloneAction (G-1/D-2): per-variable object reference is fresh');
  assert(src.fcurves[0].driver.variables[0].target !== clone.fcurves[0].driver.variables[0].target,
    'cloneAction (G-1/D-2): per-variable target object reference is fresh');
  // Mutating the clone's driver path does NOT bleed into source
  clone.fcurves[0].driver.variables[0].target.rnaPath = 'pose.x';
  assert(src.fcurves[0].driver.variables[0].target.rnaPath === 'pose.rotation',
    'cloneAction (G-1/D-2): mutating clone driver target does not bleed into source');
  // Mutating the clone's variables array (push/splice) does NOT bleed
  clone.fcurves[0].driver.variables.push({ name: 'var2', type: 'SINGLE_PROP' });
  assert(src.fcurves[0].driver.variables.length === 1,
    'cloneAction (G-1/D-2): mutating clone driver.variables array does not bleed into source');
}

{
  // Meta normalisation: clone's meta.source = 'authored', timestamps null
  const project = makeProject();
  const clone = cloneAction(project, 'action-2'); // source = 'imported_motion3'
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
  // Audit-fix G-10 — early-return on missing project.actions array
  assert(cloneAction({}, 'action-1') === null,
    'cloneAction: missing project.actions → null (no defensive re-bind needed)');
}

// ── G-8 missing scenarios + audit-fix coverage ──────────────────────────────

{
  // G-8a: getActionUsers after delete returns [] for the deleted id
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  assignAction(project, 'rightArm', 'action-1');
  deleteAction(project, 'action-1');
  assert(getActionUsers(project, 'action-1').length === 0,
    'G-8a: getActionUsers returns [] for deleted id (cascade visible to readers)');
}

{
  // G-8b: cloneAction of a bound action does NOT auto-bind the clone;
  // source binding preserved.
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1');
  const clone = cloneAction(project, 'action-1');
  assert(getActionUsers(project, 'action-1').length === 1,
    'G-8b: source action binding preserved after clone');
  assert(getActionUsers(project, clone.id).length === 0,
    'G-8b: clone has no auto-bound users');
}

{
  // G-8c: assignAction twice on the same Object replaces slotHandle cleanly
  const project = makeProject();
  assignAction(project, 'leftArm', 'action-1', 3);
  assignAction(project, 'leftArm', 'action-2', 7);
  assert(project.nodes[0].animData.actionId === 'action-2',
    'G-8c: second assign replaces actionId');
  assert(project.nodes[0].animData.slotHandle === 7,
    'G-8c: second assign replaces slotHandle');
}

{
  // G-8d: deleteAction twice returns {removed:false} on second call
  const project = makeProject();
  const r1 = deleteAction(project, 'action-1');
  assert(r1.removed === true, 'G-8d: first delete succeeds');
  const r2 = deleteAction(project, 'action-1');
  assert(r2.removed === false && r2.cascaded === 0,
    'G-8d: second delete returns {removed:false, cascaded:0}');
}

{
  // D-6: integer guard on slot
  const project = makeProject();
  assert(assignAction(project, 'leftArm', 'action-1', 1.5) === false,
    'D-6: non-integer slot rejected');
  assert(assignAction(project, 'leftArm', 'action-1', -1) === false,
    'D-6: negative slot rejected');
  assert(assignAction(project, 'leftArm', 'action-1', NaN) === false,
    'D-6: NaN slot rejected');
  assert(project.nodes[0].animData.actionId === null,
    'D-6: rejected slot does not mutate animData');
  // Valid integer slot works
  assert(assignAction(project, 'leftArm', 'action-1', 0) === true,
    'D-6: 0 slot accepted');
  assert(assignAction(project, 'leftArm', 'action-1', 42) === true,
    'D-6: positive integer slot accepted');
}

{
  // G-7: assignAction preserves actionInfluence/Blendmode/Extendmode (per-Object policy)
  const project = makeProject();
  project.nodes[0].animData.actionInfluence = 0.5;
  project.nodes[0].animData.actionBlendmode = 'add';
  project.nodes[0].animData.actionExtendmode = 'nothing';
  assignAction(project, 'leftArm', 'action-1');
  const ad = project.nodes[0].animData;
  assert(ad.actionInfluence === 0.5,
    'G-7: assignAction preserves actionInfluence (per-Object policy)');
  assert(ad.actionBlendmode === 'add',
    'G-7: assignAction preserves actionBlendmode');
  assert(ad.actionExtendmode === 'nothing',
    'G-7: assignAction preserves actionExtendmode');
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

// ── D-9 closure (Stage 1.D introduces __scene__) ──────────────────────────
//
// Audit-fix D-9 (Stage 1.C audit) flagged the read/write asymmetry:
// `getActionUsers` enumerated `__scene__` (any node with animData was
// scanned), but `assignAction` rejected it because v36 didn't give
// `__scene__` an animData slot. Stage 1.D's v37 migration adds the
// scene node WITH an animData slot, so both helpers now treat it as a
// first-class Object. These tests pin the closure functionally —
// future regressions that re-introduce the asymmetry surface here.

{
  const { makeSceneNode } = await import(
    '../../src/store/migrations/v37_scene_anim_data.js'
  );
  const project = makeProject();
  project.nodes.push(makeSceneNode());

  // assignAction now accepts the scene node
  assert(assignAction(project, '__scene__', 'action-1') === true,
    'D-9 closure: assignAction(__scene__) returns true post-v37');
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene.animData.actionId === 'action-1',
    'D-9 closure: scene.animData.actionId set');

  // getActionUsers enumerates the scene
  const users = getActionUsers(project, 'action-1');
  assert(users.some((u) => u.id === '__scene__'),
    'D-9 closure: getActionUsers includes __scene__ when bound');

  // unassignAction works on the scene
  assert(unassignAction(project, '__scene__') === true,
    'D-9 closure: unassignAction(__scene__) returns true');
  assert(scene.animData.actionId === null,
    'D-9 closure: scene.animData.actionId cleared');

  // deleteAction cascades through the scene too
  scene.animData.actionId = 'action-1';
  const result = deleteAction(project, 'action-1');
  assert(result.removed === true, 'D-9 closure: action removed');
  assert(result.cascaded >= 1, 'D-9 closure: cascade walked __scene__');
  assert(scene.animData.actionId === null,
    'D-9 closure: scene cascade nulled actionId');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
