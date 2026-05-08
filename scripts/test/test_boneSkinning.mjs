// Per-vertex weighted bone skinning (`renderer/boneSkinning.js`).
//
// Linear blend skinning for the BONE_ARMATURE_INDEPENDENCE pipeline
// (docs/plans/BONE_ARMATURE_INDEPENDENCE.md). Tests cover:
//   1. Identity matrix → positions unchanged regardless of weights.
//   2. Full-weight (1.0 everywhere) → equivalent to applying matrix
//      directly (matches the overlay path's effect).
//   3. Zero-weight (0.0 everywhere) → positions unchanged.
//   4. Mixed weights (0.5) → vertices land halfway between in/out.
//   5. Per-vertex weights ([1, 0, 1, 0]) → only odd-indexed vertices rotate.
//   6. Pivot-around: rotation around the bone pivot preserves the pivot
//      point itself.
//   7. buildBoneSkinningMatrix returns identity for at-rest bones.
//   8. buildBoneSkinningMatrix returns a non-identity matrix when
//      pose.rotation is non-zero.
//
// Run: node scripts/test/test_boneSkinning.mjs

import {
  applyWeightedSkinning,
  applyWeightedSkinningObj,
  isIdentityMatrix,
} from '../../src/renderer/boneSkinning.js';
import { computeBoneWorldMatrices } from '../../src/renderer/boneOverlayMatrix.js';
import { mat3Identity } from '../../src/renderer/transforms.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function arrEq(a, b, eps = 1e-5) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!approx(a[i], b[i], eps)) return false;
  return true;
}

// ── 1. Identity matrix → positions unchanged regardless of weights ─

{
  const positions = new Float32Array([10, 20, 30, 40, 50, 60]);
  const weights = [1, 0.5, 0];
  const before = Array.from(positions);
  applyWeightedSkinning(positions, mat3Identity(), weights);
  assert(arrEq(Array.from(positions), before),
    'identity matrix: positions unchanged');
}

// ── 2. Full-weight 1.0 → equivalent to direct matrix apply ─

{
  // 90° rotation around (0, 0): (x, y) → (-y, x)
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  const positions = new Float32Array([10, 0, 0, 10, 5, 5]);
  const weights = [1, 1, 1];
  applyWeightedSkinning(positions, m, weights);
  assert(approx(positions[0], 0) && approx(positions[1], 10), 'full-weight v0: (10,0) → (0,10)');
  assert(approx(positions[2], -10) && approx(positions[3], 0), 'full-weight v1: (0,10) → (-10,0)');
  assert(approx(positions[4], -5) && approx(positions[5], 5), 'full-weight v2: (5,5) → (-5,5)');
}

// ── 3. Zero-weight 0.0 → positions unchanged ─

{
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  const positions = new Float32Array([10, 0, 0, 10]);
  const before = Array.from(positions);
  const weights = [0, 0];
  applyWeightedSkinning(positions, m, weights);
  assert(arrEq(Array.from(positions), before),
    'zero-weight: positions unchanged despite non-identity matrix');
}

// ── 4. Mixed weights 0.5 → halfway between in/out ─

{
  // 90° rotation around (0,0): (10, 0) → (0, 10) at full rotation.
  // At weight 0.5: lerp((10,0), (0,10), 0.5) = (5, 5).
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  const positions = new Float32Array([10, 0]);
  const weights = [0.5];
  applyWeightedSkinning(positions, m, weights);
  assert(approx(positions[0], 5) && approx(positions[1], 5),
    'half-weight: (10,0) → halfway to (0,10) = (5,5)');
}

// ── 5. Per-vertex weights — alternating 1/0 ─

{
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  const positions = new Float32Array([10, 0, 20, 0, 30, 0, 40, 0]);
  const weights = [1, 0, 1, 0];
  applyWeightedSkinning(positions, m, weights);
  // Even indices rotate (10, 0) → (0, 10), (30, 0) → (0, 30)
  assert(approx(positions[0], 0) && approx(positions[1], 10), 'alt[0]: rotated');
  assert(approx(positions[2], 20) && approx(positions[3], 0),  'alt[1]: untouched');
  assert(approx(positions[4], 0) && approx(positions[5], 30), 'alt[2]: rotated');
  assert(approx(positions[6], 40) && approx(positions[7], 0),  'alt[3]: untouched');
}

// ── 6. Pivot preservation (via computeBoneWorldMatrices) ─

