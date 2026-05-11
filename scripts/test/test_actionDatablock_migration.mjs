// Animation Phase 1 Stage 1.F — Action datablock migration smoke pin.
//
// `test_migration_v36.mjs` carries the deep coverage (47 assertions) of
// the v35→v36 conversion; this test is the Phase-1-exit-gate smoke pin
// that locks down the high-level invariants surfaced by the plan
// (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §1.F):
//
//   - Legacy `project.animations[]` → `project.actions[]` (Blender
//     `bAction` per `DNA_action_types.h:215-360`)
//   - Per-Object `node.animData` slot (Blender `AnimData` per
//     `DNA_anim_types.h:664-740`)
//   - `project.animations` deleted (Rule №2 — no migration baggage)
//   - Full chain v17 → v38 lands at CURRENT_SCHEMA_VERSION with no
//     residual `animations` field
//   - rnaPath grammar: bracket-string keys are double-quoted (Blender
//     RNA tokenizer `rna_path.cc:127`)
//
// What this test is NOT:
//   - The deep-coverage migration test → see `test_migration_v36.mjs`.
//   - The lifecycle helper test → see `test_actionRegistry.mjs`.
//   - The exporter-side equivalence test → see `test_actionScene.mjs`.
//
// Run: node scripts/test/test_actionDatablock_migration.mjs

import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

// ── 1. v35 → CURRENT round-trip preserves the action datablock ─────────────

{
  const project = {
    schemaVersion: 35,
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'g1', type: 'group' },
    ],
    animations: [
      {
        id: 'idle', name: 'Idle', fps: 24, duration: 2000,
        tracks: [
          { paramId: 'ParamAngleX', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 30 }] },
          { nodeId: 'p1', property: 'opacity', keyframes: [{ time: 0, value: 1 }, { time: 500, value: 0 }] },
        ],
      },
    ],
  };

  const migrated = migrateProject(project);

  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION,
    `1: lands at v${CURRENT_SCHEMA_VERSION}`);
  assert(Array.isArray(migrated.actions), '1a: project.actions is an array');
  assert(migrated.actions.length === 1, '1b: 1 action');
  assert(migrated.animations === undefined, '1c: project.animations deleted (Rule №2)');

  const action = migrated.actions[0];
  assertEq(action.id, 'idle', '1d: action.id preserved');
  assertEq(action.name, 'Idle', '1e: action.name preserved');
  assertEq(action.fps, 24, '1f: action.fps preserved');
  assertEq(action.duration, 2000, '1g: action.duration preserved');
  assert(Array.isArray(action.fcurves), '1h: action.fcurves is an array');
  assert(action.fcurves.length === 2, '1i: 2 fcurves');
}

// ── 2. AnimData scaffolding on every Object node (Blender per-ID adt) ──────

{
  const project = {
    schemaVersion: 35,
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'g1', type: 'group' },
      { id: 'b1', type: 'group', boneRole: 'leftElbow' },
      { id: 'd1', type: 'deformer' },           // non-Object → no animData
      { id: 'm1', type: 'meshData' },           // non-Object → no animData
    ],
    animations: [],
  };

  const migrated = migrateProject(project);

  // Parts + groups (incl. bones) all carry animData.
  const p1 = migrated.nodes.find((n) => n.id === 'p1');
  const g1 = migrated.nodes.find((n) => n.id === 'g1');
  const b1 = migrated.nodes.find((n) => n.id === 'b1');
  const d1 = migrated.nodes.find((n) => n.id === 'd1');
  const m1 = migrated.nodes.find((n) => n.id === 'm1');

  assert(p1.animData != null, '2: parts have animData');
  assert(g1.animData != null, '2a: groups have animData');
  assert(b1.animData != null, '2b: bone groups have animData');
  assert(d1.animData === undefined, '2c: deformer nodes have no animData');
  assert(m1.animData === undefined, '2d: meshData nodes have no animData');

  // Default shape (Blender BKE_animdata_create at anim_data.cc:123).
  const ad = p1.animData;
  assertEq(ad.actionId, null, '2e: actionId default null');
  assertEq(ad.actionInfluence, 1, '2f: actionInfluence=1 (BKE runtime override)');
  assertEq(ad.actionBlendmode, 'replace', '2g: blendmode=replace');
  assertEq(ad.actionExtendmode, 'hold', '2h: extendmode=hold');
  assertEq(ad.slotHandle, 0, '2i: slotHandle=0');
}

// ── 3. rnaPath grammar uses double-quoted bracket-string keys ──────────────

{
  const project = {
    schemaVersion: 35,
    nodes: [{ id: 'leftArm', type: 'group' }],
    animations: [
      {
        id: 'sweep', name: 'Sweep',
        tracks: [
          { paramId: 'ParamAngleX', keyframes: [{ time: 0, value: 0 }] },
          { nodeId: 'leftArm', property: 'rotation', keyframes: [{ time: 0, value: 0 }] },
        ],
      },
    ],
  };

  const migrated = migrateProject(project);
  const fcurves = migrated.actions[0].fcurves;

  const paramFc = fcurves.find((fc) => fc.id === 'param:ParamAngleX');
  const nodeFc = fcurves.find((fc) => fc.id === 'leftArm.rotation');

  // Per Blender `rna_path.cc:127`: `if (*p == '"')` is the only branch
  // recognising a quoted string key. Single-quoted keys would parse-fail.
  assertEq(paramFc.rnaPath, 'objects["__params__"].values["ParamAngleX"]',
    '3: param rnaPath uses double-quoted keys');
  assertEq(nodeFc.rnaPath, 'objects["leftArm"].rotation',
    '3a: node rnaPath uses double-quoted nodeId key');
}

// ── 4. v17 → CURRENT chain: full migration walk lands at current ──────────

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

  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION,
    `4: full chain v17 → v${CURRENT_SCHEMA_VERSION}`);
  assert(migrated.actions.length === 1, '4a: action survives full chain');
  assert(migrated.animations === undefined, '4b: animations field deleted');
  // v37 introduces __scene__ as a real project.nodes entry.
  const scene = migrated.nodes.find((n) => n?.id === '__scene__');
  assert(scene != null, '4c: v37 __scene__ node present after full chain');
  assert(scene.type === 'scene', '4d: __scene__ has type=scene (Blender ID type)');
  assert(scene.animData != null, '4e: __scene__ has animData');
  assert(scene.animData.actionId === null, '4f: __scene__ unbound by default');
}

// ── 5. Idempotent: re-migrating an already-migrated project is a no-op ─────

{
  const project = {
    schemaVersion: 35,
    nodes: [{ id: 'p1', type: 'part' }],
    animations: [
      { id: 'a1', name: 'A1', tracks: [{ paramId: 'P', keyframes: [{ time: 0, value: 1 }] }] },
    ],
  };

  const once = migrateProject(project);
  const onceJson = JSON.stringify(once);
  const twice = migrateProject(once);
  const twiceJson = JSON.stringify(twice);

  assert(onceJson === twiceJson, '5: re-migration is idempotent (Rule for migrations)');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nactionDatablock_migration: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
