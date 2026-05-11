// Schema v35 — Pose Read/Write Canonicalisation Plan audit-fix D-3.
//
// v35 repairs mixed-state pose corruption (a v19 channels-shape bone
// where pre-Phase-8 writers stamped flat fields onto the channels
// envelope without updating the inner channel). Repair semantics:
// latest-wins (flat fields override channels values), then drop the
// flat fields so only the canonical channels-shape remains.
//
// Run: node scripts/test/test_migration_v35.mjs

import { migratePoseShapeRepair } from '../../src/store/migrations/v35_pose_shape_repair.js';
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

// ── 1. Mixed-state bone gets repaired (latest-wins flat → channels) ─────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b1', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 0, pivotY: 0 },
        // Corruption: channels has stale rotation 0.5; flat field has new 1.2
        pose: {
          rotation: 1.2,
          x: 30,
          channels: { 'b1': { rotation: 0.5, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
        },
      },
    ],
  };
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 1, `1: 1 bone repaired, got ${r.repaired}`);
  // Channels[id] now holds the LATEST flat values
  assertEq(project.nodes[0].pose.channels['b1'].rotation, 1.2, '1a: latest rotation 1.2 wins');
  assertEq(project.nodes[0].pose.channels['b1'].x, 30, '1b: latest x 30 wins');
  // Untouched channel fields preserved
  assertEq(project.nodes[0].pose.channels['b1'].y, 0, '1c: untouched y preserved');
  assertEq(project.nodes[0].pose.channels['b1'].scaleX, 1, '1d: untouched scaleX preserved');
  // Flat fields STRIPPED from envelope
  assert(project.nodes[0].pose.rotation === undefined, '1e: flat rotation stripped');
  assert(project.nodes[0].pose.x === undefined, '1f: flat x stripped');
  // Channels envelope intact
  assert(project.nodes[0].pose.channels !== undefined, '1g: channels envelope intact');
}

// ── 2. Pure flat-shape bone: untouched ──────────────────────────────────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b2', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 0, pivotY: 0 },
        pose: { rotation: 0.7, x: 5, y: -5, scaleX: 1.1, scaleY: 0.9 },
      },
    ],
  };
  const before = JSON.stringify(project.nodes[0]);
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 0, '2: pure flat → no repair');
  assertEq(JSON.parse(before), project.nodes[0], '2a: pure flat untouched');
}

// ── 3. Pure channels-shape bone: untouched ──────────────────────────────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b3', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 0, pivotY: 0 },
        pose: { channels: { 'b3': { rotation: 0.7, x: 5, y: -5, scaleX: 1.1, scaleY: 0.9 } } },
      },
    ],
  };
  const before = JSON.stringify(project.nodes[0]);
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 0, '3: pure channels → no repair');
  assertEq(JSON.parse(before), project.nodes[0], '3a: pure channels untouched');
}

// ── 4. Idempotency: second migration is a no-op ─────────────────────────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b4', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 0, pivotY: 0 },
        pose: { rotation: 1.2, channels: { 'b4': { rotation: 0.5 } } },
      },
    ],
  };
  migratePoseShapeRepair(project);
  const after1 = JSON.stringify(project.nodes[0]);
  migratePoseShapeRepair(project);
  const after2 = JSON.stringify(project.nodes[0]);
  assert(after1 === after2, '4: second run is no-op');
}

// ── 5. Self-channel auto-created when missing ───────────────────────────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b5', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 0, pivotY: 0 },
        // Channels envelope exists but no entry for self-id; flat fields present
        pose: { rotation: 0.9, channels: { 'foreign-bone': { rotation: 0 } } },
      },
    ],
  };
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 1, '5: 1 repair');
  assertEq(project.nodes[0].pose.channels['b5'].rotation, 0.9, '5a: self-channel created with flat value');
  assert(project.nodes[0].pose.rotation === undefined, '5b: flat stripped');
  // Foreign channel preserved
  assertEq(project.nodes[0].pose.channels['foreign-bone'].rotation, 0, '5c: foreign channel preserved (D-5 deviation)');
}

// ── 6. Non-bone nodes ignored ───────────────────────────────────────────────
{
  const project = {
    schemaVersion: 34,
    nodes: [
      { id: 'p1', type: 'part',
        transform: { pivotX: 0, pivotY: 0 },
        pose: { rotation: 1.2, channels: { 'p1': { rotation: 0.5 } } },  // mixed but non-bone
      },
    ],
  };
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 0, '6: non-bone untouched');
}

// ── 7. End-to-end via migrateProject from v17 → v35 ─────────────────────────
{
  // Start a v17 project with a bone that has flat pose; run all migrations.
  const project = {
    schemaVersion: 17,
    nodes: [
      {
        id: 'b7', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 100, pivotY: 200, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        pose: { rotation: 0.7, x: 25, y: -10, scaleX: 1.3, scaleY: 0.9 },
      },
    ],
  };
  const migrated = migrateProject(project);
  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION,
    `7: project at v${CURRENT_SCHEMA_VERSION}, got v${migrated.schemaVersion}`);
  // After v19, pose is in channels-shape; v35 sees it as pure-channels (no flat fields), no repair.
  const node = migrated.nodes.find((n) => n.id === 'b7');
  assert(node.pose.channels !== undefined, '7a: channels-shape after v19');
  assert(node.pose.channels['b7'].rotation === 0.7, '7b: rotation preserved through full chain');
  assert(node.pose.rotation === undefined, '7c: NO flat-shape leak');
}

// ── 8. End-to-end with PRE-EXISTING corruption (typical save+load) ──────────
{
  // Project at v34 (post-v19 channels), with corrupt mixed state from a
  // pre-Phase-8 writer. v35 should repair on first load post-Phase-8.
  const project = {
    schemaVersion: 34,
    nodes: [
      {
        id: 'b8', type: 'group', boneRole: 'leftElbow',
        transform: { pivotX: 100, pivotY: 200 },
        pose: {
          rotation: 1.5,         // user's most recent intent (flat write by pre-fix code)
          channels: { 'b8': { rotation: 0.0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },  // STALE
        },
      },
    ],
  };
  const migrated = migrateProject(project);
  assert(migrated.schemaVersion === CURRENT_SCHEMA_VERSION, '8: at current version');
  const node = migrated.nodes.find((n) => n.id === 'b8');
  assertEq(node.pose.channels['b8'].rotation, 1.5, '8a: corruption repaired — latest 1.5 in channels');
  assert(node.pose.rotation === undefined, '8b: stale flat field stripped');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) console.error('\nFailures:\n' + failures.map(f => '  - ' + f).join('\n'));
process.exit(failed > 0 ? 1 : 0);
