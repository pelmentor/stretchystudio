// Audit-pin tests for Animation Phase 1 Stage 1.F sweep — captures the
// 11 dedup'd gap blocks (2 HIGH + 7 MED + 2 LOW after dropping doc-only
// tweaks) that the dual audit surfaced after commit `0ab8f2c` (Stage 1.F
// substrate ship — 4 new test files for the Phase-1 exit gate). Each
// block asserts the audit fix is present in source / behaviour, so a
// future regression (citation revert, opts.loop reintroduction, hardcoded
// param range) trips here rather than at the manual Cubism Viewer load
// or in production motion3 / can3 output.
//
// Gap dedup notes:
//   - G-1 (Architecture: dead opts.loop hook) + D-2 (Blender: ACT_CYCLIC
//     unpinned) → 1 HIGH gap. Both audits flagged the same root cause.
//   - G-3 (XML substring counting fragility) + G-9 (test 6 substring
//     matching) → 1 MED gap. Both share the same fix.
//   - G-4 (missing audit-pin) → THIS file is the fix.
//   - G-6 (helper duplication) → preserved per design (per-file
//     isolation; Phase 2 BezTriple migration may unify them).
//   - G-8 (npm test chain ordering) → preserved per audit suggestion (b)
//     low-risk leave-as-is.
//   - G-10 (positive: binding-agnostic invariant docs) → preserved.
//   - D-12 (positive: assignAction "Skipped vs Blender" exemplary) →
//     preserved.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase1_stage1f.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { generateCan3 } from '../../src/io/live2d/can3writer.js';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';
import { decodeFCurveTarget } from '../../src/anim/animationFCurve.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

/** Flatten JSDoc multi-line text. */
function flatJsdoc(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]*\*[ \t]?/g, ' ')
    .replace(/\n[ \t]*\/\/[ \t]?/g, ' ');
}

function fileFlatMatches(rel, regex) {
  if (!existsSync(join(ROOT, rel))) return false;
  return regex.test(flatJsdoc(read(rel)));
}

function fileMatches(rel, regex) {
  if (!existsSync(join(ROOT, rel))) return false;
  return regex.test(read(rel));
}

// ── Gap 1: G-1+D-2 dedup'd HIGH — opts.loop dropped; Loop signal pinning ──

{
  // The opts.loop parameter was dropped; the function reads only
  // parameterMap from opts. (Still true post-3.D — Slice 3.D shifted
  // the Loop signal from "hardcoded true" to "driven by Cycles
  // FModifier", but did NOT re-introduce an opts override per Rule №2:
  // callable-by-no-one is a Rule №1 anti-pattern.)
  assert(
    fileFlatMatches(
      'src/io/live2d/motion3json.js',
      /(?:const|let)\s*\{\s*parameterMap\s*=\s*new Map\(\)\s*\}\s*=\s*opts/,
    ),
    '1: motion3json.js destructures only parameterMap from opts (opts.loop dropped)',
  );

  // Module JSDoc carries the Loop semantics section (was "Blender
  // deviation" in Stage 1.F; rewritten to "Slice 3.D" header in this
  // slice — both share the "Loop semantics" prefix).
  assert(
    fileFlatMatches(
      'src/io/live2d/motion3json.js',
      /Loop semantics/i,
    ),
    '1a: motion3json.js JSDoc carries Loop semantics section header',
  );

  // ACT_CYCLIC bit value (1 << 13) still cited — it remains the
  // action-level loop bit, still reserved (will OR-compose with the
  // Cycles signal when the ActionsEditor Cyclic-toggle UI ships).
  assert(
    fileFlatMatches(
      'src/io/live2d/motion3json.js',
      /v36_action_datablock\.js:325-329/,
    ),
    '1b: motion3json.js JSDoc cites ACT_CYCLIC bit location (v36_action_datablock.js:325-329)',
  );

  // The Cyclic-toggle UI is still cited as the integration point for
  // ACT_CYCLIC even though Slice 3.D now drives Loop from per-curve
  // Cycles FModifier directly.
  assert(
    fileFlatMatches(
      'src/io/live2d/motion3json.js',
      /Cyclic.toggle UI/i,
    ),
    '1c: motion3json.js documents Cyclic-toggle UI as the ACT_CYCLIC integration point',
  );

  // Behavior post-3.D: Loop is FALSE when no fcurve carries a Cycles
  // modifier, regardless of the ACT_CYCLIC bit (the flag's runtime
  // wiring is deferred to the Cyclic-toggle UI slice). Loop is TRUE
  // only when every fcurve has a clean repeat-forever Cycles modifier
  // (covered by test_actionExportMotion3.mjs §5b).
  const make = (flag) => ({
    id: 'a', name: 'A', fps: 30, duration: 1000, audioTracks: [], flag,
    fcurves: [{
      id: 'param:P', rnaPath: 'objects["__params__"].values["P"]',
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      keyforms: [
        { time: 0, value: 0, easing: 'linear', type: 'linear' },
        { time: 500, value: 1, easing: 'linear', type: 'linear' },
      ],
    }],
    meta: {},
  });
  const noCyclic = generateMotion3Json(make(0));
  const cyclic = generateMotion3Json(make(1 << 13));
  assertEq(noCyclic.Meta.Loop, false,
    '1d: ACT_CYCLIC=0 + no Cycles FModifier → Loop=false (Slice 3.D semantics)');
  assertEq(cyclic.Meta.Loop, false,
    '1e: ACT_CYCLIC bit alone → Loop=false (flag wiring deferred to Cyclic-toggle UI)');
}

