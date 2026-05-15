// Slice 2.C — tests for src/anim/fcurveEval.js
//
// Validates the BezTriple segment evaluator + 30 easing functions
// against:
//   1. Cubic-bezier oracle values computed from explicit (P0, P1, P2, P3)
//      control points using Blender's solve_cubic-shaped formula.
//   2. Robert Penner's easing equations as they appear in Blender's
//      easing.cc — exercised at known sample points where the algebra
//      collapses to a clean expression.
//   3. Default-easeMode behavior — each named interpolation type has a
//      Blender-curated `auto` mode that the evaluator must apply when
//      `easeMode` is missing or === 'auto'.
//   4. correctBezpart's overshoot clamp (handle that exceeds the
//      segment-time span gets pulled back per Blender's algorithm).
//
// Run: node scripts/test/test_fcurveEval.mjs

import {
  evaluateBezTripleSegment,
  evaluateBezTripleParam,
} from '../../src/anim/fcurveEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function near(actual, expected, eps = 1e-4, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

// ── constant interpolation ────────────────────────────────────────────────
{
  const prev = { time: 0, value: 5, interpolation: 'constant',
    handleLeft: { time: 0, value: 5 }, handleRight: { time: 0, value: 5 } };
  const next = { time: 100, value: 10, interpolation: 'linear',
    handleLeft: { time: 100, value: 10 }, handleRight: { time: 100, value: 10 } };
  near(evaluateBezTripleSegment(prev, next, 50), 5, 1e-9, 'constant: holds prev value mid-segment');
  near(evaluateBezTripleSegment(prev, next, 0), 5, 1e-9, 'constant: at left edge = prev');
  near(evaluateBezTripleSegment(prev, next, 100), 5, 1e-9, 'constant: at right edge = prev (next held by next-segment)');
}

// ── linear interpolation ──────────────────────────────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'linear',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 0, value: 0 } };
  const next = { time: 100, value: 10, interpolation: 'linear',
    handleLeft: { time: 100, value: 10 }, handleRight: { time: 100, value: 10 } };
  near(evaluateBezTripleSegment(prev, next, 25), 2.5, 1e-9, 'linear quarter');
  near(evaluateBezTripleSegment(prev, next, 50), 5, 1e-9, 'linear midpoint');
  near(evaluateBezTripleSegment(prev, next, 75), 7.5, 1e-9, 'linear three-quarter');
}

// ── bezier with vector handles (degenerates to linear) ────────────────────
{
  // Vector handles that lie on the line from prev to next produce a straight curve.
  // Blender's findZero + bezierY returns linear when control points are colinear.
  const prev = { time: 0, value: 0, interpolation: 'bezier',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 1 / 3, value: 1 / 3 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 2 / 3, value: 2 / 3 }, handleRight: { time: 1, value: 1 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), 0.5, 1e-3, 'bezier with colinear handles → linear midpoint');
  near(evaluateBezTripleSegment(prev, next, 0.25), 0.25, 1e-3, 'bezier colinear quarter');
}

// ── bezier with auto handles (S-curve through endpoints) ──────────────────
{
  // Default auto handles: handleRight at (prev.time + 1/3 * span, prev.value)
  // and handleLeft at (next.time - 1/3 * span, next.value).
  // Symmetric ease-both: at t=0.5 the value is 0.5 by symmetry.
  const prev = { time: 0, value: 0, interpolation: 'bezier',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 1 / 3, value: 0 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 2 / 3, value: 1 }, handleRight: { time: 1, value: 1 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), 0.5, 1e-3, 'bezier auto-handles symmetric: midpoint = 0.5');
  near(evaluateBezTripleSegment(prev, next, 0), 0, 1e-9, 'bezier at t=0 = prev.value');
  near(evaluateBezTripleSegment(prev, next, 1), 1, 1e-9, 'bezier at t=1 = next.value');
}

