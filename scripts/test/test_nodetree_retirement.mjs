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

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { CURRENT_SCHEMA_VERSION, migrateProject } from '../../src/store/projectMigrations.js';
import { migrateNodeTreeRetirement } from '../../src/store/migrations/v38_nodetree_retirement.js';
import * as buildModule from '../../src/anim/nodetree/build.js';
import * as evalModule from '../../src/anim/nodetree/eval.js';

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

// Recursive walker for repo-wide grep. Yields .js / .jsx file paths
// under the given root. Skips node_modules / .git / build artifacts.
function* walkJsFiles(root) {
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    const st = statSync(cur);
    if (st.isDirectory()) {
      const base = cur.split(/[\\/]/).pop();
      if (base === 'node_modules' || base === '.git' || base === 'dist' || base === 'build') continue;
      for (const entry of readdirSync(cur)) {
        stack.push(join(cur, entry));
      }
    } else if (st.isFile()) {
      if (/\.(js|jsx)$/.test(cur)) yield cur;
    }
  }
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

// ---- 10. Audit-fix G-1 + G-2 + D-1: dead-write helpers deleted ----

{
  // build.js: buildRigTreesForProject + buildNodeTreesFromProject gone
  assert(typeof buildModule.buildRigTreeForPart === 'function',
    'build.js: buildRigTreeForPart export preserved (used by NodeTreeArea)');
  assert(typeof buildModule.buildRigTreesForProject === 'undefined',
    'audit-fix G-1: buildRigTreesForProject export deleted');
  assert(typeof buildModule.buildNodeTreesFromProject === 'undefined',
    'audit-fix G-1: buildNodeTreesFromProject export deleted');
  // eval.js: evalAllRigTrees gone; evalNodeTree preserved (test harness)
  assert(typeof evalModule.evalNodeTree === 'function',
    'eval.js: evalNodeTree export preserved (test harness)');
  assert(typeof evalModule.evalAllRigTrees === 'undefined',
    'audit-fix G-2: evalAllRigTrees export deleted');
}

// ---- 11. Audit-fix G-3: NodeTreeEditor s.track branch deleted ----

{
  const rawSrc = readSrc('src/v3/editors/nodetree/NodeTreeEditor.jsx');
  const src = stripComments(rawSrc);
  assert(!/s\.track/.test(src) && !/s\.track\?\./.test(src),
    'audit-fix G-3: NodeTreeEditor.nodeSubtitle has no `s.track` branch');
  assert(!/track\.paramId/.test(src) && !/track\.property/.test(src) && !/track\.nodeId/.test(src),
    'audit-fix G-3: NodeTreeEditor has no legacy track field reads');
  // Post-fix the new branch reads s.fcurve.rnaPath.
  assert(/s\.fcurve\?\.rnaPath/.test(src),
    'audit-fix G-3: NodeTreeEditor.nodeSubtitle reads s.fcurve.rnaPath (post-v36 shape)');
}

// ---- 12. Audit-fix G-4: repo-wide grep finds zero production `project.nodeTrees` reads ----

{
  const srcRoot = join(REPO, 'src');
  // The v38 retirement migration itself contains `delete project.nodeTrees`
  // by design — that's the cleanup operation. Exempt it from the grep.
  const EXEMPT = new Set([
    join('src', 'store', 'migrations', 'v38_nodetree_retirement.js'),
  ].map((p) => p.replace(/[\\/]/g, '/')));
  /** @type {string[]} */
  const offenders = [];
  for (const file of walkJsFiles(srcRoot)) {
    const relPath = relative(REPO, file).replace(/[\\/]/g, '/');
    if (EXEMPT.has(relPath)) continue;
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);
    if (/project\.nodeTrees|project\?\.nodeTrees|_proj\.nodeTrees|_project\.nodeTrees/.test(code)) {
      offenders.push(relPath);
    }
  }
  assert(offenders.length === 0,
    `audit-fix G-4: repo-wide grep finds zero \`project.nodeTrees\` reads in src/ (v38 retirement migration exempt) — offenders: ${offenders.join(', ') || '(none)'}`);
}

// ---- 13. Audit-fix D-2: v38 retirement migration cites Blender deviation ----

{
  const src = readSrc('src/store/migrations/v38_nodetree_retirement.js');
  assert(/ID_NT|first-class.+datablock|DNA_node_types\.h/.test(src),
    'audit-fix D-2: v38 migration JSDoc cites Blender ID_NT datablock deviation');
}

