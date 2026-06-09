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

// Regression — wander shiftToRest must pin kf[0].value to defaultRest.
// Now linear (post 2026-06-09 R7) so handle-shift assertions no longer
// apply, but the value-pin invariant still does.
expect('wander shiftToRest pins kf[0] to defaultRest', () => {
  const result = buildMotion3({
    preset: 'idle', paramIds: STANDARD_PARAMS,
    physicsOutputIds: new Set(),
    durationSec: 10, fps: 60, personality: 'calm', seed: 1,
  });
  const kfs = result.paramKeyframes.get('ParamAngleX');
  assert.ok(kfs && kfs.length >= 2, 'ParamAngleX has keyforms');
  assert.ok(Math.abs(kfs[0].value - 0) < 1e-6,
    `kfs[0].value should be 0 (defaultRest), got ${kfs[0].value}`);
  // Linear segments — no handle objects.
  assert.strictEqual(kfs[0].interpolation, 'linear',
    `kfs[0].interpolation should be 'linear' post-R7, got ${kfs[0].interpolation}`);
});

// Regression — amplitude clamp + handle clamp eliminate the
// "snap at extremes" bug. Pre-2026-06-09 'energetic' breath had
// ampMul=1.5 → amp=0.75 → peaks at 1.25, clamped by clampKeyframes
// to 1.0 across ~3 samples in a row → bezier handles still encoded
// out-of-range slopes → Cubism overshoot + re-clamp = visible snap.
// Pin: for every personality on a [0,1]-range breath param, NO
// run of more than 1 consecutive samples may sit at 0 or 1, and
// NO bezier control point may exceed the range.
import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { resultToSsAction } from '../../src/io/live2d/idle/builder.js';

for (const personality of ['calm', 'energetic', 'tired', 'nervous']) {
  expect(`${personality} breath has no clamp plateau / no out-of-range handles`, () => {
    const r = buildMotion3({
      preset: 'idle',
      paramIds: ['ParamBreath'],
      physicsOutputIds: new Set(),
      durationSec: 10, fps: 60, personality, seed: 1,
    });
    const { action } = resultToSsAction(r);
    const m3 = generateMotion3Json(action);
    const segs = m3.Curves.find(c => c.Id === 'ParamBreath').Segments;

    // Walk endpoints; count consecutive runs at exactly 0 or 1.
    const ends = [{ t: segs[0], v: segs[1] }];
    let i = 2;
    while (i + 6 < segs.length) {
      if (segs[i] === 1) { ends.push({ t: segs[i + 5], v: segs[i + 6] }); i += 7; }
      else { ends.push({ t: segs[i + 1], v: segs[i + 2] }); i += 3; }
    }
    let run = 0, maxRun = 0;
    for (const k of ends) {
      if (k.v === 0 || k.v === 1) { run++; if (run > maxRun) maxRun = run; } else run = 0;
    }
    assert.ok(maxRun <= 1,
      `${personality}: max consecutive samples at 0/1 must be <= 1, got ${maxRun}`);

    // Bezier control points must stay inside [0, 1] (param range).
    let oor = 0;
    for (let j = 2; j + 6 < segs.length; j += 7) {
      if (segs[j] !== 1) continue;
      if (segs[j + 2] < -1e-3 || segs[j + 2] > 1 + 1e-3) oor++;
      if (segs[j + 4] < -1e-3 || segs[j + 4] > 1 + 1e-3) oor++;
    }
    assert.ok(oor === 0, `${personality}: out-of-range bezier control points must be 0, got ${oor}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
