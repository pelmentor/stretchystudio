// Tests for migration v33 — `project.cursor: {x, y}`.
// Run: node scripts/test/test_migrationV33.mjs

import { migrateProjectCursor } from '../../src/store/migrations/v33_project_cursor.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

// ── 1. Direct migrator: missing cursor → adds at canvas centre ────
{
  const project = { canvas: { width: 1024, height: 768 } };
  const r = migrateProjectCursor(project);
  assert(r.added === true, 'reports added=true');
  assert(project.cursor.x === 512 && project.cursor.y === 384,
    `cursor at (canvas.w/2, canvas.h/2), got (${project.cursor.x},${project.cursor.y})`);
}

// ── 2. Direct migrator: existing cursor preserved ─────────────────
{
  const project = { canvas: { width: 1024, height: 768 }, cursor: { x: 100, y: 200 } };
  const r = migrateProjectCursor(project);
  assert(r.added === false, 'reports added=false');
  assert(project.cursor.x === 100 && project.cursor.y === 200, 'existing cursor preserved');
}

// ── 3. Direct migrator: missing canvas → fallback to (800/2, 600/2) ─
{
  const project = {};
  migrateProjectCursor(project);
  assert(project.cursor.x === 400 && project.cursor.y === 300,
    `default canvas (800x600), got (${project.cursor.x},${project.cursor.y})`);
}

// ── 4. Direct migrator: malformed cursor (missing field) overwritten ─
{
  const project = { canvas: { width: 800, height: 600 }, cursor: { x: 'bad' } };
  migrateProjectCursor(project);
  assert(project.cursor.x === 400 && project.cursor.y === 300,
    'malformed cursor replaced with default');
}

// ── 5. Full migrateProject: pre-v33 save gets cursor + bumps version ─
{
  const project = {
    schemaVersion: 32,
    version: '0.1',
    canvas: { width: 1024, height: 768, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [], animations: [], parameters: [], physics_groups: [],
  };
  migrateProject(project);
  assert(project.schemaVersion === CURRENT_SCHEMA_VERSION,
    `bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(project.cursor && project.cursor.x === 512 && project.cursor.y === 384,
    `cursor seeded at canvas centre, got ${JSON.stringify(project.cursor)}`);
}

// ── 6. Already-v33 project: cursor preserved through migrateProject ─
{
  const project = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    version: '0.1',
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    cursor: { x: 50, y: 60 },
    textures: [], nodes: [], animations: [], parameters: [], physics_groups: [],
  };
  migrateProject(project);
  assert(project.cursor.x === 50 && project.cursor.y === 60,
    'cursor unchanged on already-current save');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
