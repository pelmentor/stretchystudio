// Animation Phase 5 Slice 5.T — tests for
// src/v3/editors/fcurve/fcurveTimeFormat.js (time display conversion).
//
// Coverage:
//   - getEffectiveFps: action override beats global; rejects 0/negative/NaN
//   - formatXTickLabel: seconds mode, frames mode, fps-null fallback
//   - formatTimeFieldLabel: seconds/frames + side prefix
//   - formatTimeFieldValue: seconds mode, frames mode, fps-null fallback
//   - parseTimeFieldValue: seconds mode, frames mode, fps-null fallback
//   - Display↔parse round-trip at integer frame boundaries
//   - Display↔parse round-trip with seconds precision
//
// Run: node scripts/test/test_fcurveTimeFormat.mjs

import {
  getEffectiveFps,
  formatXTickLabel,
  formatTimeFieldLabel,
  formatTimeFieldValue,
  parseTimeFieldValue,
} from '../../src/v3/editors/fcurve/fcurveTimeFormat.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function approx(a, b, name, eps = 1e-9) {
  if (Math.abs(a - b) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${a}\n   expected: ${b}`);
}

// ── getEffectiveFps ──────────────────────────────────────────────────
{
  eq(getEffectiveFps(null, 24), 24, 'fps: null action → global');
  eq(getEffectiveFps(undefined, 30), 30, 'fps: undef action → global');
  eq(getEffectiveFps({}, 24), 24, 'fps: action without fps → global');
  eq(getEffectiveFps({ fps: 60 }, 24), 60, 'fps: action.fps overrides global');
  eq(getEffectiveFps({ fps: 24 }, 30), 24, 'fps: action.fps wins even if equal-magnitude global');
  eq(getEffectiveFps({ fps: 0 }, 24), 24, 'fps: action.fps=0 rejected, fall back to global');
  eq(getEffectiveFps({ fps: -1 }, 24), 24, 'fps: action.fps negative rejected');
  eq(getEffectiveFps({ fps: NaN }, 24), 24, 'fps: action.fps NaN rejected');
  eq(getEffectiveFps(null, 0), null, 'fps: global=0 rejected → null');
  eq(getEffectiveFps(null, null), null, 'fps: both null → null');
  eq(getEffectiveFps(null, undefined), null, 'fps: both missing → null');
  eq(getEffectiveFps(null, NaN), null, 'fps: global NaN → null');
}

// ── formatXTickLabel ────────────────────────────────────────────────
{
  eq(formatXTickLabel(500, { showSeconds: true, fps: 24 }), '0.5s', 'tick: 500ms seconds → "0.5s"');
  eq(formatXTickLabel(1000, { showSeconds: true, fps: 24 }), '1.0s', 'tick: 1000ms seconds → "1.0s"');
  eq(formatXTickLabel(0, { showSeconds: true, fps: 24 }), '0.0s', 'tick: 0ms seconds → "0.0s"');
  eq(formatXTickLabel(2333, { showSeconds: true, fps: 24 }), '2.3s', 'tick: 2333ms seconds → "2.3s" (one decimal)');

  eq(formatXTickLabel(500, { showSeconds: false, fps: 24 }), '12', 'tick: 500ms @ 24fps frames → 12');
  eq(formatXTickLabel(1000, { showSeconds: false, fps: 24 }), '24', 'tick: 1000ms @ 24fps frames → 24');
  eq(formatXTickLabel(1000, { showSeconds: false, fps: 30 }), '30', 'tick: 1000ms @ 30fps frames → 30');
  eq(formatXTickLabel(0, { showSeconds: false, fps: 24 }), '0', 'tick: 0ms frames → 0');

  // Degenerate fallback path (fps unresolvable in frames mode)
  eq(formatXTickLabel(500, { showSeconds: false, fps: null }), '500', 'tick: fps=null frames → raw ms');
  eq(formatXTickLabel(500.7, { showSeconds: false, fps: null }), '501', 'tick: rounds raw ms fallback');
  eq(formatXTickLabel(500, { showSeconds: false, fps: 0 }), '500', 'tick: fps=0 frames → raw ms');

  eq(formatXTickLabel(NaN, { showSeconds: true, fps: 24 }), '', 'tick: NaN → empty');
  eq(formatXTickLabel(Infinity, { showSeconds: false, fps: 24 }), '', 'tick: Infinity → empty');
}

// ── formatTimeFieldLabel ────────────────────────────────────────────
{
  eq(formatTimeFieldLabel({ showSeconds: true }), 'Time (s)', 'label: seconds, no side');
  eq(formatTimeFieldLabel({ showSeconds: false }), 'Frame', 'label: frames, no side');
  eq(formatTimeFieldLabel({ showSeconds: true, side: 'left' }), 'L Time (s)', 'label: seconds, left');
  eq(formatTimeFieldLabel({ showSeconds: false, side: 'left' }), 'L Frame', 'label: frames, left');
  eq(formatTimeFieldLabel({ showSeconds: true, side: 'right' }), 'R Time (s)', 'label: seconds, right');
  eq(formatTimeFieldLabel({ showSeconds: false, side: 'right' }), 'R Frame', 'label: frames, right');
}

// ── formatTimeFieldValue ────────────────────────────────────────────
{
  approx(formatTimeFieldValue(500, { showSeconds: true, fps: 24 }), 0.5, 'fieldVal: 500ms seconds → 0.5');
  approx(formatTimeFieldValue(0, { showSeconds: true, fps: 24 }), 0, 'fieldVal: 0ms seconds → 0');
  approx(formatTimeFieldValue(2500, { showSeconds: true, fps: 24 }), 2.5, 'fieldVal: 2500ms seconds → 2.5');

  eq(formatTimeFieldValue(500, { showSeconds: false, fps: 24 }), 12, 'fieldVal: 500ms @ 24fps → 12');
  eq(formatTimeFieldValue(1000, { showSeconds: false, fps: 30 }), 30, 'fieldVal: 1000ms @ 30fps → 30');
  eq(formatTimeFieldValue(0, { showSeconds: false, fps: 24 }), 0, 'fieldVal: 0ms frames → 0');

  // Degenerate fallback path
  eq(formatTimeFieldValue(500, { showSeconds: false, fps: null }), 500, 'fieldVal: fps=null frames → raw ms');
  eq(formatTimeFieldValue(500, { showSeconds: false, fps: 0 }), 500, 'fieldVal: fps=0 frames → raw ms');

  eq(formatTimeFieldValue(NaN, { showSeconds: true, fps: 24 }), 0, 'fieldVal: NaN → 0');
}

// ── parseTimeFieldValue ─────────────────────────────────────────────
{
  approx(parseTimeFieldValue(0.5, { showSeconds: true, fps: 24 }), 500, 'parse: 0.5s → 500ms');
  approx(parseTimeFieldValue(0, { showSeconds: true, fps: 24 }), 0, 'parse: 0s → 0ms');
  approx(parseTimeFieldValue(2.5, { showSeconds: true, fps: 24 }), 2500, 'parse: 2.5s → 2500ms');

  approx(parseTimeFieldValue(12, { showSeconds: false, fps: 24 }), 500, 'parse: 12 @ 24fps → 500ms');
  approx(parseTimeFieldValue(30, { showSeconds: false, fps: 30 }), 1000, 'parse: 30 @ 30fps → 1000ms');
  approx(parseTimeFieldValue(0, { showSeconds: false, fps: 24 }), 0, 'parse: 0 frames → 0ms');
  // Audit-fix MED-A1: fractional frame inputs round to nearest whole
  // frame before conversion (Blender Key Frame field is PROP_INT —
  // SS rounds rather than rejects).
  approx(parseTimeFieldValue(0.5, { showSeconds: false, fps: 24 }), 1000 / 24, 'parse: 0.5 frame @ 24fps rounds to 1 → 1000/24 ms');
  approx(parseTimeFieldValue(0.4, { showSeconds: false, fps: 24 }), 0, 'parse: 0.4 frame @ 24fps rounds to 0 → 0ms');
  approx(parseTimeFieldValue(12.7, { showSeconds: false, fps: 24 }), (13 / 24) * 1000, 'parse: 12.7 @ 24fps rounds to 13');
  approx(parseTimeFieldValue(-0.6, { showSeconds: false, fps: 24 }), -1000 / 24, 'parse: -0.6 @ 24fps rounds to -1');

  // Degenerate fallback path
  eq(parseTimeFieldValue(500, { showSeconds: false, fps: null }), 500, 'parse: fps=null frames → input verbatim');
  eq(parseTimeFieldValue(500, { showSeconds: false, fps: 0 }), 500, 'parse: fps=0 frames → input verbatim');

  eq(parseTimeFieldValue(NaN, { showSeconds: true, fps: 24 }), 0, 'parse: NaN → 0');
}

// ── Display↔parse round-trip ────────────────────────────────────────
{
  // Frame-aligned ms round-trip cleanly through frames mode
  for (const fps of [24, 30, 60]) {
    for (let frame = 0; frame <= 5; frame++) {
      const ms = (frame / fps) * 1000;
      const display = formatTimeFieldValue(ms, { showSeconds: false, fps });
      const back = parseTimeFieldValue(display, { showSeconds: false, fps });
      approx(back, ms, `frames round-trip: fps=${fps} frame=${frame} (ms=${ms})`);
    }
  }
  // Seconds mode round-trips exactly for any ms
  for (const ms of [0, 100, 500, 1000, 1234, 9999]) {
    const display = formatTimeFieldValue(ms, { showSeconds: true, fps: 24 });
    const back = parseTimeFieldValue(display, { showSeconds: true, fps: 24 });
    approx(back, ms, `seconds round-trip: ${ms}ms`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
