// Schema v34 migration — `node.weightPaintSettings: { xMirror: false }` for parts.
//
// Run: node scripts/test/test_migrationV34.mjs

import { migrateProject } from '../../src/store/projectMigrations.js';
import { migrateWeightPaintSettings } from '../../src/store/migrations/v34_weight_paint_settings.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

// ── 1. add xMirror=false on every part ──────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'p2', type: 'part' },
      { id: 'g',  type: 'group' },
      { id: 'd',  type: 'meshData' },
    ],
  };
  const r = migrateWeightPaintSettings(project);
  assert(r.added === 2, `added 2 part settings, got ${r.added}`);
  assert(project.nodes[0].weightPaintSettings.xMirror === false, 'p1 has xMirror=false');
  assert(project.nodes[1].weightPaintSettings.xMirror === false, 'p2 has xMirror=false');
  assert(project.nodes[2].weightPaintSettings === undefined, 'group untouched');
  assert(project.nodes[3].weightPaintSettings === undefined, 'meshData untouched');
}

// ── 2. idempotent: re-running on v34 leaves existing intact ─────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', weightPaintSettings: { xMirror: true } },
      { id: 'p2', type: 'part' },  // missing
    ],
  };
  const r = migrateWeightPaintSettings(project);
  assert(r.added === 1, `added 1 (only the missing one), got ${r.added}`);
  assert(project.nodes[0].weightPaintSettings.xMirror === true,
    `p1 retains user-set xMirror=true, got ${project.nodes[0].weightPaintSettings.xMirror}`);
  assert(project.nodes[1].weightPaintSettings.xMirror === false, 'p2 default false');
}

// ── 3. no nodes / null project ──────────────────────────────────────
{
  const r = migrateWeightPaintSettings({ nodes: [] });
  assert(r.added === 0, 'empty nodes → added 0');
  const r2 = migrateWeightPaintSettings(null);
  assert(r2.added === 0, 'null project → added 0');
  const r3 = migrateWeightPaintSettings({});
  assert(r3.added === 0, 'no nodes field → added 0');
}

// ── 4. malformed weightPaintSettings replaced ──────────────────────
{
  const project = {
    nodes: [
      // missing xMirror sub-key — replaced
      { id: 'p1', type: 'part', weightPaintSettings: { other: 'junk' } },
      // xMirror not boolean — replaced
      { id: 'p2', type: 'part', weightPaintSettings: { xMirror: 'true' } },
    ],
  };
  const r = migrateWeightPaintSettings(project);
  assert(r.added === 2, `replaced 2 malformed, got ${r.added}`);
  assert(project.nodes[0].weightPaintSettings.xMirror === false, 'p1 reset');
  assert(project.nodes[1].weightPaintSettings.xMirror === false, 'p2 reset');
}

// ── 5. full migrateProject walks v33 → v34 ──────────────────────────
{
  const project = {
    schemaVersion: 33,
    canvas: { width: 800, height: 600 },
    nodes: [{ id: 'p', type: 'part' }],
    cursor: { x: 400, y: 300 },
  };
  migrateProject(project);
  // Note: assertion uses CURRENT_SCHEMA_VERSION since v35 (Phase 8 audit-fix
  // D-3) extends past v34; the v34 field assertion still verifies that the
  // v34 step actually ran during the walk.
  assert(project.schemaVersion >= 34, `walked past v33, got ${project.schemaVersion}`);
  assert(project.nodes[0].weightPaintSettings.xMirror === false, 'v34 field added via full migrate');
}

// ── 6. fresh project at v0 walks all the way to current schema ─────
{
  const project = {
    nodes: [{ id: 'p', type: 'part' }],
  };
  migrateProject(project);
  // Per CURRENT_SCHEMA_VERSION; v34 assertion is the v34-specific field check below.
  assert(project.schemaVersion >= 34, `v0 → current schema, got ${project.schemaVersion}`);
  assert(project.nodes[0].weightPaintSettings.xMirror === false, 'fresh part has xMirror=false');
  assert(project.cursor && typeof project.cursor.x === 'number', 'fresh project also has v33 cursor');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
