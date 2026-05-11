// Schema v36 — Animation Phase 1 Stage 1.A + 1.B.
//
// v36 splits legacy `project.animations[]` into:
//   - `project.actions[]` (Blender Action datablock; tracks → fcurves
//     with rnaPath addressing instead of paramId/nodeId/property).
//   - `node.animData` (Blender AnimData slot per Object).
//   - `project.animations` deleted (Rule №2).
//
// Run: node scripts/test/test_migration_v36.mjs

import { migrateActionDatablock } from '../../src/store/migrations/v36_action_datablock.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

// ── 1. Single param-track animation → action with one param fcurve ──────────
{
  const project = {
    schemaVersion: 35,
    nodes: [],
    animations: [
      {
        id: 'anim.idle', name: 'Idle', fps: 24, duration: 2000,
        audioTracks: [],
        tracks: [
          {
            paramId: 'ParamAngleX',
            keyframes: [
              { time: 0, value: 0, easing: 'linear' },
              { time: 1000, value: 30, easing: 'linear' },
            ],
          },
        ],
      },
    ],
  };
  const r = migrateActionDatablock(project);
  assert(r.actionsCreated === 1, '1: 1 action created');
  assert(project.actions.length === 1, '1a: project.actions has 1 entry');
  assert(project.animations === undefined, '1b: project.animations deleted');
  const action = project.actions[0];
  assertEq(action.id, 'anim.idle', '1c: id preserved');
  assertEq(action.name, 'Idle', '1d: name preserved');
  assertEq(action.fps, 24, '1e: fps preserved');
  assertEq(action.duration, 2000, '1f: duration preserved');
  assert(action.fcurves.length === 1, '1g: 1 fcurve');
  const fc = action.fcurves[0];
  assertEq(fc.rnaPath, "objects['__params__'].values['ParamAngleX']", '1h: param rnaPath shape');
  assertEq(fc.id, 'param:ParamAngleX', '1i: param id naming');
  assert(fc.keyforms.length === 2, '1j: 2 keyforms');
  assertEq(fc.keyforms[0], { time: 0, value: 0, easing: 'linear', type: 'linear' }, '1k: kf0 verbatim + type derived');
  assertEq(fc.keyforms[1], { time: 1000, value: 30, easing: 'linear', type: 'linear' }, '1l: kf1 verbatim + type derived');
  assertEq(fc.arrayIndex, 0, '1m: arrayIndex defaults to 0');
  assertEq(fc.modifiers, [], '1n: modifiers empty');
  assert(action.flag === 0, '1o: flag defaults to 0');
  assertEq(action.meta.source, 'authored', '1p: meta.source default');
}

// ── 2. Pose-track animation → action with one node fcurve ───────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [{ id: 'p1', type: 'part' }],
    animations: [
      {
        id: 'anim.wave', name: 'Wave', fps: 60,
        tracks: [
          {
            nodeId: 'p1',
            property: 'opacity',
            keyframes: [
              { time: 0, value: 1.0 },
              { time: 500, value: 0.5, easing: 'constant' },
              { time: 1000, value: 1.0, easing: 'linear' },
            ],
          },
        ],
      },
    ],
  };
  const r = migrateActionDatablock(project);
  assert(r.actionsCreated === 1, '2: 1 action');
  const action = project.actions[0];
  assert(action.fcurves.length === 1, '2a: 1 fcurve');
  const fc = action.fcurves[0];
  assertEq(fc.rnaPath, "objects['p1'].opacity", '2b: node rnaPath shape');
  assertEq(fc.id, 'p1.opacity', '2c: node id naming');
  // Easing defaults to 'linear' for kf0 since no easing field; kf1 'constant', kf2 'linear'
  assertEq(fc.keyforms[0].easing, 'linear', '2d: missing easing defaults to linear');
  assertEq(fc.keyforms[1].easing, 'constant', '2e: constant easing preserved');
}

// ── 3. Track without paramId or nodeId is dropped silently ──────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [],
    animations: [
      {
        id: 'a3', name: 'A3',
        tracks: [
          { keyframes: [{ time: 0, value: 0 }] },             // no target
          { paramId: 'P', keyframes: [{ time: 0, value: 1 }] },// addressable
        ],
      },
    ],
  };
  migrateActionDatablock(project);
  const action = project.actions[0];
  assert(action.fcurves.length === 1, '3: untargeted track dropped');
  assertEq(action.fcurves[0].id, 'param:P', '3a: surviving fcurve is the addressable one');
}

// ── 4. Track with empty keyframes is dropped ────────────────────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [],
    animations: [
      {
        id: 'a4', name: 'A4',
        tracks: [
          { paramId: 'X', keyframes: [] },            // no kfs
          { paramId: 'Y' },                            // no kfs property at all
          { paramId: 'Z', keyframes: [{ time: 0, value: 1 }] },
        ],
      },
    ],
  };
  migrateActionDatablock(project);
  assert(project.actions[0].fcurves.length === 1, '4: empty/missing kfs dropped');
  assertEq(project.actions[0].fcurves[0].id, 'param:Z', '4a: only Z survives');
}

// ── 5. Track driver carries through onto fcurve ─────────────────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [],
    animations: [
      {
        id: 'a5', name: 'A5',
        tracks: [
          {
            paramId: 'P5',
            keyframes: [{ time: 0, value: 0 }],
            driver: { type: 'scripted', expression: '1 + 1', variables: [] },
          },
        ],
      },
    ],
  };
  migrateActionDatablock(project);
  const fc = project.actions[0].fcurves[0];
  assertEq(fc.driver, { type: 'scripted', expression: '1 + 1', variables: [] },
    '5: driver pointer preserved on fcurve');
}

