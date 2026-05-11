// Animation Phase 1 Stage 1.F (pre-exit) — NodeTree retirement pin.
//
// Pins:
//   1. CURRENT_SCHEMA_VERSION = 38 (the retirement bump).
//   2. v38 migration deletes `project.nodeTrees` from older saves
//      idempotently.
//   3. v22 / v23 / v24 entries in projectMigrations.js are no-op
//      shims (the migration MODULES are deleted from disk per
//      Rule №2; the entries stay only for the contiguous-version
//      walker invariant).
//   4. Source-grep gates: NodeTreeArea.jsx no longer reads
//      `project.nodeTrees`; FCurveStrip executor no longer carries
//      the legacy `storage.track` shadow branch; v22/v23/v24
//      migration modules no longer exist on disk.
//   5. Fresh project + projectRoundTrip do not introduce a
//      `project.nodeTrees` field.
//
// Run: node scripts/test/test_nodetree_retirement.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CURRENT_SCHEMA_VERSION, migrateProject } from '../../src/store/projectMigrations.js';
import { migrateNodeTreeRetirement } from '../../src/store/migrations/v38_nodetree_retirement.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (a === b || JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`);
}

function readSrc(rel) {
  return readFileSync(join(REPO, rel), 'utf8');
}

// Strip JSDoc / block comments + line comments so pattern-grep
// for production reads doesn't match prose inside docstrings.
function stripComments(src) {
  return src
    .replace(/\r\n/g, '\n')
    // Block comments: /* ... */ (non-greedy, multi-line)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments: // ... up to EOL
    .replace(/\/\/[^\n]*/g, '');
}

// ---- 1. Schema version bumped to 38 ----

assertEq(CURRENT_SCHEMA_VERSION, 38,
  'CURRENT_SCHEMA_VERSION = 38 (NodeTree retirement bump)');

// ---- 2a. v38 migration deletes project.nodeTrees ----

{
  const project = {
    nodeTrees: { rig: { face: { id: 'rig:face', nodes: [], links: [] } },
                 driver: {}, animation: {} },
    nodes: [],
  };
  migrateNodeTreeRetirement(project);
  assert(!('nodeTrees' in project),
    'v38: project.nodeTrees deleted after migration');
}

// ---- 2b. v38 idempotent on missing field ----

{
  const project = { nodes: [] };  // no nodeTrees
  migrateNodeTreeRetirement(project);
  assert(!('nodeTrees' in project),
    'v38 idempotent: missing nodeTrees stays absent');
}

// ---- 2c. v38 idempotent on re-run ----

{
  const project = { nodeTrees: { rig: {}, driver: {}, animation: {} }, nodes: [] };
  migrateNodeTreeRetirement(project);
  migrateNodeTreeRetirement(project);
  assert(!('nodeTrees' in project),
    'v38 idempotent: re-run keeps nodeTrees absent');
}

// ---- 2d. v38 leaves other fields untouched ----

{
  const project = {
    nodeTrees: { rig: {}, driver: {}, animation: {} },
    nodes: [{ id: 'face', type: 'part' }],
    parameters: [{ id: 'P1', default: 0 }],
    actions: [{ id: 'a1', name: 'Idle', fcurves: [] }],
    canvas: { width: 800, height: 600 },
  };
  migrateNodeTreeRetirement(project);
  assert(!('nodeTrees' in project), 'v38: nodeTrees gone');
  assertEq(project.nodes.length, 1, 'v38: nodes preserved');
  assertEq(project.parameters.length, 1, 'v38: parameters preserved');
  assertEq(project.actions.length, 1, 'v38: actions preserved');
  assertEq(project.canvas.width, 800, 'v38: canvas preserved');
}

// ---- 2e. v38 e2e via migrateProject (v0 fixture → v38) ----

{
  const project = {
    nodes: [{ id: 'face', type: 'part',
              mesh: { vertices: [], uvs: [], triangles: [] } }],
    parameters: [],
  };
  migrateProject(project);
  assertEq(project.schemaVersion, 38, 'e2e: schemaVersion bumped to 38');
  assert(!('nodeTrees' in project),
    'e2e v0 → v38: no nodeTrees field on the migrated project');
}

// ---- 2f. v38 e2e via migrateProject (v37 fixture WITH nodeTrees → v38) ----

{
  const project = {
    schemaVersion: 37,
    nodeTrees: {
      rig: { face: { id: 'rig:face', nodes: [], links: [] } },
      driver: {},
      animation: {},
    },
    nodes: [{ id: 'face', type: 'part' }],
    parameters: [],
    actions: [],
  };
  migrateProject(project);
  assertEq(project.schemaVersion, 38, 'v37 → v38 fixture: schemaVersion bumped');
  assert(!('nodeTrees' in project),
    'v37 → v38 fixture: nodeTrees field stripped on migration');
}

// ---- 3. v22 / v23 / v24 entries are no-op shims ----

