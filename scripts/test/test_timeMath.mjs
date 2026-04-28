// v3 Phase 0F.7 - timeMath tests
// Run: node scripts/test/test_timeMath.mjs

import { clamp, msToFrame, frameToMs } from '../../src/lib/timeMath.js';

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

// ── clamp ───────────────────────────────────────────────────────────

assert(clamp(5, 0, 10) === 5, 'clamp: in range');
assert(clamp(-5, 0, 10) === 0, 'clamp: below min');
assert(clamp(15, 0, 10) === 10, 'clamp: above max');
assert(clamp(0, 0, 10) === 0, 'clamp: at min');
assert(clamp(10, 0, 10) === 10, 'clamp: at max');
assert(clamp(NaN, 0, 10) === 0, 'clamp: NaN → min');
assert(clamp(0.5, 0, 1) === 0.5, 'clamp: fractional');
assert(clamp(-Infinity, 0, 10) === 0, 'clamp: -Infinity → min');
assert(clamp(Infinity, 0, 10) === 10, 'clamp: Infinity → max');

// ── msToFrame ───────────────────────────────────────────────────────

assert(msToFrame(0, 24) === 0, 'msToFrame: 0ms → 0');
assert(msToFrame(1000, 24) === 24, 'msToFrame: 1s @ 24fps → 24');
assert(msToFrame(500, 24) === 12, 'msToFrame: 0.5s @ 24fps → 12');
assert(msToFrame(2000, 30) === 60, 'msToFrame: 2s @ 30fps → 60');
assert(msToFrame(33, 30) === 1, 'msToFrame: rounds to nearest (33ms ~ 1 frame @ 30fps)');
assert(msToFrame(1000, 0) === 1, 'msToFrame: fps=0 floors to 1');
assert(msToFrame(1000, -5) === 1, 'msToFrame: negative fps clamped to 1');

// ── frameToMs ───────────────────────────────────────────────────────

assert(frameToMs(0, 24) === 0, 'frameToMs: 0 → 0ms');
assert(frameToMs(24, 24) === 1000, 'frameToMs: 24 frames @ 24fps → 1000ms');
assert(frameToMs(60, 30) === 2000, 'frameToMs: 60 @ 30fps → 2000ms');
assert(near(frameToMs(1, 24), 1000 / 24), 'frameToMs: 1 frame @ 24fps');
assert(frameToMs(1000, 0) === 1000000, 'frameToMs: fps=0 floors to 1');
assert(frameToMs(1000, -5) === 1000000, 'frameToMs: negative fps clamped to 1');

// ── Round-trip ──────────────────────────────────────────────────────
//
// msToFrame(frameToMs(f, fps), fps) === f for any non-negative integer f.
// (Round-trip the other way isn't exact because of rounding.)

for (const fps of [24, 30, 60, 120]) {
  for (let f = 0; f < 1000; f++) {
    const back = msToFrame(frameToMs(f, fps), fps);
    if (back !== f) {
      failed++;
      console.error(`FAIL: round-trip f=${f} fps=${fps} → ${back}`);
      break;
    }
  }
  passed++;  // one batch per fps if all f's passed
}

console.log(`timeMath: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
