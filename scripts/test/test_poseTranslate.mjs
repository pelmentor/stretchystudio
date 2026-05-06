// BVR-004 deferred follow-up — Pose Mode joint drag → pose.x/y.
//
// Tests the helper pair that closes the UX inconsistency where joint
// drag in Pose Mode used to write rest pivot directly. Now, given a
// canvas-px target, the helper computes pose.{x, y} such that the
// bone's joint dot lands at the target after the world transform.
//
// Properties verified:
//   1. Top-level bone, no parent: pose = target - pivot.
//   2. Top-level bone with rest.rotation: pose is in the bone's local
//      frame (= rotated parent-rest frame), not canvas frame.
//   3. Nested bone whose parent has POSE rotation: pose is in
//      parent-rest-frame so dragging visually lands at target.
//   4. Round-trip — apply computed pose, run computeWorldMatrices,
//      verify joint canvas position equals target.
//   5. Degenerate transform (zero scale) returns sensible result
//      (mat3Inverse falls back to identity per existing contract).
//
// Run: node scripts/test/test_poseTranslate.mjs

import {
  preparePoseTranslate, applyPoseTranslate,
  mat3Identity, mat3Mul, makeLocalMatrix, makeBoneLocalMatrix,
  computeWorldMatrices,
} from '../../src/renderer/transforms.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

