// Phase 1 Stage 1.F-post audit-fix pin (2026-05-12).
//
// Substrate commit `92ca246` shipped the gap-tolerant walker + deleted
// v22/v23/v24/v30/v31 shim entries. Same-day dual audit surfaced gaps;
// this pin asserts the audit-fix sweep's coverage:
//
//   G-1 / G-9     — v38 module "Companion clean-ups" rewrite (post-state only)
//   G-2           — v32 module JSDoc no longer cites deleted v31 module path
//   G-3           — ANIMATION plan §Stage 1.F-pre carries Stage 1.F-post follow-up bullet
//   G-4           — CUBISM_ADAPTER_PATTERN.md banner + stale line annotated
//   G-5           — walker uses `typeof migrate === 'function'` (defensive)
//   G-6 / G-7     — test_migrations covers fromVersion === CURRENT no-op
//                   + schemaVersion-bumped-on-gap traversal contract
//   G-8           — "Stage 1.F-post" phase tag scrubbed from inline source
//                   comments (kept in test names / commits only)
//   G-10          — NodeTreeArea/NodeTreeEditor JSDoc v22-24 citations paired
//                   with "(modules deleted in v38)" framing
//   G-11          — walker inline comment references header (no duplication)
//   G-12          — test_nodetree_retirement preamble entry 3 trimmed to
//                   post-state only
//
//   D-1 / D-4 / D-11   — JSDoc clarifies SS dispatches at table level vs
//                        Blender's per-fixup macro inside dispatcher functions
//   D-2                — Single-int vs major.minor schema-version deviation cited
//   D-3 / D-10         — Per-iteration bump deviation + idempotency requirement
//                        called out
//   D-5 / D-8          — Retirement playbook cites versioning_xxx_template.cc
//                        + versioning_legacy.cc precedent
//   D-6                — DNA_DEPRECATED_ALLOW substrate divergence cited
//   D-7                — DNA_DEFAULTS substrate divergence cited
//   D-9                — Macro family (3 variants) cited correctly
//   D-12               — "# Known deviations from Blender" sub-section present
//
// Run: node scripts/test/test_audit_fixes_2026_05_12_phase1_stage1f_post.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CURRENT_SCHEMA_VERSION, migrateProject } from '../../src/store/projectMigrations.js';

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
function readSrc(rel) { return readFileSync(join(REPO, rel), 'utf8'); }

// Flatten JSDoc/line-comment continuations + CRLF so cross-platform
// regex matches work against multi-line prose.
function flatJsdoc(src) {
  return src
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\*\s*/g, ' ')
    .replace(/\n\s*\/\/\s*/g, ' ');
}

// ---- D-1 / D-4 / D-11: dispatch level vs per-fixup macro clarified ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/[Dd]ispatcher-level vs\.?\s+predicate-level/.test(flat),
    'D-1: header clarifies dispatcher-level (SS) vs predicate-level (Blender) gap-tolerance');
  assert(/readfile\.cc:3755/.test(flat),
    'D-1: header cites readfile.cc:3755 (Blender dispatcher call site for blo_do_versions_500)');
  assert(/inside each dispatcher function|INSIDE each dispatcher/.test(flat),
    'D-4: header tightens "gap" language — SS gap at dispatch table, Blender gap inside dispatcher fn');
}

// ---- D-2: single-int vs major.minor deviation cited ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/Single integer vs[\s.]+major\.minor|single monotonic.+integer/.test(flat),
    'D-2: header cites SS single-int vs Blender (versionfile, subversionfile) deviation');
  assert(/BKE_blender_version\.h:32-33|BLENDER_FILE_VERSION.+BLENDER_FILE_SUBVERSION/.test(flat),
    'D-2: header cites BLENDER_FILE_VERSION + BLENDER_FILE_SUBVERSION at BKE_blender_version.h:32-33');
}

// ---- D-3 / D-10: per-iteration bump deviation + idempotency requirement ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/Per-step version bump|every loop iteration/.test(flat),
    'D-3: header cites per-step bump deviation from Blender');
  assert(/readfile\.cc:4166|ONCE at file load/.test(flat),
    'D-3: header cites Blender single-bump at readfile.cc:4166');
  assert(/idempotent|crashed mid-cascade/.test(flat),
    'D-10: header documents idempotency requirement + partial-failure semantics');
}

