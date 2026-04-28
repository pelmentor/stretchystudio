// v2 R2 — Unit tests for cellSelect.
// Run: node scripts/test_cellSelect.mjs

import { cellSelect } from '../../src/io/live2d/runtime/evaluator/cellSelect.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function arrEq(a, b, eps = 1e-9) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEq(a[i], b[i], eps)) return false;
  return true;
}

function assertCell(actual, expectedIndices, expectedWeights, name, eps = 1e-9) {
  const okI = arrEq(actual.indices, expectedIndices);
  const okW = arrEq(actual.weights, expectedWeights, eps);
  if (okI && okW) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected indices: ${JSON.stringify(expectedIndices)}`);
  console.error(`  actual indices:   ${JSON.stringify(actual.indices)}`);
  console.error(`  expected weights: ${JSON.stringify(expectedWeights)}`);
  console.error(`  actual weights:   ${JSON.stringify(actual.weights)}`);
}

// ── Zero bindings (host with single rest keyform) ──
{
  const r = cellSelect([], {});
  assertCell(r, [0], [1], 'zero bindings → single corner');

  const r2 = cellSelect(null, {});
  assertCell(r2, [0], [1], 'null bindings → single corner');

  const r3 = cellSelect(undefined, {});
  assertCell(r3, [0], [1], 'undefined bindings → single corner');
}

// ── 1D, 2 keys, midpoint ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 1] }];
  const r = cellSelect(bindings, { P: 0.5 });
  assertCell(r, [0, 1], [0.5, 0.5], '1D midpoint');
}

// ── 1D, 2 keys, exact lower endpoint ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 1] }];
  const r = cellSelect(bindings, { P: 0 });
  assertCell(r, [0, 1], [1, 0], '1D at lower endpoint → t=0');
}

// ── 1D, 2 keys, exact upper endpoint ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 1] }];
  const r = cellSelect(bindings, { P: 1 });
  assertCell(r, [0, 1], [0, 1], '1D at upper endpoint → t=1');
}

// ── 1D, 2 keys, below range (clamped) ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 1] }];
  const r = cellSelect(bindings, { P: -5 });
  assertCell(r, [0, 1], [1, 0], '1D below range → clamps to t=0');
}

// ── 1D, 2 keys, above range (clamped) ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 1] }];
  const r = cellSelect(bindings, { P: 99 });
  assertCell(r, [0, 1], [0, 1], '1D above range → clamps to t=1');
}

// ── 1D, 3 keys (e.g. ParamAngleX [-30, 0, 30]), midpoint of lower segment ──
{
  const bindings = [{ parameterId: 'AngleX', keys: [-30, 0, 30] }];
  const r = cellSelect(bindings, { AngleX: -15 });
  assertCell(r, [0, 1], [0.5, 0.5], '1D 3-key, lower segment midpoint');
}

// ── 1D, 3 keys, midpoint of upper segment ──
{
  const bindings = [{ parameterId: 'AngleX', keys: [-30, 0, 30] }];
  const r = cellSelect(bindings, { AngleX: 15 });
  assertCell(r, [1, 2], [0.5, 0.5], '1D 3-key, upper segment midpoint');
}

// ── 1D, 3 keys, value at exact middle key ──
{
  const bindings = [{ parameterId: 'AngleX', keys: [-30, 0, 30] }];
  const r = cellSelect(bindings, { AngleX: 0 });
  // Either segment is acceptable; impl picks the lower segment with t=1 (since 0 == upper of [−30,0]).
  // Verify: middle key gets weight 1, others 0.
  const totalWeights = r.weights.reduce((s, w) => s + w, 0);
  assert(nearlyEq(totalWeights, 1), '1D 3-key, exact middle: weights sum to 1');
  let middleWeight = 0;
  for (let i = 0; i < r.indices.length; i++) {
    if (r.indices[i] === 1) middleWeight += r.weights[i];
  }
  assert(nearlyEq(middleWeight, 1), '1D 3-key, exact middle key gets full weight');
}

// ── 1D, 5 keys (BAKED_ANGLES style), arbitrary value ──
{
  const bindings = [{ parameterId: 'A', keys: [-90, -45, 0, 45, 90] }];
  const r = cellSelect(bindings, { A: 22.5 });
  // Should pick segment [0, 45], t = 0.5
  assertCell(r, [2, 3], [0.5, 0.5], '1D 5-key value 22.5 → segment [0,45] midpoint');
}

// ── 2D, 2×2 keys, both midpoints (eye compound case) ──
{
  // First binding (closure) varies fastest. keyform layout:
  //   index 0 = (closure=0, variant=0)
  //   index 1 = (closure=1, variant=0)
  //   index 2 = (closure=0, variant=1)
  //   index 3 = (closure=1, variant=1)
  const bindings = [
    { parameterId: 'EyeOpen', keys: [0, 1] },
    { parameterId: 'Smile',   keys: [0, 1] },
  ];
  const r = cellSelect(bindings, { EyeOpen: 0.5, Smile: 0.5 });
  assertCell(r, [0, 1, 2, 3], [0.25, 0.25, 0.25, 0.25], '2D both midpoints');
}

// ── 2D, 2×2, EyeOpen at upper, Smile at lower ──
{
  const bindings = [
    { parameterId: 'EyeOpen', keys: [0, 1] },
    { parameterId: 'Smile',   keys: [0, 1] },
  ];
  const r = cellSelect(bindings, { EyeOpen: 1, Smile: 0 });
  // Only (closure=1, variant=0) = index 1 should have weight 1
  const totalWeights = r.weights.reduce((s, w) => s + w, 0);
  assert(nearlyEq(totalWeights, 1), '2D corner exact: weights sum to 1');
  let idx1Weight = 0;
  for (let i = 0; i < r.indices.length; i++) if (r.indices[i] === 1) idx1Weight += r.weights[i];
  assert(nearlyEq(idx1Weight, 1), '2D (1,0) → keyform index 1 gets full weight');
}

// ── 2D, asymmetric keys: 2 × 3 ──
{
  // Layout (first fastest, K0=2, K1=3):
  //   (0,0) → 0   (0,1) → 2   (0,2) → 4
  //   (1,0) → 1   (1,1) → 3   (1,2) → 5
  const bindings = [
    { parameterId: 'A', keys: [0, 1] },
    { parameterId: 'B', keys: [-30, 0, 30] },
  ];
  const r = cellSelect(bindings, { A: 0.5, B: -15 });
  // A in segment [0,1] t=0.5; B in segment [-30,0] t=0.5
  // Corners: (0,0), (1,0), (0,1), (1,1) → indices 0,1,2,3
  // Weights: 0.25 each
  assertCell(r, [0, 1, 2, 3], [0.25, 0.25, 0.25, 0.25], '2D asymmetric (2×3) lower-segment midpoint');
}

// ── 2D, asymmetric, B in upper segment ──
{
  const bindings = [
    { parameterId: 'A', keys: [0, 1] },
    { parameterId: 'B', keys: [-30, 0, 30] },
  ];
  const r = cellSelect(bindings, { A: 0.25, B: 15 });
  // A: j=0, t=0.25 → corners 0, 1
  // B: j=1, t=0.5  → corners 1, 2 (key indices in B's keys)
  // Combined: (a=0,b=1)→2, (a=1,b=1)→3, (a=0,b=2)→4, (a=1,b=2)→5
  // Weights:  (1-0.25)*0.5=0.375, 0.25*0.5=0.125, 0.75*0.5=0.375, 0.25*0.5=0.125
  assertCell(r, [2, 3, 4, 5], [0.375, 0.125, 0.375, 0.125],
    '2D asymmetric (2×3) upper segment of B');
}

// ── 3D, all 2×2×2 ──
{
  const bindings = [
    { parameterId: 'X', keys: [0, 1] },
    { parameterId: 'Y', keys: [0, 1] },
    { parameterId: 'Z', keys: [0, 1] },
  ];
  const r = cellSelect(bindings, { X: 0.5, Y: 0.5, Z: 0.5 });
  // 8 corners, each weight 0.125. Indices 0..7 in first-fastest layout.
  assert(r.indices.length === 8, '3D produces 8 corners');
  assert(arrEq(r.indices, [0, 1, 2, 3, 4, 5, 6, 7]), '3D indices in cross-product order');
  for (let i = 0; i < 8; i++) {
    assert(nearlyEq(r.weights[i], 0.125), `3D weight[${i}] = 0.125`);
  }
  const total = r.weights.reduce((s, w) => s + w, 0);
  assert(nearlyEq(total, 1), '3D weights sum to 1');
}

// ── 3D corner exact (all upper) ──
{
  const bindings = [
    { parameterId: 'X', keys: [0, 1] },
    { parameterId: 'Y', keys: [0, 1] },
    { parameterId: 'Z', keys: [0, 1] },
  ];
  const r = cellSelect(bindings, { X: 1, Y: 1, Z: 1 });
  // (1,1,1) → index 1 + 2 + 4 = 7
  let idx7Weight = 0;
  for (let i = 0; i < r.indices.length; i++) if (r.indices[i] === 7) idx7Weight += r.weights[i];
  assert(nearlyEq(idx7Weight, 1), '3D all-upper → index 7 full weight');
}

// ── Single-key binding (degenerate) ──
{
  const bindings = [{ parameterId: 'O', keys: [1.0] }];
  const r = cellSelect(bindings, { O: 0.5 });
  assertCell(r, [0], [1], 'single-key binding → 1 corner weight 1');
}

// ── Single-key + 2-key combined ──
{
  const bindings = [
    { parameterId: 'A', keys: [0, 1] },
    { parameterId: 'B', keys: [1.0] }, // single
  ];
  const r = cellSelect(bindings, { A: 0.5, B: 999 });
  // First binding contributes 2 corners (j=0,1); second contributes 1.
  // K0=2, K1=1, strides=[1,2]. Corners: (0,0)→0, (1,0)→1.
  // Weights: 0.5, 0.5.
  assertCell(r, [0, 1], [0.5, 0.5], '2D mixed (2-key × 1-key) → 2 corners');
}

// ── Missing paramValue defaults to 0 ──
{
  const bindings = [{ parameterId: 'P', keys: [-1, 1] }];
  const r = cellSelect(bindings, {});  // P missing — defaults to 0
  // 0 in segment [-1, 1] → t = 0.5
  assertCell(r, [0, 1], [0.5, 0.5], 'missing param → defaults to 0');
}

// ── Empty paramValues object ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 10] }];
  const r = cellSelect(bindings, null);
  // null params → 0 → clamped to lower (since 0 == keys[0])
  assertCell(r, [0, 1], [1, 0], 'null paramValues → 0 → lower endpoint');
}

// ── Non-uniform spacing ──
{
  const bindings = [{ parameterId: 'P', keys: [0, 10, 100] }];
  const r = cellSelect(bindings, { P: 5 });
  // Segment [0, 10], t = 0.5
  assertCell(r, [0, 1], [0.5, 0.5], 'non-uniform spacing, lower segment midpoint');

  const r2 = cellSelect(bindings, { P: 55 });
  // Segment [10, 100], t = 0.5
  assertCell(r2, [1, 2], [0.5, 0.5], 'non-uniform spacing, upper segment midpoint');
}

// ── Weights sum invariant (random sweep) ──
{
  const bindings = [
    { parameterId: 'A', keys: [-30, 0, 30] },
    { parameterId: 'B', keys: [0, 0.5, 1] },
  ];
  let allOk = true;
  for (let i = 0; i < 100; i++) {
    const a = -45 + Math.random() * 90;
    const b = -0.2 + Math.random() * 1.4;
    const r = cellSelect(bindings, { A: a, B: b });
    const sum = r.weights.reduce((s, w) => s + w, 0);
    if (!nearlyEq(sum, 1, 1e-9)) {
      allOk = false;
      console.error(`  weights did not sum to 1 at A=${a}, B=${b}: sum=${sum}`);
      break;
    }
  }
  assert(allOk, 'random sweep: weights always sum to 1');
}

// ── First binding varies fastest invariant ──
{
  // For 2 bindings with K0=K1=2, increment A by 1 (cross half a segment)
  // and verify the corners that gain weight share variant=fixed.
  const bindings = [
    { parameterId: 'A', keys: [0, 1] },
    { parameterId: 'B', keys: [0, 1] },
  ];
  // Walk A from 0 to 0.25 with B fixed at 0:
  //  → only corners (a=0,b=0)=index 0 and (a=1,b=0)=index 1 should be non-zero
  //  → (a=0,b=1)=index 2 and (a=1,b=1)=index 3 must stay zero
  const r = cellSelect(bindings, { A: 0.25, B: 0 });
  let w2 = 0, w3 = 0;
  for (let i = 0; i < r.indices.length; i++) {
    if (r.indices[i] === 2) w2 += r.weights[i];
    if (r.indices[i] === 3) w3 += r.weights[i];
  }
  assert(nearlyEq(w2, 0), 'first-fastest: B=0 leaves index 2 (b=1) at zero');
  assert(nearlyEq(w3, 0), 'first-fastest: B=0 leaves index 3 (b=1) at zero');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
