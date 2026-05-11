// Phase 1 Stage 1.A+1.B audit-fix sweep — pin every FIX in place against
// regression. Sister to scripts/test/test_audit_fixes_2026_05_11_phase8.mjs.
//
// Two parallel audits ran against commit `229305a` (Action datablock +
// per-Object AnimData, schema v36):
//   - Architecture audit (A-N): code quality + data-flow cascades + helper
//     contract consistency. 1 HIGH (A1) + 3 MED (A2-A4 [A3 collapsed]).
//   - Blender-fidelity audit (B-N): FCurve / Action / AnimData shape vs
//     `reference/blender/source/blender/`. 4 HIGH (B1-B4) + 1 MED (B5).
//
// Each block below pins one gap, tagged A-N (architecture) or B-N
// (Blender-fidelity), asserting the FIXED behaviour or contract.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase1_stage1ab.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildParamFCurve,
  buildNodeFCurve,
  decodeFCurveTarget,
  evaluateActionFCurves,
} from '../../src/anim/animationFCurve.js';
import { kernelFCurveEval } from '../../src/anim/depgraph/kernels/fcurve.js';
import { migrateActionDatablock } from '../../src/store/migrations/v36_action_datablock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── A-1: kernels/fcurve.js passes ctx.timeMs verbatim (no /1000) ────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/depgraph/kernels/fcurve.js'), 'utf8');
  // Strip JSDoc block to leave only executable code for the divide check.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/timeMs[^;]*\/\s*1000/.test(codeOnly),
    'A-1a: FCURVE_EVAL kernel no longer divides ctx.timeMs by 1000');
  assert(!codeOnly.includes('timeSeconds'),
    'A-1b: stale `timeSeconds` local removed');
  assert(src.includes('evaluateFCurve(fc, ctx.timeMs ?? 0'),
    'A-1c: kernel passes ctx.timeMs verbatim to evaluateFCurve');
  assert(src.includes('feedback_ms_canonical_animation_time'),
    'A-1d: ms-canonical memory cited in kernel docstring');

  // Functional: keyforms in ms, ctx.timeMs = 500, expect mid-segment lerp.
  const fc = buildParamFCurve('P', [
    { time: 0, value: 0, easing: 'linear' },
    { time: 1000, value: 10, easing: 'linear' },
  ]);
  const ctx = {
    timeMs: 500,
    action: { fcurves: [fc] },
    paramOverrides: new Map(),
    project: {},
  };
  const op = { tag: fc.rnaPath };
  const v = kernelFCurveEval(op, ctx);
  assert(near(v, 5),
    `A-1e: FCURVE_EVAL at ctx.timeMs=500 against [0ms→0, 1000ms→10] returns 5 (got ${v})`);
}

// ── A-2: v36 extrapolation ternary returns 'linear' for non-hold easings ────
{
  const src = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(src.includes("? 'constant' : 'linear'"),
    'A-2a: extrapolation ternary alive — false branch returns linear');
  assert(!src.includes("? 'constant' : 'constant'"),
    'A-2b: dead-ternary `? constant : constant` removed');

  // Functional: legacy track ending in linear easing migrates to extrap=linear.
  const project = {
    animations: [{
      id: 'a1', name: 'A1', fps: 24,
      tracks: [{
        paramId: 'P',
        keyframes: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1000, value: 5, easing: 'linear' },
        ],
      }],
    }],
    nodes: [],
  };
  migrateActionDatablock(project);
  assert(project.actions[0].fcurves[0].extrapolation === 'linear',
    'A-2c: linear-easing terminator migrates to extrapolation=linear');

  // And: hold easing terminator still produces extrapolation=constant.
  const project2 = {
    animations: [{
      id: 'a2', name: 'A2', fps: 24,
      tracks: [{
        paramId: 'Q',
        keyframes: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1000, value: 5, easing: 'constant' },
        ],
      }],
    }],
    nodes: [],
  };
  migrateActionDatablock(project2);
  assert(project2.actions[0].fcurves[0].extrapolation === 'constant',
    'A-2d: constant-easing terminator migrates to extrapolation=constant');
}

// ── A-3: v36 mesh_verts drop site has explanatory comment ───────────────────
{
  const src = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(src.includes('mesh_verts'),
    'A-3a: mesh_verts drop documented in trackToFCurveInline');
  assert(src.includes('array-shaped values'),
    'A-3b: drop reason (array-shaped values) explained');
  assert(src.includes('Phase 4'),
    'A-3c: future-Phase pointer (Phase 4 mesh deformation) noted');
}

