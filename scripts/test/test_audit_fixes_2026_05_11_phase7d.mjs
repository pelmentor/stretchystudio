// Phase 7.D audit-fix sweep — pin every FIX in place against regression.
//
// Sister to scripts/test/test_audit_fixes_2026_05_11_phase8.mjs.
// One block per gap, tagged G-N (architecture audit) or D-N (docs/
// consistency audit), asserts the fixed behavior or the fixed contract.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase7d.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

// Read package.json + plan doc + close-out once.
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const chain = pkg.scripts?.test ?? '';
const planDoc = readFileSync(join(repoRoot, 'docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md'), 'utf8');
const closeoutDoc = readFileSync(join(repoRoot, 'docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE7D.md'), 'utf8');

// ── G-1: spatialHash wired into npm test chain ─────────────
// (G-1a/G-1c originally pinned `test:typedArrayPool` to run right after
// `test:chainEval`; both tests were retired 2026-05-26 alongside the
// chainEval engine itself — see [[chainEval-retirement-2026-05-26]] /
// `scripts/test/realRigHarness.mjs`'s docstring. Only the spatialHash
// insertion-point assertion survives.)
{
  assert(/npm run test:spatialHash\b/.test(chain),
    'G-1b: chain invokes test:spatialHash');
  assert(chain.includes('test:meshSample && npm run test:spatialHash'),
    'G-1d: spatialHash inserted right after meshSample');
}

// ── G-2: migrationV35 alias positioned with V33/V34 in the alias block ──────
{
  // The alias section should run V33 → V34 → V35 contiguously.
  const aliasBlock = JSON.stringify(pkg.scripts);
  const v34Idx = aliasBlock.indexOf('"test:migrationV34"');
  const v35Idx = aliasBlock.indexOf('"test:migrationV35"');
  const poseHelpersIdx = aliasBlock.indexOf('"test:poseWriterHelpers"');
  assert(v34Idx > 0 && v35Idx > v34Idx, 'G-2a: migrationV35 alias appears after migrationV34 alias');
  assert(v35Idx < poseHelpersIdx, 'G-2b: migrationV35 alias appears BEFORE poseWriterHelpers alias');
}

// ── G-3: no `&&npm` (no-space) in chain ─────────────────────────────────────
{
  assert(!/&&npm /.test(chain), 'G-3: chain has no &&npm without space');
}

// ── G-1 completeness: every test_*.mjs on disk is also in the chain (modulo allowlist) ──
{
  // The orphan-detection invariant. If this fails, a new orphan was added.
  // Any scripts deliberately excluded from the chain should be listed in
  // ALLOWLIST below with a one-line reason.
  const ALLOWLIST = new Set([
    // (none today)
  ]);
  const { readdirSync } = await import('node:fs');
  const testFiles = readdirSync(join(repoRoot, 'scripts/test'))
    .filter((f) => f.startsWith('test_') && f.endsWith('.mjs'));

  // Build a set of script names invoked by `npm run test:*` aliases that the
  // chain includes.
  const chainAliases = (chain.match(/npm run (test:[a-zA-Z0-9_]+)/g) ?? [])
    .map((s) => s.slice(8));
  const chainScriptFiles = new Set();
  for (const alias of chainAliases) {
    const cmd = pkg.scripts[alias];
    if (!cmd) continue;
    const m = cmd.match(/scripts\/test\/(test_[a-zA-Z0-9_]+\.mjs)/);
    if (m) chainScriptFiles.add(m[1]);
  }

  const orphans = testFiles.filter((f) => !chainScriptFiles.has(f) && !ALLOWLIST.has(f));
  assert(orphans.length === 0,
    `G-1 completeness: no orphan test files (found: ${orphans.join(', ') || 'none'})`);
}