// ── bezier with all-equal y values (Blender shortcut) ─────────────────────
{
  // When prev.value === next.value === handles' values, Blender returns prev.value
  // immediately (fcurve.cc:2110 optimization).
  const prev = { time: 0, value: 7, interpolation: 'bezier',
    handleLeft: { time: 0, value: 7 }, handleRight: { time: 1 / 3, value: 7 } };
  const next = { time: 1, value: 7, interpolation: 'linear',
    handleLeft: { time: 2 / 3, value: 7 }, handleRight: { time: 1, value: 7 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), 7, 1e-9, 'bezier all-equal y shortcut');
}

// ── correctBezpart: handle overshoot clamp ────────────────────────────────
{
  // handleRight at time=2 in a [0,1] segment — should get clamped.
  // Without clamp, the time-axis bezier would loop. With clamp, the
  // result still produces a sane y-value at any time in [0,1].
  const prev = { time: 0, value: 0, interpolation: 'bezier',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 2, value: 5 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: -1, value: -3 }, handleRight: { time: 1, value: 1 } };
  // Just confirm we don't crash + return a sane finite value.
  const v = evaluateBezTripleSegment(prev, next, 0.5);
  assert(Number.isFinite(v), 'overshoot clamp: returns finite value');
}

// ── named easings: sine (default = ease_in) ───────────────────────────────
{
  // sine_ease_in(t, 0, 1, 1) = -cos(t * π/2) + 1
  const prev = { time: 0, value: 0, interpolation: 'sine',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 0, value: 0 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 1, value: 1 }, handleRight: { time: 1, value: 1 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), 1 - Math.cos(Math.PI / 4), 1e-6,
    'sine default (in) at 0.5 = 1 - cos(π/4)');
  near(evaluateBezTripleSegment(prev, next, 0), 0, 1e-9, 'sine at t=0 = 0');
  near(evaluateBezTripleSegment(prev, next, 1), 1, 1e-6, 'sine at t=1 = 1');
}

// ── named easings: sine ease_out via easeMode override ────────────────────
{
  // sine_ease_out(t, 0, 1, 1) = sin(t * π/2)
  const prev = { time: 0, value: 0, interpolation: 'sine', easeMode: 'out',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 0, value: 0 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 1, value: 1 }, handleRight: { time: 1, value: 1 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), Math.sin(Math.PI / 4), 1e-6,
    'sine ease_out at 0.5 = sin(π/4)');
}

// ── named easings: cubic in/out/inout ─────────────────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'cubic',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 0, value: 0 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 1, value: 1 }, handleRight: { time: 1, value: 1 } };
  // cubic ease_in (default): t^3
  near(evaluateBezTripleSegment(prev, next, 0.5), 0.125, 1e-9, 'cubic ease_in at 0.5 = 0.125');
  near(evaluateBezTripleSegment({ ...prev, easeMode: 'out' }, next, 0.5), 1 - 0.125, 1e-9,
    'cubic ease_out at 0.5 = 1 - (1-t)^3 = 0.875');
  near(evaluateBezTripleSegment({ ...prev, easeMode: 'inout' }, next, 0.5), 0.5, 1e-9,
    'cubic ease_inout at 0.5 = 0.5 (symmetric)');
}

// ── named easings: quad in/out/inout ──────────────────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'quad',
    handleLeft: { time: 0, value: 0 }, handleRight: { time: 0, value: 0 } };
  const next = { time: 1, value: 1, interpolation: 'linear',
    handleLeft: { time: 1, value: 1 }, handleRight: { time: 1, value: 1 } };
  near(evaluateBezTripleSegment(prev, next, 0.5), 0.25, 1e-9, 'quad ease_in at 0.5 = 0.25');
  near(evaluateBezTripleSegment({ ...prev, easeMode: 'out' }, next, 0.5), 0.75, 1e-9,
    'quad ease_out at 0.5 = 0.75');
}

// ── named easings: circ ───────────────────────────────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'circ' };
  const next = { time: 1, value: 1, interpolation: 'linear' };
  // circ ease_in: 1 - sqrt(1 - t^2)
  near(evaluateBezTripleSegment(prev, next, 0.5), 1 - Math.sqrt(1 - 0.25), 1e-6,
    'circ ease_in at 0.5');
}