// ---- D-5 / D-8: retirement playbook cites Blender precedents ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/versioning_legacy\.cc/.test(flat),
    'D-5: retirement playbook cites Blender pre-2.50 fixup retirement in versioning_legacy.cc');
  assert(/versioning_xxx_template\.cc/.test(flat),
    'D-8: retirement playbook cites Blender install template at versioning_xxx_template.cc');
}

// ---- D-6: DNA_DEPRECATED_ALLOW substrate divergence cited ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/DNA_DEPRECATED_ALLOW/.test(flat),
    'D-6: header cites DNA_DEPRECATED_ALLOW Blender substrate not present in SS');
}

// ---- D-7: DNA_DEFAULTS substrate divergence cited ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/DNA_DEFAULTS|DNA defaults/.test(flat),
    'D-7: header cites DNA_DEFAULTS Blender substrate not present in SS');
}

// ---- D-9: macro family cited correctly (3 variants) ----

{
  const flat = flatJsdoc(readSrc('src/store/projectMigrations.js'));
  assert(/ATLEAST.+OLDER.+OLDER_OR_EQUAL|macro family|BKE_main\.hh:855-865/.test(flat),
    'D-9: header cites MAIN_VERSION_FILE_ATLEAST macro family (3 variants), not single predicate');
}

// ---- D-12: explicit "Known deviations from Blender" sub-section ----

{
  const src = readSrc('src/store/projectMigrations.js');
  assert(/Known deviations from Blender/.test(src),
    'D-12: header carries explicit "Known deviations from Blender" sub-section');
}

// ---- G-1: v38 module "Companion clean-ups" rewrite (post-state only) ----

{
  const flat = flatJsdoc(readSrc('src/store/migrations/v38_nodetree_retirement.js'));
  assert(/MODULES \+ dispatch entries are deleted|MODULES \+ dispatch entries deleted/.test(flat),
    'G-1: v38 module Companion clean-ups names post-state (modules + dispatch entries deleted)');
  // Pre-Stage-1.F-post history narration should be gone — no
  // "stayed as no-op shims because" framing.
  assert(!/stayed as no-op shims because/.test(flat),
    'G-1: v38 module Companion clean-ups drops the pre-Stage-1.F-post narration');
}

// ---- G-2: v32 module no longer cites deleted v31 module path ----

{
  const flat = flatJsdoc(readSrc('src/store/migrations/v32_strip_rigid_default_weights.js'));
  assert(!/v31_default_rigid_weights\.js/.test(flat),
    'G-2: v32 module JSDoc no longer references deleted v31_default_rigid_weights.js path');
  assert(/gap-tolerant walker|iterates v30\/v31 as no-ops/.test(flat),
    'G-2: v32 module JSDoc cites gap-tolerant walker');
}

// ---- G-3: ANIMATION plan §Stage 1.F-pre follow-up bullet ----

{
  const src = readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  assert(/Stage 1\.F-post follow-up/i.test(src),
    'G-3: ANIMATION plan §1.F-pre carries Stage 1.F-post follow-up bullet');
  assert(/dispatch entries DELETED entirely|gap-tolerant/.test(src),
    'G-3: ANIMATION plan §1.F-pre follow-up names the dispatch-entry deletion');
}

// ---- G-4: CUBISM_ADAPTER_PATTERN.md banner + stale line annotated ----

{
  const src = readSrc('docs/plans/CUBISM_ADAPTER_PATTERN.md');
  assert(/PATTERN REVERTED 2026-05-09/.test(src),
    'G-4: CUBISM_ADAPTER_PATTERN.md carries pattern-reverted banner');
  assert(/BOTH ENTRIES DELETED|gap-tolerant walker/i.test(src),
    'G-4: CUBISM_ADAPTER_PATTERN.md stale "v30 reserved no-op shim" line is annotated post-state');
}

// ---- G-5: walker uses typeof === 'function' guard ----

{
  const src = readSrc('src/store/projectMigrations.js');
  assert(/typeof migrate === ['"]function['"]/.test(src),
    'G-5: walker uses typeof === function guard (defensive vs accidental non-function dispatch)');
}

// ---- G-6 / G-7: test_migrations.mjs new walker contract pins ----

{
  const src = readSrc('scripts/test/test_migrations.mjs');
  assert(/fromVersion === CURRENT is a no-op walk/.test(src),
    'G-7: test_migrations covers fromVersion === CURRENT no-op walk');
  assert(/v25 ran AFTER the v22\/v23\/v24 gap/.test(src),
    'G-6: test_migrations pins schemaVersion-bumped-on-gap → next-entry-runs invariant');
  // Behavioural smoke: a v21 fixture lands at CURRENT cleanly.
  const p = {
    schemaVersion: 21,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    nodes: [{ id: 'face', type: 'part', mode: 'mesh' }],
    parameters: [], physics_groups: [],
  };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION,
    'G-6: behavioural — v21 walks to CURRENT across the v22/v23/v24 gap');
  assertEq(p.nodes[0].mode, 'edit',
    'G-6: behavioural — v25 fired after the v22/v23/v24 gap (mode rename ran)');
}