// ── D-1: §9 file index migration filenames are correct ─────────────────────
{
  assert(planDoc.includes('src/store/migrations/v33_project_cursor.js'),
    'D-1a: §9 cites real v33_project_cursor.js');
  assert(planDoc.includes('src/store/migrations/v34_weight_paint_settings.js'),
    'D-1b: §9 cites real v34_weight_paint_settings.js');
  assert(!planDoc.includes('v33_toolset_cursor.js'),
    'D-1c: stale v33_toolset_cursor.js name removed');
  assert(!planDoc.includes('v34_toolset_xMirror.js'),
    'D-1d: stale v34_toolset_xMirror.js name removed');
}

// ── D-2: §9 pose operator filenames + chord correct ────────────────────────
{
  assert(planDoc.includes('src/v3/operators/pose/clearTransform.js'),
    'D-2a: §9 cites real clearTransform.js');
  assert(planDoc.includes('src/v3/operators/pose/mirror.js'),
    'D-2b: §9 cites real pose/mirror.js');
  assert(!planDoc.includes('src/v3/operators/pose/clearLocation.js'),
    'D-2c: fictional clearLocation.js removed from §9');
  assert(!planDoc.includes('src/v3/operators/pose/clearRotation.js'),
    'D-2d: fictional clearRotation.js removed from §9');
  assert(!planDoc.includes('src/v3/operators/pose/clearScale.js'),
    'D-2e: fictional clearScale.js removed from §9');
  assert(!planDoc.includes('src/v3/operators/pose/clearAll.js'),
    'D-2f: fictional clearAll.js removed from §9');
  assert(!planDoc.includes('src/v3/operators/pose/copyPaste.js'),
    'D-2g: fictional copyPaste.js removed from §9');
  // The §9 pose mirror.js entry should mention BOTH chords (Ctrl+Shift+M for
  // Select Mirror + Ctrl+Shift+V for Mirror Pose) — no longer the wrong
  // single-chord pre-audit-fix description.
  const poseMirrorRow = planDoc.split('\n').find((l) =>
    l.includes('src/v3/operators/pose/mirror.js')) ?? '';
  assert(poseMirrorRow.includes('Ctrl+Shift+V'),
    'D-2h: pose/mirror.js row mentions Ctrl+Shift+V (Mirror Pose chord)');
}

// ── Sister sweep: §9 entries that exist on disk, fictional ones removed ────
{
  // Files that should appear in §9 (present on disk):
  const presentFiles = [
    'src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx',
    'src/v3/operators/select/linked.js',
    'src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx',
    'src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx',
    'src/lib/snap/index.js',
    'src/lib/sculpt/pinch.js',
    'src/v3/shell/ApplyMenu.jsx',
    'src/lib/meshTopology.js',
    'src/store/migrations/v35_pose_shape_repair.js',
  ];
  for (const path of presentFiles) {
    assert(existsSync(join(repoRoot, path)) && planDoc.includes(path),
      `sister-sweep: §9 cites real on-disk path ${path}`);
  }
  // Files that were fictional and must NOT appear in §9:
  const fictionalFiles = [
    'src/v3/operators/select/box.js',
    'src/v3/operators/select/lasso.js',
    'src/v3/operators/select/circle.js',
    'src/v3/shell/BoxSelectOverlay.jsx',
    'src/v3/shell/LassoSelectOverlay.jsx',
    'src/v3/shell/CircleSelectOverlay.jsx',
    'src/lib/sculpt/inflate.js',
    'src/v3/editors/viewport/overlays/SculptCursorOverlay.jsx',
    'src/v3/operators/apply/menu.js',
    'src/v3/operators/object/clearParent.js',
    'src/lib/weightPaint/mirrorMap.js',
  ];
  for (const path of fictionalFiles) {
    assert(!planDoc.includes(path),
      `sister-sweep: fictional path ${path} removed from §9`);
  }
}

// ── D-3: close-out doc Phase 7.D commit hash filled in ─────────────────────
{
  assert(closeoutDoc.includes('59fedac'),
    'D-3a: close-out doc cites real Phase 7.D commit hash');
  assert(!closeoutDoc.includes('_pending_'),
    'D-3b: close-out doc has no remaining _pending_ placeholders');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
process.exit(failed > 0 ? 1 : 0);