{
  // Rotate 45° around pivot (100, 200). The pivot vertex itself should
  // be invariant regardless of weight (lerp(pivot, M·pivot, w) = pivot
  // because M·pivot = pivot for a rotation around pivot).
  const nodes = [
    {
      id: 'b-arm', type: 'group', boneRole: 'leftArm',
      transform: { pivotX: 100, pivotY: 200 },
      pose: { rotation: 45, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
  ];
  const boneWorld = computeBoneWorldMatrices(nodes);
  const m = boneWorld.get('b-arm');
  assert(!!m, 'world map has bone entry');

  // Pivot vertex with weight 1.0 should stay at pivot.
  const positions = new Float32Array([100, 200]);
  applyWeightedSkinning(positions, m, [1]);
  assert(approx(positions[0], 100) && approx(positions[1], 200),
    'pivot-preserve weight=1: rotation around pivot fixes the pivot point');

  // Same with weight 0.5 — lerp(pivot, pivot, 0.5) = pivot.
  const positions2 = new Float32Array([100, 200]);
  applyWeightedSkinning(positions2, m, [0.5]);
  assert(approx(positions2[0], 100) && approx(positions2[1], 200),
    'pivot-preserve weight=0.5: lerp(pivot, pivot, w) = pivot for any w');
}

// ── 7. computeBoneWorldMatrices: ancestor pose composes through chain ─

{
  // Critical regression case for arm-pieces-don't-move-when-leftArm-rotates.
  // leftElbow is parented to leftArm. leftElbow.pose = identity.
  // leftArm.pose.rotation = 90°. leftElbow's WORLD must include the 90°.
  const nodes = [
    {
      id: 'leftArm', type: 'group', boneRole: 'leftArm',
      transform: { pivotX: 0, pivotY: 0 },
      pose: { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    {
      id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
      transform: { pivotX: 100, pivotY: 0 },
      pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
  ];
  const boneWorld = computeBoneWorldMatrices(nodes);
  const armMat = boneWorld.get('leftArm');
  const elbowMat = boneWorld.get('leftElbow');

  // leftArm rotates 90° around (0, 0) → (1, 0) lands at (0, 1).
  const armProbe = new Float32Array([1, 0]);
  applyWeightedSkinning(armProbe, armMat, [1]);
  assert(approx(armProbe[0], 0) && approx(armProbe[1], 1),
    'leftArm world: (1,0) rotates 90° around (0,0) → (0,1)');

  // leftElbow has identity pose, but its WORLD = leftArm.world * leftElbow.local.
  // leftElbow.local is identity (pose all zero), so elbowWorld = armWorld.
  // Apply to the elbow's pivot (100, 0): leftArm rotation of 90° around (0,0)
  // sends (100, 0) → (0, 100).
  const elbowProbe = new Float32Array([100, 0]);
  applyWeightedSkinning(elbowProbe, elbowMat, [1]);
  assert(approx(elbowProbe[0], 0) && approx(elbowProbe[1], 100),
    'leftElbow world: ancestor leftArm pose composes through (the bug fix)');
}

// ── 8. computeBoneWorldMatrices: at-rest chain returns identity ─

{
  const nodes = [
    {
      id: 'b1', type: 'group', boneRole: 'leftArm',
      transform: { pivotX: 50, pivotY: 60 },
      pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
  ];
  const boneWorld = computeBoneWorldMatrices(nodes);
  const m = boneWorld.get('b1');
  assert(isIdentityMatrix(m),
    'rest bone (rotation=0, x=y=0, scale=1) → identity world matrix');
}

// ── 9. Object-vert variant (applyWeightedSkinningObj) ─

{
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  const verts = [
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
  applyWeightedSkinningObj(verts, m, [1, 0]);
  assert(approx(verts[0].x, 0) && approx(verts[0].y, 10),
    'obj variant v0 weight=1: rotated');
  assert(approx(verts[1].x, 0) && approx(verts[1].y, 10),
    'obj variant v1 weight=0: unchanged');
}

// ── 10. Defensive: missing weights / matrix → no-op ─

{
  const positions = new Float32Array([10, 20, 30, 40]);
  const before = Array.from(positions);
  applyWeightedSkinning(positions, null, [1, 1]);
  assert(arrEq(Array.from(positions), before), 'null matrix → no-op');
  applyWeightedSkinning(positions, mat3Identity(), null);
  assert(arrEq(Array.from(positions), before), 'null weights → no-op');

  // Weights too short → no-op (defensive).
  const rad = Math.PI / 2;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rotMatrix = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  applyWeightedSkinning(positions, rotMatrix, [1]);
  assert(arrEq(Array.from(positions), before),
    'weights shorter than positions → no-op (defensive against malformed input)');
}

console.log(`boneSkinning: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
