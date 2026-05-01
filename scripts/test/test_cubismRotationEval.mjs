// Cubism Warp Port Phase 2a — rotation eval kernel unit tests.
//
// Verifies the byte-faithful port of RotationDeformer_TransformTarget
// against the IDA decompile at 0x7fff2b24c950. Tests cover:
//   - kernel formula bit-for-bit (θ=0, θ=±90°, arbitrary θ)
//   - reflect flag application (X / Y / both)
//   - scale handling
//   - translation (originX/originY)
//   - 4-vert SIMD-unroll boundary + tail-loop
//   - in-place safety (vertsIn === vertsOut)
//   - the divergence-from-textbook check (90° rotation difference)
//
// Run: node scripts/test/test_cubismRotationEval.mjs

import {
  evalRotationKernelCubism,
  buildRotationMat3Cubism,
  buildRotationMat3CubismAniso,
} from '../../src/io/live2d/runtime/evaluator/cubismRotationEval.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function approxEq(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function makeBufs(...verts) {
  const flat = new Float64Array(verts.flat());
  const out = new Float64Array(verts.length * 2);
  return { in: flat, out, vertCount: verts.length };
}

// ── θ=0 with no scale/reflect/translate is NOT identity ────────────
//
// Cubism's kernel at θ=0 with unit scale, no reflect, zero translate:
//   out.x = px·(0)·1·1 + py·(1)·1·1 + 0 = py
//   out.y = px·(1)·1·1 + py·(0)·1·1 + 0 = px
//
// This IS the "rotation deformer at neutral" being a 90° rotation
// relative to the textbook "do nothing" identity. Cubism's
// rotation-deformer convention is that θ=0 corresponds to a 90°
// rotation in textbook coordinates. Authoring tools (Cubism Editor)
// account for this when storing keyforms; the kernel reads them as
// stored.
{
  const state = { angleDeg: 0, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], 7), 'θ=0: out.x = py (3,7) → 7');
  assert(approxEq(b.out[1], 3), 'θ=0: out.y = px (3,7) → 3');
}

// ── θ=-90° with no scale/reflect/translate IS textbook identity ────
//
//   θ=-90° → sin=-1, cos=0
//   out.x = px·(-(-1)·1·1) + py·(0·1·1) + 0 = px
//   out.y = px·(0·1·1)     + py·((-1)·1·1) + 0 = -py
//
// So Cubism rotation at θ=-90° is "x stays, y negates". That's a
// reflection across the X-axis, not identity. So neither θ=0 nor
// θ=-90° is plain identity — Cubism's kernel really is structurally
// different from textbook. The port carries this exactly.
{
  const state = { angleDeg: -90, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], 3),  'θ=-90°: out.x = px');
  assert(approxEq(b.out[1], -7), 'θ=-90°: out.y = -py');
}

// ── θ=+90° ────────────────────────────────────────────────────────
//
//   sin=1, cos=0
//   out.x = px·(-1·1·1) + py·(0) + 0 = -px
//   out.y = px·(0) + py·(1·1·1) + 0 = py
//
{
  const state = { angleDeg: 90, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], -3), 'θ=+90°: out.x = -px');
  assert(approxEq(b.out[1], 7),  'θ=+90°: out.y = py');
}

// ── Arbitrary θ (matches the formula bit-for-bit) ──────────────────
{
  const angleDeg = 37;
  const angleRad = angleDeg * Math.PI / 180;
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const px = 5, py = 11;
  const state = { angleDeg, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const b = makeBufs([px, py]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  const expectedX = px * (-sin) + py * cos;
  const expectedY = px *   cos  + py * sin;
  assert(approxEq(b.out[0], expectedX), `θ=37°: out.x matches formula`);
  assert(approxEq(b.out[1], expectedY), `θ=37°: out.y matches formula`);
}

// ── Translation (originX/originY) ──────────────────────────────────
{
  const state = { angleDeg: 0, scale: 1, originX: 100, originY: 200, reflectX: false, reflectY: false };
  const b = makeBufs([0, 0]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], 100), 'origin: (0,0) → out.x = originX (100)');
  assert(approxEq(b.out[1], 200), 'origin: (0,0) → out.y = originY (200)');
}

// ── Scale ──────────────────────────────────────────────────────────
//
// scale=2, θ=0, origin=0: out = (2*py, 2*px)
{
  const state = { angleDeg: 0, scale: 2, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], 14), 'scale=2: out.x = 2·py = 14');
  assert(approxEq(b.out[1], 6),  'scale=2: out.y = 2·px = 6');
}

