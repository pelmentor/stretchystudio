// @ts-check

/**
 * Per-FCurve display color (Animation Phase 5 Slice 5.C+).
 *
 * Direct port of Blender's `getcolor_fcurve_rainbow` at
 * `reference/blender/source/blender/editors/animation/anim_ipo_utils.cc:311-346`.
 * Used for `FCURVE_COLOR_AUTO_RAINBOW` (the default `color_mode`).
 *
 * SS doesn't ship `color_mode` as an FCurve schema field yet, so every
 * FCurve effectively uses AUTO_RAINBOW. The three other Blender modes
 * (AUTO_RGB, AUTO_YRGB, CUSTOM) are documented omissions for this slice
 * -see [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_5_SLICE_C_PLUS.md]
 * (../../docs/plans/) for the full "what was deferred and why" list.
 *
 * @module anim/fcurveColor
 */

/** Matches `HSV_BANDWIDTH` at `anim_ipo_utils.cc:307`. */
const HSV_BANDWIDTH = 0.3;

/**
 * Hue/sat/value for an FCurve at index `cur` of `tot` total channels.
 * Hue rotation matches Blender's grouping-of-3-or-4 banding logic so
 * sibling-grouped curves cluster around shared base hues (Blender's
 * "majority of triplets/quartets of curves" comment at line 318).
 *
 * @param {number} cur -0-based channel index in the visible-FCurve list
 * @param {number} tot -total visible FCurve count
 * @returns {{h:number, s:number, v:number}} HSV in [0,1] each
 */
export function getcolorFcurveRainbow(cur, tot) {
  if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot <= 0) {
    return { h: 0, s: 0.6, v: 1 };
  }
  // grouping: 3 for odd tot, 4 for even -Blender's `4 - (tot % 2)`.
  const grouping = 4 - (tot % 2);
  let h = HSV_BANDWIDTH * (cur % grouping);
  const fac = (cur / tot) * 0.7;
  h += fac * HSV_BANDWIDTH;
  if (h > 1) h -= Math.floor(h);
  // Saturation drop in the green→cyan band (matches line 339).
  const s = (h > 0.5 && h < 0.8) ? 0.5 : 0.6;
  // Value pinned at 1.0 for visibility (line 342).
  const v = 1.0;
  return { h, s, v };
}

/**
 * Return an `hsl(...)` CSS string with the given alpha. Browser converts
 * HSL to RGB the same way Blender's `hsv_to_rgb_v` would (modulo the
 * S/V vs L mapping difference -see `hsvToHsl` below).
 *
 * @param {number} cur
 * @param {number} tot
 * @param {number} [alpha=1] -0..1
 * @returns {string}
 */
export function fcurveColorCss(cur, tot, alpha = 1) {
  const { h, s, v } = getcolorFcurveRainbow(cur, tot);
  const { hslH, hslS, hslL } = hsvToHsl(h, s, v);
  return `hsla(${(hslH * 360).toFixed(1)} ${(hslS * 100).toFixed(1)}% ${(hslL * 100).toFixed(1)}% / ${alpha.toFixed(3)})`;
}

/**
 * HSV → HSL conversion. CSS `hsl(...)` takes Lightness, but Blender
 * computes in Value (HSV) -they're different axes. This conversion
 * preserves the perceptual hue + relative chroma so the SS Graph Editor
 * colors visually match what Blender's rainbow renders.
 *
 * Formula: standard HSV-to-HSL conversion
 * (`https://en.wikipedia.org/wiki/HSL_and_HSV#HSV_to_HSL`).
 *
 * @param {number} h -hue [0,1]
 * @param {number} s -saturation [0,1] in HSV
 * @param {number} v -value [0,1]
 * @returns {{hslH:number, hslS:number, hslL:number}} all [0,1]
 */
export function hsvToHsl(h, s, v) {
  const l = v * (1 - s / 2);
  const hslS = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
  return { hslH: h, hslS, hslL: l };
}
