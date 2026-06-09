/**
 * Procedural curve generators for idle motion3.json synthesis.
 *
 * Each generator returns an array of `{time: ms, value, interpolation, ...}`
 * keyframes which feeds directly into `encodeKeyframesToSegments` from
 * `src/io/live2d/motion3json.js`. The `interpolation` field is the same
 * one the SS animation pipeline uses (linear / bezier / constant / named
 * easings) — using it lets analytical generators (sine, wander) emit true
 * bezier handles so Cubism plays them with curved, not piecewise-linear,
 * segments. Without it every segment baked to linear and the user saw
 * visible "blocky" steps even on a slow breath curve.
 *
 * Loop-safety contract: every generator MUST emit `value(t=0) === value(t=durationMs)`
 * so that motion3.json with `Loop: true` plays seamlessly.
 *
 * @module io/live2d/idle/motionLib
 */

/**
 * Deterministic seeded PRNG (mulberry32). Same seed → same sequence — critical
 * so a regenerated idle for the same character keeps the same feel.
 */
export function makeRng(seed) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = Math.PI * 2;

/**
 * Constant curve — value held flat. Two keyframes at t=0 and t=D.
 * Useful for params we explicitly want pinned at rest (mouth, expression).
 */
export function genConstant({ durationMs, value }) {
  return [
    { time: 0, value, interpolation: 'linear' },
    { time: durationMs, value, interpolation: 'linear' },
  ];
}

/**
 * Sine curve — `value = mid + amplitude * sin(2π t / period + phase)`.
 * Period must divide durationMs evenly for loop safety; we enforce by snapping
 * to the closest integer cycle count.
 *
 * Emits BEZIER keyframes with analytical handle tangents derived from the
 * cosine derivative `dv/dt = amplitude * ω * cos(ω t + φ)`. Each handle sits
 * at `±δ/3` along the time axis with value offset `dv/dt · δ/3` (hermite-to-
 * bezier conversion at 1/3 segment), giving Cubism enough information to
 * play a true sine, not a polygonal approximation. With this every sample
 * still lands exactly on the sine but the SEGMENTS between samples curve
 * through the analytic shape — no visible polygon edges at peaks.
 */
export function genSine({ durationMs, amplitude, period, phase = 0, mid = 0, samples = 0 }) {
  const D = durationMs;
  const cycles = Math.max(1, Math.round(D / period));
  const snappedPeriod = D / cycles;
  const omega = TWO_PI / snappedPeriod;

  // 60 samples per cycle. We emit LINEAR segments (not bezier) because
  // bezier-with-zero-slope-at-extrema fundamentally asymptotes to the
  // peak value over the last fraction of the segment (P2.y == P3.y →
  // tangent at u=1 horizontal). Even with adaptive handle offset the
  // asymptote IS there, just sub-frame; the user kept reporting
  // "snap at 0/1" through 6 rounds of bezier-handle fixes because
  // Cubism / ren'py runtime bezier eval shape differs subtly from
  // SS's evaluator. Linear-between-dense-samples sidesteps every
  // bezier interpretation question: 60 samples/cycle gives a polygon
  // whose max chord error vs true sine is ~0.14 % of amplitude
  // ((2π/60)² / 8) — visually identical to SS viewport's live sine.
  // File size is actually SMALLER than bezier (3 vs 7 numbers per
  // segment), so this is a win on every axis.
  const N = samples > 0 ? samples : Math.max(16, cycles * 60);
  const dt = D / N;
  const kfs = [];
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    const v = mid + amplitude * Math.sin(omega * t + phase);
    kfs.push({ time: t, value: v, interpolation: 'linear' });
  }
  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  // Pin the last sample's time to D exactly. `i * dt` for the loop's
  // final iteration is mathematically D but FP can produce
  // D + 1e-12 which fails downstream bounds-checks (test_actionExportCan3
  // refused 8000.000000000001 as "time out of bounds: 8000").
  last.time = D;
  last.value = first.value;
  return kfs;
}

/**
 * Wander curve — sum of N harmonics (k = 1..harmonics cycles over duration).
 * Each harmonic gets a random amplitude weighting + random phase.
 * Result is loop-safe because every component is exactly periodic over D.
 */