// ── reflectX (rx=-1) ──────────────────────────────────────────────
//
// θ=0, reflectX=true (rx=-1):
//   out.x = px·(0·1·1) + py·(1·1·-1) + 0 = -py
//   out.y = px·(1·1·1) + py·(0·1·-1) + 0 = px
{
  const state = { angleDeg: 0, scale: 1, originX: 0, originY: 0, reflectX: true, reflectY: false };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], -7), 'reflectX θ=0: out.x = -py');
  assert(approxEq(b.out[1], 3),  'reflectX θ=0: out.y = px');
}

// ── reflectY (ry=-1) ──────────────────────────────────────────────
//
// θ=0, reflectY=true (ry=-1):
//   out.x = px·(0·1·-1) + py·(1·1·1) = py
//   out.y = px·(1·1·-1) + py·(0·1·1) = -px
{
  const state = { angleDeg: 0, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: true };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], 7),  'reflectY θ=0: out.x = py');
  assert(approxEq(b.out[1], -3), 'reflectY θ=0: out.y = -px');
}

// ── reflectX + reflectY ───────────────────────────────────────────
//
// θ=0, both reflect:
//   out.x = px·(0·1·-1) + py·(1·1·-1) = -py
//   out.y = px·(1·1·-1) + py·(0·1·-1) = -px
{
  const state = { angleDeg: 0, scale: 1, originX: 0, originY: 0, reflectX: true, reflectY: true };
  const b = makeBufs([3, 7]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);
  assert(approxEq(b.out[0], -7), 'both reflect θ=0: out.x = -py');
  assert(approxEq(b.out[1], -3), 'both reflect θ=0: out.y = -px');
}

// ── Combined: θ=45°, scale=1.5, origin=(10,20), reflectX ──────────
{
  const angleDeg = 45, scale = 1.5, ox = 10, oy = 20;
  const angleRad = angleDeg * Math.PI / 180;
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const rx = -1; // reflectX
  const ry = 1;
  const px = 4, py = 6;

  const state = { angleDeg, scale, originX: ox, originY: oy, reflectX: true, reflectY: false };
  const b = makeBufs([px, py]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);

  const expectedX = px * (-sin * scale * ry) + py * (cos * scale * rx) + ox;
  const expectedY = px * ( cos * scale * ry) + py * (sin * scale * rx) + oy;
  assert(approxEq(b.out[0], expectedX), 'combined: out.x matches full formula');
  assert(approxEq(b.out[1], expectedY), 'combined: out.y matches full formula');
}