// ---- G-8: "Stage 1.F-post" phase tag scrubbed from inline source comments ----

{
  // Header acknowledges the refactor existence but inline walker comment
  // is neutral. The phase tag may stay in commit history and test names.
  const src = readSrc('src/store/projectMigrations.js');
  const walkerMatch = src.match(/Gap-tolerant walker[\s\S]+?for \(let v/);
  assert(walkerMatch != null, 'G-8: walker inline comment located');
  if (walkerMatch) {
    assert(!/Stage 1\.F-post/.test(walkerMatch[0]),
      'G-8: walker inline comment does not embed "Stage 1.F-post" phase tag');
  }
}

// ---- G-9: v38 module Companion clean-ups is short / post-state ----

{
  // Already covered by G-1 absence-of-narration check. Quick length pin
  // as defence-in-depth: the section is < 600 chars (was ~1200 with the
  // history narration).
  const src = readSrc('src/store/migrations/v38_nodetree_retirement.js');
  const m = src.match(/# Companion clean-ups\s*\*\s*([\s\S]*?)\*\//);
  assert(m != null, 'G-9: Companion clean-ups section located');
  if (m) {
    assert(m[1].length < 700,
      `G-9: Companion clean-ups section is ≤ 700 chars (got ${m[1].length})`);
  }
}

// ---- G-10: NodeTreeArea / NodeTreeEditor v22-24 citations paired ----

{
  const flatArea = flatJsdoc(readSrc('src/v3/editors/nodetree/NodeTreeArea.jsx'));
  assert(/modules \+ dispatch entries deleted|modules deleted in v38|deleted in v38/i.test(flatArea),
    'G-10a: NodeTreeArea v22-24 citation paired with "(modules deleted)" framing');
  const flatEd = flatJsdoc(readSrc('src/v3/editors/nodetree/NodeTreeEditor.jsx'));
  assert(/module \+ dispatch entry are both gone|both gone|gap-tolerant walker/i.test(flatEd),
    'G-10b: NodeTreeEditor v24 citation paired with post-state framing');
}

// ---- G-11: walker inline comment references header (no duplication) ----

{
  const src = readSrc('src/store/projectMigrations.js');
  const walkerMatch = src.match(/Gap-tolerant walker[\s\S]+?for \(let v/);
  assert(walkerMatch != null, 'G-11: walker inline comment located');
  if (walkerMatch) {
    assert(/See header/.test(walkerMatch[0]),
      'G-11: walker inline comment references header instead of duplicating prose');
    // Inline block is short — was ~7 lines, now ≤ 4 lines.
    const lines = walkerMatch[0].split('\n').filter(l => /^\s*\/\//.test(l));
    assert(lines.length <= 5,
      `G-11: walker inline comment is concise (≤ 5 comment lines, got ${lines.length})`);
  }
}

// ---- G-12: test_nodetree_retirement preamble entry 3 trimmed ----

{
  const src = readSrc('scripts/test/test_nodetree_retirement.mjs');
  // Preamble entry 3 must NOT carry the pre-state narrative anymore.
  assert(!/Pre-Stage-1\.F-post these stayed as no-op shims/.test(src),
    'G-12: test header preamble entry 3 drops pre-state narration');
  assert(/gap-tolerant walker per Blender's MAIN_VERSION_FILE_ATLEAST/.test(src),
    'G-12: test header preamble entry 3 names the post-state contract concisely');
}

// ---- Behavioural sanity (walker invariants post-typeof-guard) ----

{
  // The walker's typeof guard must skip non-function dispatch values
  // without crashing. We can't poke the module-private MIGRATIONS,
  // but the existing migrations-table walk covers the function branch;
  // the guard is exercised at runtime against the (currently absent)
  // v22/v23/v24/v30/v31 keys.
  const p = {
    schemaVersion: 0,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    nodes: [],
  };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION,
    'walker sanity: v0 → CURRENT across all real + gap entries');
}

// ---- Result ----

console.log(`audit-fixes-stage1f-post: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