// ── 6. animData scaffolding on every Object node (parts + bone groups) ──────
{
  const project = {
    schemaVersion: 35,
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'p2', type: 'part', animData: { actionId: 'preexisting' } },
      { id: 'g1', type: 'group' },
      { id: 'b1', type: 'group', boneRole: 'leftElbow' },
      { id: 'd1', type: 'deformer' },           // deformer → no animData
      { id: 'm1', type: 'meshData' },           // meshData → no animData
      { id: 'a1', type: 'armatureData' },       // armatureData → no animData
    ],
    animations: [],
  };
  const r = migrateActionDatablock(project);
  assert(r.animDataAdded === 3, `6: 3 animData added (p1, g1, b1), got ${r.animDataAdded}`);
  // p1 + g1 + b1 newly seeded
  assert(project.nodes[0].animData?.actionId === null, '6a: p1.animData.actionId null');
  assert(project.nodes[2].animData?.actionId === null, '6b: g1.animData.actionId null');
  assert(project.nodes[3].animData?.actionId === null, '6c: b1.animData.actionId null');
  // p2 preserved (was preexisting)
  assertEq(project.nodes[1].animData, { actionId: 'preexisting' }, '6d: preexisting animData preserved');
  // deformer / meshData / armatureData skipped
  assert(project.nodes[4].animData === undefined, '6e: deformer skipped');
  assert(project.nodes[5].animData === undefined, '6f: meshData skipped');
  assert(project.nodes[6].animData === undefined, '6g: armatureData skipped');
  // Default fields shape
  const ad = project.nodes[0].animData;
  assertEq(ad.actionInfluence, 1, '6h: actionInfluence=1');
  assertEq(ad.actionBlendmode, 'replace', '6i: blendmode=replace');
  assertEq(ad.actionExtendmode, 'hold', '6j: extendmode=hold');
  assertEq(ad.slotHandle, 0, '6k: slotHandle=0');
  assertEq(ad.nlaTracks, [], '6l: nlaTracks=[]');
  assertEq(ad.drivers, [], '6m: drivers=[]');
  assertEq(ad.flag, 0, '6n: flag=0');
}

// ── 7. Idempotency: second migration is a no-op ─────────────────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [{ id: 'p1', type: 'part' }],
    animations: [
      { id: 'a1', name: 'A1', tracks: [{ paramId: 'P', keyframes: [{ time: 0, value: 1 }] }] },
    ],
  };
  migrateActionDatablock(project);
  const after1 = JSON.stringify(project);
  migrateActionDatablock(project);
  const after2 = JSON.stringify(project);
  assert(after1 === after2, '7: second run no-op');
}

// ── 8. project.actions pre-populated → preserve existing, still scaffold ────
{
  const project = {
    schemaVersion: 35,
    nodes: [{ id: 'p1', type: 'part' }],
    actions: [{ id: 'a-pre', name: 'Preserved', fcurves: [], audioTracks: [], fps: 60, flag: 0, meta: {} }],
    // No animations field — already migrated
  };
  const r = migrateActionDatablock(project);
  assert(project.actions.length === 1, '8: preserved action stays');
  assertEq(project.actions[0].id, 'a-pre', '8a: preserved id');
  assert(r.animDataAdded === 1, '8b: animData scaffolding still happens');
}

// ── 9. End-to-end via migrateProject from v35 → v36 ─────────────────────────
{
  const project = {
    schemaVersion: 35,
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'b1', type: 'group', boneRole: 'leftElbow' },
    ],
    animations: [
      {
        id: 'idle', name: 'Idle', fps: 24, duration: 2000, audioTracks: [],
        tracks: [
          { paramId: 'ParamAngleX', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 30 }] },
          { nodeId: 'p1', property: 'opacity', keyframes: [{ time: 0, value: 1 }, { time: 500, value: 0.5 }] },
        ],
      },
    ],
  };
  const migrated = migrateProject(project);
  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION,
    `9: project at v${CURRENT_SCHEMA_VERSION}, got v${migrated.schemaVersion}`);
  assert(migrated.actions.length === 1, '9a: 1 action');
  assert(migrated.actions[0].fcurves.length === 2, '9b: 2 fcurves');
  assert(migrated.animations === undefined, '9c: animations deleted');
  // animData seeded on both Objects
  assert(migrated.nodes.find((n) => n.id === 'p1').animData !== undefined, '9d: p1 animData');
  assert(migrated.nodes.find((n) => n.id === 'b1').animData !== undefined, '9e: b1 animData');
}

// ── 10. End-to-end from v17 (full migration chain) ──────────────────────────
{
  const project = {
    schemaVersion: 17,
    nodes: [],
    animations: [
      { id: 'a', name: 'A', tracks: [{ paramId: 'P', keyframes: [{ time: 0, value: 0 }] }] },
    ],
    parameters: [{ id: 'P', default: 0 }],
  };
  const migrated = migrateProject(project);
  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION, '10: at current version');
  assert(migrated.actions.length === 1, '10a: 1 action');
  assert(migrated.animations === undefined, '10b: animations deleted');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
process.exit(failed > 0 ? 1 : 0);