// ── Gap 2: D-1 HIGH — BKE_main_namemap_get_unique_name citation ────────────

{
  // The corrected citation points to id_name_final_build (the actual
  // algorithmic mirror), with a note about the public API entry point.
  assert(
    fileFlatMatches(
      'src/anim/actionRegistry.js',
      /id_name_final_build[\s\S]{0,100}main_namemap\.cc:441/,
    ),
    '2: actionRegistry.js cites id_name_final_build at main_namemap.cc:441',
  );
  assert(
    fileFlatMatches(
      'src/anim/actionRegistry.js',
      /BKE_main_namemap_get_unique_name[\s\S]{0,100}main_namemap\.cc:582/,
    ),
    '2a: actionRegistry.js cites public API entry point at main_namemap.cc:582',
  );

  // Audit-fix D-1 marker present.
  assert(
    fileFlatMatches(
      'src/anim/actionRegistry.js',
      /Audit-fix D-1 Stage 1\.F/,
    ),
    '2b: actionRegistry.js carries Audit-fix D-1 marker',
  );

  // Per-array-scan deviation called out.
  assert(
    fileFlatMatches(
      'src/anim/actionRegistry.js',
      /SS scans only the[\s\S]{0,40}actions\[\][\s\S]{0,300}walks the entire[\s\S]{0,40}Main[\s\S]{0,40}namemap/,
    ),
    '2c: actionRegistry.js documents the scope deviation (per-array vs Main-wide)',
  );
}

// ── Gap 3: G-2 MED — plumb project.parameters through generateCan3 ─────────

{
  // can3writer.js destructures `parameters = []` from input.
  assert(
    fileFlatMatches(
      'src/io/live2d/can3writer.js',
      /parameters\s*=\s*\[\]/,
    ),
    '3: can3writer.js destructures parameters with default empty array',
  );

  // The hardcoded -1..1 fallback comment is REPLACED with a reference
  // to project.parameters resolution.
  assert(
    fileFlatMatches(
      'src/io/live2d/can3writer.js',
      /Stage 1\.F audit-fix G-2[\s\S]{0,200}closes the previous hardcoded/,
    ),
    '3a: can3writer.js carries Audit-fix G-2 marker explaining the fix',
  );

  // The exporter caller passes parameters: paramSpec.
  assert(
    fileFlatMatches(
      'src/io/live2d/exporter.js',
      /parameters:\s*paramSpec/,
    ),
    '3b: exporter.js passes paramSpec to generateCan3',
  );

  // Behavior: param spec is honored.
  const action = {
    id: 'a', name: 'A', fps: 30, duration: 1000, audioTracks: [], flag: 0,
    fcurves: [{
      id: 'param:ParamBreath',
      rnaPath: 'objects["__params__"].values["ParamBreath"]',
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      keyforms: [{ time: 0, value: 0.5, easing: 'linear', type: 'linear' }],
    }],
    meta: {},
  };
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: new Map(),
    cmo3FileName: 'm.cmo3', canvasW: 1024, canvasH: 1024,
    parameters: [{ id: 'ParamBreath', min: 0, max: 1, defaultVal: 0.5 }],
  });
  const archive = await unpackCaff(can3);
  const xml = new TextDecoder().decode(
    archive.files.find((f) => f.path === 'main.xml').content,
  );
  assert(xml.includes('<d xs.n="rangeMin">0</d>'),
    '3c: ParamBreath emits rangeMin=0 from project.parameters spec');
  assert(xml.includes('<d xs.n="rangeMax">1</d>'),
    '3d: ParamBreath emits rangeMax=1 from project.parameters spec');
}

