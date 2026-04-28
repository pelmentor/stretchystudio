// v3 Phase 0F.14 - tests for src/renderer/animationEngine.js
//
// The animation engine drives every keyframe-based playback in the
// app: transform tweens, opacity fades, blend-shape ramps, mesh-vert
// morphs. Untested until now; a regression in interpolation /
// easing / loop wrap-around would silently distort every animation.
//
// Run: node scripts/test/test_animationEngine.mjs

import {
  evaluateCubicBezier,
  evaluateEasing,
  interpolateTrack,
  upsertKeyframe,
  computePoseOverrides,
  getNodePropertyValue,
} from '../../src/renderer/animationEngine.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

// ── evaluateCubicBezier ────────────────────────────────────────────

{
  // x <= 0 / x >= 1 clamp to 0 / 1
  assert(evaluateCubicBezier(-0.1, 0.42, 0, 0.58, 1) === 0, 'bezier: x < 0 → 0');
  assert(evaluateCubicBezier(0, 0.42, 0, 0.58, 1) === 0, 'bezier: x = 0 → 0');
  assert(evaluateCubicBezier(1, 0.42, 0, 0.58, 1) === 1, 'bezier: x = 1 → 1');
  assert(evaluateCubicBezier(1.5, 0.42, 0, 0.58, 1) === 1, 'bezier: x > 1 → 1');

  // Linear shortcut: when (cx1, cy1) === (cx2, cy2), return x directly
  // (the early-return path)
  assert(evaluateCubicBezier(0.3, 0.5, 0.5, 0.5, 0.5) === 0.3, 'bezier: degenerate → linear');

  // Standard ease-out at t=0.5 should be > 0.5 (ahead of linear)
  const easeOut = evaluateCubicBezier(0.5, 0, 0, 0.58, 1);
  assert(easeOut > 0.5, 'bezier: ease-out at 0.5 ahead of linear');
  assert(easeOut < 1, 'bezier: ease-out at 0.5 below 1');

  // Standard ease-in at t=0.5 should be < 0.5 (behind linear)
  const easeIn = evaluateCubicBezier(0.5, 0.42, 0, 1, 1);
  assert(easeIn < 0.5, 'bezier: ease-in at 0.5 behind linear');
  assert(easeIn > 0, 'bezier: ease-in at 0.5 above 0');
}

// ── evaluateEasing ─────────────────────────────────────────────────

{
  // Linear is identity
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert(evaluateEasing(t, 'linear') === t, `linear: ${t} → ${t}`);
  }

  // Stepped always returns 0 (until next keyframe)
  assert(evaluateEasing(0.5, 'stepped') === 0, 'stepped: anywhere → 0');
  assert(evaluateEasing(0.99, 'stepped') === 0, 'stepped: near 1 → 0');

  // Default / undefined / 'ease' / 'ease-both' all use the standard ease curve
  const t = 0.3;
  const std = evaluateEasing(t, 'ease');
  assert(near(evaluateEasing(t, undefined), std), 'undefined → ease');
  assert(near(evaluateEasing(t, null), std), 'null → ease');
  assert(near(evaluateEasing(t, 'ease-both'), std), 'ease-both = ease');

  // Custom 4-tuple easing accepted
  const custom = evaluateEasing(0.5, [0, 0, 1, 1]); // y=x linear shape
  assert(near(custom, 0.5), 'custom [0,0,1,1] linear control points');

  // Unknown easing string falls back to t
  assert(evaluateEasing(0.7, 'banana') === 0.7, 'unknown easing string → linear');

  // Boundary values
  assert(evaluateEasing(0, 'ease') === 0, 'ease at 0 = 0');
  assert(near(evaluateEasing(1, 'ease'), 1), 'ease at 1 = 1');
}

// ── interpolateTrack ───────────────────────────────────────────────

{
  // Empty / null
  assert(interpolateTrack([], 0) === undefined, 'empty keyframes → undefined');
  assert(interpolateTrack(null, 0) === undefined, 'null keyframes → undefined');
}

{
  // Single keyframe: any time returns its value
  const kfs = [{ time: 100, value: 42, easing: 'linear' }];
  assert(interpolateTrack(kfs, 0) === 42, 'single kf: time before → value');
  assert(interpolateTrack(kfs, 100) === 42, 'single kf: time at → value');
  assert(interpolateTrack(kfs, 200) === 42, 'single kf: time after → value');
}