export function genWander({ durationMs, amplitude, harmonics = 3, mid = 0, samples = 24, seed = 1 }) {
  const D = durationMs;
  const rng = makeRng(seed);

  const comps = [];
  for (let k = 1; k <= harmonics; k++) {
    const w = 1 / k;
    const a = w * (0.5 + rng());
    const phi = rng() * TWO_PI;
    // Pre-compute the per-component angular frequency so the eval +
    // derivative loops below don't re-derive 2π·k/D for every sample.
    comps.push({ k, a, phi, omega: (TWO_PI * k) / D });
  }
  const ampSum = comps.reduce((s, c) => s + c.a, 0);
  const norm = ampSum > 0 ? 1 / ampSum : 1;

  // Linear segments at dense sampling — same rationale as genSine.
  // Wander is sum-of-harmonics so we sample more densely to handle
  // the higher-frequency components without polygon artefacts:
  // multiplier scales with `harmonics` so the per-component Nyquist
  // is comfortable (≥4 samples per harmonic cycle even at the highest k).
  const dtRaw = D / samples;
  // Caller may have passed a small `samples` thinking we'd use beziers;
  // for linear we want at least ~12 samples per harmonic period.
  const sampleFloor = Math.max(samples, harmonics * 12, 24);
  const N = sampleFloor;
  const dt = D / N;
  const kfs = [];
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    let v = 0;
    for (const c of comps) v += c.a * Math.sin(c.omega * t + c.phi);
    v = mid + amplitude * v * norm;
    kfs.push({ time: t, value: v, interpolation: 'linear' });
  }
  // Loop-safety: pin t=D value to t=0. Each harmonic completes an integer
  // number of cycles over D so the analytic value at t=D already equals
  // t=0 to fp32 precision; explicit pin removes any drift accumulated
  // across `N` evaluations.
  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  last.time = D; // FP-exact pin — see genSine comment.
  last.value = first.value;
  return kfs;
}

/**
 * Blink rhythm — discrete eye closure events at randomised intervals.
 * Loop closure: schedule blinks only in the interior [edgeBufferMs, D-edgeBufferMs]
 * so t=0 and t=D both sit at fully-open.
 *
 * Each blink occupies ~120ms total (60ms close + 60ms open). The model's own
 * blink keyform handles the squash visual; we just drive the param.
 */
export function genBlink({
  durationMs,
  intervalAvgMs = 4000,
  intervalJitterMs = 1500,
  closedDurationMs = 60,
  openValue = 1.0,
  closedValue = 0.0,
  edgeBufferMs = 400,
  seed = 1,
}) {
  const D = durationMs;
  const rng = makeRng(seed);

  const blinkTimes = [];
  let t = edgeBufferMs + rng() * intervalAvgMs;
  while (t < D - edgeBufferMs) {
    blinkTimes.push(t);
    const jitter = (rng() * 2 - 1) * intervalJitterMs;
    t += Math.max(800, intervalAvgMs + jitter);
  }

  const kfs = [
    { time: 0, value: openValue, interpolation: 'linear' },
  ];

  for (const bt of blinkTimes) {
    const halfClose = closedDurationMs / 2;
    kfs.push({ time: bt - halfClose - 30, value: openValue, interpolation: 'linear' });
    kfs.push({ time: bt - halfClose,      value: closedValue, interpolation: 'linear' });
    kfs.push({ time: bt + halfClose,      value: closedValue, interpolation: 'linear' });
    kfs.push({ time: bt + halfClose + 30, value: openValue, interpolation: 'linear' });
  }

  kfs.push({ time: D, value: openValue, interpolation: 'linear' });

  kfs.sort((a, b) => a.time - b.time);
  return kfs;
}

/**
 * Burst events — at random intervals, value smoothly transitions
 * `restValue → peakValue → restValue` over `pulseDurationMs`. Used for
 * acknowledgement nods (listening), accent gestures (talking), eye glances.
 *
 * Loop closure: bursts only scheduled in interior [edgeBufferMs, D-edgeBufferMs]
 * so endpoints stay at restValue.
 *
 * The pulse is symmetric with 5 keyframes:
 *   start_rest → quarter_to_peak → peak → quarter_back → end_rest
 * Linear segments give a triangular pulse; downstream encoder may upgrade
 * easing to bezier per keyframe.
 */
export function genBurst({
  durationMs,
  intervalAvgMs = 5000,
  intervalJitterMs = 2000,
  pulseDurationMs = 500,
  peakValue = -5,
  restValue = 0,
  edgeBufferMs = 600,
  seed = 1,
}) {
  const D = durationMs;
  const rng = makeRng(seed);

  const burstTimes = [];
  let t = edgeBufferMs + rng() * intervalAvgMs;
  const minSpacing = pulseDurationMs + 400;  // never overlap pulses
  while (t < D - edgeBufferMs - pulseDurationMs / 2) {
    burstTimes.push(t);
    const jitter = (rng() * 2 - 1) * intervalJitterMs;
    t += Math.max(minSpacing, intervalAvgMs + jitter);
  }

  const kfs = [{ time: 0, value: restValue, interpolation: 'linear' }];
  const halfPulse = pulseDurationMs / 2;
  const quarterPulse = pulseDurationMs / 4;
  const midValue = restValue + (peakValue - restValue) * 0.5;

  for (const bt of burstTimes) {
    // Peak is at bt; pulse runs from bt-halfPulse to bt+halfPulse. The
    // approach/decay use 'cubic' (NAMED_EASING) so the encoder bakes
    // each segment into 16 linear sub-samples — Cubism plays it as a
    // smooth ease-in-out nod, not a sharp triangular pulse.
    kfs.push({ time: bt - halfPulse - 1,    value: restValue, interpolation: 'linear' });
    kfs.push({ time: bt - quarterPulse,     value: midValue,  interpolation: 'cubic' });
    kfs.push({ time: bt,                    value: peakValue, interpolation: 'cubic' });
    kfs.push({ time: bt + quarterPulse,     value: midValue,  interpolation: 'cubic' });
    kfs.push({ time: bt + halfPulse + 1,    value: restValue, interpolation: 'linear' });
  }

  kfs.push({ time: D, value: restValue, interpolation: 'linear' });
  kfs.sort((a, b) => a.time - b.time);
  return kfs;
}

