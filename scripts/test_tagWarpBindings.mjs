// Tests for src/io/live2d/rig/tagWarpBindings.js — Stage 9a.
// Run: node scripts/test_tagWarpBindings.mjs
//
// Two layers of coverage:
//   1. Default-equivalence — with the default magnitudes, each shiftFn
//      produces the bit-for-bit same output as the inline literals in
//      cmo3writer.js produced before Stage 9a. Reproduced here as a
//      reference table per tag.
//   2. Magnitude scaling — when a magnitude is doubled in the input
//      config, the output for that tag scales linearly.

import {
  buildTagWarpBindingRules,
  buildTagBindingMap,
} from '../src/io/live2d/rig/tagWarpBindings.js';
import { DEFAULT_AUTO_RIG_CONFIG } from '../src/io/live2d/rig/autoRigConfig.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

function assertClose(actual, expected, eps, name) {
  if (Math.abs(actual - expected) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} — expected ~${expected}, got ${actual}`);
}

function arraysClose(a, b, eps, name) {
  if (a.length !== b.length) {
    failed++;
    console.error(`FAIL: ${name} — length mismatch ${a.length} vs ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) {
      failed++;
      console.error(`FAIL: ${name} at idx=${i} — ${a[i]} vs ${b[i]}`);
      return;
    }
  }
  passed++;
}

// Build a uniform 3×3 rest grid in deformer-local 0..1 space.
function makeGrid(gW, gH) {
  const grid = new Float64Array(gW * gH * 2);
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      grid[(r * gW + c) * 2]     = c / (gW - 1);
      grid[(r * gW + c) * 2 + 1] = r / (gH - 1);
    }
  }
  return grid;
}

// --- Map shape ---

{
  const rules = buildTagWarpBindingRules();
  const expectedTags = [
    'front hair', 'back hair', 'bottomwear', 'topwear', 'legwear',
    'eyebrow', 'eyebrow-l', 'eyebrow-r',
    'irides', 'irides-l', 'irides-r',
    'eyewhite-l', 'eyewhite-r', 'eyewhite',
    'eyelash', 'mouth',
  ];
  for (const tag of expectedTags) {
    assert(rules.has(tag), `rules.has('${tag}')`);
  }
  assertEq(rules.size, expectedTags.length, 'rule count matches expected tag list');

  // Each rule has bindings + shiftFn; bindings carry paramId/keys/desc.
  for (const [tag, rule] of rules) {
    assert(Array.isArray(rule.bindings) && rule.bindings.length > 0,
      `'${tag}' has at least one binding`);
    for (const b of rule.bindings) {
      assert(typeof b.paramId === 'string' && b.paramId.length > 0,
        `'${tag}' binding paramId`);
      assert(Array.isArray(b.keys) && b.keys.length > 0,
        `'${tag}' binding keys`);
      assert(typeof b.desc === 'string', `'${tag}' binding desc`);
    }
    assert(typeof rule.shiftFn === 'function', `'${tag}' shiftFn is function`);
  }
}

// --- buildTagBindingMap: PIDs wired through ---

{
  const map = buildTagBindingMap({
    ParamHairFront: 'pid-hair-front',
    ParamHairBack:  'pid-hair-back',
    ParamSkirt:     'pid-skirt',
    ParamShirt:     'pid-shirt',
    ParamPants:     'pid-pants',
    ParamBust:      'pid-bust',
    ParamBrowLY:    'pid-brow-l',
    ParamBrowRY:    'pid-brow-r',
    ParamMouthOpenY:'pid-mouth',
    ParamEyeLOpen:  'pid-eye-open',
    ParamEyeBallX:  'pid-eye-x',
    ParamEyeBallY:  'pid-eye-y',
  });
  assertEq(map.get('front hair').bindings[0].pid, 'pid-hair-front', 'front hair PID wired');
  assertEq(map.get('topwear').bindings.map(b => b.pid),
    ['pid-shirt', 'pid-bust'], 'topwear two-binding PIDs wired in order');
  assertEq(map.get('mouth').bindings[0].pid, 'pid-mouth', 'mouth PID wired');
}

// --- buildTagBindingMap: missing PID → null (writer's gate drops it) ---

{
  const map = buildTagBindingMap({}); // empty lookup
  assert(map.get('front hair').bindings[0].pid === null,
    'missing PID → null (writer gate drops binding)');
  assert(map.get('topwear').bindings.every(b => b.pid === null),
    'topwear missing both PIDs → all null');
}