{
  const src = readSrc('src/store/projectMigrations.js');
  // v22 — should be `22: (project) => project,`
  assert(/22:\s*\(project\)\s*=>\s*project,/.test(src),
    'v22 entry: no-op shim `22: (project) => project,`');
  assert(/23:\s*\(project\)\s*=>\s*project,/.test(src),
    'v23 entry: no-op shim `23: (project) => project,`');
  assert(/24:\s*\(project\)\s*=>\s*project,/.test(src),
    'v24 entry: no-op shim `24: (project) => project,`');
  // v38 entry must call migrateNodeTreeRetirement.
  assert(/38:\s*\(project\)\s*=>\s*\{\s*migrateNodeTreeRetirement\(project\);/.test(src),
    'v38 entry: dispatches to migrateNodeTreeRetirement');
  // The deleted migration imports must NOT appear.
  assert(!/migrateNodeTreeRigTree/.test(src),
    'projectMigrations: no import of migrateNodeTreeRigTree');
  assert(!/migrateNodeTreeDriverTree/.test(src),
    'projectMigrations: no import of migrateNodeTreeDriverTree');
  assert(!/migrateNodeTreeAnimationTree/.test(src),
    'projectMigrations: no import of migrateNodeTreeAnimationTree');
}

// ---- 4. Migration MODULES deleted from disk ----

assert(!existsSync(join(REPO, 'src/store/migrations/v22_nodetree_rigtree.js')),
  'v22_nodetree_rigtree.js: deleted from disk');
assert(!existsSync(join(REPO, 'src/store/migrations/v23_nodetree_drivertree.js')),
  'v23_nodetree_drivertree.js: deleted from disk');
assert(!existsSync(join(REPO, 'src/store/migrations/v24_nodetree_animationtree.js')),
  'v24_nodetree_animationtree.js: deleted from disk');
assert(existsSync(join(REPO, 'src/store/migrations/v38_nodetree_retirement.js')),
  'v38_nodetree_retirement.js: present on disk');

// ---- 5. NodeTreeArea source-grep gates (production code only — JSDoc stripped) ----

{
  const rawSrc = readSrc('src/v3/editors/nodetree/NodeTreeArea.jsx');
  const src = stripComments(rawSrc);
  // No more reading from project.nodeTrees.
  assert(!/project\.nodeTrees/.test(src) && !/project\?\.nodeTrees/.test(src) && !/_proj\.nodeTrees/.test(src),
    'NodeTreeArea: no `project.nodeTrees` reads in production code');
  // Compile passes are imported (on-the-fly derive). Imports survive comment stripping.
  assert(/from ['"][^'"]*nodetree\/build(?:\.js)?['"]/.test(src),
    'NodeTreeArea: imports buildRigTreeForPart from nodetree/build');
  assert(/from ['"][^'"]*nodetree\/driverCompile(?:\.js)?['"]/.test(src),
    'NodeTreeArea: imports compileDriverTree from nodetree/driverCompile');
  assert(/from ['"][^'"]*nodetree\/animationCompile(?:\.js)?['"]/.test(src),
    'NodeTreeArea: imports compileAnimationTree from nodetree/animationCompile');
  // Side-effect imports for node-type label registration (replaces v23/v24
  // side-effect imports).
  assert(/import ['"][^'"]*nodetree\/nodes\/drivers(?:\.js)?['"];/.test(src),
    'NodeTreeArea: side-effect-imports nodes/drivers.js');
  assert(/import ['"][^'"]*nodetree\/nodes\/animation(?:\.js)?['"];/.test(src),
    'NodeTreeArea: side-effect-imports nodes/animation.js');
}

// ---- 6. FCurveStrip executor: legacy `storage.track` branch removed ----

{
  const rawSrc = readSrc('src/anim/nodetree/nodes/animation.js');
  const src = stripComments(rawSrc);
  // Pre-retirement the executor had `const track = node.storage?.track;`
  // followed by an entire alternate branch reading `track.paramId` etc.
  // Post-retirement the only storage shape is `storage.fcurve`.
  assert(!/node\.storage\?\.track/.test(src),
    'FCurveStrip executor: no `node.storage?.track` legacy branch in production code');
  assert(!/track\.paramId/.test(src) && !/track\.keyframes/.test(src),
    'FCurveStrip executor: no `track.paramId` / `track.keyframes` reads in production code');
  assert(/node\.storage\?\.fcurve/.test(src),
    'FCurveStrip executor: still reads `node.storage?.fcurve`');
}

// ---- 7. v38 retirement migration JSDoc cites Rule №2 + plan ----

{
  const src = readSrc('src/store/migrations/v38_nodetree_retirement.js');
  assert(/NodeTree retirement/.test(src),
    'v38 module: documents NodeTree retirement intent');
  assert(/Rule\s+№?2|migration baggage/.test(src),
    'v38 module: cites Rule №2 / migration baggage');
}

// ---- 8. animationCompile.js JSDoc reflects sole-compile-path status ----

{
  const src = readSrc('src/anim/nodetree/animationCompile.js');
  assert(/SOLE compile path|sole compile path/.test(src),
    'animationCompile JSDoc: documents post-v38 sole-compile-path status');
}

// ---- 9. package.json test scripts updated ----

{
  const pkg = readSrc('package.json');
  assert(!/test:nodetreeMigration/.test(pkg),
    'package.json: test:nodetreeMigration script removed');
  assert(!/test:driverTreeMigration/.test(pkg),
    'package.json: test:driverTreeMigration script removed');
  assert(!/test:animationTreeMigration/.test(pkg),
    'package.json: test:animationTreeMigration script removed');
  assert(/test:nodetreeRetirement/.test(pkg),
    'package.json: test:nodetreeRetirement script added');
  assert(/test:animationTreeCompile/.test(pkg),
    'package.json: test:animationTreeCompile script added');
}

// ---- Result ----

console.log(`nodetree_retirement: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
