// v2 R4 — Unit tests for rotationEval.
// Run: node scripts/test_rotationEval.mjs

import {
  evalRotation,
  buildRotationMat3,
  applyMat3ToPoint,
  mat3Multiply,
} from '../../src/io/live2d/runtime/evaluator/rotationEval.js';

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

// ── evalRotation: single keyform identity ──
{
  const spec = {
    keyforms: [
      { keyTuple: [0], angle: 30, originX: 100, originY: 50, scale: 1.5, opacity: 0.8 },
    ],
  };
  const r = evalRotation(spec, { indices: [0], weights: [1] });
  assert(r !== null, 'single keyform: returns object');
  assert(nearlyEq(r.angleDeg, 30), 'single keyform: angle preserved');
  assert(nearlyEq(r.originX, 100), 'single keyform: originX preserved');
  assert(nearlyEq(r.originY, 50), 'single keyform: originY preserved');
  assert(nearlyEq(r.scale, 1.5), 'single keyform: scale preserved');
  assert(nearlyEq(r.opacity, 0.8), 'single keyform: opacity preserved');
  assert(r.reflectX === false, 'single keyform: reflectX false default');
  assert(r.reflectY === false, 'single keyform: reflectY false default');
}

// ── evalRotation: missing fields default ──
{
  const spec = {
    keyforms: [
      { keyTuple: [0] }, // angle/origin/scale missing — defaults: 0, 0, 0, 1
    ],
  };
  const r = evalRotation(spec, { indices: [0], weights: [1] });
  assert(nearlyEq(r.angleDeg, 0), 'missing fields: angle 0 default');
  assert(nearlyEq(r.scale, 1), 'missing fields: scale 1 default');
  assert(nearlyEq(r.opacity, 1), 'missing fields: opacity 1 default');
}

// ── evalRotation: 50/50 blend ──
{
  const spec = {
    keyforms: [
      { angle: -30, originX: 0, originY: 0, scale: 1, opacity: 1 },
      { angle: 30, originX: 100, originY: 50, scale: 2, opacity: 0.5 },
    ],
  };
  const r = evalRotation(spec, { indices: [0, 1], weights: [0.5, 0.5] });
  assert(nearlyEq(r.angleDeg, 0), '50/50: angle midpoint = 0');
  assert(nearlyEq(r.originX, 50), '50/50: originX midpoint');
  assert(nearlyEq(r.originY, 25), '50/50: originY midpoint');
  assert(nearlyEq(r.scale, 1.5), '50/50: scale midpoint');
  assert(nearlyEq(r.opacity, 0.75), '50/50: opacity midpoint');
}

// ── evalRotation: reflect taken from heaviest weight ──
{
  const spec = {
    keyforms: [
      { angle: 0, reflectX: false, reflectY: false },
      { angle: 0, reflectX: true,  reflectY: false },
    ],
  };
  // 60/40 — first keyform wins.
  let r = evalRotation(spec, { indices: [0, 1], weights: [0.6, 0.4] });
  assert(r.reflectX === false, 'reflect: heavier weight (no-reflect) wins');

  r = evalRotation(spec, { indices: [0, 1], weights: [0.4, 0.6] });
  assert(r.reflectX === true, 'reflect: heavier weight (reflect) wins');
}

// ── evalRotation: empty spec → null ──
{
  assert(evalRotation({}, { indices: [0], weights: [1] }) === null,
    'no keyforms → null');
  assert(evalRotation(null, { indices: [0], weights: [1] }) === null, 'null spec → null');
  assert(evalRotation({ keyforms: [] }, { indices: [0], weights: [1] }) === null,
    'empty keyforms → null');
}

// ── evalRotation: zero total weight defensive fallback ──
{
  const spec = {
    keyforms: [
      { angle: 7, originX: 11, originY: 13, scale: 0.5, opacity: 0.3 },
    ],
  };
  const r = evalRotation(spec, { indices: [0], weights: [0] });
  assert(r.angleDeg === 7, 'zero-weight cellInfo falls back to first keyform');
  assert(r.originX === 11, 'fallback originX');
}

// ── buildRotationMat3: identity (angle=0, scale=1, no reflect, origin=0) ──
{
  const m = buildRotationMat3({ angleDeg: 0, originX: 0, originY: 0, scale: 1 });
  // Should be 3x3 identity
  assert(arrEq(Array.from(m), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12), 'identity matrix');
}

// ── buildRotationMat3: pure translation (origin=10,20, no rotation/scale) ──
{
  const m = buildRotationMat3({ angleDeg: 0, originX: 10, originY: 20, scale: 1 });
  // Apply to point (1, 2) → should be (11, 22)
  const out = applyMat3ToPoint(m, 1, 2);
  assert(arrEq(out, [11, 22], 1e-12), 'pure translation applies origin');
}

// ── buildRotationMat3: 90° rotation around origin ──
{
  const m = buildRotationMat3({ angleDeg: 90, originX: 0, originY: 0, scale: 1 });
  // (1, 0) → (0, 1) under +90° CCW
  const out = applyMat3ToPoint(m, 1, 0);
  assert(arrEq(out, [0, 1], 1e-12), '90° rotation: (1,0) → (0,1)');
  // (0, 1) → (-1, 0)
  const out2 = applyMat3ToPoint(m, 0, 1);
  assert(arrEq(out2, [-1, 0], 1e-12), '90° rotation: (0,1) → (-1,0)');
}

