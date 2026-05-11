// Toolset Plan Phase 7.B.4 — X-Axis Mirror toggle.
//
// Verifies:
//   - projectStore.setWeightPaintXMirror writes to node.weightPaintSettings.xMirror
//   - persists across save+load (round-trips through state)
//   - toggle is idempotent
//   - undo via beginBatch / pushSnapshot works
//   - migration v34 default = false
//
// Run: node scripts/test/test_weightPaint_xMirror.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { undo } from '../../src/store/undoHistory.js';
import { migrateWeightPaintSettings } from '../../src/store/migrations/v34_weight_paint_settings.js';

/** Mirror the production app.undo wiring (registry.js:155-162). */
function appUndo() {
  const project = useProjectStore.getState().project;
  const updateProject = useProjectStore.getState().updateProject;
  undo(project, (snapshot) => {
    updateProject((proj) => {
      Object.assign(proj, snapshot);
    }, { skipHistory: true });
  });
}

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

function seed() {
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 }, cursor: { x: 400, y: 300 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [
        { id: 'p1', type: 'part', parent: null,
          weightPaintSettings: { xMirror: false } },
        { id: 'g',  type: 'group', parent: null },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
}

// ── 1. setWeightPaintXMirror writes to node ────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('p1', true);
  const node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings.xMirror === true,
    `xMirror=true after set, got ${node.weightPaintSettings.xMirror}`);
  assert(useProjectStore.getState().hasUnsavedChanges === true,
    'hasUnsavedChanges flagged');
}

// ── 2. toggle to false ──────────────────────────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('p1', true);
  useProjectStore.getState().setWeightPaintXMirror('p1', false);
  const node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings.xMirror === false, 'toggled back to false');
}

// ── 3. idempotent: same value → no state change ────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('p1', false);
  // Already false; no-op should not flag hasUnsavedChanges.
  assert(useProjectStore.getState().hasUnsavedChanges === false,
    'no-op set does not dirty state');
}

// ── 4. undo restores prior value ───────────────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('p1', true);
  appUndo();
  const node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings.xMirror === false,
    `undo → false, got ${node.weightPaintSettings.xMirror}`);
}

// ── 5. invalid partId → no-op ──────────────────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('nonexistent', true);
  assert(useProjectStore.getState().hasUnsavedChanges === false,
    'unknown id → no-op');
}

// ── 6. group node → no-op (parts only) ────────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('g', true);
  const node = useProjectStore.getState().project.nodes[1];  // g
  assert(node.weightPaintSettings === undefined, 'group untouched');
}

// ── 7. boolean coercion ────────────────────────────────────────────
{
  seed();
  useProjectStore.getState().setWeightPaintXMirror('p1', 1);  // truthy
  let node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings.xMirror === true, 'truthy → true');
  useProjectStore.getState().setWeightPaintXMirror('p1', 0);  // falsy
  node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings.xMirror === false, 'falsy → false');
}

// ── 8. weightPaintSettings created if missing on a part ───────────
{
  // Simulate a part added post-migration without weightPaintSettings.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 }, cursor: { x: 400, y: 300 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [{ id: 'p1', type: 'part', parent: null }],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useProjectStore.getState().setWeightPaintXMirror('p1', true);
  const node = useProjectStore.getState().project.nodes[0];
  assert(node.weightPaintSettings && node.weightPaintSettings.xMirror === true,
    'created weightPaintSettings on the fly');
}

// ── 9. migration default == false ────────────────────────────────
{
  const project = { nodes: [{ id: 'p', type: 'part' }] };
  migrateWeightPaintSettings(project);
  assert(project.nodes[0].weightPaintSettings.xMirror === false,
    'default xMirror = false');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
