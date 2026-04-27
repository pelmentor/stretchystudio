// v2 R5 — Unit tests for artMeshEval.
// Run: node scripts/test_artMeshEval.mjs

import { evalArtMesh } from '../src/io/live2d/runtime/evaluator/artMeshEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function arrEq(a, b, eps = 1e-6) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEq(a[i], b[i], eps)) return false;
  return true;
}

const f32 = (xs) => new Float32Array(xs);

// ── Single keyform identity ──
{
  const verts = f32([10, 20, 30, 40]);
  const spec = {
    keyforms: [{ keyTuple: [1.0], vertexPositions: verts, opacity: 1.0 }],
    drawOrder: 500,
  };
  const r = evalArtMesh(spec, { indices: [0], weights: [1] });
  assert(r !== null, 'single keyform: returns object');
  assert(arrEq(r.vertexPositions, [10, 20, 30, 40]), 'single keyform: verts preserved');
  assert(nearlyEq(r.opacity, 1.0), 'single keyform: opacity preserved');
  assert(r.drawOrder === 500, 'single keyform: drawOrder from spec');
}

// ── 2-keyform 50/50 blend (eye-blink-style) ──
{
  const closed = f32([0, 0, 100, 0, 0, 0, 100, 0]);   // y collapsed to 0
  const open = f32([0, 0, 100, 0, 0, 50, 100, 50]);   // y top at 50
  const spec = {
    keyforms: [
      { keyTuple: [0], vertexPositions: closed, opacity: 1 },
      { keyTuple: [1], vertexPositions: open,   opacity: 1 },
    ],
  };
  const r = evalArtMesh(spec, { indices: [0, 1], weights: [0.5, 0.5] });
  // Midpoint: y top should be (0 + 50) / 2 = 25
  assert(nearlyEq(r.vertexPositions[5], 25), '50/50 blend: y[5] = 25 (top mid)');
  assert(nearlyEq(r.vertexPositions[7], 25), '50/50 blend: y[7] = 25');
  assert(nearlyEq(r.opacity, 1.0), '50/50 blend: opacity stays 1');
}

// ── Variant fade (opacity 0 ↔ 1, same verts) ──
{
  const v = f32([1, 2, 3, 4]);
  const spec = {
    keyforms: [
      { keyTuple: [0], vertexPositions: v, opacity: 0 },
      { keyTuple: [1], vertexPositions: v, opacity: 1 },
    ],
  };
  const r = evalArtMesh(spec, { indices: [0, 1], weights: [0.7, 0.3] });
  assert(arrEq(r.vertexPositions, [1, 2, 3, 4]), 'variant fade: verts unchanged');
  // 0.7 * 0 + 0.3 * 1 = 0.3
  assert(nearlyEq(r.opacity, 0.3), 'variant fade: opacity = 0.3');
}

// ── 4-keyform 2D compound (eye blink × variant) ──
{
  // closed=0/open=1 × neutral=0/variant=1
  const cN = f32([0, 0, 0, 0]);
  const oN = f32([1, 1, 1, 1]);
  const cV = f32([2, 2, 2, 2]);
  const oV = f32([3, 3, 3, 3]);
  const spec = {
    keyforms: [
      { keyTuple: [0, 0], vertexPositions: cN, opacity: 1 }, // base closed
      { keyTuple: [1, 0], vertexPositions: oN, opacity: 1 }, // base open
      { keyTuple: [0, 1], vertexPositions: cV, opacity: 0 }, // variant closed (hidden at variant=1 — wait, base hidden at variant=1)
      { keyTuple: [1, 1], vertexPositions: oV, opacity: 0 }, // base open at variant=1 — hidden
    ],
  };
  // Mid-blend at (closure=0.5, variant=0.5) → all 4 corners at 0.25 each
  const r = evalArtMesh(spec, {
    indices: [0, 1, 2, 3],
    weights: [0.25, 0.25, 0.25, 0.25],
  });
  // verts = 0.25*(0+1+2+3) = 1.5 each
  for (let i = 0; i < 4; i++) {
    assert(nearlyEq(r.vertexPositions[i], 1.5), `compound: vertex[${i}] = 1.5`);
  }
  // opacity = 0.25*(1+1+0+0) = 0.5
  assert(nearlyEq(r.opacity, 0.5), 'compound: opacity = 0.5');
}

// ── Single-keyform "ParamOpacity[1.0]" default plan ──
{
  const v = f32([5, 5]);
  const spec = {
    keyforms: [{ keyTuple: [1.0], vertexPositions: v, opacity: 1 }],
  };
  const r = evalArtMesh(spec, { indices: [0], weights: [1] });
  assert(arrEq(r.vertexPositions, [5, 5]), 'default plan: verts preserved');
  assert(r.opacity === 1, 'default plan: opacity 1');
  assert(r.drawOrder === 500, 'default plan: drawOrder default 500');
}

