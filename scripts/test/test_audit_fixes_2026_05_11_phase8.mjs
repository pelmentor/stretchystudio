// Phase 8 audit-fix sweep — pin every FIX in place against regression.
//
// Sister to scripts/test/test_audit_fixes_2026_05_11_phase7c.mjs.
// One block per gap, tagged G-N (architecture audit) or D-N (data-
// integrity audit), asserts the fixed behavior or the fixed contract.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase8.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isBoneGroup,
  ensureBonePoseChannel,
  setBonePoseField,
  setBonePose,
  getBonePose,
} from '../../src/store/objectDataAccess.js';
import { evaluateRnaPath, setRnaPath } from '../../src/anim/rnaPath.js';
import { computeWorldMatrices } from '../../src/renderer/transforms.js';
import { migratePoseShapeRepair } from '../../src/store/migrations/v35_pose_shape_repair.js';
import { CURRENT_SCHEMA_VERSION } from '../../src/store/projectSchemaVersion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── G-1/D-1: bonePostChain partial-graph fallback uses getBonePose ──────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/depgraph/kernels/bonePostChain.js'), 'utf8');
  assert(src.includes('getBonePose(bone)'),
    'G-1/D-1: bonePostChain falls back through getBonePose, not raw node.pose');
  assert(src.includes('Audit-fix G-1/D-1'),
    'G-1/D-1: breadcrumb to audit gap retained');
}

// ── G-2/D-2: transformCompose synthetic pose bases off getBonePose ──────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/depgraph/kernels/transformCompose.js'), 'utf8');
  assert(src.includes('getBonePose(node)'),
    'G-2/D-2: transformCompose synthetic pose bases off getBonePose');
  assert(src.includes('Audit-fix G-2/D-2'),
    'G-2/D-2: breadcrumb to audit gap retained');
}

// ── D-3: v35 migration repairs mixed-state pose corruption ──────────────────
{
  // Audit-pin's original assertion was `CURRENT_SCHEMA_VERSION === 35`,
  // pinning the v35 ship. Subsequent migrations (v36 Action datablock,
  // 2026-05-11) bumped it further. The functional invariant — that
  // v35 still runs and repairs mixed-state pose — is what the pin
  // really cares about; the version-equality check is replaced by
  // "v35 is still in the migration walker's path".
  assert(CURRENT_SCHEMA_VERSION >= 35,
    `D-3: schema is at v35 or later (got ${CURRENT_SCHEMA_VERSION})`);
  // Functional repair test
  const project = {
    schemaVersion: 34,
    nodes: [{
      id: 'bone-x', type: 'group', boneRole: 'leftElbow',
      transform: { pivotX: 0, pivotY: 0 },
      pose: { rotation: 1.2, channels: { 'bone-x': { rotation: 0.5 } } },
    }],
  };
  const r = migratePoseShapeRepair(project);
  assert(r.repaired === 1, 'D-3: mixed-state bone repaired');
  assert(project.nodes[0].pose.rotation === undefined, 'D-3a: flat rotation stripped');
  assert(project.nodes[0].pose.channels['bone-x'].rotation === 1.2, 'D-3b: latest-wins (1.2 not 0.5)');
}

// ── G-3/D-4: rnaPath routes pose access through helpers ─────────────────────
{
  const project = {
    nodes: [{
      id: 'bone-rna', type: 'group', boneRole: 'leftElbow',
      transform: { pivotX: 0, pivotY: 0 },
      pose: { channels: { 'bone-rna': { rotation: 0.42, x: 7, y: 0, scaleX: 1, scaleY: 1 } } },
    }],
  };
  const rot = evaluateRnaPath(project, 'objects["bone-rna"].pose.rotation');
  assert(near(rot, 0.42), `G-3/D-4: read channels-shape rotation via rnaPath → ${rot}`);
  const x = evaluateRnaPath(project, 'objects["bone-rna"].pose.x');
  assert(near(x, 7), `G-3/D-4a: read channels-shape x via rnaPath → ${x}`);

  // Write via rnaPath: should hit the helper, not corrupt envelope.
  const ok = setRnaPath(project, 'objects["bone-rna"].pose.rotation', 0.9);
  assert(ok === true, 'G-3/D-4b: setRnaPath returns true on bone pose path');
  assert(project.nodes[0].pose.rotation === undefined,
    'G-3/D-4c: write did NOT create mixed-state (no flat field on envelope)');
  assert(project.nodes[0].pose.channels['bone-rna'].rotation === 0.9,
    'G-3/D-4d: write landed in channels[id].rotation');
}