// ── A-4: evaluateActionFCurves time parameter is canonical timeMs ───────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/animationFCurve.js'), 'utf8');
  assert(src.includes('export function evaluateActionFCurves(action, timeMs'),
    'A-4a: evaluateActionFCurves param renamed time → timeMs');
  assert(src.includes('@param {number} timeMs'),
    'A-4b: JSDoc reflects ms-canonical contract');
  assert(src.includes('feedback_ms_canonical_animation_time'),
    'A-4c: ms-canonical memory cited in evaluateActionFCurves docstring');

  // Functional: pass ms-shaped time, expect ms-shaped keyform interpolation.
  const fc = buildParamFCurve('P', [
    { time: 0, value: 0, easing: 'linear' },
    { time: 1000, value: 10, easing: 'linear' },
  ]);
  const out = evaluateActionFCurves({ fcurves: [fc] }, 500);
  assert(near(out.get(fc.rnaPath), 5),
    'A-4d: timeMs=500 against [0ms→0, 1000ms→10] returns 5');
}

// ── B-1: rnaPath grammar uses double-quoted bracket strings ─────────────────
{
  const fc = buildParamFCurve('ParamA', [{ time: 0, value: 1, easing: 'linear' }]);
  assert(fc.rnaPath === 'objects["__params__"].values["ParamA"]',
    `B-1a: buildParamFCurve emits double-quoted rnaPath (got ${fc.rnaPath})`);

  const fc2 = buildNodeFCurve('partA', 'rotation',
    [{ time: 0, value: 1, easing: 'linear' }]);
  assert(fc2.rnaPath === 'objects["partA"].rotation',
    `B-1b: buildNodeFCurve emits double-quoted rnaPath (got ${fc2.rnaPath})`);

  // Decoder is strict-double — single-quoted rnaPath returns null.
  assert(decodeFCurveTarget({ rnaPath: "objects['__params__'].values['X']" }) === null,
    'B-1c: decoder rejects single-quoted param path (strict double)');
  assert(decodeFCurveTarget({ rnaPath: "objects['Y'].rotation" }) === null,
    'B-1d: decoder rejects single-quoted node path (strict double)');

  // Decoder accepts canonical double-quoted.
  const t = decodeFCurveTarget({ rnaPath: 'objects["__params__"].values["A"]' });
  assert(t?.kind === 'param' && t.paramId === 'A',
    'B-1e: decoder accepts double-quoted param path');
  const t2 = decodeFCurveTarget({ rnaPath: 'objects["Y"].rotation' });
  assert(t2?.kind === 'node' && t2.nodeId === 'Y' && t2.property === 'rotation',
    'B-1f: decoder accepts double-quoted node path');

  // v36 migration normalises pre-fix single-quoted paths (idempotency block).
  const project = {
    schemaVersion: 36,
    actions: [{
      id: 'a1', name: 'A1', fps: 24, audioTracks: [], fcurves: [
        { id: 'param:X',
          rnaPath: "objects['__params__'].values['X']",
          arrayIndex: 0, keyforms: [], modifiers: [], extrapolation: 'constant' },
        { id: 'Y.rot',
          rnaPath: "objects['Y'].rotation",
          arrayIndex: 0, keyforms: [], modifiers: [], extrapolation: 'constant' },
      ], flag: 0, meta: { source: 'authored' },
    }],
    nodes: [],
  };
  migrateActionDatablock(project);
  assert(project.actions[0].fcurves[0].rnaPath === 'objects["__params__"].values["X"]',
    'B-1g: v36 idempotency normalises single→double on pre-fix param paths');
  assert(project.actions[0].fcurves[1].rnaPath === 'objects["Y"].rotation',
    'B-1h: v36 idempotency normalises single→double on pre-fix node paths');

  // Idempotent: re-running on already-double rnaPath is a no-op.
  migrateActionDatablock(project);
  assert(project.actions[0].fcurves[0].rnaPath === 'objects["__params__"].values["X"]',
    'B-1i: re-running v36 on already-double rnaPath is a no-op');

  // Production-side regex sites use double-quoted.
  const buildSrc = readFileSync(join(repoRoot, 'src/anim/depgraph/build.js'), 'utf8');
  assert(buildSrc.includes('/objects\\["__params__"\\]\\.values\\["([^"]+)"\\]/'),
    'B-1j: depgraph/build.js paramId-extraction regex is double-quoted');
  const driverCompileSrc = readFileSync(
    join(repoRoot, 'src/anim/nodetree/driverCompile.js'), 'utf8');
  assert(driverCompileSrc.includes('/objects\\["__params__"\\]\\.values\\["([^"]+)"\\]/'),
    'B-1k: nodetree/driverCompile.js paramId-extraction regex is double-quoted');
  const driverPassSrc = readFileSync(join(repoRoot, 'src/anim/driverPass.js'), 'utf8');
  assert(driverPassSrc.includes('/^objects\\["__params__"\\]\\.values\\["([^"]+)"\\]$/'),
    'B-1l: driverPass.js paramId-extraction regex is double-quoted');

  // Migration docstring cites the Blender tokenizer source-of-truth.
  const migSrc = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(migSrc.includes('rna_path.cc:127'),
    'B-1m: v36 migration cites Blender rna_path.cc:127 as quote-grammar source');
}