// ── drawOrder taken from heaviest keyform ──
{
  const v = f32([0, 0]);
  const spec = {
    keyforms: [
      { vertexPositions: v, opacity: 1, drawOrder: 100 },
      { vertexPositions: v, opacity: 1, drawOrder: 900 },
    ],
  };
  let r = evalArtMesh(spec, { indices: [0, 1], weights: [0.6, 0.4] });
  assert(r.drawOrder === 100, 'drawOrder: heavier 60/40 → 100');
  r = evalArtMesh(spec, { indices: [0, 1], weights: [0.4, 0.6] });
  assert(r.drawOrder === 900, 'drawOrder: heavier 40/60 → 900');
}

// ── drawOrder fallback chain: keyform → spec → 500 ──
{
  const v = f32([0, 0]);
  // No drawOrder anywhere
  let spec = { keyforms: [{ vertexPositions: v }] };
  let r = evalArtMesh(spec, { indices: [0], weights: [1] });
  assert(r.drawOrder === 500, 'drawOrder: falls back to 500');
  // spec.drawOrder used when keyform lacks it
  spec = { keyforms: [{ vertexPositions: v }], drawOrder: 750 };
  r = evalArtMesh(spec, { indices: [0], weights: [1] });
  assert(r.drawOrder === 750, 'drawOrder: spec.drawOrder used when keyform unset');
}

// ── Empty / null spec ──
{
  assert(evalArtMesh({}, { indices: [0], weights: [1] }) === null,
    'no keyforms → null');
  assert(evalArtMesh(null, { indices: [0], weights: [1] }) === null, 'null spec → null');
  assert(evalArtMesh({ keyforms: [] }, { indices: [0], weights: [1] }) === null,
    'empty keyforms array → null');
}

// ── Length mismatch → entry skipped (does not corrupt blend) ──
{
  const v3 = f32([1, 1, 2]);
  const v4 = f32([3, 3, 4, 4]);
  const spec = {
    keyforms: [
      { vertexPositions: v3, opacity: 1 },
      { vertexPositions: v4, opacity: 1 }, // length differs — should be skipped
    ],
  };
  const r = evalArtMesh(spec, { indices: [0, 1], weights: [0.5, 0.5] });
  // Reference is keyform 0 (first weighted, length 3). Keyform 1 is skipped.
  assert(r.vertexPositions.length === 3, 'length mismatch: skipped, output uses ref length');
  // Out = 0.5 * v3 (keyform 1 skipped) → [0.5, 0.5, 1.0]
  assert(arrEq(r.vertexPositions, [0.5, 0.5, 1.0]), 'length mismatch: skipped entry not blended');
}

// ── Zero total weight defensive fallback ──
{
  const v = f32([7, 8, 9]);
  const spec = {
    keyforms: [
      { vertexPositions: v, opacity: 0.4, drawOrder: 200 },
    ],
  };
  const r = evalArtMesh(spec, { indices: [0], weights: [0] });
  // totalW=0 fallback returns first keyform verbatim.
  assert(arrEq(r.vertexPositions, [7, 8, 9]), 'zero-weight: verts from first keyform');
  assert(r.opacity === 0.4, 'zero-weight: opacity from first keyform');
  assert(r.drawOrder === 200, 'zero-weight: drawOrder from first keyform');
}

// ── Output is fresh Float32Array (no aliasing) ──
{
  const v = f32([1, 2, 3, 4]);
  const spec = { keyforms: [{ vertexPositions: v, opacity: 1 }] };
  const r = evalArtMesh(spec, { indices: [0], weights: [1] });
  r.vertexPositions[0] = 999;
  assert(v[0] === 1, 'output: mutating result does NOT mutate input keyform');
  assert(r.vertexPositions instanceof Float32Array, 'output: Float32Array type preserved');
}

// ── Random sweep: opacity stays in [0, 1] for valid weight inputs ──
{
  const a = f32([0, 0]);
  const b = f32([1, 1]);
  const c = f32([2, 2]);
  const d = f32([3, 3]);
  const spec = {
    keyforms: [
      { vertexPositions: a, opacity: 0 },
      { vertexPositions: b, opacity: 1 },
      { vertexPositions: c, opacity: 0.5 },
      { vertexPositions: d, opacity: 0.7 },
    ],
  };
  let okOpacity = true;
  for (let i = 0; i < 50; i++) {
    const w = [Math.random(), Math.random(), Math.random(), Math.random()];
    const total = w.reduce((s, x) => s + x, 0);
    for (let j = 0; j < 4; j++) w[j] /= total;
    const r = evalArtMesh(spec, { indices: [0, 1, 2, 3], weights: w });
    if (r.opacity < -1e-6 || r.opacity > 1 + 1e-6) {
      okOpacity = false;
      break;
    }
  }
  assert(okOpacity, 'random sweep: opacity stays in [0, 1]');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