// ── Gap 4: G-3+G-9 MED — robust XML extraction in test_actionExportCan3 ────

{
  // The test file declares the new helpers.
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /function countDefinitions\(/,
    ),
    '4: test_actionExportCan3 declares countDefinitions helper',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /function readChildText\(/,
    ),
    '4a: test_actionExportCan3 declares readChildText helper',
  );

  // The audit-fix G-3 + G-9 markers are present.
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /Stage 1\.F audit-fix G-3/,
    ),
    '4b: test_actionExportCan3 carries G-3 marker',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /Stage 1\.F audit-fix G-9/,
    ),
    '4c: test_actionExportCan3 carries G-9 marker',
  );

  // The brittle substring `<CSceneSource exportMotionFile="true"` is
  // GONE from active assertions — the helpers replaced it.
  const ctx = read('scripts/test/test_actionExportCan3.mjs');
  // Check assertions use countDefinitions, not the brittle substring.
  // (The substring may still appear in JSDoc explaining the helper.)
  const assertionLines = ctx.split('\n').filter(
    (l) => l.includes('count(xml,') && l.includes('CSceneSource'),
  );
  assert(assertionLines.length === 0,
    '4d: no remaining count(xml, "CSceneSource…") assertions (replaced by countDefinitions)');
}

// ── Gap 5: D-3 MED — __scene__.parent: null Blender deviation note ─────────

{
  assert(
    fileFlatMatches(
      'src/store/migrations/v37_scene_anim_data.js',
      /DEVIATION FROM BLENDER \(Audit-fix D-3 Stage 1\.F\)/,
    ),
    '5: v37 migration carries Audit-fix D-3 deviation header for parent: null',
  );
  assert(
    fileFlatMatches(
      'src/store/migrations/v37_scene_anim_data.js',
      /Blender's Scene datablock.+has NO.parent.field/i,
    ),
    '5a: v37 documents that Blender Scene has no parent field',
  );
  assert(
    fileFlatMatches(
      'src/store/migrations/v37_scene_anim_data.js',
      /tree-traversal helpers/,
    ),
    '5b: v37 explains why SS adds parent: null (walker compatibility)',
  );
}

// ── Gap 6: D-4 MED — BKE-runtime override note in v36 (sister to v37) ──────

{
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /actionInfluence = 1.+BKE-runtime override deviation \(Stage 1\.F audit-fix D-4\)/i,
    ),
    '6: v36 migration carries Audit-fix D-4 deviation header for actionInfluence',
  );
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /SS adopts the BKE-runtime default.+1\.0f.+directly because we eagerly create AnimData/i,
    ),
    '6a: v36 explains the eager-create reasoning (sister to v37)',
  );
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /v37_scene_anim_data\.js:77-85/,
    ),
    '6b: v36 cross-references v37 sister deviation block',
  );
}

// ── Gap 7: D-5 MED — escape-grammar contract assertion + JSDoc ─────────────

{
  // JSDoc on decodeFCurveTarget carries the escape-grammar deviation.
  assert(
    fileFlatMatches(
      'src/anim/animationFCurve.js',
      /Escape grammar.+Blender deviation \(Stage 1\.F audit-fix D-5\)/i,
    ),
    '7: animationFCurve.js JSDoc carries Audit-fix D-5 escape-grammar header',
  );
  assert(
    fileFlatMatches(
      'src/anim/animationFCurve.js',
      /BLI_str_unescape.+BLI_str_escape_find_quote/,
    ),
    '7a: animationFCurve.js cites Blender escape-aware tokenizer functions',
  );

  // Behavior: malformed rnaPath with embedded `"` mis-tokenises.
  const malformed = decodeFCurveTarget({
    rnaPath: 'objects["__params__"].values["Some"Quote"]',
  });
  assert(malformed?.kind === 'node',
    '7b: malformed rnaPath with embedded `"` mis-tokenises as node-target (latent gap; documented)');
  assertEq(malformed.nodeId, '__params__',
    '7c: malformed path silently captures __params__ as nodeId');
}