// ── B-2: defaultAnimData cites correct Blender enum names ───────────────────
{
  const src = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(src.includes('NLASTRIP_MODE_REPLACE'),
    'B-2a: actionBlendmode cites NLASTRIP_MODE_REPLACE (correct Blender enum)');
  assert(src.includes('NLASTRIP_EXTEND_HOLD'),
    'B-2b: actionExtendmode cites NLASTRIP_EXTEND_HOLD (correct Blender enum)');
  assert(!src.includes('ACT_BLEND_REPLACE'),
    'B-2c: invented `ACT_BLEND_REPLACE` enum name removed');
  assert(!src.includes('ACT_EXTEND_HOLD'),
    'B-2d: invented `ACT_EXTEND_HOLD` enum name removed');
  assert(src.includes('DNA_anim_enums.h:375')
      || src.includes('DNA_anim_enums.h:386'),
    'B-2e: enum citations point at DNA_anim_enums.h source-of-truth');
}

// ── B-3: act_influence cites BKE override (anim_data.cc:123) ────────────────
{
  const src = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(src.includes('anim_data.cc:123'),
    'B-3a: actionInfluence cites BKE constructor override (anim_data.cc:123)');
  assert(src.includes('1.0f'),
    'B-3b: docstring records the runtime default value (1.0f)');
}

// ── B-4: eAction_Flag comment enumerates all bits ──────────────────────────
{
  const src = readFileSync(
    join(repoRoot, 'src/store/migrations/v36_action_datablock.js'), 'utf8');
  assert(src.includes('ACT_COLLAPSED'),
    'B-4a: eAction_Flag comment includes ACT_COLLAPSED');
  assert(src.includes('ACT_SELECTED'),
    'B-4b: eAction_Flag comment includes ACT_SELECTED');
  assert(src.includes('ACT_MUTED'),
    'B-4c: eAction_Flag comment includes ACT_MUTED');
  assert(src.includes('ACT_FRAME_RANGE'),
    'B-4d: eAction_Flag comment includes ACT_FRAME_RANGE');
  assert(src.includes('ACT_CYCLIC'),
    'B-4e: eAction_Flag comment includes ACT_CYCLIC');
  assert(src.includes('DNA_action_types.h:374'),
    'B-4f: enum citation points at DNA_action_types.h source-of-truth');
}

// ── B-5: rnaPath.js documents __params__/__armature__/__scene__ semantics ───
{
  const src = readFileSync(join(repoRoot, 'src/anim/rnaPath.js'), 'utf8');
  assert(src.includes('Synthetic Object IDs'),
    'B-5a: rnaPath.js has dedicated synthetic-id documentation section');
  assert(src.includes('SS-specific') && src.includes('no Blender analogue'),
    'B-5b: synthetic ids documented as SS-specific');
  assert(src.includes('__scene__') && src.includes('Stage 1.D'),
    'B-5c: __scene__ Stage 1.D coexistence rule documented');
  assert(src.includes('does NOT shadow `__params__`'),
    'B-5d: __scene__ resolver-priority rule (no shadow) explicit');
  assert(src.includes('rna_path.cc:127'),
    'B-5e: bracket-key grammar cites Blender source-of-truth');
}

// ── Result ──────────────────────────────────────────────────────────────────

console.log(
  `audit_fixes_2026_05_11_phase1_stage1ab: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failed checks:');
  failures.forEach((f) => console.error(`  - ${f}`));
}
process.exit(failed === 0 ? 0 : 1);
