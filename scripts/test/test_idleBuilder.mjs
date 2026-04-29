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
  resultToSsAnimation,
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

// ── resultToSsAnimation ──────────────────────────────────────────

{
  const result = buildMotion3({
    paramIds: ['ParamAngleX'],
    durationSec: 8,
    fps: 30,
  });
  const { animation } = resultToSsAnimation(result);

  assert(typeof animation.id === 'string' && animation.id.startsWith('__motion_idle'),
    'ssAnim: id has motion_idle prefix');
  assert(typeof animation.name === 'string' && animation.name.length > 0,
    'ssAnim: name set');
  assert(animation.duration === 8000, 'ssAnim: duration in ms');
  assert(animation.fps === 30, 'ssAnim: fps preserved');
  assert(Array.isArray(animation.tracks), 'ssAnim: tracks array');
  assert(animation.tracks.length === result.animatedIds.length,
    'ssAnim: 1 track per animated param');

  for (const t of animation.tracks) {
    if (typeof t.paramId !== 'string' ||
        typeof t.min !== 'number' ||
        typeof t.max !== 'number' ||
        typeof t.rest !== 'number' ||
        !Array.isArray(t.keyframes)) {
      failed++; console.error(`FAIL: ssAnim track shape — ${JSON.stringify(t)}`);
      break;
    }
  }
  passed++;
}

{
  // Custom name override
  const result = buildMotion3({ paramIds: [], durationSec: 8 });
  const { animation } = resultToSsAnimation(result, { name: 'CustomName', fps: 60 });
  assert(animation.name === 'CustomName', 'ssAnim: name override');
  assert(animation.fps === 60, 'ssAnim: fps override');
}

console.log(`idleBuilder: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