// ── buildRotationMat3: 90° rotation around (10, 20) ──
{
  const m = buildRotationMat3({ angleDeg: 90, originX: 10, originY: 20, scale: 1 });
  // Local (0, 0) → canvas (10, 20)  (origin)
  assert(arrEq(applyMat3ToPoint(m, 0, 0), [10, 20], 1e-12), '90° around (10,20): origin maps to itself');
  // Local (1, 0) → rotate → (0, 1) → translate → (10, 21)
  assert(arrEq(applyMat3ToPoint(m, 1, 0), [10, 21], 1e-12), '90° around (10,20): (1,0) → (10,21)');
}

// ── buildRotationMat3: pure scale ──
{
  const m = buildRotationMat3({ angleDeg: 0, originX: 0, originY: 0, scale: 2 });
  assert(arrEq(applyMat3ToPoint(m, 3, 5), [6, 10], 1e-12), 'scale 2: (3,5) → (6,10)');
}

// ── buildRotationMat3: reflectX ──
{
  const m = buildRotationMat3({ angleDeg: 0, originX: 0, originY: 0, scale: 1, reflectX: true });
  assert(arrEq(applyMat3ToPoint(m, 5, 7), [-5, 7], 1e-12), 'reflectX flips x sign');
}

// ── buildRotationMat3: reflectY ──
{
  const m = buildRotationMat3({ angleDeg: 0, originX: 0, originY: 0, scale: 1, reflectY: true });
  assert(arrEq(applyMat3ToPoint(m, 5, 7), [5, -7], 1e-12), 'reflectY flips y sign');
}

// ── buildRotationMat3: combined transform ──
{
  // rotate 90° + scale 2 around origin (1, 1).
  // Local point (1, 0): scale → (2, 0); rotate → (0, 2); translate → (1, 3)
  const m = buildRotationMat3({ angleDeg: 90, originX: 1, originY: 1, scale: 2 });
  assert(arrEq(applyMat3ToPoint(m, 1, 0), [1, 3], 1e-12), 'combined: rotate 90 + scale 2 around (1,1)');
}

// ── mat3Multiply: identity ──
{
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const M = buildRotationMat3({ angleDeg: 45, originX: 5, originY: 7, scale: 2 });
  const out1 = mat3Multiply(I, M);
  assert(arrEq(Array.from(out1), Array.from(M), 1e-12), 'I * M = M');
  const out2 = mat3Multiply(M, I);
  assert(arrEq(Array.from(out2), Array.from(M), 1e-12), 'M * I = M');
}

// ── mat3Multiply: chain of two rotations equals sum of angles ──
{
  const M1 = buildRotationMat3({ angleDeg: 30, originX: 0, originY: 0, scale: 1 });
  const M2 = buildRotationMat3({ angleDeg: 60, originX: 0, originY: 0, scale: 1 });
  const M3 = mat3Multiply(M1, M2);
  const M90 = buildRotationMat3({ angleDeg: 90, originX: 0, originY: 0, scale: 1 });
  // (1, 0) under M3 should equal (1, 0) under M90 = (0, 1).
  assert(arrEq(applyMat3ToPoint(M3, 1, 0), applyMat3ToPoint(M90, 1, 0), 1e-12),
    'chain: 30°·60° = 90° applied to (1,0)');
}

// ── mat3Multiply: out parameter ──
{
  const A = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const B = [9, 8, 7, 6, 5, 4, 3, 2, 1];
  const out = new Float64Array(9);
  const ret = mat3Multiply(A, B, out);
  assert(ret === out, 'out param returned');
  // Sanity: matmul row 0 col 0 = 1*9 + 2*6 + 3*3 = 9+12+9 = 30
  assert(out[0] === 30, 'out[0] = 30 (matmul check)');
}

// ── applyMat3ToPoint: out parameter ──
{
  const m = buildRotationMat3({ angleDeg: 90, originX: 0, originY: 0, scale: 1 });
  const out = [99, 99];
  const ret = applyMat3ToPoint(m, 1, 0, out);
  assert(ret === out, 'out param returned from applyMat3ToPoint');
  assert(arrEq(out, [0, 1], 1e-12), 'applyMat3ToPoint with out matches');
}

// ── Integration: evalRotation → buildRotationMat3 → applyMat3ToPoint ──
{
  const spec = {
    keyforms: [
      { angle: 0,  originX: 100, originY: 100, scale: 1, opacity: 1 },
      { angle: 90, originX: 100, originY: 100, scale: 1, opacity: 1 },
    ],
  };
  // 50/50 blend → 45° around (100, 100).
  const state = evalRotation(spec, { indices: [0, 1], weights: [0.5, 0.5] });
  const m = buildRotationMat3(state);
  // Local (1, 0) under 45° → (cos45, sin45) → (~0.707, 0.707) plus (100, 100)
  const c = Math.cos(Math.PI / 4);
  const s = Math.sin(Math.PI / 4);
  const out = applyMat3ToPoint(m, 1, 0);
  assert(arrEq(out, [100 + c, 100 + s], 1e-9), 'integration: 50/50 blend → 45° rotation');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
