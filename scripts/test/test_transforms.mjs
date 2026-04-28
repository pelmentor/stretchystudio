// v3 Phase 0F.13 - tests for src/renderer/transforms.js
//
// Covers all six exports: mat3Identity, mat3Mul, mat3Inverse,
// makeLocalMatrix, computeWorldMatrices, computeEffectiveProps.
// These pure utilities back the renderer's MVP, every gizmo overlay,
// every hit-test - silent regressions here ripple everywhere.
//
// Run: node scripts/test/test_transforms.mjs

import {
  mat3Identity,
  mat3Mul,
  mat3Inverse,
  makeLocalMatrix,
  computeWorldMatrices,
  computeEffectiveProps,
} from '../../src/renderer/transforms.js';

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

function matNear(a, b, eps = 1e-6) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!near(a[i], b[i], eps)) return false;
  return true;
}

// Apply a 3×3 column-major matrix to a (x, y, 1) point.
function apply(m, x, y) {
  return [
    m[0] * x + m[3] * y + m[6],
    m[1] * x + m[4] * y + m[7],
  ];
}

// ── mat3Identity ────────────────────────────────────────────────────

{
  const I = mat3Identity();
  assert(I.length === 9, 'identity: length 9');
  assert(I[0] === 1 && I[4] === 1 && I[8] === 1, 'identity: diagonal 1');
  assert(I[1] === 0 && I[2] === 0 && I[3] === 0 && I[5] === 0 && I[6] === 0 && I[7] === 0,
    'identity: off-diagonal 0');
  assert(I instanceof Float32Array, 'identity: Float32Array');

  // Each call returns a fresh array
  const I2 = mat3Identity();
  assert(I !== I2, 'identity: fresh array per call');
}

// ── mat3Mul ────────────────────────────────────────────────────────

{
  const I = mat3Identity();
  const T = makeLocalMatrix({ x: 5, y: 7 }); // pure translation

  // I × T == T
  assert(matNear(mat3Mul(I, T), T), 'I × T = T');
  // T × I == T
  assert(matNear(mat3Mul(T, I), T), 'T × I = T');

  // Translation composes additively
  const T2 = makeLocalMatrix({ x: 3, y: -2 });
  const composed = mat3Mul(T, T2);
  // T translates by (5, 7) first (when applied right-to-left), then T2 by (3, -2)
  // wait — A × B applied to point: A × (B × p). So result of mat3Mul(T, T2)
  // applied to p means T applied AFTER T2 (T2 first).
  // T2(p) = p + (3, -2); T(T2(p)) = p + (8, 5).
  const [x, y] = apply(composed, 0, 0);
  assert(near(x, 8) && near(y, 5), 'translation composition: (3,-2) then (5,7) → (8,5)');
}

// ── mat3Inverse ────────────────────────────────────────────────────

{
  // Identity inverse is identity
  const I = mat3Identity();
  assert(matNear(mat3Inverse(I), I), 'inverse(I) = I');

  // Translation inverse negates
  const T = makeLocalMatrix({ x: 5, y: -3 });
  const Tinv = mat3Inverse(T);
  const result = mat3Mul(T, Tinv);
  assert(matNear(result, I), 'T × T⁻¹ = I');

  // Inverse round-trip: applying T then T⁻¹ to a point gives original
  const [px, py] = [10, 20];
  const [tx, ty] = apply(T, px, py);
  const [bx, by] = apply(Tinv, tx, ty);
  assert(near(bx, px) && near(by, py), 'inverse round-trip on point');

  // Singular matrix → returns identity (not NaN)
  const singular = new Float32Array([0, 0, 0,  0, 0, 0,  0, 0, 1]);
  const sInv = mat3Inverse(singular);
  assert(matNear(sInv, I), 'singular matrix → identity (graceful)');
}

// ── makeLocalMatrix ────────────────────────────────────────────────

{
  // null / undefined → identity
  const I = mat3Identity();
  assert(matNear(makeLocalMatrix(null), I), 'null transform → identity');
  assert(matNear(makeLocalMatrix(undefined), I), 'undefined transform → identity');
  assert(matNear(makeLocalMatrix({}), I), 'empty transform → identity');
}

{
  // Pure translation
  const m = makeLocalMatrix({ x: 5, y: 7 });
  const [x, y] = apply(m, 0, 0);
  assert(near(x, 5) && near(y, 7), 'translation: (0,0) → (5,7)');

  const [x2, y2] = apply(m, 3, 4);
  assert(near(x2, 8) && near(y2, 11), 'translation: (3,4) → (8,11)');
}

{
  // Pure scale (around origin)
  const m = makeLocalMatrix({ scaleX: 2, scaleY: 3 });
  const [x, y] = apply(m, 4, 5);
  assert(near(x, 8) && near(y, 15), 'scale: (4,5) → (8,15)');
}

