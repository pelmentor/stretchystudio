// Bone overlay matrix unit tests.
//
// `computeBoneOverlayMatrices` produces per-part overlay matrices that
// compose ancestor bone-group `pose` offsets on top of rig output.
// Three properties to verify:
//
//   1. Bones with identity pose contribute identity → no overlay entry.
//   2. Non-rig-driven bones with non-identity pose contribute their
//      pose-around-pivot. Multi-bone chains compose.
//   3. Rig-driven bones (those with a `ParamRotation_<sanitised>` param)
//      contribute identity REGARDLESS of pose data — defensive check
//      for legacy projects with non-zero transform.rotation.
//
// Run: node scripts/test/test_boneOverlayMatrix.mjs

import { computeBoneOverlayMatrices } from '../../src/renderer/boneOverlayMatrix.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function applyMat(m, x, y) {
  return [
    m[0] * x + m[3] * y + m[6],
    m[1] * x + m[4] * y + m[7],
  ];
}

// ── Test 1: All-rest bones produce no overlay entries ───────────────
{
  const nodes = [
    { id: 'b-root',  type: 'group', boneRole: 'root',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0,   pivotY: 0   },
      pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'b-torso', type: 'group', boneRole: 'torso', parent: 'b-root',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
      pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-face', type: 'part', parent: 'b-torso',
      mesh: { vertices: [{ x: 100, y: 200 }] },
    },
  ];
  const out = computeBoneOverlayMatrices(nodes);
  assert(out.size === 0, 'Test 1: identity-pose chain produces no overlay entries');
}