/**
 * Speech-like mouth pulses — continuous sequence of small open/close events
 * at speech tempo (~3-4 syllables/sec). Each pulse: rest → random peak → rest.
 *
 * Loop closure: starts and ends at restValue (mouth closed).
 */
export function genSyllables({
  durationMs,
  intervalAvgMs = 280,
  intervalJitterMs = 100,
  syllableDurationMs = 180,
  peakMin = 0.3,
  peakMax = 0.85,
  restValue = 0,
  pauseProbability = 0.12,
  pauseLengthMs = 700,
  edgeBufferMs = 200,
  seed = 1,
}) {
  const D = durationMs;
  const rng = makeRng(seed);

  const kfs = [{ time: 0, value: restValue, interpolation: 'linear' }];
  let t = edgeBufferMs + rng() * intervalAvgMs;

  while (t < D - edgeBufferMs - syllableDurationMs) {
    const peak = peakMin + rng() * (peakMax - peakMin);
    const halfDur = syllableDurationMs / 2;

    kfs.push({ time: t,                value: restValue, interpolation: 'linear' });
    // Approach + decay use 'cubic' (NAMED_EASING) so the encoder bakes
    // each segment into 16 sub-samples — smooth mouth pulse instead of a
    // sharp triangle. Same pattern as genBurst.
    kfs.push({ time: t + halfDur,      value: peak,      interpolation: 'cubic' });
    kfs.push({ time: t + syllableDurationMs, value: restValue, interpolation: 'cubic' });

    // Advance: syllable duration + gap. Occasional longer pause = sentence boundary.
    const gap = rng() < pauseProbability
      ? pauseLengthMs
      : Math.max(60, intervalAvgMs - syllableDurationMs + (rng() * 2 - 1) * intervalJitterMs);
    t += syllableDurationMs + gap;
  }

  kfs.push({ time: D, value: restValue, interpolation: 'linear' });
  kfs.sort((a, b) => a.time - b.time);
  return kfs;
}

/**
 * Clamp keyframe values to [min, max]. Run AFTER any generator to guarantee
 * the model's parameter bounds are respected.
 *
 * Bezier handles are clamped IN LOCKSTEP with their owning keyform's value.
 * Pre-2026-06-09 only `kf.value` was clamped — when amplitude × personality
 * exceeded the param range (e.g. energetic's ampMul=1.5 took breath peaks
 * from 1.0 to 1.25), the kf endpoints flattened to 1.0 but the handles
 * still pointed at the un-clamped 1.18 / 1.25 values. Cubism's bezier
 * playback then OVERSHOT past 1.0 and got clamped a second time by the
 * runtime — visible as a snap/discontinuity at the param boundary that
 * SS viewport (which uses live driver math, not the baked keyforms)
 * never shows.
 */
function clampHandle(h, min, max) {
  if (!h || typeof h.value !== 'number') return h;
  return { time: h.time, value: Math.max(min, Math.min(max, h.value)) };
}

export function clampKeyframes(keyframes, min, max) {
  return keyframes.map(kf => ({
    ...kf,
    value: Math.max(min, Math.min(max, kf.value)),
    handleLeft:  clampHandle(kf.handleLeft,  min, max),
    handleRight: clampHandle(kf.handleRight, min, max),
  }));
}

/**
 * Apply a personality profile to the base config of a single param.
 * Profiles scale amplitude and period multiplicatively. Clamps respected
 * downstream by clampKeyframes.
 */
export function applyPersonality(baseCfg, personality) {
  const profiles = {
    calm:       { ampMul: 1.0, periodMul: 1.0, blinkIntervalMul: 1.0, blinkJitterMul: 1.0 },
    energetic:  { ampMul: 1.5, periodMul: 0.7, blinkIntervalMul: 0.8, blinkJitterMul: 1.2 },
    tired:      { ampMul: 0.6, periodMul: 1.4, blinkIntervalMul: 0.6, blinkJitterMul: 0.8 },
    nervous:    { ampMul: 0.8, periodMul: 0.5, blinkIntervalMul: 0.5, blinkJitterMul: 2.0 },
    confident:  { ampMul: 1.0, periodMul: 1.2, blinkIntervalMul: 1.2, blinkJitterMul: 0.8 },
  };
  const p = profiles[personality] ?? profiles.calm;
  const out = { ...baseCfg };
  if (out.amplitude !== undefined) out.amplitude *= p.ampMul;
  if (out.period !== undefined) out.period *= p.periodMul;
  if (out.intervalAvgMs !== undefined) out.intervalAvgMs *= p.blinkIntervalMul;
  if (out.intervalJitterMs !== undefined) out.intervalJitterMs *= p.blinkJitterMul;
  return out;
}