// --- buildTagBindingMap: Map lookup also works (mirrors writer pattern) ---

{
  const map = buildTagBindingMap(new Map([
    ['ParamHairFront', 'pid-from-Map'],
  ]));
  assertEq(map.get('front hair').bindings[0].pid, 'pid-from-Map',
    'Map-form paramPids lookup works');
}

// --- shiftFn defaults bit-for-bit equal pre-Stage-9a literals ---
// Reference values use the default magnitudes (m.hairFrontXSway=0.12 etc).
// Each pair below recomputes the expected output INLINE using the same
// formula as the original cmo3writer literals — divergence here means
// either the magnitude default drifted or the formula was edited.

{
  const rules = buildTagWarpBindingRules();
  const gW = 3, gH = 3;
  const grid = makeGrid(gW, gH);
  const gxS = 100, gyS = 200;

  // 'front hair' k=+1 against inline reference:
  // pos[idx]     += k * 0.12 * min(gxS,gyS) * frac^3
  // pos[idx + 1] += k * 0.03 * min(gxS,gyS) * frac^3
  {
    const out = rules.get('front hair').shiftFn(grid, gW, gH, [+1], gxS, gyS);
    const scale = Math.min(gxS, gyS);
    const ref = new Float64Array(grid);
    for (let r = 0; r < gH; r++) {
      const frac = r / (gH - 1);
      const w = frac * frac * frac;
      for (let c = 0; c < gW; c++) {
        ref[(r * gW + c) * 2]     += 1 * 0.12 * scale * w;
        ref[(r * gW + c) * 2 + 1] += 1 * 0.03 * scale * w;
      }
    }
    arraysClose(out, ref, 1e-15, 'front hair k=+1 matches inline literal');
  }

  // 'back hair' k=-1 — values 0.10 / 0.025
  {
    const out = rules.get('back hair').shiftFn(grid, gW, gH, [-1], gxS, gyS);
    const scale = Math.min(gxS, gyS);
    const ref = new Float64Array(grid);
    for (let r = 0; r < gH; r++) {
      const frac = r / (gH - 1);
      const w = frac * frac * frac;
      for (let c = 0; c < gW; c++) {
        ref[(r * gW + c) * 2]     += -1 * 0.10 * scale * w;
        ref[(r * gW + c) * 2 + 1] += -1 * 0.025 * scale * w;
      }
    }
    arraysClose(out, ref, 1e-15, 'back hair k=-1 matches inline literal');
  }

  // 'bottomwear' k=+1 — frac^4 X-only, magnitude 0.04
  {
    const out = rules.get('bottomwear').shiftFn(grid, gW, gH, [+1], gxS, gyS);
    const ref = new Float64Array(grid);
    for (let r = 0; r < gH; r++) {
      const frac = r / (gH - 1);
      const w = frac ** 4;
      for (let c = 0; c < gW; c++) {
        ref[(r * gW + c) * 2] += 1 * 0.04 * gxS * w;
      }
    }
    arraysClose(out, ref, 1e-15, 'bottomwear k=+1 matches inline literal');
  }

  // 'topwear' kShirt=+1, kBust=-1 — combined shift
  {
    const out = rules.get('topwear').shiftFn(grid, gW, gH, [+1, -1], gxS, gyS);
    const ref = new Float64Array(grid);
    for (let r = 0; r < gH; r++) {
      const rFrac = r / (gH - 1);
      const shirtSwayW = rFrac * rFrac;
      const bustRowW = Math.max(0, 1 - Math.abs(rFrac - 0.5) * 2);
      for (let c = 0; c < gW; c++) {
        const cFrac = c / (gW - 1);
        const bustColW = Math.max(0, 1 - Math.abs(cFrac - 0.5) * 2);
        const bustW = bustRowW * bustColW;
        const idx = (r * gW + c) * 2;
        ref[idx]     +=  1 * 0.02  * gxS * shirtSwayW;
        ref[idx + 1] += -(-1) * 0.012 * gyS * bustW;
      }
    }
    arraysClose(out, ref, 1e-15, 'topwear kShirt=+1 kBust=-1 matches inline literal');
  }

  // 'legwear' k=+1 — frac^4 X-only, magnitude 0.008
  {
    const out = rules.get('legwear').shiftFn(grid, gW, gH, [+1], gxS, gyS);
    const ref = new Float64Array(grid);
    for (let r = 0; r < gH; r++) {
      const frac = r / (gH - 1);
      const w = frac ** 4;
      for (let c = 0; c < gW; c++) {
        ref[(r * gW + c) * 2] += 1 * 0.008 * gxS * w;
      }
    }
    arraysClose(out, ref, 1e-15, 'legwear k=+1 matches inline literal');
  }

  // 'eyebrow' k=+1 — uniform Y translate, magnitude 0.15
  {
    const out = rules.get('eyebrow').shiftFn(grid, gW, gH, [+1], gxS, gyS);
    const ref = new Float64Array(grid);
    for (let i = 1; i < ref.length; i += 2) ref[i] += -1 * 0.15 * gyS;
    arraysClose(out, ref, 1e-15, 'eyebrow k=+1 matches inline literal');
  }

  // 'irides' k=0 — collapse to convergence line at gyS*0.80
  {
    const out = rules.get('irides').shiftFn(grid, gW, gH, [0], gxS, gyS);
    const convergY = grid[1] + gyS * 0.80;
    const ref = new Float64Array(grid);
    for (let i = 1; i < ref.length; i += 2) {
      ref[i] = convergY + (grid[i] - convergY) * 0;
    }
    arraysClose(out, ref, 1e-15, 'irides k=0 matches inline literal');
  }

  // 'irides-l' kX=+1, kY=-1 — uniform translate by 0.09 / 0.075
  {
    const out = rules.get('irides-l').shiftFn(grid, gW, gH, [+1, -1], gxS, gyS);
    const ref = new Float64Array(grid);
    const dx =  1 * gxS * 0.09;
    const dy = -(-1) * gyS * 0.075;
    for (let i = 0; i < ref.length; i += 2) {
      ref[i]     += dx;
      ref[i + 1] += dy;
    }
    arraysClose(out, ref, 1e-15, 'irides-l kX=+1 kY=-1 matches inline literal');
  }

  // 'eyewhite-l' identity — should equal grid for any input
  {
    const out = rules.get('eyewhite-l').shiftFn(grid, gW, gH, [+1, -1], gxS, gyS);
    arraysClose(out, grid, 1e-15, 'eyewhite-l identity for any input');
  }

  // 'mouth' k=+1 — quadratic stretch 0.35
  {
    const out = rules.get('mouth').shiftFn(grid, gW, gH, [+1], gxS, gyS);
    const ref = new Float64Array(grid);
    const maxStretch = gyS * 0.35;
    for (let r = 0; r < gH; r++) {
      const rFrac = r / (gH - 1);
      const dy = 1 * maxStretch * rFrac * rFrac;
      for (let c = 0; c < gW; c++) {
        ref[(r * gW + c) * 2 + 1] += dy;
      }
    }
    arraysClose(out, ref, 1e-15, 'mouth k=+1 matches inline literal');
  }
}