// ── G-4: setBonePose(node, {}) does NOT mutate pose-less bone ───────────────
{
  const b = {
    id: 'b-g4', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
  };
  setBonePose(b, {});
  assert(b.pose === undefined, 'G-4: empty-write no-ops on pose-less bone');
  setBonePose(b, { foo: 'bar' });
  assert(b.pose === undefined, 'G-4a: junk-field-only partial no-ops');
}

// ── G-5/G-6: array-shape pose / channels rejected ───────────────────────────
{
  const b = {
    id: 'b-arr', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: [],  // malformed array
  };
  ensureBonePoseChannel(b);
  assert(!Array.isArray(b.pose), 'G-5/G-6: array pose replaced with object');
}

// ── D-6: getBonePose contract documented ────────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/store/objectDataAccess.js'), 'utf8');
  assert(src.includes('Audit-fix D-6'),
    'D-6: null-vs-identity contract documented in getBonePose docstring');
}

// ── D-5: ensureBonePoseChannel foreign-channels deviation documented ────────
{
  const src = readFileSync(join(repoRoot, 'src/store/objectDataAccess.js'), 'utf8');
  assert(src.includes('Audit-fix D-5'),
    'D-5: foreign-channels behavior documented in ensureBonePoseChannel docstring');
}

// ── G-10/D-7: object/mirror.js bone-skip comment corrected ──────────────────
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/object/mirror.js'), 'utf8');
  assert(src.includes('Audit-fix G-10/D-7'),
    'G-10/D-7: object/mirror comment updated with bone-skip context');
}

// ── G-11: PoseService.restorePose retains isBoneGroup early-out ─────────────
{
  const src = readFileSync(join(repoRoot, 'src/services/PoseService.js'), 'utf8');
  assert(src.includes('Audit-fix G-11'),
    'G-11: isBoneGroup early-out documented in restorePose');
}

// ── G-12: rnaPath docstring drift removed ───────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/rnaPath.js'), 'utf8');
  // Find the supported-paths bullet list (lines after `* property addresses SS exposes`)
  // and confirm `__armature__.pose.channels` isn't in it.
  const headerMatch = src.match(/property addresses SS exposes today[\s\S]+?Indexing is bracket-style/);
  assert(headerMatch, 'G-12: header section locatable');
  if (headerMatch) {
    const header = headerMatch[0];
    assert(!header.includes("__armature__'].pose.channels"),
      'G-12: aspirational __armature__ pose.channels path absent from supported-paths bullet list');
  }
  assert(src.includes('Audit-fix G-12'),
    'G-12: removal documented');
}

// ── G-13: bonePostChain partial-graph fallback contract documented ──────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/depgraph/kernels/bonePostChain.js'), 'utf8');
  assert(src.includes('Audit-fix G-13'),
    'G-13: partial-graph fallback contract documented');
}

// ── Functional end-to-end: render path reads v19 bones correctly ────────────
{
  // Compose a project with one v19 channels-shape bone with rotation 30°
  // (makeBoneLocalMatrix takes degrees per `transforms.js`). Without the
  // G-1 fix, computeWorldMatrices would read identity → m[0]=1. With
  // the fix, m[0]=cos(30°)≈0.866.
  const ROT_DEG = 30;
  const project = {
    nodes: [{
      id: 'render-b', type: 'group', boneRole: 'leftElbow',
      parent: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 100 },
      pose: { channels: { 'render-b': { rotation: ROT_DEG, x: 0, y: 0, scaleX: 1, scaleY: 1 } } },
    }],
  };
  const wm = computeWorldMatrices(project.nodes);
  const m = wm.get('render-b');
  assert(m !== undefined, 'render: world matrix exists');
  const expected = Math.cos(ROT_DEG * Math.PI / 180);
  assert(near(m[0], expected, 1e-4),
    `render: m[0] = cos(${ROT_DEG}°) ≈ ${expected.toFixed(4)} (got ${m[0]}) — channels-shape rotation applied`);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) console.error('\nFailures:\n' + failures.map(f => '  - ' + f).join('\n'));
process.exit(failed > 0 ? 1 : 0);
