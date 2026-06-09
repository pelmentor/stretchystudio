// Smoke-test the buildMotion3 → v3 animation-tracks conversion that
// IdleMotionDialog.handleGenerate uses. Pure logic, no DOM.
//
// Verifies:
//   - All presets produce non-zero animated tracks for a standard param set.
//   - Physics-output paramIds are skipped.
//   - Track shape matches v3's `{paramId, keyframes:[{time, value, easing}]}`.
//   - Time stays in milliseconds (motionLib uses durationMs end-to-end).
//   - No validation errors for default args.

import { buildMotion3, PRESET_NAMES } from '../../src/io/live2d/idle/builder.js';
import { strict as assert } from 'node:assert';

const STANDARD_PARAMS = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen',
  'ParamMouthOpenY', 'ParamMouthForm', 'ParamBreath',
];
const PHYSICS_OUTPUTS = new Set(['ParamHairFront', 'ParamHairBack', 'ParamSkirt']);

let pass = 0, fail = 0;
const expect = (label, fn) => {
  try { fn(); pass += 1; }
  catch (err) { fail += 1; console.error(`  ✗ ${label}: ${err.message}`); }
};

for (const preset of PRESET_NAMES) {
  expect(`preset='${preset}' produces tracks`, () => {
    const result = buildMotion3({
      preset, paramIds: STANDARD_PARAMS, physicsOutputIds: PHYSICS_OUTPUTS,
      durationSec: 8, fps: 30, personality: 'calm', seed: 1,
    });
    assert.equal(result.validationErrors.length, 0, `validationErrors: ${result.validationErrors.join('; ')}`);
    assert.ok(result.animatedIds.length > 0, 'no params got curves');

    const tracks = [];
    for (const id of result.animatedIds) {
      const kfs = result.paramKeyframes.get(id);
      if (!kfs || kfs.length < 2) continue;
      tracks.push({
        paramId: id,
        keyframes: kfs.map((kf) => ({ time: kf.time, value: kf.value, easing: kf.easing ?? 'linear' })),
      });
    }
    assert.ok(tracks.length > 0, 'no tracks built');

    for (const t of tracks) {
      assert.ok(typeof t.paramId === 'string' && t.paramId.length > 0);
      assert.ok(Array.isArray(t.keyframes) && t.keyframes.length >= 2);
      // Time is in ms — last kf should be ≤ durationSec*1000 (= 8000ms).
      const last = t.keyframes[t.keyframes.length - 1];
      assert.ok(last.time > 0 && last.time <= 8000, `time out of bounds: ${last.time}`);
      assert.ok(typeof last.value === 'number' && Number.isFinite(last.value), `non-finite value`);
      assert.ok(typeof last.easing === 'string', `easing not a string`);
    }
  });
}

expect('physics outputs are skipped', () => {
  const result = buildMotion3({
    preset: 'idle',
    paramIds: [...STANDARD_PARAMS, 'ParamHairFront', 'ParamHairBack'],
    physicsOutputIds: PHYSICS_OUTPUTS,
    durationSec: 8, fps: 30, personality: 'calm', seed: 1,
  });
  for (const id of result.animatedIds) {
    assert.ok(!PHYSICS_OUTPUTS.has(id), `physics output ${id} was animated (should be skipped)`);
  }
  const skippedIds = new Set(result.skipped.map((s) => s.id));
  assert.ok(skippedIds.has('ParamHairFront') || skippedIds.has('ParamHairBack'),
    'expected at least one physics-output id in skipped list');
});

expect('seed determinism: same seed → same keyframes', () => {
  const a = buildMotion3({ preset: 'idle', paramIds: STANDARD_PARAMS, physicsOutputIds: new Set(), durationSec: 8, fps: 30, personality: 'calm', seed: 7 });
  const b = buildMotion3({ preset: 'idle', paramIds: STANDARD_PARAMS, physicsOutputIds: new Set(), durationSec: 8, fps: 30, personality: 'calm', seed: 7 });
  assert.deepStrictEqual([...a.paramKeyframes.entries()].map(([k, v]) => [k, v.length]),
                          [...b.paramKeyframes.entries()].map(([k, v]) => [k, v.length]));
});

expect('different seed → different keyframes', () => {
  const a = buildMotion3({ preset: 'idle', paramIds: STANDARD_PARAMS, physicsOutputIds: new Set(), durationSec: 8, fps: 30, personality: 'calm', seed: 1 });
  const b = buildMotion3({ preset: 'idle', paramIds: STANDARD_PARAMS, physicsOutputIds: new Set(), durationSec: 8, fps: 30, personality: 'calm', seed: 99 });
  // At least one param's keyframe values should differ.
  let differs = false;
  for (const [id, kfsA] of a.paramKeyframes.entries()) {
    const kfsB = b.paramKeyframes.get(id);
    if (!kfsB || kfsB.length !== kfsA.length) { differs = true; break; }
    for (let i = 0; i < kfsA.length; i++) {
      if (Math.abs(kfsA[i].value - kfsB[i].value) > 1e-6) { differs = true; break; }
    }
    if (differs) break;
  }
  assert.ok(differs, 'different seeds produced identical motion');
});

// Regression — wander shiftToRest must shift bezier handles WITH the value.
// Before 2026-06-09 the offset was only applied to kf.value; the handles
// kept their pre-shift absolute (time, value) coordinates, so the bezier
// between every pair of keyforms overshot by the shift magnitude. With
// the post-2026-06-09 handleType:free/free preservation that turned into
// a parkinsonian high-frequency oscillation on every wander param (head
// angles, eyeball drift) — visible in the F-curve panel and in exported
// motion3.json playback.
//
// Pin: for the calm/seed=1 idle preset's ParamAngleX:
//   - kfs[0].value must be 0 (defaultRest)
//   - handleLeft.value and handleRight.value must be CLOSE to kfs[0].value
//     (within the wander's max handle offset). Pre-fix they were ~6-9
//     units away from the kf value while the kf was at 0.
expect('wander shiftToRest also shifts bezier handles', () => {
  const result = buildMotion3({
    preset: 'idle', paramIds: STANDARD_PARAMS,
    physicsOutputIds: new Set(),
    durationSec: 10, fps: 60, personality: 'calm', seed: 1,
  });
  const kfs = result.paramKeyframes.get('ParamAngleX');
  assert.ok(kfs && kfs.length >= 2, 'ParamAngleX has keyforms');
  const kf0 = kfs[0];
  // shiftToRest pins kf[0].value to defaultRest (=0 for ParamAngleX).
  assert.ok(Math.abs(kf0.value - 0) < 1e-6,
    `kfs[0].value should be 0 (defaultRest), got ${kf0.value}`);
  // Handles should be CLOSE to kf value (within the analytical handle
  // offset for a 3-harmonic wander; pre-fix they were ~7-9 units off).
  const HANDLE_BOUND = 3; // generous — analytical max is ~1.7 for this config
  assert.ok(Math.abs(kf0.handleLeft.value - kf0.value) < HANDLE_BOUND,
    `kfs[0].handleLeft.value (${kf0.handleLeft.value}) too far from kf.value (${kf0.value}) — shiftToRest didn't shift handles`);
  assert.ok(Math.abs(kf0.handleRight.value - kf0.value) < HANDLE_BOUND,
    `kfs[0].handleRight.value (${kf0.handleRight.value}) too far from kf.value (${kf0.value}) — shiftToRest didn't shift handles`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