// --- shiftFn rest keyform (k=0 / k=1 etc) returns rest grid ---

{
  const rules = buildTagWarpBindingRules();
  const gW = 3, gH = 3;
  const grid = makeGrid(gW, gH);
  const gxS = 100, gyS = 200;
  // Rest keyform per tag (the value of k that yields baseGrid).
  const restKey = {
    'front hair': [0],
    'back hair':  [0],
    bottomwear:   [0],
    topwear:      [0, 0],
    legwear:      [0],
    eyebrow:      [0],
    'eyebrow-l':  [0],
    'eyebrow-r':  [0],
    irides:       [1],         // ParamEyeLOpen = 1 → rest (open)
    'irides-l':   [0, 0],
    'irides-r':   [0, 0],
    'eyewhite-l': [0, 0],      // identity always == rest, but check at rest
    'eyewhite-r': [0, 0],
    eyewhite:     [1],
    eyelash:      [1],
    mouth:        [0],
  };
  for (const [tag, rule] of rules) {
    const k = restKey[tag];
    if (!k) continue;
    const out = rule.shiftFn(grid, gW, gH, k, gxS, gyS);
    arraysClose(out, grid, 1e-15, `'${tag}' rest keyform == grid`);
  }
}

// --- Magnitudes scale linearly ---