// ── Test 2: Single non-driver bone with pose rotates descendants ────
{
  const nodes = [
    { id: 'b-torso', type: 'group', boneRole: 'torso',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
      pose:      { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-shirt', type: 'part', parent: 'b-torso',
      mesh: { vertices: [{ x: 600, y: 800 }] },
    },
  ];
  const out = computeBoneOverlayMatrices(nodes);
  assert(out.size === 1, 'Test 2: posed bone produces an overlay entry for descendant');
  const m = out.get('p-shirt');
  assert(!!m, 'Test 2: shirt has overlay matrix');
  // Rotate (600, 800) by 90° around (500, 800) → (500, 900)
  const [nx, ny] = applyMat(m, 600, 800);
  assert(nearlyEq(nx, 500), `Test 2: rotated x ≈ 500 (got ${nx})`);
  assert(nearlyEq(ny, 900), `Test 2: rotated y ≈ 900 (got ${ny})`);
}

// ── Test 3: Two-bone chain composes (parent and child both posed) ──
{
  // root@(0,0) identity, torso@(500,800) pose R30°, head@(500,400) pose R10°.
  // A vertex of a face mesh under head, at canvas (500, 200):
  //   1. head local matrix rotates around (500, 400) by 10° in torso's
  //      frame (= canvas here). A point at (500, 200) is 200px above
  //      head pivot; rotated by 10°: cos10°·0 - sin10°·(-200) = 200·sin10°
  //      ≈ 34.73 in x; sin10°·0 + cos10°·(-200) = -200·cos10° ≈ -196.96 in y.
  //      Result: (500 + 34.73, 400 - 196.96) = (534.73, 203.04).
  //   2. torso world matrix rotates that around (500, 800) by 30°.
  //      Vector from (500,800) to (534.73, 203.04) is (34.73, -596.96).
  //      Rotated 30°: (34.73·cos30° - (-596.96)·sin30°, 34.73·sin30° + (-596.96)·cos30°)
  //      = (34.73·0.866 + 596.96·0.5, 34.73·0.5 - 596.96·0.866)
  //      = (30.08 + 298.48, 17.37 - 516.96)
  //      = (328.56, -499.59).
  //      + (500, 800) → (828.56, 300.41).
  const nodes = [
    { id: 'b-torso', type: 'group', boneRole: 'torso',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
      pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'b-head',  type: 'group', boneRole: 'head', parent: 'b-torso',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 400 },
      pose:      { rotation: 10, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-face', type: 'part', parent: 'b-head',
      mesh: { vertices: [{ x: 500, y: 200 }] },
    },
  ];
  const out = computeBoneOverlayMatrices(nodes);
  const m = out.get('p-face');
  assert(!!m, 'Test 3: face has overlay matrix');
  const [nx, ny] = applyMat(m, 500, 200);
  // Tolerance on the wider side because intermediate rotation rounding accumulates.
  assert(nearlyEq(nx, 828.56, 0.5), `Test 3: composed x ≈ 828.56 (got ${nx.toFixed(2)})`);
  assert(nearlyEq(ny, 300.41, 0.5), `Test 3: composed y ≈ 300.41 (got ${ny.toFixed(2)})`);
}

// ── Test 4: BONE_ARMATURE_INDEPENDENCE (2026-05-08) — bones with a
// matching ParamRotation_<name> param NOW contribute to the overlay.
// Pre-2026-05-08 the overlay force-zeroed these bones to avoid double-
// rotation under the legacy "bone gesture writes the param" hack. That
// hack is gone (SkeletonOverlay always writes pose.rotation now); the
// overlay matrix and the param slider are independent control surfaces.
{
  const nodes = [
    { id: 'b-arm', type: 'group', boneRole: 'leftArm', name: 'arm',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 700, pivotY: 600 },
      pose:      { rotation: 45, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-handwear', type: 'part', parent: 'b-arm',
      mesh: { vertices: [{ x: 800, y: 600 }] },
    },
  ];
  // Note: even with a matching ParamRotation_arm param in the project,
  // the overlay no longer force-zeroes this bone. The function now
  // takes `nodes` only — no `parameters` argument.
  const out = computeBoneOverlayMatrices(nodes);
  const m = out.get('p-handwear');
  assert(!!m, 'Test 4: arm bone with ParamRotation_arm STILL produces overlay (independence)');
  // 45° rotation around (700, 600) applied to (800, 600).
  // R = [[cos45, -sin45], [sin45, cos45]]; v - P = (100, 0);
  // R·(v - P) = (100·cos45, 100·sin45) ≈ (70.71, 70.71);
  // out = R·(v - P) + P ≈ (770.71, 670.71).
  const [nx, ny] = applyMat(m, 800, 600);
  assert(nearlyEq(nx, 770.71, 0.1), `Test 4: x ≈ 770.71 (got ${nx.toFixed(2)})`);
  assert(nearlyEq(ny, 670.71, 0.1), `Test 4: y ≈ 670.71 (got ${ny.toFixed(2)})`);
}

// ── Test 5: Identity pose under non-driver chain still no entry ───
{
  const nodes = [
    { id: 'b-torso', type: 'group', boneRole: 'torso',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
      pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-shirt', type: 'part', parent: 'b-torso',
      mesh: { vertices: [{ x: 600, y: 800 }] },
    },
  ];
  const out = computeBoneOverlayMatrices(nodes);
  assert(out.size === 0, 'Test 5: identity pose → no overlay entry (cheap-render path)');
}

// ── Test 6: Translation-only pose (no rotation) ─────────────────────
{
  const nodes = [
    { id: 'b-eyes', type: 'group', boneRole: 'eyes',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 100 },
      pose:      { rotation: 0, x: 25, y: -10, scaleX: 1, scaleY: 1 },
    },
    { id: 'p-iris', type: 'part', parent: 'b-eyes',
      mesh: { vertices: [{ x: 400, y: 100 }] },
    },
  ];
  const out = computeBoneOverlayMatrices(nodes);
  const m = out.get('p-iris');
  assert(!!m, 'Test 6: translation-only pose produces overlay');
  const [nx, ny] = applyMat(m, 400, 100);
  assert(nearlyEq(nx, 425), `Test 6: translated x = 425 (got ${nx.toFixed(3)})`);
  assert(nearlyEq(ny, 90),  `Test 6: translated y = 90 (got ${ny.toFixed(3)})`);
}

console.log(`\nboneOverlayMatrix: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