{
  // Pure rotation (90° around origin) - (1,0) → (0,1)
  const m = makeLocalMatrix({ rotation: 90 });
  const [x, y] = apply(m, 1, 0);
  assert(near(x, 0) && near(y, 1), 'rotate 90°: (1,0) → (0,1)');
}

{
  // Pivot translation: rotating around (10, 0) keeps that point fixed
  const m = makeLocalMatrix({ rotation: 90, pivotX: 10, pivotY: 0 });
  const [x, y] = apply(m, 10, 0);
  assert(near(x, 10) && near(y, 0), 'rotate around pivot (10,0): pivot is fixed point');

  // Point at (11, 0) - one unit right of pivot - rotates 90° to (10, 1)
  const [x2, y2] = apply(m, 11, 0);
  assert(near(x2, 10) && near(y2, 1), 'rotate around pivot: (11,0) → (10,1)');
}

{
  // Translation after pivot rotation
  const m = makeLocalMatrix({ x: 100, y: 200, rotation: 90, pivotX: 10, pivotY: 0 });
  const [x, y] = apply(m, 10, 0);
  // Pivot stays put under rotation, then translate adds (100,200)
  assert(near(x, 110) && near(y, 200), 'translation + pivot rotation: pivot moves with translation');
}

// ── computeWorldMatrices ──────────────────────────────────────────

{
  // Single root-level node: world == local
  const nodes = [{ id: 'a', transform: { x: 5, y: 7 }, parent: null }];
  const wm = computeWorldMatrices(nodes);
  const [x, y] = apply(wm.get('a'), 0, 0);
  assert(near(x, 5) && near(y, 7), 'single root node: world = local');
}

{
  // Parent + child: world(child) = parent_world × child_local
  const nodes = [
    { id: 'p', transform: { x: 10, y: 0 }, parent: null },
    { id: 'c', transform: { x: 5, y: 0 }, parent: 'p' },
  ];
  const wm = computeWorldMatrices(nodes);
  const [x, y] = apply(wm.get('c'), 0, 0);
  // Child's world: translate by p (10,0) then by c (5,0) → (15, 0)
  assert(near(x, 15) && near(y, 0), 'parent+child: world is composed');
}

{
  // Out-of-order definition (child before parent): still resolves
  const nodes = [
    { id: 'c', transform: { x: 5, y: 0 }, parent: 'p' },
    { id: 'p', transform: { x: 10, y: 0 }, parent: null },
  ];
  const wm = computeWorldMatrices(nodes);
  const [x] = apply(wm.get('c'), 0, 0);
  assert(near(x, 15), 'out-of-order: depth-first resolve still works');
}

{
  // Missing parent reference → falls back to local
  const nodes = [
    { id: 'orphan', transform: { x: 7, y: 0 }, parent: 'does-not-exist' },
  ];
  const wm = computeWorldMatrices(nodes);
  const [x] = apply(wm.get('orphan'), 0, 0);
  assert(near(x, 7), 'orphan with missing parent: world = local');
}

{
  // Three-deep chain composes correctly
  const nodes = [
    { id: 'a', transform: { x: 1, y: 0 }, parent: null },
    { id: 'b', transform: { x: 2, y: 0 }, parent: 'a' },
    { id: 'c', transform: { x: 3, y: 0 }, parent: 'b' },
  ];
  const wm = computeWorldMatrices(nodes);
  const [x] = apply(wm.get('c'), 0, 0);
  assert(near(x, 6), '3-deep chain: 1+2+3 = 6');
}

// ── computeEffectiveProps ─────────────────────────────────────────

{
  // Single node, default visible
  const nodes = [{ id: 'a', visible: true, opacity: 0.8, parent: null }];
  const { visMap, opMap } = computeEffectiveProps(nodes);
  assert(visMap.get('a') === true, 'single node visible');
  assert(near(opMap.get('a'), 0.8), 'single node opacity preserved');
}

{
  // Hidden parent hides child
  const nodes = [
    { id: 'p', visible: false, opacity: 1, parent: null },
    { id: 'c', visible: true, opacity: 1, parent: 'p' },
  ];
  const { visMap } = computeEffectiveProps(nodes);
  assert(visMap.get('p') === false, 'parent hidden');
  assert(visMap.get('c') === false, 'child of hidden parent: also hidden');
}

{
  // Opacity multiplies down the chain (Photoshop-style)
  const nodes = [
    { id: 'p', visible: true, opacity: 0.5, parent: null },
    { id: 'c', visible: true, opacity: 0.5, parent: 'p' },
  ];
  const { opMap } = computeEffectiveProps(nodes);
  assert(near(opMap.get('p'), 0.5), 'parent opacity 0.5');
  assert(near(opMap.get('c'), 0.25), 'child opacity 0.5 * parent 0.5 = 0.25');
}

{
  // Default opacity = 1 when undefined
  const nodes = [{ id: 'a', parent: null }];
  const { opMap } = computeEffectiveProps(nodes);
  assert(opMap.get('a') === 1, 'default opacity = 1');
}

console.log(`transforms: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
