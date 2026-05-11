// v3 Phase 0F.32 - tests for src/io/live2d/idle/builder.js
//
// Top-level idle motion builder: input validation, skip
// classification (physics-output / implicit-skip / no-config),
// and the SS animation conversion adapter.
//
// Run: node scripts/test/test_idleBuilder.mjs

import {
  buildMotion3,
  buildIdleMotion3,
  resultToSsAction,
  validateMotion3,
} from '../../src/io/live2d/idle/builder.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// ── Input validation ──────────────────────────────────────────────

assertThrows(() => buildMotion3({ preset: 'banana', paramIds: [] }),
  'unknown preset throws');

assertThrows(() => buildMotion3({ paramIds: 'not-array' }),
  'paramIds non-array throws');

assertThrows(() => buildMotion3({ paramIds: [], personality: 'banana' }),
  'unknown personality throws');

assertThrows(() => buildMotion3({ paramIds: [], durationSec: 0 }),
  'durationSec < 1 throws');

assertThrows(() => buildMotion3({ paramIds: [], durationSec: 100 }),
  'durationSec > 60 throws');

assertThrows(() => buildMotion3({ paramIds: [], durationSec: NaN }),
  'durationSec NaN throws');

// ── Skip classification ───────────────────────────────────────────

{
  const result = buildMotion3({
    paramIds: ['ParamRotation_neck', 'ParamPhysics_X', 'NotInPreset', 'ParamAngleX'],
    physicsOutputIds: new Set(['ParamPhysics_X']),
    durationSec: 8,
  });

  // ParamRotation_* → implicit-skip
  const rot = result.skipped.find(s => s.id === 'ParamRotation_neck');
  assert(rot && rot.reason === 'implicit-skip', 'skip: ParamRotation_* implicit-skip');

  // physics-output → physics-output
  const phys = result.skipped.find(s => s.id === 'ParamPhysics_X');
  assert(phys && phys.reason === 'physics-output', 'skip: physics-output');

  // Not in preset → no-default-config
  const noConf = result.skipped.find(s => s.id === 'NotInPreset');
  assert(noConf && noConf.reason === 'no-default-config', 'skip: no-default-config');

  // ParamAngleX is in idle preset → animated (not skipped)
  assert(!result.skipped.some(s => s.id === 'ParamAngleX'),
    'skip: ParamAngleX animated, not skipped');
  assert(result.animatedIds.includes('ParamAngleX'),
    'animated: ParamAngleX in animatedIds');
}

// ── Empty paramIds falls back to all preset keys ──────────────────

{
  const result = buildMotion3({ paramIds: [], durationSec: 8 });
  // Should produce SOME animated params from the preset's defaults
  assert(result.animatedIds.length > 0,
    'empty paramIds falls back to preset defaults');
}

// ── Output shape: motion3 valid + paramKeyframes/Ranges populated ─

{
  const result = buildMotion3({
    paramIds: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'],
    durationSec: 8,
    fps: 30,
  });

  assert(result.preset === 'idle', 'default preset = idle');
  assert(result.motion3.Version === 3, 'motion3.Version = 3');
  assert(result.motion3.Meta.Loop === true, 'motion3.Meta.Loop = true');
  assert(result.motion3.Meta.Duration === 8, 'motion3.Meta.Duration matches');
  assert(result.motion3.Meta.Fps === 30, 'motion3.Meta.Fps matches');
  assert(result.motion3.Meta.CurveCount === result.motion3.Curves.length,
    'motion3.Meta.CurveCount matches Curves.length');
  assert(result.animatedIds.length > 0, 'animatedIds populated');

  // Each animated id has keyframes + range
  for (const id of result.animatedIds) {
    assert(result.paramKeyframes.has(id), `paramKeyframes: ${id}`);
    assert(result.paramRanges.has(id), `paramRanges: ${id}`);
  }

  // validateMotion3 returns no errors for our own output
  assert(result.validationErrors.length === 0,
    'validateMotion3: no errors for produced motion3');
}

// ── buildIdleMotion3 alias ────────────────────────────────────────

{
  const a = buildMotion3({ preset: 'idle', paramIds: ['ParamAngleX'], durationSec: 8 });
  const b = buildIdleMotion3({ paramIds: ['ParamAngleX'], durationSec: 8 });
  assert(a.preset === b.preset, 'buildIdleMotion3 alias: same preset');
  assert(a.motion3.Curves.length === b.motion3.Curves.length,
    'buildIdleMotion3 alias: same curve count');
}

// ── validateMotion3: reports actual problems ──────────────────────

{
  const errs1 = validateMotion3({ Version: 2, Meta: {}, Curves: [] });
  assert(errs1.length > 0 && errs1[0].includes('Version must be 3'),
    'validate: wrong Version flagged');

  const errs2 = validateMotion3({ Version: 3, Curves: [] });
  assert(errs2.some(e => e.includes('Missing Meta')), 'validate: missing Meta flagged');

  // CurveCount mismatch
  const errs3 = validateMotion3({
    Version: 3,
    Meta: { CurveCount: 5, TotalSegmentCount: 0, TotalPointCount: 0, Loop: false },
    Curves: [],
  });
  assert(errs3.some(e => e.includes('CurveCount mismatch')),
    'validate: CurveCount mismatch flagged');
}

// ── resultToSsAction ──────────────────────────────────────────

{
  const result = buildMotion3({
    paramIds: ['ParamAngleX'],
    durationSec: 8,
    fps: 30,
  });
  const { action } = resultToSsAction(result);

  assert(typeof action.id === 'string' && action.id.startsWith('__motion_idle'),
    'ssAction: id has motion_idle prefix');
  assert(typeof action.name === 'string' && action.name.length > 0,
    'ssAction: name set');
  assert(action.duration === 8000, 'ssAction: duration in ms');
  assert(action.fps === 30, 'ssAction: fps preserved');
  assert(Array.isArray(action.fcurves), 'ssAction: fcurves array');
  assert(action.fcurves.length === result.animatedIds.length,
    'ssAction: 1 fcurve per animated param');

  for (const fc of action.fcurves) {
    // v36 fcurve shape: rnaPath addressing, no per-curve min/max/rest
    // (those moved to project.parameters[]). The fcurve carries the
    // canonical {id, rnaPath, arrayIndex, keyforms, modifiers, extrapolation}.
    if (typeof fc.id !== 'string' ||
        typeof fc.rnaPath !== 'string' ||
        !fc.rnaPath.startsWith('objects["__params__"].values[') ||
        !Array.isArray(fc.keyforms)) {
      failed++; console.error(`FAIL: ssAction fcurve shape — ${JSON.stringify(fc)}`);
      break;
    }
  }
  passed++;
}

{
  // Custom name override
  const result = buildMotion3({ paramIds: [], durationSec: 8 });
  const { action } = resultToSsAction(result, { name: 'CustomName', fps: 60 });
  assert(action.name === 'CustomName', 'ssAction: name override');
  assert(action.fps === 60, 'ssAction: fps override');
}

console.log(`idleBuilder: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
