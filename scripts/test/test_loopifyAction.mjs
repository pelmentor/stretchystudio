// scripts/test/test_loopifyAction.mjs — substrate test for the
// loop-ify operator. Verifies value + tangent continuity at the
// loop boundary (t=0 vs t=D) per fcurve.
//
// Run: node scripts/test/test_loopifyAction.mjs

import { loopifyAction } from '../../src/anim/loopifyAction.js';
import { buildParamFCurve } from '../../src/anim/animationFCurve.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function makeAction(duration, fcurves) {
  return { id: 'a1', name: 'A', duration, fps: 30, fcurves, audioTracks: [], flag: 0 };
}

// ── §1 endKf missing → inserted at t=D with value=startKf.value ─────
{
  const fc = buildParamFCurve('P', [
    { time: 0,    value: 0,   interpolation: 'bezier' },
    { time: 1000, value: 0.5, interpolation: 'bezier' },
  ]);
  const action = makeAction(2000, [fc]);
  const r = loopifyAction(action);
  ok(r.inserted === 1, '§1.1 one keyform inserted at t=D');
  ok(r.processed === 1, '§1.1 one fcurve processed');
  ok(fc.keyforms.length === 3, '§1.1 fcurve grew from 2 → 3 keyforms');
  const endKf = fc.keyforms[fc.keyforms.length - 1];
  ok(near(endKf.time, 2000), `§1.1 end at t=2000 (got ${endKf.time})`);
  ok(near(endKf.value, 0),   `§1.1 endKf.value = startKf.value = 0 (got ${endKf.value})`);
}

// ── §2 endKf exists at t=D → replaced in place, no insert ────────────
{
  const fc = buildParamFCurve('P', [
    { time: 0,    value: 0,    interpolation: 'bezier' },
    { time: 500,  value: 0.5,  interpolation: 'bezier' },
    { time: 2000, value: 0.95, interpolation: 'bezier' },
  ]);
  const action = makeAction(2000, [fc]);
  const r = loopifyAction(action);
  ok(r.inserted === 0, '§2.1 nothing inserted (end already at t=D)');
  ok(r.processed === 1, '§2.1 fcurve processed');
  ok(fc.keyforms.length === 3, '§2.1 kf count unchanged');
  const endKf = fc.keyforms[fc.keyforms.length - 1];
  ok(near(endKf.value, 0), `§2.1 endKf.value pinned to startKf (0); was 0.95`);
}

// ── §3 slope continuity: endKf.handleLeft slope = startKf.handleRight slope ─
//
// Set up the fcurve manually with an explicit startKf outgoing slope, then
// verify endKf.handleLeft after loopify matches the same slope.
{
  const fc = buildParamFCurve('P', [
    { time: 0,    value: 0, interpolation: 'bezier' },
    { time: 500,  value: 0.3, interpolation: 'bezier' },
    { time: 1500, value: 0.6, interpolation: 'bezier' },
  ]);
  // Force a known outgoing slope for startKf: slope = 1/1000 (1 unit per second)
  fc.keyforms[0].handleRight = { time: 100, value: 0.1 };
  fc.keyforms[0].handleType = { left: 'free', right: 'free' };
  const startSlope = (fc.keyforms[0].handleRight.value - fc.keyforms[0].value)
                   / (fc.keyforms[0].handleRight.time - fc.keyforms[0].time);

  const action = makeAction(2000, [fc]);
  loopifyAction(action);

  const endKf = fc.keyforms[fc.keyforms.length - 1];
  const endSlope = (endKf.value - endKf.handleLeft.value)
                 / (endKf.time - endKf.handleLeft.time);
  ok(near(endSlope, startSlope, 1e-9),
    `§3.1 endKf incoming slope (${endSlope}) matches startKf outgoing slope (${startSlope})`);
}

// ── §4 driver-only / empty / single-kf fcurves skipped silently ──────
{
  const action = makeAction(1000, [
    { id: 'fc1', rnaPath: 'objects["__params__"].values["A"]', arrayIndex: 0, keyforms: [], modifiers: [], extrapolation: 'constant' },
    { id: 'fc2', rnaPath: 'objects["__params__"].values["B"]', arrayIndex: 0, keyforms: [{ time: 0, value: 0 }], modifiers: [], extrapolation: 'constant' },
  ]);
  const r = loopifyAction(action);
  ok(r.processed === 0, '§4.1 no processable fcurves');
  ok(r.skipped === 2, '§4.1 both fcurves skipped (< 2 keyforms)');
}

// ── §5 zero/invalid duration → no-op ─────────────────────────────────
{
  const fc = buildParamFCurve('P', [
    { time: 0, value: 0, interpolation: 'bezier' },
    { time: 1000, value: 1, interpolation: 'bezier' },
  ]);
  const r1 = loopifyAction(makeAction(0, [fc]));
  ok(r1.processed === 0 && r1.inserted === 0, '§5.1 duration=0 → no-op');
  const r2 = loopifyAction(makeAction(NaN, [fc]));
  ok(r2.processed === 0, '§5.2 duration=NaN → no-op');
  const r3 = loopifyAction(null);
  ok(r3.processed === 0, '§5.3 null action → no-op');
}

// ── §6 handle pin survives recalcKeyformHandles ──────────────────────
//
// Audit pin: handleType MUST be 'free' on the pinned side or recalc
// would overwrite the slope match — same trap that bit the 2026-06-09
// genSine fix.
{
  const fc = buildParamFCurve('P', [
    { time: 0, value: 0, interpolation: 'bezier' },
    { time: 1000, value: 0.5, interpolation: 'bezier' },
  ]);
  const action = makeAction(2000, [fc]);
  loopifyAction(action);
  const endKf = fc.keyforms[fc.keyforms.length - 1];
  ok(endKf.handleType?.left === 'free',
    `§6.1 endKf.handleType.left = 'free' (got '${endKf.handleType?.left}')`);
}

console.log(`loopifyAction: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