// ── named easings: bounce_out (default for bounce) ────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'bounce' };
  const next = { time: 1, value: 1, interpolation: 'linear' };
  // bounce_ease_out at t=0.5: 0.5 < (2/2.75) ≈ 0.727, so:
  // t -= 1.5/2.75; return 7.5625 * t^2 + 0.75
  // t = 0.5 - 1.5/2.75 = 0.5 - 0.5454545... = -0.0454545...
  // = 7.5625 * 0.002066 + 0.75 = 0.01563 + 0.75 = 0.76563
  near(evaluateBezTripleSegment(prev, next, 0.5),
    7.5625 * Math.pow(0.5 - 1.5 / 2.75, 2) + 0.75, 1e-6,
    'bounce ease_out at 0.5 (Blender formula)');
  // Boundary
  near(evaluateBezTripleSegment(prev, next, 0), 0, 1e-9, 'bounce at t=0 = 0');
  near(evaluateBezTripleSegment(prev, next, 1), 1, 1e-6, 'bounce at t=1 = 1');
}

// ── named easings: back ease_in (default = ease_out) ──────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'back' };
  const next = { time: 1, value: 1, interpolation: 'linear' };
  // back ease_out (default) with overshoot=1.70158:
  //   t = t-1; return (t^2 * ((s+1)*t + s)) + 1
  // t=0.5 → t-1 = -0.5; (-0.5)^2 = 0.25; (s+1)*(-0.5) + s = -2.70158*0.5 + 1.70158 = 0.35079
  //   → 0.25 * 0.35079 + 1 = 0.0877 + 1 = 1.0877
  const s = 1.70158;
  const t = 0.5 - 1;
  const expected = (t * t * ((s + 1) * t + s)) + 1;
  near(evaluateBezTripleSegment(prev, next, 0.5), expected, 1e-6, 'back ease_out at 0.5 (overshoot=1.70158)');
}

// ── named easings: elastic at boundary ────────────────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'elastic' };
  const next = { time: 1, value: 1, interpolation: 'linear' };
  near(evaluateBezTripleSegment(prev, next, 0), 0, 1e-9, 'elastic at t=0 = 0');
  near(evaluateBezTripleSegment(prev, next, 1), 1, 1e-6, 'elastic at t=1 = 1');
  // Mid-segment value should be a finite number (we can't easily hand-check elastic algebra).
  assert(Number.isFinite(evaluateBezTripleSegment(prev, next, 0.5)), 'elastic at 0.5 finite');
}

// ── unknown interpolation enum degrades to linear ─────────────────────────
{
  const prev = { time: 0, value: 0, interpolation: 'banana' };
  const next = { time: 1, value: 1, interpolation: 'linear' };
  near(evaluateBezTripleSegment(prev, next, 0.5), 0.5, 1e-9,
    'unknown interpolation → linear fallback');
}

// ── zero-duration segment holds prev value ────────────────────────────────
{
  const prev = { time: 100, value: 5, interpolation: 'cubic' };
  const next = { time: 100, value: 10, interpolation: 'linear' };
  near(evaluateBezTripleSegment(prev, next, 100), 5, 1e-9, 'zero-duration: hold prev');
}

// ── evaluateBezTripleParam: returns t in [0,1] for use as lerp factor ─────
{
  const prev = { time: 0, value: 0, interpolation: 'linear' };
  const next = { time: 100, value: 999, interpolation: 'linear' };
  near(evaluateBezTripleParam(prev, next, 25), 0.25, 1e-9, 'param: linear quarter → 0.25');
  near(evaluateBezTripleParam(prev, next, 50), 0.5, 1e-9, 'param: linear midpoint → 0.5');
}
{
  const prev = { time: 0, value: 0, interpolation: 'cubic' };
  const next = { time: 1, value: 999, interpolation: 'linear' };
  near(evaluateBezTripleParam(prev, next, 0.5), 0.125, 1e-9,
    'param: cubic ease_in at 0.5 → t=0.125');
}

console.log(`fcurveEval: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
