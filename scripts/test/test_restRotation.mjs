// BVR-004 follow-up — rest.rotation for bones (Armature Edit Mode).
//
// Properties verified:
//   1. readRestValue on a bone reads transform.{pivotX, pivotY,
//      rotation, scaleX, scaleY} via the {x, y, rotation, scaleX,
//      scaleY} key set (matches the modal's pose-shape API).
//   2. writeRestValues on a bone writes transform.* (rest), not pose.
//   3. readRestValue / writeRestValues on a non-bone fall through to
//      the pose-frame helpers (= just transform).
//   4. makeBoneLocalMatrix with non-zero transform.rotation rotates
//      the bone's rest matrix around its pivot (Blender Edit Mode
//      semantics — rest absorbs the rotation).
//   5. With BOTH non-zero rest.rotation AND non-zero pose.rotation,
//      the world matrix composes: rotate-rest-then-rotate-pose,
//      both around the same pivot.
//
// Run: node scripts/test/test_restRotation.mjs

import {
  readRestValue, writeRestValues,
  readPoseValue,
} from '../../src/renderer/animationEngine.js';
import { makeBoneLocalMatrix, computeWorldMatrices } from '../../src/renderer/transforms.js';

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

// ── Test 1: readRestValue on a bone reads transform fields ──
{
  const bone = {
    type: 'group', boneRole: 'torso',
    transform: { pivotX: 100, pivotY: 200, rotation: 30, x: 5, y: 7, scaleX: 1.5, scaleY: 0.8 },
    pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
  };
  assert(readRestValue(bone, 'x')        === 100, `Test 1: x → pivotX (got ${readRestValue(bone, 'x')})`);
  assert(readRestValue(bone, 'y')        === 200, `Test 1: y → pivotY (got ${readRestValue(bone, 'y')})`);
  assert(readRestValue(bone, 'rotation') === 30,  `Test 1: rotation → transform.rotation`);
  assert(readRestValue(bone, 'scaleX')   === 1.5, `Test 1: scaleX → transform.scaleX`);
  assert(readRestValue(bone, 'scaleY')   === 0.8, `Test 1: scaleY → transform.scaleY`);
}

// ── Test 2: writeRestValues on a bone writes transform.* (not pose) ──
{
  const bone = {
    type: 'group', boneRole: 'torso',
    transform: { pivotX: 100, pivotY: 200, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
  };
  writeRestValues(bone, { x: 150, y: 250, rotation: 45, scaleX: 2.0, scaleY: 0.5 });
  assert(bone.transform.pivotX === 150, `Test 2: pivotX written (got ${bone.transform.pivotX})`);
  assert(bone.transform.pivotY === 250, `Test 2: pivotY written`);
  assert(bone.transform.rotation === 45, `Test 2: rest rotation written`);
  assert(bone.transform.scaleX === 2.0, `Test 2: rest scaleX written`);
  assert(bone.transform.scaleY === 0.5, `Test 2: rest scaleY written`);
  // pose untouched
  assert(bone.pose.rotation === 0, `Test 2: pose untouched`);
  assert(bone.pose.x === 0, `Test 2: pose.x untouched`);
}

// ── Test 3: non-bone — readRestValue / writeRestValues fall back ──
{
  const part = {
    type: 'part',
    transform: { x: 100, y: 200, rotation: 30, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  };
  // For non-bones, rest === pose === transform. readRestValue should
  // return the same as readPoseValue.
  assert(readRestValue(part, 'x') === readPoseValue(part, 'x'), 'Test 3: non-bone read parity (x)');
  assert(readRestValue(part, 'rotation') === 30, 'Test 3: non-bone rotation');
  writeRestValues(part, { x: 150, rotation: 60 });
  assert(part.transform.x === 150, 'Test 3: non-bone write lands on transform.x');
  assert(part.transform.rotation === 60, 'Test 3: non-bone write lands on transform.rotation');
}

// ── Test 4: makeBoneLocalMatrix with non-zero rest.rotation ──
{
  // Bone at pivot (100, 100), rest rotation 90°, pose identity.
  // A point at the bone's pivot should stay at pivot; a point offset
  // by (1, 0) in the bone's local frame should land at pivot + (0, 1).
  const transform = { pivotX: 100, pivotY: 100, rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const m = makeBoneLocalMatrix(transform, pose);
  // Apply to pivot (100, 100): should stay at (100, 100).
  const px = m[0] * 100 + m[3] * 100 + m[6];
  const py = m[1] * 100 + m[4] * 100 + m[7];
  assert(nearlyEq(px, 100), `Test 4: pivot stays (got ${px.toFixed(4)})`);
  assert(nearlyEq(py, 100), `Test 4: pivot stays Y (got ${py.toFixed(4)})`);
  // Apply to (101, 100) → 90° rotation around (100, 100) sends it to (100, 101).
  const qx = m[0] * 101 + m[3] * 100 + m[6];
  const qy = m[1] * 101 + m[4] * 100 + m[7];
  assert(nearlyEq(qx, 100), `Test 4: (101,100) → x=100 after 90° rest rotation (got ${qx.toFixed(4)})`);
  assert(nearlyEq(qy, 101), `Test 4: (101,100) → y=101 (got ${qy.toFixed(4)})`);
}

// ── Test 5: rest.rotation + pose.rotation compose around shared pivot ──
{
  // Rest 30°, pose 60° → total 90° around pivot.
  const transform = { pivotX: 100, pivotY: 100, rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const pose = { rotation: 60, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const m = makeBoneLocalMatrix(transform, pose);
  // (101, 100) under 90° around (100, 100) → (100, 101)
  const qx = m[0] * 101 + m[3] * 100 + m[6];
  const qy = m[1] * 101 + m[4] * 100 + m[7];
  assert(nearlyEq(qx, 100), `Test 5: rest+pose composed → x=100 (got ${qx.toFixed(4)})`);
  assert(nearlyEq(qy, 101), `Test 5: rest+pose composed → y=101 (got ${qy.toFixed(4)})`);
}

// ── Test 6: world matrix integration — child of rotated bone ──
{
  // Parent bone with rest rotation 90° at pivot (0, 0); child bone
  // pivot at (10, 0) in parent's local frame. Expected world pivot
  // of child after parent's rest: 90° rotation of (10, 0) around (0, 0)
  // = (0, 10).
  const nodes = [
    {
      id: 'parent', type: 'group', boneRole: 'torso', parent: null,
      transform: { pivotX: 0, pivotY: 0, rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    {
      id: 'child', type: 'group', boneRole: 'head', parent: 'parent',
      transform: { pivotX: 10, pivotY: 0, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
  ];
  const wm = computeWorldMatrices(nodes);
  const child = wm.get('child');
  // Joint dot rendering = `nodeWorldMatrix × pivot` (per SkeletonOverlay).
  // Child's pivot is (10, 0) in parent's frame; parent is 90° around
  // (0, 0); so joint canvas pos = (0, 10).
  const px = 10, py = 0;
  const jx = child[0] * px + child[3] * py + child[6];
  const jy = child[1] * px + child[4] * py + child[7];
  assert(nearlyEq(jx, 0), `Test 6: child joint canvas x=0 after parent 90° rest rotation (got ${jx.toFixed(4)})`);
  assert(nearlyEq(jy, 10), `Test 6: child joint canvas y=10 (got ${jy.toFixed(4)})`);
}

console.log(`\nrestRotation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