// ── Gap 8: D-6 MED — Phase-scope warning in test_actionScene test 4 ────────

{
  assert(
    fileMatches(
      'scripts/test/test_actionScene.mjs',
      /DEVIATION FROM BLENDER \(Stage 1\.F audit-fix D-6\)/,
    ),
    '8: test_actionScene carries D-6 deviation header on test 4',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionScene.mjs',
      /Blender does NOT auto-compose/,
    ),
    '8a: test_actionScene explains the SS-specific composition is a Phase-1 bridge',
  );
}

// ── Gap 9: D-7 MED — Phase 4 NLA TODO in motion3+can3 test headers ─────────

{
  assert(
    fileMatches(
      'scripts/test/test_actionExportMotion3.mjs',
      /PHASE-SCOPE WARNING \(Stage 1\.F audit-fix D-7 .+ Phase 4 NLA prep\)/,
    ),
    '9: test_actionExportMotion3 carries Phase 4 NLA warning',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionExportMotion3.mjs',
      /NlaStrip.+DNA_anim_types\.h:425-499/,
    ),
    '9a: test_actionExportMotion3 cites NlaStrip DNA source',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /PHASE-SCOPE WARNING \(Stage 1\.F audit-fix D-7 .+ Phase 4 NLA prep\)/,
    ),
    '9b: test_actionExportCan3 carries Phase 4 NLA warning',
  );
  assert(
    fileMatches(
      'scripts/test/test_actionExportCan3.mjs',
      /NlaStrip.+DNA_anim_types\.h:425-499/,
    ),
    '9c: test_actionExportCan3 cites NlaStrip DNA source',
  );
}

// ── Gap 10: G-5/G-7 LOW — doc reframings preserved ─────────────────────────

{
  // G-5: test 6 in test_actionScene reframed as no-leakage assertion.
  assert(
    fileMatches(
      'scripts/test/test_actionScene.mjs',
      /Stage 1\.F audit-fix G-5 reframe/,
    ),
    '10: test_actionScene test 6 carries G-5 reframe marker',
  );
  // G-7: test_actionDatablock_migration documents its smoke-pin role.
  assert(
    fileMatches(
      'scripts/test/test_actionDatablock_migration.mjs',
      /Role of this test \(Stage 1\.F audit-fix G-7\)/,
    ),
    '10a: test_actionDatablock_migration documents its smoke-pin role',
  );
  // The phrase "which goes through the walker" splits across lines:
  // "(which goes\n// through the walker)". flatJsdoc bridges this.
  assert(
    fileFlatMatches(
      'scripts/test/test_actionDatablock_migration.mjs',
      /which goes\s*through the walker/,
    ),
    '10b: test_actionDatablock_migration explains walker-vs-direct distinction',
  );
}

// ── Gap 11: D-8/D-9/D-10/D-11 LOW — v36 SS-specific shape deviations ───────

{
  // D-8: action.id vs Blender ID.name = "AC<actionname>"
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /action\.id[\s\S]{0,40}vs Blender[\s\S]{0,200}Stage 1\.F audit-fix D-8/i,
    ),
    '11: v36 carries D-8 deviation header for action.id vs Blender ID.name prefix',
  );
  // The "AC" prefix is illustrated with a concrete example.
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /id\.name\s*==\s*"ACIdle"/,
    ),
    '11d: v36 D-8 explanation includes "ACIdle" concrete example',
  );
  // D-9: audioTracks SS-only field
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /audioTracks.+SS-only field \(Stage 1\.F audit-fix D-9\)/,
    ),
    '11a: v36 carries D-9 deviation note for audioTracks SS-only field',
  );
  // D-10: meta field deviation symmetry
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /Stage 1\.F audit-fix D-10[\s\S]{0,100}meta.+SS-specific/i,
    ),
    '11b: v36 carries D-10 deviation note for meta field SS-specific',
  );
  // D-11: slotHandle slot table absence
  assert(
    fileFlatMatches(
      'src/store/migrations/v36_action_datablock.js',
      /Stage 1\.F audit-fix D-11[\s\S]{0,200}SS doesn't have a slot table/i,
    ),
    '11c: v36 carries D-11 deviation note for slotHandle slot table absence',
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`audit-fixes-stage1f: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
