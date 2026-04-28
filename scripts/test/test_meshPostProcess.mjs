// v3 Phase 0F.3 — Tests for the mesh post-process pure helpers
// extracted from CanvasViewport's worker callback.
//
// Run: node scripts/test/test_meshPostProcess.mjs

import {
  childBoneRoleFor,
  computeSkinWeights,
  computeMeshCentroid,
} from '../../src/components/canvas/viewport/meshPostProcess.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ── childBoneRoleFor ────────────────────────────────────────────────

{
  assert(childBoneRoleFor('leftArm')  === 'leftElbow',  'leftArm  → leftElbow');
  assert(childBoneRoleFor('rightArm') === 'rightElbow', 'rightArm → rightElbow');
  assert(childBoneRoleFor('leftLeg')  === 'leftKnee',   'leftLeg  → leftKnee');
  assert(childBoneRoleFor('rightLeg') === 'rightKnee',  'rightLeg → rightKnee');
  assert(childBoneRoleFor('head') === null, 'non-limb → null');
  assert(childBoneRoleFor(null) === null, 'null → null');
  assert(childBoneRoleFor(undefined) === null, 'undefined → null');
  assert(childBoneRoleFor('') === null, 'empty string → null');
}

// ── computeSkinWeights ──────────────────────────────────────────────

{
  // Horizontal arm: shoulder at (0,0), elbow at (100,0).
  // Vertices upstream of elbow → low weight, downstream → high.
  const parent = { transform: { pivotX: 0,   pivotY: 0 } };
  const joint  = { transform: { pivotX: 100, pivotY: 0 } };
  const verts  = [
    { x: 0,   y: 0 },   // at shoulder
    { x: 50,  y: 0 },   // mid arm
    { x: 100, y: 0 },   // at elbow
    { x: 150, y: 0 },   // forearm
    { x: 200, y: 0 },   // hand
  ];
  const w = computeSkinWeights(verts, parent, joint, 40);

  // At shoulder (proj = -100, blend=40): -100/40 + 0.5 = -2 → clamped to 0
  assert(w[0] === 0, 'shoulder vertex: weight 0');
  // At elbow (proj = 0): 0/40 + 0.5 = 0.5
  assert(near(w[2], 0.5), 'elbow vertex: weight 0.5');
  // Mid arm (proj = -50): -50/40 + 0.5 = -0.75 → clamped 0
  assert(w[1] === 0, 'mid-arm vertex: weight 0');
  // Hand (proj = 100): 100/40 + 0.5 = 3 → clamped 1
  assert(w[4] === 1, 'hand vertex: weight 1');
}

{
  // Vertical limb (leg) — shoulder at (0,0), knee at (0,100).
  // Axis is +Y; only Y component of vertex matters.
  const parent = { transform: { pivotX: 0, pivotY: 0   } };
  const joint  = { transform: { pivotX: 0, pivotY: 100 } };
  const verts  = [
    { x: 0,   y: 0   },  // hip
    { x: 0,   y: 100 },  // knee
    { x: 0,   y: 200 },  // foot
    { x: 50,  y: 100 },  // sideways at knee height — same projection as knee
  ];
  const w = computeSkinWeights(verts, parent, joint, 40);
  assert(w[0] === 0, 'leg: hip → 0');
  assert(near(w[1], 0.5), 'leg: knee → 0.5');
  assert(w[2] === 1, 'leg: foot → 1');
  assert(near(w[3], 0.5), 'leg: sideways at knee → 0.5 (same projection)');
}

{
  // Diagonal arm — shoulder (0,0), elbow (60, 80) (3-4-5 triangle, len=100)
  const parent = { transform: { pivotX: 0,  pivotY: 0  } };
  const joint  = { transform: { pivotX: 60, pivotY: 80 } };
  // Vertex at the elbow → projection 0 → weight 0.5
  const w = computeSkinWeights([{ x: 60, y: 80 }], parent, joint, 40);
  assert(near(w[0], 0.5), 'diagonal arm: elbow → 0.5');
}

{
  // Degenerate axis (parent and joint at same point) → axLen=1 fallback
  // shouldn't NaN / Infinity. Every vertex relative to the joint becomes
  // a 0-length projection.
  const parent = { transform: { pivotX: 50, pivotY: 50 } };
  const joint  = { transform: { pivotX: 50, pivotY: 50 } };
  const verts  = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  const w = computeSkinWeights(verts, parent, joint, 40);
  assert(Number.isFinite(w[0]) && Number.isFinite(w[1]), 'degenerate axis: no NaN');
}

{
  // Empty vertices → empty result (not a crash)
  const parent = { transform: { pivotX: 0, pivotY: 0   } };
  const joint  = { transform: { pivotX: 0, pivotY: 100 } };
  const w = computeSkinWeights([], parent, joint);
  assert(Array.isArray(w) && w.length === 0, 'empty vertices → empty array');
}

// ── computeMeshCentroid ─────────────────────────────────────────────

{
  // Square — centroid should be center of bbox
  const verts = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  const c = computeMeshCentroid(verts);
  assert(c.cx === 5 && c.cy === 5, 'square centroid');
}

{
  // Single point
  const c = computeMeshCentroid([{ x: 7, y: -3 }]);
  assert(c.cx === 7 && c.cy === -3, 'single vertex: centroid is the vertex');
}

{
  // Asymmetric bbox
  const c = computeMeshCentroid([
    { x: -10, y: 0 }, { x: 30, y: 0 }, { x: 0, y: -5 }, { x: 0, y: 25 },
  ]);
  // bbox: x in [-10, 30] → cx = 10; y in [-5, 25] → cy = 10
  assert(c.cx === 10 && c.cy === 10, 'asymmetric bbox: centroid');
}

{
  // Empty / null / undefined
  assert(computeMeshCentroid([]) === null, 'empty array → null');
  assert(computeMeshCentroid(null) === null, 'null → null');
  assert(computeMeshCentroid(undefined) === null, 'undefined → null');
}

console.log(`meshPostProcess: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
