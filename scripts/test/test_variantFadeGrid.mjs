// Unit tests for the N-D variant base-fade product grid helper.
// Run: node scripts/test/test_variantFadeGrid.mjs

import {
  buildVariantProductGridCorners,
  buildEyeCompoundBaseGridCorners,
} from '../../src/io/live2d/rig/variantFadeGrid.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL: ${m}`); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`);

// ── §1 N=1 is structurally the legacy 1-D fade ────────────────────────
{
  const c = buildVariantProductGridCorners(1);
  eq(c.length, 2, '§1 N=1 → 2 corners');
  eq(c[0], { keyIndices: [0], opacity: 1, isOrigin: true }, '§1 origin visible');
  eq(c[1], { keyIndices: [1], opacity: 0, isOrigin: false }, '§1 variant=1 hidden');
}

// ── §2 N=2 product grid: opacity 1 only at (0,0) ─────────────────────
{
  const c = buildVariantProductGridCorners(2);
  eq(c.length, 4, '§2 N=2 → 4 corners');
  // first suffix varies fastest
  eq(c.map(x => x.keyIndices), [[0, 0], [1, 0], [0, 1], [1, 1]], '§2 first-fastest order');
  eq(c.map(x => x.opacity), [1, 0, 0, 0], '§2 opacity 1 only at all-zero corner');
  // multilinear interpolation sanity: ∏(1-pi)
  const interp = (s, a) => {
    // corners: (0,0)=1,(1,0)=0,(0,1)=0,(1,1)=0
    return 1 * (1 - s) * (1 - a);
  };
  ok(Math.abs(interp(0, 1) - 0) < 1e-9, '§2 angry=1 → base 0');
  ok(Math.abs(interp(1, 0) - 0) < 1e-9, '§2 smile=1 → base 0');
  ok(Math.abs(interp(0, 0) - 1) < 1e-9, '§2 rest → base 1');
  ok(Math.abs(interp(0.5, 0.5) - 0.25) < 1e-9, '§2 midpoint product');
}

// ── §3 N=3 → 8 corners, single visible ───────────────────────────────
{
  const c = buildVariantProductGridCorners(3);
  eq(c.length, 8, '§3 N=3 → 8 corners');
  eq(c.filter(x => x.opacity === 1).length, 1, '§3 exactly one visible corner');
  ok(c[0].isOrigin && c[0].opacity === 1, '§3 origin is the visible one');
}

// ── §4 Eye-compound base: closure × variants, closure fastest ────────
{
  const c = buildEyeCompoundBaseGridCorners(1);
  eq(c.length, 4, '§4 N=1 → 2 closure × 2 variant = 4');
  eq(c.map(x => [x.closureKey, x.keyIndices[0]]),
    [[0, 0], [1, 0], [0, 1], [1, 1]], '§4 closure-fastest order matches legacy cornersOrder');
  eq(c.map(x => x.geometry), ['closed', 'open', 'closed', 'open'], '§4 geometry by closure');
  // base eye: αN (variant=0)=1, αV (variant=1)=0
  eq(c.map(x => x.opacity), [1, 1, 0, 0], '§4 αN=1 at variant=0, αV=0 at variant=1');
}
{
  const c = buildEyeCompoundBaseGridCorners(2);
  eq(c.length, 8, '§4 N=2 → 2 closure × 4 variant = 8');
  // opacity 1 only when BOTH variants are 0 (either closure)
  const visible = c.filter(x => x.opacity === 1);
  eq(visible.length, 2, '§4 N=2 two visible corners (closed+open at all-variant-zero)');
  eq(visible.map(x => x.keyIndices), [[0, 0], [0, 0]], '§4 N=2 visible only at variant (0,0)');
}

console.log(`variantFadeGrid: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
