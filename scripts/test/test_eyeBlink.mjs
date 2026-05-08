// EyeBlinkDriver — Cubism Web Framework state-machine port.
//
// Tests:
//   1. Initial state = Interval, value = 1.
//   2. Interval → Closing transition fires when nextBlinkingTime
//      expires; Closing ramps 1 → 0 over closingSeconds.
//   3. Closed phase holds 0 for closedSeconds.
//   4. Opening ramps 0 → 1 over openingSeconds; lands back in Interval.
//   5. Each cycle picks a fresh nextBlinkingTime via injected RNG.
//   6. resolveEyeBlinkParamIds reads project.groups.EyeBlink, falls
//      back to canonical ids.
//   7. Defensive: negative / NaN / Infinity dt collapses to 0.
//
// Run: node scripts/test/test_eyeBlink.mjs

import {
  EyeBlinkDriver,
  EYE_BLINK_DEFAULTS,
  DEFAULT_EYE_BLINK_PARAM_IDS,
  resolveEyeBlinkParamIds,
} from '../../src/io/live2d/runtime/eyeBlink.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ---- 1. Initial state = Interval, value = 1 ----
{
  // Inject random=0 so nextBlinkingTime = 0 + 0*(2*4-1) = 0 immediately
  // ready to fire on first tick.
  const d = new EyeBlinkDriver({ random: () => 0 });
  assert(d.state === 'Interval', 'starts in Interval');
  // Tick with dt=0 — userTime still 0, nextBlinkingTime=0; condition is
  // strict less-than (0 < 0 false), so still Interval.
  const v = d.tick(0);
  assert(v === 1, 'eye-open value = 1 in Interval');
  assert(d.state === 'Interval', 'still Interval at dt=0');
}

// ---- 2. Interval → Closing → Closed → Opening cycle (deterministic) ----
{
  // RNG draws 0.0 always → nextBlinkingTime = userTime + 0 each interval
  // pick. After the first tick, _userTime > _nextBlinkingTime is false
  // strictly (== fails the < check); the next tick with positive dt
  // pushes _userTime past 0 and triggers Closing.
  const d = new EyeBlinkDriver({
    random: () => 0,
    closingSeconds: 0.1,
    closedSeconds: 0.05,
    openingSeconds: 0.15,
    blinkingIntervalSeconds: 4.0,
  });
  // Frame 1: dt=0.001. userTime=0.001 > nextBlinkingTime=0 → trips into Closing.
  const v1 = d.tick(0.001);
  assert(d.state === 'Closing', 'tripped into Closing');
  // Closing started at userTime=0.001. With t = (0.001 - 0.001) / 0.1 = 0,
  // value = 1 - 0 = 1.
  assert(approx(v1, 1, 1e-6), `closing-start value ≈ 1 (got ${v1})`);

  // Halfway through closing — userTime = 0.001 + 0.05 = 0.051;
  // t = (0.051 - 0.001) / 0.1 = 0.5; value = 1 - 0.5 = 0.5.
  const v2 = d.tick(0.05);
  assert(approx(v2, 0.5, 1e-6), `closing-mid value ≈ 0.5 (got ${v2})`);
  assert(d.state === 'Closing', 'still Closing mid-ramp');

  // Finish closing — userTime = 0.001 + 0.05 + 0.05 = 0.101 → t=1
  // → snap to Closed.
  const v3 = d.tick(0.05);
  assert(d.state === 'Closed', 'transitioned to Closed at t=1');
  assert(v3 === 0, `Closed value = 0 (got ${v3})`);

  // Closed phase — value stays 0 mid-hold, then transitions on overshoot.
  // (dt sums chosen to clear closedSeconds without landing on the 1.0
  // threshold under fp64 — 0.025 + 0.025 = 0.05 can drift below 1.0.)
  const v4 = d.tick(0.02);
  assert(d.state === 'Closed', 'still Closed mid-hold');
  assert(v4 === 0, 'value = 0 mid-hold');

  const v5 = d.tick(0.04); // overshoots closedSeconds (0.05) on accumulated dt
  // After completing Closed, the state transitions to Opening; the
  // current tick still emits value=0 (transition happens before
  // value computation in the case branch).
  assert(d.state === 'Opening', 'transitioned to Opening');
  assert(v5 === 0, 'value still 0 right at Opening start (t=0)');

  // Halfway through opening (dt = 0.08 > 0.075 so we're slightly past
  // the half — accept anything in [0.5, 0.6]).
  const v6 = d.tick(0.08);
  assert(v6 >= 0.4 && v6 <= 0.7, `opening-mid value in [0.4, 0.7] (got ${v6})`);
  assert(d.state === 'Opening', 'still Opening');

  // Finish opening (overshoot openingSeconds).
  const v7 = d.tick(0.1);
  assert(d.state === 'Interval', 'back to Interval after Opening');
  assert(v7 === 1, 'Interval value = 1');
}

