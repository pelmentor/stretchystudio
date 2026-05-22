// Proves the Cubism EXPORT bone-rotation bake (bakeBoneRotationLBS) equals
// the VIEWPORT's live linear-blend skinning (applyTwoBoneSkinning) at the
// rest grid — i.e. viewport == export for bone-baked parts (the claim Slice 2
// previously only asserted in a comment).
//
// applyTwoBoneSkinning works in canvas-px; bakeBoneRotationLBS works in the
// keyform-local frame with `scaleX`/`scaleY` mapping local→canvas. The
// algebra: bakeLocal mapped to canvas == lerp(canvasRest, canvasFullRotated,
// w) == applyTwoBoneSkinning(canvasRest, identity, R(angle)) — the scale
// cancels, so they match for ANY scaleX/scaleY (deformer-px AND anisotropic
// warp-local).
//
// Run: node scripts/test/test_bakeBoneRotation.mjs

import { bakeBoneRotationLBS } from '../../src/io/live2d/rig/bakeBoneRotation.js';
import { applyTwoBoneSkinning } from '../../src/renderer/boneSkinning.js';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function near(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

// Rotation-around-pivot matrix in applyTwoBoneSkinning's layout
// (x' = m0·x + m3·y + m6 ; y' = m1·x + m4·y + m7).
function rotAroundPivot(angleDeg, px, py) {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const m = new Float32Array(9);
  m[0] = c;  m[3] = -s; m[6] = px - (c * px - s * py);
  m[1] = s;  m[4] = c;  m[7] = py - (s * px + c * py);
  m[8] = 1;
  return m;
}

// ── 1. Deformer-px (scaleX=scaleY=1): bake == applyTwoBoneSkinning, exact ──
{
  const verts = [10, 0, 20, 5, 30, -5, 0, 0];
  const n = 4;
  const weights = [1, 0.5, 0.25, 0];
  const px = 12, py = 3;
  const angle = 37;

  const baked = bakeBoneRotationLBS(verts, n, weights, px, py, 1, 1, angle);

  const lbs = new Float32Array(verts);
  applyTwoBoneSkinning(lbs, null /* parent identity */, rotAroundPivot(angle, px, py), weights);

  let ok = true;
  for (let i = 0; i < n * 2; i++) if (!near(baked[i], lbs[i])) ok = false;
  assert(ok, `deformer-px: bake == applyTwoBoneSkinning (baked=${baked.map((v) => v.toFixed(2))} lbs=${Array.from(lbs).map((v) => v.toFixed(2))})`);
  // Non-vacuous: weight 1 vert actually rotated; weight 0 vert pinned.
  assert(!near(baked[0], verts[0]) || !near(baked[1], verts[1]), 'deformer-px: w=1 vert moved');
  assert(near(baked[6], verts[6]) && near(baked[7], verts[7]), 'deformer-px: w=0 vert pinned');
}

// ── 2. Anisotropic warp-local (scaleX≠scaleY): bake→canvas == LBS canvas ──
{
  // Warp box: gridMin (100, 50), gridW=400, gridH=200. Local verts in 0..1.
  const gridMinX = 100, gridMinY = 50, gridW = 400, gridH = 200;
  const vertsLocal = [0.25, 0.5, 0.75, 0.25, 0.5, 0.9, 0.1, 0.1];
  const n = 4;
  const weights = [1, 0.6, 0.3, 0];
  const pivotCanvasX = 260, pivotCanvasY = 130;
  const pivotLocalX = (pivotCanvasX - gridMinX) / gridW;
  const pivotLocalY = (pivotCanvasY - gridMinY) / gridH;
  const angle = -52;

  const bakedLocal = bakeBoneRotationLBS(
    vertsLocal, n, weights, pivotLocalX, pivotLocalY, gridW, gridH, angle,
  );

  // Map rest verts → canvas, run canvas-px LBS, and compare to the bake
  // mapped local→canvas. (local→canvas: canvas = gridMin + local·grid.)
  const toCanvas = (lx, ly) => [gridMinX + lx * gridW, gridMinY + ly * gridH];
  const vertsCanvas = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = toCanvas(vertsLocal[i * 2], vertsLocal[i * 2 + 1]);
    vertsCanvas[i * 2] = cx; vertsCanvas[i * 2 + 1] = cy;
  }
  applyTwoBoneSkinning(vertsCanvas, null, rotAroundPivot(angle, pivotCanvasX, pivotCanvasY), weights);

  let ok = true;
  for (let i = 0; i < n; i++) {
    const [bcx, bcy] = toCanvas(bakedLocal[i * 2], bakedLocal[i * 2 + 1]);
    if (!near(bcx, vertsCanvas[i * 2], 1e-3) || !near(bcy, vertsCanvas[i * 2 + 1], 1e-3)) ok = false;
  }
  assert(ok, 'warp-local anisotropic: bake→canvas == applyTwoBoneSkinning canvas (scale cancels — viewport==export holds under a warp box)');
}

// ── 3. LBS chord ≠ arc at intermediate weight (the model actually changed) ──
{
  const verts = [10, 0];
  const weights = [0.5];
  const angle = 90;
  const baked = bakeBoneRotationLBS(verts, 1, weights, 0, 0, 1, 1, angle);
  // LBS chord: lerp(rest (10,0), full-rot-90 (0,10), 0.5) = (5, 5).
  assert(near(baked[0], 5) && near(baked[1], 5), `chord: w=0.5 → (5,5) (got ${baked.map((v) => v.toFixed(2))})`);
  // Arc would be rotate-by-45° = (7.07, 7.07) — confirm we are NOT that.
  assert(!near(baked[0], 7.07, 0.05), 'chord: NOT the old arc (rotate by angle×weight)');
}

console.log(`bakeBoneRotation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
