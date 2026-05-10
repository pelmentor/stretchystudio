// Toolset Plan Phase 2.D/F — Modal R / S snap math.
//
// Validates `snapAngleToIncrement` (radian → multiple-of-deg radian)
// and `snapScaleToIncrement` (scale → multiple-of-step where step =
// degrees/100 per the SNAP_DEFAULT jsdoc).
//
// Run: node scripts/test/test_snap_rotation_increment.mjs

import {
  snapAngleToIncrement,
  snapScaleToIncrement,
  applyPrecisionToDelta,
  applyPrecisionToAngle,
  applyPrecisionToScale,
} from '../../src/lib/snap/snapMath.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

const D2R = Math.PI / 180;

// ── 1: rotation snap at default 15° ──────────────────────────────────
{
  assert(close(snapAngleToIncrement(0, 15), 0), '0rad → 0rad');
  assert(close(snapAngleToIncrement(15 * D2R, 15), 15 * D2R), '15° identity');
  assert(close(snapAngleToIncrement(20 * D2R, 15), 15 * D2R), '20° → 15°');
  assert(close(snapAngleToIncrement(23 * D2R, 15), 30 * D2R), '23° → 30° (rounds up at 22.5+)');
  assert(close(snapAngleToIncrement(7 * D2R, 15),  0),         '7° → 0°');
  assert(close(snapAngleToIncrement(-23 * D2R, 15), -30 * D2R), '-23° → -30°');
  assert(close(snapAngleToIncrement(360 * D2R, 15), 360 * D2R), '360° identity');
}

// ── 2: rotation snap at custom increments ────────────────────────────
{
  assert(close(snapAngleToIncrement(50 * D2R, 45), 45 * D2R), '50° → 45° at inc 45');
  assert(close(snapAngleToIncrement(70 * D2R, 45), 90 * D2R), '70° → 90° at inc 45');
  assert(close(snapAngleToIncrement(50 * D2R, 5),  50 * D2R), '50° → 50° at inc 5');
  assert(close(snapAngleToIncrement(53 * D2R, 5),  55 * D2R), '53° → 55° at inc 5');
  assert(close(snapAngleToIncrement(91 * D2R, 90), 90 * D2R), '91° → 90° at inc 90');
}

// ── 3: rotation degrade on bad input ─────────────────────────────────
{
  assert(snapAngleToIncrement(NaN, 15) !== snapAngleToIncrement(NaN, 15)
         || Number.isNaN(snapAngleToIncrement(NaN, 15)),
         'NaN input passthrough');
  assert(close(snapAngleToIncrement(0.5, 0),  0.5),  'inc 0  → identity');
  assert(close(snapAngleToIncrement(0.5, -1), 0.5),  'inc <0 → identity');
}

// ── 4: scale snap (incDeg=10 → step 0.1, legacy default) ─────────────
{
  assert(close(snapScaleToIncrement(1, 10),    1),    '1 → 1');
  assert(close(snapScaleToIncrement(1.1, 10),  1.1),  '1.1 → 1.1');
  assert(close(snapScaleToIncrement(1.05, 10), 1.1),  '1.05 → 1.1 (rounds up)');
  assert(close(snapScaleToIncrement(1.04, 10), 1.0),  '1.04 → 1.0');
  assert(close(snapScaleToIncrement(0.5, 10),  0.5),  '0.5 → 0.5');
  // Floor: scale snaps to >= step (no zero-scale or negative).
  assert(close(snapScaleToIncrement(0.05, 10), 0.1),  '0.05 → 0.1 (floor at step)');
  assert(close(snapScaleToIncrement(-0.5, 10), 0.1),  '-0.5 → 0.1 (floor at step)');
}

// ── 5: scale snap at custom increment 15 (step 0.15) ─────────────────
{
  assert(close(snapScaleToIncrement(1.5, 15),  1.5),  '1.5 → 1.5 at step 0.15');
  assert(close(snapScaleToIncrement(1.0, 15),  1.05), '1.0 → 1.05 (nearest 0.15 mult is 1.05)');
  // 0.15 * 7 = 1.05, * 8 = 1.20. Midpoint = 1.125.
  // 1.10 < midpoint → 1.05.
  assert(close(snapScaleToIncrement(1.10, 15), 1.05), '1.10 → 1.05 at step 0.15');
  // 1.13 > midpoint (0.005 above) → 1.20.
  assert(close(snapScaleToIncrement(1.13, 15), 1.20), '1.13 → 1.20 at step 0.15 (rounds up past 1.125)');
}

// ── 6: scale degrade on bad input ────────────────────────────────────
{
  assert(close(snapScaleToIncrement(1, 0),  1),  'inc 0  → identity');
  assert(close(snapScaleToIncrement(1, -5), 1),  'inc <0 → identity');
  assert(Number.isNaN(snapScaleToIncrement(NaN, 10)), 'NaN passthrough');
}

// ── 7: applyPrecisionToDelta (Blender's MOD_PRECISION for translate) ─
{
  const r = applyPrecisionToDelta({ x: 100, y: 200 }, 0.1);
  assert(r.x === 10 && r.y === 20, 'delta * 0.1 → (10, 20)');
  const r2 = applyPrecisionToDelta({ x: 17, y: -3 }, 0.5);
  assert(close(r2.x, 8.5) && close(r2.y, -1.5), 'delta * 0.5 → (8.5, -1.5)');
  // Bad factor → identity
  const r3 = applyPrecisionToDelta({ x: 5, y: 7 }, 0);
  assert(r3.x === 5 && r3.y === 7, 'factor 0 → identity');
  const r4 = applyPrecisionToDelta(null, 0.1);
  assert(r4.x === 0 && r4.y === 0, 'null delta → origin');
  // NaN x coerces to 0
  const r5 = applyPrecisionToDelta({ x: NaN, y: 100 }, 0.1);
  assert(r5.x === 0 && r5.y === 10, 'NaN x → 0; y unaffected');
}

// ── 8: applyPrecisionToAngle ─────────────────────────────────────────
{
  assert(close(applyPrecisionToAngle(D2R * 30, 0.1), D2R * 3),
    '30° * 0.1 → 3°');
  assert(close(applyPrecisionToAngle(D2R * 90, 0.5), D2R * 45),
    '90° * 0.5 → 45°');
  assert(close(applyPrecisionToAngle(0, 0.1), 0), '0 → 0');
  assert(applyPrecisionToAngle(D2R * 30, 0) === D2R * 30,
    'factor 0 → identity');
  assert(Number.isNaN(applyPrecisionToAngle(NaN, 0.1)), 'NaN passthrough');
}

// ── 9: applyPrecisionToScale (relative-to-1 factor) ──────────────────
{
  // s=1.5, factor=0.1 → 1 + (1.5-1)*0.1 = 1.05
  assert(close(applyPrecisionToScale(1.5, 0.1), 1.05),
    '1.5 with 0.1 precision → 1.05 (relative-to-1)');
  // s=0.5, factor=0.1 → 1 + (-0.5)*0.1 = 0.95
  assert(close(applyPrecisionToScale(0.5, 0.1), 0.95),
    '0.5 with 0.1 precision → 0.95');
  // s=1, factor=0.1 → 1 (no change at unity)
  assert(close(applyPrecisionToScale(1, 0.1), 1),
    'unity scale unchanged by precision');
  // factor=0 → identity (bad input)
  assert(applyPrecisionToScale(1.5, 0) === 1.5, 'factor 0 → identity');
  assert(Number.isNaN(applyPrecisionToScale(NaN, 0.1)), 'NaN passthrough');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
