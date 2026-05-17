// Tests for migration v40 — Animation Phase 5 Slice 5.V: action.groups[].
// Run: node scripts/test/test_migrationV40.mjs

import { migrateActionGroups } from '../../src/store/migrations/v40_action_groups.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

// ── 1. Direct migrator: empty project → no-op ──────────────────────
{
  const r = migrateActionGroups({});
  eq(r.actionsMigrated, 0, '1: empty project actionsMigrated=0');
  eq(r.groupsCreated, 0, '1: empty project groupsCreated=0');
  eq(r.fcurvesAssigned, 0, '1: empty project fcurvesAssigned=0');
}

// ── 2. Direct migrator: null project → safe no-op ──────────────────
{
  const r = migrateActionGroups(null);
  eq(r.actionsMigrated, 0, '2: null project safe');
}

// ── 3. Direct migrator: action with node + param fcurves ───────────
{
  const project = {
    nodes: [
      { id: 'hairId', name: 'Hair' },
      { id: 'bodyId', name: 'Body' },
    ],
    actions: [
      {
        id: 'act1',
        fcurves: [
          { id: 'fc1', rnaPath: 'objects["hairId"].transform.x', keyforms: [] },
          { id: 'fc2', rnaPath: 'objects["hairId"].transform.y', keyforms: [] },
          { id: 'fc3', rnaPath: 'objects["bodyId"].transform.rotation', keyforms: [] },
          { id: 'fc4', rnaPath: 'objects["__params__"].values["paramX"]', keyforms: [] },
        ],
      },
    ],
  };
  const r = migrateActionGroups(project);
  eq(r.actionsMigrated, 1, '3: 1 action migrated');
  eq(r.groupsCreated, 2, '3: 2 groups created (one per node)');
  eq(r.fcurvesAssigned, 3, '3: 3 fcurves assigned (param stays ungrouped)');
  // Verify resolved names came from project.nodes
  const groups = project.actions[0].groups;
  const nameByGid = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  eq(nameByGid['g_node_hairId'], 'Hair', '3: hair name resolved from node');
  eq(nameByGid['g_node_bodyId'], 'Body', '3: body name resolved from node');
  // Param-target fc4 untouched
  assert(project.actions[0].fcurves[3].groupId === undefined, '3: param fc4 stays ungrouped');
}

// ── 4. Direct migrator: orphaned fcurve target (node deleted) ──────
{
  const project = {
    nodes: [],
    actions: [
      {
        id: 'act1',
        fcurves: [
          { id: 'fc1', rnaPath: 'objects["ghostNodeId"].transform.x', keyforms: [] },
        ],
      },
    ],
  };
  const r = migrateActionGroups(project);
  eq(r.groupsCreated, 1, '4: orphaned target still creates group');
  eq(project.actions[0].groups[0].name, 'ghostNodeId',
    '4: name falls back to nodeId when node is missing');
}

// ── 5. Idempotency: re-run leaves migrated data alone ──────────────
{
  const project = {
    nodes: [{ id: 'nodeA', name: 'A' }],
    actions: [
      {
        id: 'act1',
        fcurves: [{ id: 'fc1', rnaPath: 'objects["nodeA"].transform.x', keyforms: [] }],
      },
    ],
  };
  migrateActionGroups(project);
  // User renames + mutes
  project.actions[0].groups[0].name = 'Renamed';
  project.actions[0].groups[0].mute = true;
  const r2 = migrateActionGroups(project);
  eq(r2.fcurvesAssigned, 0, '5: idempotent re-run touches nothing');
  eq(project.actions[0].groups[0].name, 'Renamed', '5: user rename preserved');
  eq(project.actions[0].groups[0].mute, true, '5: user mute preserved');
}

// ── 6. Full migrateProject: pre-v40 save gets groups + bumps version ─
{
  const project = {
    schemaVersion: 39,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [
      { id: 'nodeA', name: 'NodeA' },
    ],
    animations: [], parameters: [], physics_groups: [],
    actions: [
      {
        id: 'act1',
        fcurves: [
          { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x', keyforms: [] },
        ],
      },
    ],
  };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `6: bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(Array.isArray(project.actions[0].groups), '6: action.groups[] exists');
  eq(project.actions[0].fcurves[0].groupId, 'g_node_nodeA',
    '6: fcurve groupId assigned');
}

// ── 7. No actions array → safe no-op ──────────────────────────────
{
  const project = { /* no actions, no nodes */ };
  const r = migrateActionGroups(project);
  eq(r.actionsMigrated, 0, '7: missing actions safe');
}

// ── 8. Action with no fcurves → skipped ───────────────────────────
{
  const project = {
    nodes: [],
    actions: [{ id: 'act1' /* no fcurves */ }],
  };
  const r = migrateActionGroups(project);
  eq(r.actionsMigrated, 0, '8: action without fcurves skipped');
}

console.log(`\nmigrationV40: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
