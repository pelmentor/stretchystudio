// v3 Phase 0F.33 - tests for src/io/live2d/motion3json.js
//
// encodeKeyframesToSegments + countSegmentsAndPoints are the core
// motion3 segment encoder. The flat segment array format is finicky:
//   [t0, v0, type1, ...payload1, type2, ...payload2, ...]
// where bezier (type=1) uses 6 floats, others use 2. countSegments
// is what feeds Meta.TotalSegmentCount / TotalPointCount, which
// Cubism Viewer validates strictly.
//
// Phase 2.A (v39): the segment-type discriminator now lives on the
// SEGMENT-START keyform's `interpolation` field (was `easing` on the
// segment-END pre-v39). This matches Blender's BezTriple convention
// where `bezt.ipo` of keyform i controls the curve from i to i+1.
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
    [{ time: 1000, value: 0.5, interpolation: 'linear' }], 8,
  );
  assert(segs.length === 2, 'encode: single keyframe = 2 floats');
  assert(near(segs[0], 1.0), 'encode: time in seconds (1000ms → 1.0)');
  assert(near(segs[1], 0.5), 'encode: value');
}

{
  // Two linear keyforms (segment from kf0 to kf1, controlled by kf0.interpolation)
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   interpolation: 'linear' },
    { time: 1000, value: 0.5, interpolation: 'linear' },
  ], 8);
  // Expected: [0, 0, 0(linear), 1.0, 0.5]
  assert(segs.length === 5, 'encode: 2 linear kfs = 5 floats');
  assert(segs[0] === 0 && segs[1] === 0, 'encode: first time/value');
  assert(segs[2] === 0, 'encode: linear segment type = 0');
  assert(near(segs[3], 1.0), 'encode: second time');
  assert(near(segs[4], 0.5), 'encode: second value');
}

{
  // Bezier segment uses 6 control floats. Discriminator on START keyform (kf0).
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   interpolation: 'bezier' },
    { time: 1000, value: 1.0, interpolation: 'linear' },
  ], 8);
  // [0, 0, 1(bezier), cx1, cy1, cx2, cy2, time, value] = 9 floats
  assert(segs.length === 9, 'encode: 1 bezier segment = 9 floats');
  assert(segs[2] === 1, 'encode: bezier type = 1');
  // Slice 2.A: control points use 1/3, 2/3 placeholder until Slice 2.G derives from handles.
  assert(near(segs[3], 1 / 3), 'encode: bezier cx1');
  assert(near(segs[4], 0),     'encode: bezier cy1');
  assert(near(segs[5], 2 / 3), 'encode: bezier cx2');
  assert(near(segs[6], 1.0),   'encode: bezier cy2');
  assert(near(segs[7], 1.0),   'encode: end time');
  assert(near(segs[8], 1.0),   'encode: end value');
}

{
  // Constant segment (was 'stepped' pre-v39). Discriminator on START keyform.
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0,   interpolation: 'constant' },
    { time: 500,  value: 1,   interpolation: 'linear' },
  ], 8);
  assert(segs[2] === 2, 'encode: constant interpolation → segment type = 2');
}

{
  // Slice 2.G: named easings BAKE to a sequence of linear sub-segments
  // (Cubism's segment encoding has no sine/quad/etc., so we sample the
  // BezTriple eval at uniform steps and emit each sample as type-0). The
  // segment-type discriminator at index [2] therefore becomes 0 (linear)
  // for the first sub-segment, NOT 1 (bezier).
  for (const interp of ['sine', 'quad', 'cubic', 'expo', 'bounce']) {
    const segs = encodeKeyframesToSegments([
      { time: 0, value: 0, interpolation: interp },
      { time: 500, value: 1, interpolation: 'linear' },
    ], 8);
    if (segs[2] !== 0) {
      failed++;
      console.error(`FAIL: ${interp} bake should emit linear sub-segments (type 0), got ${segs[2]}`);
      break;
    }
    // Bake fidelity: BAKE_STEPS_PER_SEGMENT = 16 sub-segments → 1 (initial
    // point) + 16 sub-segments × 3 floats (type, t, v) = 49 floats total.
    if (segs.length !== 1 + 1 + 16 * 3) {
      failed++;
      console.error(
        `FAIL: ${interp} bake should produce 50 floats (2 init + 48 segs), got ${segs.length}`,
      );
      break;
    }
  }
  passed++;
}

{
  // Unknown / missing interpolation → linear (default)
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0 }, // no interpolation
    { time: 500, value: 1, interpolation: 'linear' },
  ], 8);
  assert(segs[2] === 0, 'encode: missing interpolation → linear (0)');
}

{
  // Out-of-order keyforms get sorted
  const segs = encodeKeyframesToSegments([
    { time: 1000, value: 1, interpolation: 'linear' },
    { time: 0,    value: 0, interpolation: 'linear' },
  ], 8);
  // Should start with [0, 0, ...] (the time=0 kf)
  assert(segs[0] === 0 && segs[1] === 0, 'encode: keyforms sorted by time');
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
    { time: 0,    value: 0, interpolation: 'linear' },
    { time: 1000, value: 1, interpolation: 'linear' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 1, 'count: 1 linear segment');
  assert(info.points === 2,   'count: 2 points (start + linear endpoint)');
}

{
  // Bezier: 1 segment, 4 points (start + 3 bezier control/end)
  const segs = encodeKeyframesToSegments([
    { time: 0, value: 0, interpolation: 'bezier' },
    { time: 1000, value: 1, interpolation: 'linear' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 1, 'count: 1 bezier segment');
  assert(info.points === 4,   'count: 4 points (start + 3 bezier)');
}

{
  // Mixed: 3 keyforms (linear segment, bezier segment) → 2 segments, 5 points.
  // Segment-from-kf0 is linear (kf0.interpolation), segment-from-kf1 is bezier.
  const segs = encodeKeyframesToSegments([
    { time: 0,    value: 0, interpolation: 'linear' },
    { time: 500,  value: 1, interpolation: 'bezier' },
    { time: 1000, value: 0, interpolation: 'linear' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 2, 'count: 2 segments (linear + bezier)');
  assert(info.points === 5, 'count: 5 points (1 + 1 + 3)');
}

{
  // 3 constant keyforms → 2 segments, 3 points
  const segs = encodeKeyframesToSegments([
    { time: 0,   value: 0, interpolation: 'constant' },
    { time: 500, value: 1, interpolation: 'constant' },
    { time: 1000, value: 0, interpolation: 'linear' },
  ], 8);
  const info = countSegmentsAndPoints(segs);
  assert(info.segments === 2, 'count: 2 constant segments');
  assert(info.points === 3, 'count: 3 points');
}

console.log(`motion3json: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
