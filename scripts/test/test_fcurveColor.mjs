// @ts-check
/**
 * Test the `getcolorFcurveRainbow` Blender port (Slice 5.C+).
 *
 * Asserts the same numeric outputs Blender's `getcolor_fcurve_rainbow`
 * produces for a fixed `(cur, tot)` table. Numbers were derived by hand
 * from the algorithm at `anim_ipo_utils.cc:311-346`.
 */

import { getcolorFcurveRainbow, hsvToHsl, fcurveColorCss } from '../../src/anim/fcurveColor.js';

let passed = 0;
let failed = 0;

function approx(actual, expected, tol = 1e-6, label = '') {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
}

function eq(actual, expected, label = '') {
  const ok = actual === expected;
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── grouping rule: tot=3 → grouping=3 (odd); tot=4 → grouping=4 (even) ──
{
  // cur=0, tot=3 → grouping=3, h = 0 * 0.3 + (0/3)*0.7*0.3 = 0
  const { h, s, v } = getcolorFcurveRainbow(0, 3);
  approx(h, 0, 1e-6, 'tot=3 cur=0 hue');
  approx(s, 0.6, 1e-6, 'tot=3 cur=0 sat');
  approx(v, 1.0, 1e-6, 'tot=3 cur=0 val');
}
{
  // cur=1, tot=3 → grouping=3, h = (1%3)*0.3 + (1/3)*0.7*0.3 = 0.3 + 0.07 = 0.37
  const { h } = getcolorFcurveRainbow(1, 3);
  approx(h, 0.3 + (1 / 3) * 0.7 * 0.3, 1e-6, 'tot=3 cur=1 hue');
}
{
  // cur=2, tot=3 → grouping=3, h = (2%3)*0.3 + (2/3)*0.7*0.3 = 0.6 + 0.14 = 0.74
  const { h, s } = getcolorFcurveRainbow(2, 3);
  approx(h, 0.6 + (2 / 3) * 0.7 * 0.3, 1e-6, 'tot=3 cur=2 hue');
  // h ≈ 0.74 — in (0.5,0.8) band, so sat=0.5
  approx(s, 0.5, 1e-6, 'tot=3 cur=2 sat (in green-cyan band)');
}
{
  // cur=0, tot=4 → grouping=4 (even), h=0
  const { h } = getcolorFcurveRainbow(0, 4);
  approx(h, 0, 1e-6, 'tot=4 cur=0 hue');
}
{
  // cur=3, tot=4 → grouping=4, h = (3%4)*0.3 + (3/4)*0.7*0.3 = 0.9 + 0.1575 = 1.0575 → wraps to 0.0575
  const raw = 0.9 + (3 / 4) * 0.7 * 0.3;
  const expected = raw > 1 ? raw - Math.floor(raw) : raw;
  const { h } = getcolorFcurveRainbow(3, 4);
  approx(h, expected, 1e-6, 'tot=4 cur=3 hue (wraps)');
}

// ── edge case: tot=0 returns finite gray-ish (no NaN/Infinity) ─────────
{
  const { h, s, v } = getcolorFcurveRainbow(0, 0);
  eq(Number.isFinite(h), true, 'tot=0 hue finite');
  eq(Number.isFinite(s), true, 'tot=0 sat finite');
  eq(Number.isFinite(v), true, 'tot=0 val finite');
}

// ── hsvToHsl conversion ────────────────────────────────────────────────
{
  // HSV (0, 1, 1) = red — HSL should be (0, 1, 0.5)
  const { hslH, hslS, hslL } = hsvToHsl(0, 1, 1);
  approx(hslH, 0, 1e-6, 'HSV→HSL red hue');
  approx(hslS, 1, 1e-6, 'HSV→HSL red sat');
  approx(hslL, 0.5, 1e-6, 'HSV→HSL red light');
}
{
  // HSV (h, 0, 1) = white-ish — HSL (h, 0, 1)
  const { hslS, hslL } = hsvToHsl(0.5, 0, 1);
  approx(hslS, 0, 1e-6, 'HSV→HSL grayscale sat');
  approx(hslL, 1, 1e-6, 'HSV→HSL grayscale light');
}
{
  // HSV (h, 1, 0) = black — HSL (h, 0, 0)
  const { hslS, hslL } = hsvToHsl(0.5, 1, 0);
  approx(hslS, 0, 1e-6, 'HSV→HSL black sat (guard)');
  approx(hslL, 0, 1e-6, 'HSV→HSL black light');
}

// ── CSS output ────────────────────────────────────────────────────────
{
  const css = fcurveColorCss(0, 3, 0.5);
  eq(typeof css, 'string', 'fcurveColorCss returns string');
  eq(css.startsWith('hsla('), true, 'fcurveColorCss uses hsla syntax');
  eq(css.includes('/ 0.500'), true, 'fcurveColorCss includes alpha');
}

// ── stable across calls ───────────────────────────────────────────────
{
  const a = getcolorFcurveRainbow(5, 12);
  const b = getcolorFcurveRainbow(5, 12);
  approx(a.h, b.h, 0, 'getcolor pure function (h)');
  approx(a.s, b.s, 0, 'getcolor pure function (s)');
  approx(a.v, b.v, 0, 'getcolor pure function (v)');
}

console.log(`\n${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);