{
  const gW = 3, gH = 3;
  const grid = makeGrid(gW, gH);
  const gxS = 100, gyS = 200;

  // Double front hair X sway → X delta should double.
  const def = buildTagWarpBindingRules();
  const dbl = buildTagWarpBindingRules({
    ...DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes,
    hairFrontXSway: DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.hairFrontXSway * 2,
  });
  const a = def.get('front hair').shiftFn(grid, gW, gH, [+1], gxS, gyS);
  const b = dbl.get('front hair').shiftFn(grid, gW, gH, [+1], gxS, gyS);
  // For each X delta in 'a' (pos - grid), the same idx in 'b' must be 2× it.
  let nonZero = 0;
  for (let i = 0; i < a.length; i += 2) {
    const da = a[i] - grid[i];
    const db = b[i] - grid[i];
    if (Math.abs(da) > 0) {
      nonZero++;
      assertClose(db, da * 2, 1e-12, `front hair X delta scaled 2× at idx=${i}`);
    }
  }
  assert(nonZero > 0, 'at least one row had a non-zero X delta to compare');

  // Y deltas should match between def and dbl (Y magnitude unchanged).
  for (let i = 1; i < a.length; i += 2) {
    const da = a[i] - grid[i];
    const db = b[i] - grid[i];
    assertClose(db, da, 1e-15, `front hair Y delta unchanged at idx=${i}`);
  }
}

{
  // Double mouth Y stretch → Y delta should double.
  const gW = 3, gH = 3;
  const grid = makeGrid(gW, gH);
  const gxS = 100, gyS = 200;
  const def = buildTagWarpBindingRules();
  const dbl = buildTagWarpBindingRules({
    ...DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes,
    mouthYStretch: DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.mouthYStretch * 2,
  });
  const a = def.get('mouth').shiftFn(grid, gW, gH, [+1], gxS, gyS);
  const b = dbl.get('mouth').shiftFn(grid, gW, gH, [+1], gxS, gyS);
  let nonZero = 0;
  for (let i = 1; i < a.length; i += 2) {
    const da = a[i] - grid[i];
    const db = b[i] - grid[i];
    if (Math.abs(da) > 0) {
      nonZero++;
      assertClose(db, da * 2, 1e-12, `mouth Y delta scaled 2× at idx=${i}`);
    }
  }
  assert(nonZero > 0, 'mouth had at least one non-zero Y delta');
}

// --- Determinism: same inputs → same output ---

{
  const rules = buildTagWarpBindingRules();
  const grid = makeGrid(3, 3);
  const a = rules.get('front hair').shiftFn(grid, 3, 3, [+1], 100, 200);
  const b = rules.get('front hair').shiftFn(grid, 3, 3, [+1], 100, 200);
  arraysClose(a, b, 1e-15, 'front hair deterministic');
  const c = rules.get('mouth').shiftFn(grid, 3, 3, [+1], 100, 200);
  const d = rules.get('mouth').shiftFn(grid, 3, 3, [+1], 100, 200);
  arraysClose(c, d, 1e-15, 'mouth deterministic');
}

// --- Default magnitudes are bit-for-bit the pre-9a literals ---

{
  const m = DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes;
  assertEq(m.hairFrontXSway,    0.12,  'default hairFrontXSway');
  assertEq(m.hairFrontYCurl,    0.03,  'default hairFrontYCurl');
  assertEq(m.hairBackXSway,     0.10,  'default hairBackXSway');
  assertEq(m.hairBackYCurl,     0.025, 'default hairBackYCurl');
  assertEq(m.bottomwearXSway,   0.04,  'default bottomwearXSway');
  assertEq(m.legwearXSway,      0.008, 'default legwearXSway');
  assertEq(m.topwearShirtXSway, 0.02,  'default topwearShirtXSway');
  assertEq(m.topwearBustY,      0.012, 'default topwearBustY');
  assertEq(m.eyebrowY,          0.15,  'default eyebrowY');
  assertEq(m.eyeConvergeYFrac,  0.80,  'default eyeConvergeYFrac');
  assertEq(m.iridesGazeX,       0.09,  'default iridesGazeX');
  assertEq(m.iridesGazeY,       0.075, 'default iridesGazeY');
  assertEq(m.mouthYStretch,     0.35,  'default mouthYStretch');
}

// --- Summary ---

console.log(`tagWarpBindings: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