// ---- 3. RNG influences nextBlinkingTime ----
{
  // random=1 → nextBlinkingTime = userTime + 1 * (2*4 - 1) = userTime + 7.
  // Interval should hold for ~7s.
  const d = new EyeBlinkDriver({ random: () => 1 });
  d.tick(0.001);
  assert(d.state === 'Interval', 'still Interval at dt=0.001 with r=1 (next blink in 7s)');
  d.tick(6.0);
  assert(d.state === 'Interval', 'still Interval after 6s (under 7s)');
  d.tick(2.0);
  assert(d.state === 'Closing', 'transitioned to Closing after 8s elapsed (past 7s)');
}

// ---- 4. Defensive dt clamping ----
{
  const d = new EyeBlinkDriver({ random: () => 0 });
  // Negative dt — collapses to 0.
  d.tick(-1);
  assert(d.state === 'Interval', 'negative dt collapses (no advance)');
  // NaN dt — collapses to 0.
  d.tick(Number.NaN);
  assert(d.state === 'Interval', 'NaN dt collapses');
  // Infinity dt — collapses to 0.
  d.tick(Number.POSITIVE_INFINITY);
  assert(d.state === 'Interval', 'Infinity dt collapses');
}

// ---- 5. reset() re-arms ----
{
  const d = new EyeBlinkDriver({ random: () => 0.5 });
  // Tick into closing.
  d.tick(0.001);
  d.tick(10);
  assert(d.state !== 'Interval', 'driver advanced past Interval');
  d.reset();
  assert(d.state === 'Interval', 'reset returns to Interval');
}

// ---- 6. Default constants match Cubism Framework ----
{
  assert(EYE_BLINK_DEFAULTS.closingSeconds === 0.1, 'default closingSeconds = 0.1');
  assert(EYE_BLINK_DEFAULTS.closedSeconds === 0.05, 'default closedSeconds = 0.05');
  assert(EYE_BLINK_DEFAULTS.openingSeconds === 0.15, 'default openingSeconds = 0.15');
  assert(EYE_BLINK_DEFAULTS.blinkingIntervalSeconds === 4.0, 'default blinkingIntervalSeconds = 4.0');
  assert(DEFAULT_EYE_BLINK_PARAM_IDS.length === 2, '2 default param ids');
  assert(DEFAULT_EYE_BLINK_PARAM_IDS[0] === 'ParamEyeLOpen', 'left eye id');
  assert(DEFAULT_EYE_BLINK_PARAM_IDS[1] === 'ParamEyeROpen', 'right eye id');
}

// ---- 7. resolveEyeBlinkParamIds: project.groups.EyeBlink overrides ----
{
  const ids = resolveEyeBlinkParamIds({
    groups: { EyeBlink: ['ParamCustomLeft', 'ParamCustomRight'] },
  });
  assert(ids.length === 2 && ids[0] === 'ParamCustomLeft' && ids[1] === 'ParamCustomRight',
    'project.groups.EyeBlink override honoured');
  // Defensive: returns a fresh array (not the original ref).
  const original = ['ParamCustomLeft', 'ParamCustomRight'];
  const out = resolveEyeBlinkParamIds({ groups: { EyeBlink: original } });
  assert(out !== original, 'returns a copy, not the original reference');
}

// ---- 8. resolveEyeBlinkParamIds: fallback to canonical ids ----
{
  const cases = [
    {},
    { groups: null },
    { groups: { EyeBlink: null } },
    { groups: { EyeBlink: [] } },
    { groups: { EyeBlink: ['valid', 42] } }, // mixed types — reject
  ];
  for (const c of cases) {
    const ids = resolveEyeBlinkParamIds(c);
    assert(ids.length === 2 && ids[0] === 'ParamEyeLOpen', `fallback for ${JSON.stringify(c)}`);
  }
}

console.log(`eyeBlink: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
