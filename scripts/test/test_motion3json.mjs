// v3 Phase 0F.33 - tests for src/io/live2d/motion3json.js
//
// encodeKeyframesToSegments + countSegmentsAndPoints are the core
// motion3 segment encoder. The flat segment array format is finicky:
//   [t0, v0, type1, ...payload1, type2, ...payload2, ...]
// where bezier (type=1) uses 6 floats, others use 2. countSegments
// is what feeds Meta.TotalSegmentCount / TotalPointCount, which
// Cubism Viewer validates strictly.
//
// Run: node scripts/test/test_motion3json.mjs

import {
  encodeKeyframesToSegments,
  countSegmentsAndPoints,
} from '../../src/io/live2d/motion3json.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// ── encodeKeyframesToSegments ────────────────────────────────────

{
  // Empty / null → []
  assert(encodeKeyframesToSegments([], 8).length === 0, 'encode: empty → []');
  assert(encodeKeyframesToSegments(null, 8).length === 0, 'encode: null → []');
}

{
  // Single keyframe: [time, value] only
  const segs = encodeKeyframesToSegments(
    [{ time: 1000, value: 0.5, easing: 'linear' }], 8,
  );
  assert(segs.length === 2, 'encode: single keyframe = 2 floats');
  assert(near(segs[0], 1.0), 'encode: time in seconds (1000ms → 1.0)');
  assert(near(segs[1], 0.5), 'encode: value');
}

{
  // Two linear keyframes
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   easing: 'linear' },
    { time: 1000, value: 0.5, easing: 'linear' },
  ], 8);
  // Expected: [0, 0, 0(linear), 1.0, 0.5]
  assert(segs.length === 5, 'encode: 2 linear kfs = 5 floats');
  assert(segs[0] === 0 && segs[1] === 0, 'encode: first time/value');
  assert(segs[2] === 0, 'encode: linear segment type = 0');
  assert(near(segs[3], 1.0), 'encode: second time');
  assert(near(segs[4], 0.5), 'encode: second value');
}

{
  // Bezier segment uses 6 control floats
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   easing: 'linear' },
    { time: 1000, value: 1.0, easing: 'bezier' },
  ], 8);
  // [0, 0, 1(bezier), cx1, cy1, cx2, cy2, time, value] = 9 floats
  assert(segs.length === 9, 'encode: 1 bezier segment = 9 floats');
  assert(segs[2] === 1, 'encode: bezier type = 1');
  // Control points use 1/3, 2/3 rule between prev (0,0) and curr (1, 1)
  assert(near(segs[3], 1 / 3), 'encode: bezier cx1');
  assert(near(segs[4], 0),     'encode: bezier cy1');
  assert(near(segs[5], 2 / 3), 'encode: bezier cx2');
  assert(near(segs[6], 1.0),   'encode: bezier cy2');
  assert(near(segs[7], 1.0),   'encode: end time');
  assert(near(segs[8], 1.0),   'encode: end value');
}

{
  // Stepped segment
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   easing: 'linear' },
    { time: 500,  value: 1,   easing: 'stepped' },
  ], 8);
  assert(segs[2] === 2, 'encode: stepped type = 2');
}

{
  // 'step' alias for stepped
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0, easing: 'linear' },
    { time: 500, value: 1, easing: 'step' },
  ], 8);
  assert(segs[2] === 2, 'encode: "step" alias = 2');
}

{
  // 'inverse-stepped'
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0, easing: 'linear' },
    { time: 500, value: 1, easing: 'inverse-stepped' },
  ], 8);
  assert(segs[2] === 3, 'encode: inverse-stepped = 3');
}

{
  // ease-in / ease-out / ease-in-out all map to bezier (type 1)
  for (const e of ['ease-in', 'ease-out', 'ease-in-out']) {
    const segs = encodeKeyframesToSegments([
      { time: 0, value: 0, easing: 'linear' },
      { time: 500, value: 1, easing: e },
    ], 8);
    if (segs[2] !== 1) {
      failed++; console.error(`FAIL: ${e} should be bezier`); break;
    }
  }
  passed++;
}

{
  // Unknown easing → linear (default)
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0, easing: 'linear' },
    { time: 500, value: 1, easing: 'banana' },
  ], 8);
  assert(segs[2] === 0, 'encode: unknown easing → linear (0)');
}

{
  // Out-of-order keyframes get sorted
  const segs = encodeKeyframesToSegments([
    { time: 1000, value: 1, easing: 'linear' },
    { time: 0,    value: 0, easing: 'linear' },
  ], 8);
  // Should start with [0, 0, ...] (the time=0 kf)
  assert(segs[0] === 0 && segs[1] === 0, 'encode: keyframes sorted by time');
  assert(near(segs[3], 1.0) && near(segs[4], 1.0), 'encode: sorted second kf');
}

// ── countSegmentsAndPoints ────────────────────────────────────────

{
  // Empty / single point
  assert(JSON.stringify(countSegmentsAndPoints([])) === '{"segments":0,"points":0}',
    'count: empty → 0/0');
  // Single time+value pair = 1 point, 0 segments (no segments emitted yet).
  assert(JSON.stringify(countSegmentsAndPoints([0, 0])) === '{"segments":0,"points":1}',
    'count: only first point → 0 segments / 1 point');
}

{
  // Linear: 1 segment, 2 points (start + 1)
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0, easing: 'linear' },
    { time: 1000, value: 1, easing: 'linear' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 1, 'count: 1 linear segment');
  assert(info.points === 2,   'count: 2 points (start + linear endpoint)');
}

{
  // Bezier: 1 segment, 4 points (start + 3 bezier control/end)
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0, easing: 'linear' },
    { time: 1000, value: 1, easing: 'bezier' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 1, 'count: 1 bezier segment');
  assert(info.points === 4,   'count: 4 points (start + 3 bezier)');
}

{
  // Mixed: 3 keyframes (linear, bezier) → 2 segments, 5 points
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0, easing: 'linear' },
    { time: 500,  value: 1, easing: 'linear' },
    { time: 1000, value: 0, easing: 'bezier' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 2, 'count: 2 segments (linear + bezier)');
  assert(info.points === 5, 'count: 5 points (1 + 1 + 3)');
}

{
  // 3 stepped keyframes → 2 segments, 3 points
  const segs = encodeKeyframesToSegments([
    { time: 0,   value: 0, easing: 'linear' },
    { time: 500, value: 1, easing: 'stepped' },
    { time: 1000, value: 0, easing: 'stepped' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 2, 'count: 2 stepped segments');
  assert(info.points === 3, 'count: 3 points');
}

console.log(`motion3json: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