// ---- 14. Audit-fix D-3: build.js JSDoc reframed (canonical-modifier-stack framing) ----

{
  const src = readSrc('src/anim/nodetree/build.js');
  // Post-fix the JSDoc claims the modifier stack is canonical (not a
  // shadow), the rig tree is a visualisation only, and the V2 "flip
  // canonical → tree" bet is retired.
  assert(/SS-(?:specific|invented).+visualisation|synthesises.+visualisation|read-only graph/i.test(src),
    'audit-fix D-3: build.js JSDoc frames as SS-specific visualisation of canonical modifier stack');
  assert(/modifier stack stays canonical|canonical source|canonical.+permanently/i.test(src),
    'audit-fix D-3: build.js JSDoc declares modifier stack canonical (no flip pending)');
  assert(/V2 bet was retired|that bet was retired|V2 plan.+retired|retired with v38/i.test(src),
    'audit-fix D-3: build.js JSDoc notes the V2 architectural bet was retired with v38');
}

// ---- 15. Audit-fix D-4: animationCompile NLA Phase 4 TODO marker ----

{
  const src = readSrc('src/anim/nodetree/animationCompile.js');
  assert(/Phase 4|NLA/i.test(src),
    'audit-fix D-4: animationCompile JSDoc carries Phase 4 / NLA TODO marker');
  assert(/NlaStrip|DNA_anim_types\.h/.test(src),
    'audit-fix D-4: animationCompile JSDoc cites Blender NlaStrip / DNA_anim_types.h');
  assert(/rewrite|REWRITE/.test(src),
    'audit-fix D-4: animationCompile JSDoc warns Phase 4 needs REWRITE not extension');
}

// ---- 16. Audit-fix D-6: NodeTreeEditor read-only deviation note ----

{
  const src = readSrc('src/v3/editors/nodetree/NodeTreeEditor.jsx');
  assert(/read-only by design|Read-only by design/i.test(src),
    'audit-fix D-6: NodeTreeEditor JSDoc carries "Read-only by design" deviation note');
  assert(/space_node|node_edit\.cc/.test(src),
    'audit-fix D-6: NodeTreeEditor JSDoc cites Blender space_node / node_edit.cc');
}

// ---- 17. Audit-fix D-7: mode pill labels carry canonical-source hints ----

{
  const src = readSrc('src/v3/editors/nodetree/NodeTreeArea.jsx');
  assert(/Rig \(Modifiers\)/.test(src),
    'audit-fix D-7: rig mode pill label "Rig (Modifiers)"');
  assert(/Driver \(Expression\)/.test(src),
    'audit-fix D-7: driver mode pill label "Driver (Expression)"');
  assert(/Animation \(FCurves\)/.test(src),
    'audit-fix D-7: animation mode pill label "Animation (FCurves)"');
}

// ---- 18. Audit-fix D-8: NodeTreeType post-v38 deviation note ----

{
  const src = readSrc('src/anim/nodetree/types.js');
  assert(/visualisation discriminators|NOT schema-bound|not schema-bound/i.test(src),
    'audit-fix D-8: NodeTreeType JSDoc carries post-v38 deviation note');
}

// ---- 19. Audit-fix D-9: migration walker contiguous-version invariant documented ----

{
  const src = readSrc('src/store/projectMigrations.js');
  assert(/contiguous version|MAIN_VERSION_FILE_ATLEAST/.test(src),
    'audit-fix D-9: projectMigrations header documents contiguous-version invariant + Blender deviation');
  assert(/Retiring a migration/.test(src),
    'audit-fix D-9: projectMigrations header documents the retirement playbook');
}

// ---- 20. Audit-fix G-5: tree useMemo deps trimmed ----

{
  const rawSrc = readSrc('src/v3/editors/nodetree/NodeTreeArea.jsx');
  // Find the tree useMemo's dep array. The deps are stamped on a single
  // line ending with the close-bracket; assert `driverIds` is NOT in
  // that array.
  const m = rawSrc.match(/const tree = useMemo\([\s\S]*?\}, \[([^\]]+)\]\)/);
  assert(m != null, 'audit-fix G-5: tree useMemo found');
  if (m) {
    const deps = m[1];
    assert(!/\bdriverIds\b/.test(deps),
      'audit-fix G-5: tree useMemo deps no longer include driverIds');
    assert(/project\.parameters/.test(deps),
      'audit-fix G-5: tree useMemo deps still include project.parameters');
  }
}

// ---- Result ----

console.log(`nodetree_retirement: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