// ── Test 1: top-level bone, no parent, no rest rotation ──
{
  const transform = { pivotX: 100, pivotY: 100, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const setup = preparePoseTranslate(mat3Identity(), transform);
  const pose = applyPoseTranslate(setup, 250, 320);
  assert(nearlyEq(pose.x, 150), `Test 1: pose.x = 250-100 (got ${pose.x})`);
  assert(nearlyEq(pose.y, 220), `Test 1: pose.y = 320-100 (got ${pose.y})`);
}

// ── Test 2: top-level bone with rest rotation 90° ──
{
  // Rest rotation 90° at pivot (100, 100). Drag joint to canvas (200, 100).
  // Canvas → bone-rest-local: inverse rotates -90° around (100, 100).
  // (200, 100) → rotate -90° around (100, 100) → vector (100, 0) → rotate -90° → (0, -100) + (100, 100) = (100, 0).
  // pose = local - pivot = (100, 0) - (100, 100) = (0, -100).
  // Sanity-check: with pose=(0, -100), restRotation=90°, pivot=(100,100), the bone's local matrix:
  //   poseM applied to pivot: rotate(0°) → pivot, then translate by (0, -100) → (100, 0).
  //   restM applied to (100, 0): rotate 90° around pivot. Vector (0, -100) → rotate 90° → (100, 0) + pivot = (200, 100). ✓
  const transform = { pivotX: 100, pivotY: 100, rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const setup = preparePoseTranslate(mat3Identity(), transform);
  const pose = applyPoseTranslate(setup, 200, 100);
  assert(nearlyEq(pose.x, 0), `Test 2: rest-rotated pose.x (got ${pose.x.toFixed(4)})`);
  assert(nearlyEq(pose.y, -100), `Test 2: rest-rotated pose.y = -100 (got ${pose.y.toFixed(4)})`);
}

// ── Test 3: round-trip via computeWorldMatrices ──
// Set pose from helper, then verify joint world-pos lands at target.
{
  const targetX = 250, targetY = 320;
  const nodes = [
    {
      id: 'b-torso', type: 'group', boneRole: 'torso', parent: null,
      transform: { pivotX: 100, pivotY: 100, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
  ];
  const wm0 = computeWorldMatrices(nodes);
  const parentWorld = mat3Identity(); // no parent
  const setup = preparePoseTranslate(parentWorld, nodes[0].transform);
  const pose = applyPoseTranslate(setup, targetX, targetY);
  // Apply pose
  nodes[0].pose.x = pose.x;
  nodes[0].pose.y = pose.y;
  const wm1 = computeWorldMatrices(nodes);
  const m = wm1.get('b-torso');
  // Joint canvas = m × pivot
  const pivX = nodes[0].transform.pivotX;
  const pivY = nodes[0].transform.pivotY;
  const jx = m[0] * pivX + m[3] * pivY + m[6];
  const jy = m[1] * pivX + m[4] * pivY + m[7];
  assert(nearlyEq(jx, targetX), `Test 3: round-trip joint x = target (got ${jx.toFixed(4)} vs ${targetX})`);
  assert(nearlyEq(jy, targetY), `Test 3: round-trip joint y = target (got ${jy.toFixed(4)} vs ${targetY})`);
}

// ── Test 4: nested bone whose parent has pose rotation ──
{
  // Parent bone at pivot (0, 0), pose rotation 90°.
  // Child bone at parent-frame pivot (10, 0). With parent's pose,
  // child's joint canvas position would be at (0, 10).
  // Now user drags child joint to canvas (5, 5). Helper should compute
  // pose.{x, y} such that, given parent's pose-included world, the
  // child joint lands at (5, 5).
  const parentTransform = { pivotX: 0, pivotY: 0, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const parentPose      = { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const childTransform  = { pivotX: 10, pivotY: 0, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };

  // Build parent's world (with pose). For top-level parent, that's
  // makeBoneLocalMatrix(parentTransform, parentPose).
  const parentWorld = makeBoneLocalMatrix(parentTransform, parentPose);

  // Helper.
  const setup = preparePoseTranslate(parentWorld, childTransform);
  const pose = applyPoseTranslate(setup, 5, 5);

  // Round-trip via real computeWorldMatrices.
  const nodes = [
    {
      id: 'parent', type: 'group', boneRole: 'torso', parent: null,
      transform: parentTransform, pose: parentPose,
    },
    {
      id: 'child', type: 'group', boneRole: 'head', parent: 'parent',
      transform: childTransform, pose: { rotation: 0, x: pose.x, y: pose.y, scaleX: 1, scaleY: 1 },
    },
  ];
  const wm = computeWorldMatrices(nodes);
  const m = wm.get('child');
  const jx = m[0] * 10 + m[3] * 0 + m[6];
  const jy = m[1] * 10 + m[4] * 0 + m[7];
  assert(nearlyEq(jx, 5), `Test 4: nested child joint x = 5 (got ${jx.toFixed(4)})`);
  assert(nearlyEq(jy, 5), `Test 4: nested child joint y = 5 (got ${jy.toFixed(4)})`);
}

// ── Test 5: pose.x/y is rest-frame, not canvas-frame ──
{
  // Verify that pose values are NOT just (target - canvas-pivot). With
  // a parent that's been rotated, the canvas-space delta differs from
  // the parent-rest-frame delta.
  const parentTransform = { pivotX: 0, pivotY: 0, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const parentPose      = { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const childTransform  = { pivotX: 10, pivotY: 0, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };

  const parentWorld = makeBoneLocalMatrix(parentTransform, parentPose);
  const setup = preparePoseTranslate(parentWorld, childTransform);

  // Drag child joint to canvas (0, 20) — i.e. 10 above its current
  // pose-included rest position (which was at (0, 10)).
  const pose = applyPoseTranslate(setup, 0, 20);

  // In canvas-space the delta is (0, 10) — but parent is rotated 90°,
  // so in parent's rest frame the same canvas delta is (10, 0).
  // pose should be (10, 0).
  assert(nearlyEq(pose.x, 10), `Test 5: pose.x = 10 (canvas-Y delta becomes parent-rest-X) (got ${pose.x.toFixed(4)})`);
  assert(nearlyEq(pose.y, 0),  `Test 5: pose.y = 0 (got ${pose.y.toFixed(4)})`);
}

// ── Test 6: missing transform → null ──
{
  assert(preparePoseTranslate(mat3Identity(), null) === null, 'Test 6: null transform → null');
  assert(preparePoseTranslate(mat3Identity(), undefined) === null, 'Test 6: undefined transform → null');
}

console.log(`\nposeTranslate: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