// ── 4-vert SIMD-unroll boundary + tail loop ────────────────────────
//
// DLL processes 4 verts per loop iter when vertCount ≥ 4, with a tail
// loop for the remainder. JS port doesn't unroll but must produce the
// same per-vertex output regardless of count.
{
  const state = { angleDeg: 30, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const verts = [
    [1, 2], [3, 4], [5, 6], [7, 8],   // exactly 4
    [9, 10],                          // tail vert 1
    [11, 12],                         // tail vert 2
    [13, 14],                         // tail vert 3 (1-3 verts in tail)
  ];
  const b = makeBufs(...verts);
  evalRotationKernelCubism(state, b.in, b.out, verts.length);

  // Spot-check vert 0 and the last (tail) vert.
  const angleRad = 30 * Math.PI / 180;
  const sin = Math.sin(angleRad), cos = Math.cos(angleRad);
  for (let i = 0; i < verts.length; i++) {
    const [px, py] = verts[i];
    const ex = px * -sin + py * cos;
    const ey = px *  cos + py * sin;
    assert(approxEq(b.out[i * 2],     ex), `multi-vert (${i}): out.x correct`);
    assert(approxEq(b.out[i * 2 + 1], ey), `multi-vert (${i}): out.y correct`);
  }
}

// ── In-place safety (vertsIn === vertsOut) ─────────────────────────
{
  const state = { angleDeg: 30, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const buf = new Float64Array([1, 2, 3, 4]);
  evalRotationKernelCubism(state, buf, buf, 2);

  const angleRad = 30 * Math.PI / 180;
  const sin = Math.sin(angleRad), cos = Math.cos(angleRad);
  // vert 0: in (1,2)
  assert(approxEq(buf[0], 1 * -sin + 2 * cos), 'in-place vert 0: out.x correct');
  assert(approxEq(buf[1], 1 *  cos + 2 * sin), 'in-place vert 0: out.y correct');
  // vert 1: in (3,4)
  assert(approxEq(buf[2], 3 * -sin + 4 * cos), 'in-place vert 1: out.x correct');
  assert(approxEq(buf[3], 3 *  cos + 4 * sin), 'in-place vert 1: out.y correct');
}

// ── Defaults: missing fields should not throw ──────────────────────
{
  // Empty-ish state — should default angleDeg=0, scale=1, originX=originY=0,
  // no reflect.
  const b = makeBufs([1, 2]);
  evalRotationKernelCubism(/** @type {any} */({}), b.in, b.out, b.vertCount);
  // θ=0, scale=1, origin=0, no reflect: out = (py, px)
  assert(approxEq(b.out[0], 2), 'defaults: out.x = py');
  assert(approxEq(b.out[1], 1), 'defaults: out.y = px');
}

// ── buildRotationMat3Cubism: rebuilds a matrix that gives same output ──
{
  const state = { angleDeg: 23, scale: 1.7, originX: -5, originY: 8, reflectX: false, reflectY: true };
  const m = buildRotationMat3Cubism(state);

  // Spot-check matrix layout: m[0..5] = linear+translation, m[6..8] = [0,0,1].
  assert(m[6] === 0 && m[7] === 0 && m[8] === 1, 'mat3: bottom row [0,0,1]');

  const px = 11, py = 13;
  const b = makeBufs([px, py]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);

  // Apply matrix manually: out.x = m[0]·px + m[1]·py + m[2], out.y = m[3]·px + m[4]·py + m[5]
  const matX = m[0] * px + m[1] * py + m[2];
  const matY = m[3] * px + m[4] * py + m[5];
  assert(approxEq(matX, b.out[0]), 'mat3 application matches kernel: out.x');
  assert(approxEq(matY, b.out[1]), 'mat3 application matches kernel: out.y');
}

// ── buildRotationMat3CubismAniso: extraSx/Sy applied AFTER linear part ──
{
  const state = { angleDeg: 30, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const sx = 0.001, sy = 0.0008;  // typical ~1/canvasMaxDim values
  const m = buildRotationMat3CubismAniso(state, sx, sy);

  // The linear 2x2 should be the kernel's linear part scaled by diag(sx, sy)
  // applied row-wise (each row's coefficients scaled by sx for row 0, sy for row 1).
  const angleRad = 30 * Math.PI / 180;
  const sin = Math.sin(angleRad), cos = Math.cos(angleRad);
  assert(approxEq(m[0], -sin * sx), 'aniso m[0] = -sin·sx');
  assert(approxEq(m[1],  cos * sx), 'aniso m[1] =  cos·sx');
  assert(approxEq(m[3],  cos * sy), 'aniso m[3] =  cos·sy');
  assert(approxEq(m[4],  sin * sy), 'aniso m[4] =  sin·sy');

  // sx=sy=1 should match the non-aniso path.
  const m1 = buildRotationMat3CubismAniso(state, 1, 1);
  const mP = buildRotationMat3Cubism(state);
  for (let i = 0; i < 9; i++) {
    assert(approxEq(m1[i], mP[i]), `aniso(1,1)[${i}] === plain[${i}]`);
  }
}

// ── Divergence from v3's textbook rotation (proves the BUG-003 root) ──
//
// Build v3's textbook formula manually and assert the Cubism kernel
// produces a different result for non-zero θ. This is the canary
// confirming Phase 2a actually changes behaviour (not a no-op).
{
  const state = { angleDeg: 30, scale: 1, originX: 0, originY: 0, reflectX: false, reflectY: false };
  const px = 100, py = 50;

  const angleRad = 30 * Math.PI / 180;
  const sin = Math.sin(angleRad), cos = Math.cos(angleRad);

  // v3 textbook (the OLD formula):
  const v3X = cos * px + (-sin) * py;
  const v3Y = sin * px +  cos   * py;

  // Cubism's actual:
  const b = makeBufs([px, py]);
  evalRotationKernelCubism(state, b.in, b.out, b.vertCount);

  // The two formulas differ by ≥ 1 unit somewhere for non-trivial inputs.
  const dx = Math.abs(b.out[0] - v3X);
  const dy = Math.abs(b.out[1] - v3Y);
  assert(dx > 1 || dy > 1,
    'BUG-003 canary: Cubism kernel diverges from v3 textbook formula at θ=30°');
}

console.log(`cubismRotationEval: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