{
  // Two-keyframe linear interp
  const kfs = [
    { time: 0,    value: 0,   easing: 'linear' },
    { time: 100,  value: 100, easing: 'linear' },
  ];
  assert(interpolateTrack(kfs, 50) === 50, 'linear midpoint');
  assert(interpolateTrack(kfs, 25) === 25, 'linear quarter');

  // Edge clamping
  assert(interpolateTrack(kfs, -10) === 0, 'before first → first.value');
  assert(interpolateTrack(kfs, 200) === 100, 'after last → last.value');
}

{
  // Three-keyframe lookup picks the right segment
  const kfs = [
    { time: 0,   value: 0,   easing: 'linear' },
    { time: 100, value: 50,  easing: 'linear' },
    { time: 200, value: 0,   easing: 'linear' },
  ];
  assert(interpolateTrack(kfs, 50)  === 25, 'segment 1: linear interp');
  assert(interpolateTrack(kfs, 100) === 50, 'at second kf');
  assert(interpolateTrack(kfs, 150) === 25, 'segment 2: linear interp back down');
}

{
  // Loop wrap-around: at endMs the track should ramp back toward kf[0]
  const kfs = [
    { time: 0,   value: 0,   easing: 'linear' },
    { time: 100, value: 100, easing: 'linear' },
  ];
  // timeMs = 150 (between last kf and endMs=200); should ramp toward 0
  const v = interpolateTrack(kfs, 150, true, 200);
  // Halfway from last kf (100) toward first (0) → 50
  assert(v === 50, 'loop wrap: halfway back → 50');
}

// ── upsertKeyframe ─────────────────────────────────────────────────

{
  const kfs = [];
  upsertKeyframe(kfs, 100, 5, 'linear');
  assert(kfs.length === 1 && kfs[0].time === 100 && kfs[0].value === 5,
    'upsert: insert into empty');

  // Insert at later time → appended
  upsertKeyframe(kfs, 200, 10, 'linear');
  assert(kfs.length === 2 && kfs[1].time === 200, 'upsert: insert later → appended');

  // Insert at earlier time → prepended (sorted)
  upsertKeyframe(kfs, 50, 0, 'linear');
  assert(kfs.length === 3 && kfs[0].time === 50, 'upsert: insert earlier → sorted');
  assert(kfs[1].time === 100 && kfs[2].time === 200, 'upsert: order preserved');

  // Update at existing time → replace value, no length change
  upsertKeyframe(kfs, 100, 999, 'ease');
  assert(kfs.length === 3, 'upsert: same time → replace, no growth');
  const at100 = kfs.find(k => k.time === 100);
  assert(at100.value === 999, 'upsert: same time → new value');
  assert(at100.easing === 'ease', 'upsert: same time → new easing');
}

// ── computePoseOverrides ───────────────────────────────────────────

{
  // null animation → empty Map
  const overrides = computePoseOverrides(null, 0);
  assert(overrides instanceof Map, 'null animation → Map');
  assert(overrides.size === 0, 'null animation → empty');
}

{
  // Animation with one node having two tracks
  const anim = {
    tracks: [
      { nodeId: 'a', property: 'x', keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 100, value: 100, easing: 'linear' },
      ]},
      { nodeId: 'a', property: 'opacity', keyframes: [
        { time: 0, value: 1, easing: 'linear' },
        { time: 100, value: 0, easing: 'linear' },
      ]},
    ],
  };
  const overrides = computePoseOverrides(anim, 50);
  assert(overrides.size === 1, 'one node with overrides');
  const a = overrides.get('a');
  assert(a.x === 50, 'pose: x interpolated');
  assert(near(a.opacity, 0.5), 'pose: opacity interpolated');
}

// ── getNodePropertyValue ───────────────────────────────────────────

{
  const node = {
    transform: { x: 5, y: 7, rotation: 30, scaleX: 2, scaleY: 3 },
    opacity: 0.75,
    visible: true,
    blendShapeValues: { smile: 0.6 },
  };

  assert(getNodePropertyValue(node, 'x') === 5, 'getProp: x');
  assert(getNodePropertyValue(node, 'y') === 7, 'getProp: y');
  assert(getNodePropertyValue(node, 'rotation') === 30, 'getProp: rotation');
  assert(getNodePropertyValue(node, 'scaleX') === 2, 'getProp: scaleX');
  assert(getNodePropertyValue(node, 'scaleY') === 3, 'getProp: scaleY');
  assert(getNodePropertyValue(node, 'opacity') === 0.75, 'getProp: opacity');
  assert(getNodePropertyValue(node, 'visible') === true, 'getProp: visible');
  assert(getNodePropertyValue(node, 'blendShape:smile') === 0.6, 'getProp: blendShape');
  assert(getNodePropertyValue(node, 'blendShape:other') === 0, 'getProp: missing blend → 0');
}

console.log(`animationEngine: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
