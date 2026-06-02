// Tests for the rigInvariantCheck framework.
//
// Coverage philosophy: each invariant (I-1 through I-18) gets a positive
// fixture (clean project, ok=true) and a negative fixture (violated,
// ok=false) so a regression that flips a check's polarity is caught.
//
// Run: node scripts/test/test_rigInvariantCheck.mjs

import { runRigInvariantChecks } from '../../src/io/live2d/rig/rigInvariantCheck.js';

let passed = 0;
let failed = 0;
function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

// Silence the logger for the duration of the test run — the framework
// emits logger.error on violations by design (that's the point), but
// it would pollute the test output.
import { logger } from '../../src/lib/logger.js';
const _origError = logger.error;
const _origInfo = logger.info;
logger.error = () => {};
logger.info = () => {};

// ── I-1: modifier-stack non-emptiness ─────────────────────────────────
{
  // Cage for a 2×2 cell lattice has 3×3 = 9 points (rows+1 by cols+1).
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true,
        vertices: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
                   { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
                   { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }] },
      { id: 'p1', type: 'part', name: 'p1',
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-1 clean: part with one modifier is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        modifiers: [] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-1'] === 1, 'I-1 fail: empty modifiers triggers I-1',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-2: modifier leaf reachability ───────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: { vertices: [{ x: 0, y: 0 }] },
        modifiers: [{ type: 'lattice', objectId: 'doesNotExist' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-2'] === 1,
    'I-2 fail: dangling lattice objectId triggers I-2',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-3: lattice parent reachability ──────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: 'ghost' },
      { id: 'cage1', type: 'object', objectKind: 'mesh',
        vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-3'] === 1,
    'I-3 fail: lattice with unresolvable parent triggers I-3',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-4: lattice cage shape ───────────────────────────────────────────
{
  // 2×2 CELL grid → 3×3 = 9 expected points. Providing 4 (the old wrong
  // formula's expectation) triggers the violation.
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true,
        vertices: [0, 0, 1, 0, 1, 1, 0, 1] }, // 4 verts ≠ 9 expected
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-4'] === 1,
    'I-4 fail: cage vertex count mismatches (rows+1)×(cols+1) triggers I-4',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // 5×5 CELL grid → 6×6 = 36 expected points. Real auto-rig lattices use
  // this shape (FaceParallaxWarp, BodyWarpZ, etc).
  const verts = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) verts.push({ x: c / 5, y: r / 5 });
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'FaceParallaxWarp',
        gridSize: { rows: 5, cols: 5 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true, vertices: verts },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-4 clean: 5×5 cell lattice with 36 cage points is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-5: keyform vertexPositions shape — exactly the handwear bug ────
{
  // The pre-fix handwear bug: object-shape verts copied as-is into
  // vertexPositions. The framework MUST catch this.
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: [{ x: 500, y: 400 }, { x: 600, y: 400 }], // BAD — object array
            }],
          },
        },
        modifiers: [{ type: 'armature', deformerId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-5'] ?? 0) > 0,
    'I-5 fail: object-shape vertexPositions triggers I-5 (handwear regression)',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // The actual correct case — flat Float32Array vertexPositions.
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }],
          jointBoneId: 'bone1',
          boneWeights: [1, 1],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: new Float32Array([500, 400, 600, 400]),
            }],
          },
        },
        modifiers: [{ type: 'armature', deformerId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-5 clean: flat Float32Array vertexPositions is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-5: non-finite numbers in vertexPositions ────────────────────────
{
  const cageVerts = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cageVerts.push({ x: c / 2, y: r / 2 });
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: {
          vertices: [{ x: 500, y: 400 }],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: new Float32Array([NaN, 400]),
            }],
          },
        },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true, vertices: cageVerts },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-5'] ?? 0) > 0,
    'I-5 fail: NaN in vertexPositions triggers I-5',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-2: armature uses `deformerId` (joint bone id), not boneId ───────
{
  // Regression for the framework bug surfaced by the 2026-05-25 Init Rig
  // run: armature.deformerId IS set to the joint bone id, so the
  // resolution check must use that field.
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: { vertices: [{ x: 500, y: 400 }] },
        modifiers: [{ type: 'armature', deformerId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'elbow', boneRole: 'leftElbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-2 clean: armature with valid deformerId resolves',
    `violations: ${JSON.stringify(r.violations)}`);
}
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: { vertices: [{ x: 500, y: 400 }] },
        modifiers: [{ type: 'armature', deformerId: 'ghostBone' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-2'] ?? 0) > 0,
    'I-2 fail: armature with unresolvable deformerId triggers I-2',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-6: boneWeights consistency ──────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }, { x: 700, y: 400 }],
          jointBoneId: 'bone1',
          boneWeights: [1], // 1 weight for 3 verts — wrong
          runtime: {
            keyforms: [{
              keyTuple: [], opacity: 1,
              vertexPositions: new Float32Array([500, 400, 600, 400, 700, 400]),
            }],
          },
        },
        modifiers: [{ type: 'armature', deformerId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-6'] ?? 0) > 0,
    'I-6 fail: boneWeights.length≠vertexCount triggers I-6',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-7: bone pivot finiteness ────────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'bone1', type: 'group', name: 'head', boneRole: 'head',
        transform: { pivotX: NaN, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-7'] === 1,
    'I-7 fail: NaN bone pivot triggers I-7',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-10: bone scale out of range ─────────────────────────────────────
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'spine', boneRole: 'spine',
        transform: { pivotX: 500, pivotY: 500, scaleX: 1000, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-10'] ?? 0) > 0,
    'I-10 fail: bone transform.scaleX=1000 triggers I-10',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'spine', boneRole: 'spine',
        transform: { pivotX: 500, pivotY: 500, scaleX: 1, scaleY: 1 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 500, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-10'] ?? 0) > 0,
    'I-10 fail: bone pose.scaleX=500 triggers I-10',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-11: lattice cage extent extreme ─────────────────────────────────
{
  // Cage with vertex at (1,000,000, 500) on a 1000-canvas — > 100×.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true,
        vertices: [{ x: 1000000, y: 500 }, { x: 1000000, y: 500 }, { x: 1000000, y: 500 },
                   { x: 1000000, y: 500 }, { x: 1000000, y: 500 }, { x: 1000000, y: 500 },
                   { x: 1000000, y: 500 }, { x: 1000000, y: 500 }, { x: 1000000, y: 500 }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-11'] ?? 0) > 0,
    'I-11 fail: cage vertex >100× canvas triggers I-11',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-12: bone pose translation magnitude ─────────────────────────────
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { rotation: 0, x: 800000, y: 0, scaleX: 1, scaleY: 1 } }, // 800K > 10×1000=10K
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-12'] ?? 0) > 0,
    'I-12 fail: bone pose.x=800000 on 1000px canvas triggers I-12',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { rotation: 0, x: 5, y: 12000, scaleX: 1, scaleY: 1 } }, // 12K > 10K
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-12'] ?? 0) > 0,
    'I-12 fail: bone pose.y=12000 on 1000px canvas triggers I-12',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // v19 channels-shape pose with huge translation must also trigger I-12.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { channels: { bone1: { rotation: 0, x: 500000, y: 0, scaleX: 1, scaleY: 1 } } } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-12'] ?? 0) > 0,
    'I-12 fail: v19 pose.channels[id].x=500000 on 1000px canvas triggers I-12',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // Clean: pose translation within reasonable bounds.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { rotation: 0, x: 50, y: -30, scaleX: 1, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-12 clean: bone pose.x=50 / pose.y=-30 is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-13: bone pivot magnitude (finite but huge) ──────────────────────
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 800000, pivotY: 500 } }, // 800K > 10K
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-13'] ?? 0) > 0,
    'I-13 fail: bone transform.pivotX=800000 on 1000px canvas triggers I-13',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 1500000 } }, // 1.5M > 10K
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-13'] ?? 0) > 0,
    'I-13 fail: bone transform.pivotY=1500000 on 1000px canvas triggers I-13',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // I-7 fires on NaN pivot but I-13 must NOT fire (defensive split).
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: NaN, pivotY: 500 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-7'] ?? 0) > 0 && (r.byInvariant['I-13'] ?? 0) === 0,
    'I-13 clean on NaN pivot: I-7 fires but I-13 does not double-report',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // Clean: pivot well within canvas.
  const project = {
    canvas: { width: 1792, height: 1792 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 1300, pivotY: 400 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-13 clean: bone pivot at (1300, 400) on 1792 canvas is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-14: static composed bone world matrix translation ──────────────
{
  // transform.x=800000 → static world matrix translation [6] = 800000 →
  // > 10 × 1000 (canvas) threshold → I-14 fires.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500, x: 800000, y: 0 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-14'] ?? 0) > 0,
    'I-14 fail: bone transform.x=800000 produces huge static world matrix translation',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // Clean: bone with rest-only transform produces identity-modulo-pivot
  // local matrix → world translation = 0.
  const project = {
    canvas: { width: 1792, height: 1792 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'root', boneRole: 'root',
        transform: { pivotX: 897, pivotY: 1292 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-14 clean: bone at canvas-center rest produces clean world matrix',
    `violations: ${JSON.stringify(r.violations)}`);
}
{
  // Parent-chain accumulation: 4 bones each with transform.x=3000 stacked
  // → root world.tx=3000, child1=6000, child2=9000, child3=12000 → I-14
  // fires on child3 (12000 > 10000). Tests that I-14 catches
  // CHAIN-ACCUMULATED pollution not visible per-bone.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'b0', type: 'group', name: 'root', boneRole: 'root',
        transform: { pivotX: 500, pivotY: 500, x: 3000, y: 0 } },
      { id: 'b1', type: 'group', name: 'arm', boneRole: 'arm', parent: 'b0',
        transform: { pivotX: 500, pivotY: 500, x: 3000, y: 0 } },
      { id: 'b2', type: 'group', name: 'forearm', boneRole: 'forearm', parent: 'b1',
        transform: { pivotX: 500, pivotY: 500, x: 3000, y: 0 } },
      { id: 'b3', type: 'group', name: 'hand', boneRole: 'hand', parent: 'b2',
        transform: { pivotX: 500, pivotY: 500, x: 3000, y: 0 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-14'] ?? 0) > 0,
    'I-14 fail: 4-bone chain each with transform.x=3000 accumulates to 12000 > 10K canvas',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-15: depgraph TRANSFORM_COMPOSE bone output magnitude ────────────
{
  // pose.x=800000 → depgraph TRANSFORM_COMPOSE for the bone yields
  // composed.x = pivotX + pose.x = 800500 → > 10 × 1000 (canvas) →
  // I-15 fires (alongside I-12, which catches the stored pose pollution).
  // The test asserts I-15 fires regardless of whether I-12 also fires —
  // I-15 is the depgraph-side mirror of I-12, and both are useful
  // diagnostically.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { rotation: 0, x: 800000, y: 0, scaleX: 1, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-15'] ?? 0) > 0,
    'I-15 fail: bone pose.x=800000 produces TRANSFORM_COMPOSE.x=800500 > 10K canvas',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // Clean: stored data is fine → depgraph compose produces composed.x =
  // pivotX = 500 (well under 10K). I-15 must NOT fire.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-15 clean: bone at rest produces small composed transform',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-16: static composed world matrix scale/shear magnitude ──────────
{
  // 2-bone chain, each stored scaleX=15. Each bone individually passes
  // I-10 (15 < 100). Composed world matrix m[0] on the CHILD = 15 × 15
  // = 225, > 100 → I-16 fires on the child. Demonstrates that chain
  // accumulation blows up post-composition even when stored data is
  // clean per-bone — the exact hole the handwear bug-03 slipped through
  // (I-10 + I-14 both passed; m[0] was huge from chain product).
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'boneA', type: 'group', name: 'root', boneRole: 'root',
        transform: { pivotX: 0, pivotY: 0, scaleX: 15, scaleY: 1, rotation: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        parent: null },
      { id: 'boneB', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 0, pivotY: 0, scaleX: 15, scaleY: 1, rotation: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        parent: 'boneA' },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-16'] ?? 0) > 0,
    'I-16 fail: 2-bone scaleX=15 chain produces composed m[0]=225 > 100',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
  // I-10 must NOT fire — each bone's stored scaleX is 15, within [0.01, 100]
  assert((r.byInvariant['I-10'] ?? 0) === 0,
    'I-16 isolation: per-bone stored scale passes I-10; only chain-composed fires I-16',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'root', boneRole: 'root',
        transform: { pivotX: 0, pivotY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-16 clean: single bone at rest produces identity world matrix',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-17: depgraph TRANSFORM_COMPOSE scale magnitude ──────────────────
{
  // pose.scaleX=200 → TRANSFORM_COMPOSE outputs scaleX≈200 → > 100 → I-17.
  // I-10 ALSO fires (pose.scaleX > 100): both stored-data and eval-time
  // flag the same bug, giving two pointers to the same root cause. The
  // test asserts I-17 specifically fires (I-10 firing alongside is fine).
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500, scaleX: 1, scaleY: 1, rotation: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 200, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-17'] ?? 0) > 0,
    'I-17 fail: pose.scaleX=200 produces TRANSFORM_COMPOSE.scaleX=200 > 100',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'bone1', type: 'group', name: 'hand', boneRole: 'leftHand',
        transform: { pivotX: 500, pivotY: 500, scaleX: 1, scaleY: 1, rotation: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-17 clean: bone with unit pose scale passes I-17',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-18: keyform vertexPositions magnitude ───────────────────────────
{
  // canvas 1000×1000 → I-18 threshold = 10 × 1000 = 10000. A vertex of
  // 50000 exceeds threshold but IS finite → I-18 fires, I-5 does not.
  // (Cage shape requires a self-consistent lattice + meshData pair to
  // avoid I-2/I-4 noise — copied from the I-1 clean fixture.)
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true,
        vertices: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
                   { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
                   { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }] },
      { id: 'p1', type: 'part', name: 'handwear',
        mesh: {
          vertices: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
          runtime: { keyforms: [{ vertexPositions: [100, 100, 50000, 200] }] },
        },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-18'] ?? 0) > 0,
    'I-18 fail: vertex of 50000 on canvas 1000×1000 exceeds 10× threshold',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
  assert((r.byInvariant['I-5'] ?? 0) === 0,
    'I-18 isolation: finite-but-huge vertex does NOT trigger I-5',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'meshData', isLatticeCage: true,
        vertices: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
                   { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
                   { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }] },
      { id: 'p1', type: 'part', name: 'handwear',
        mesh: {
          vertices: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
          runtime: { keyforms: [{ vertexPositions: [100, 100, 200, 200] }] },
        },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-18 clean: canvas-px vertices pass I-18',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-8/I-9: eval-time finiteness + extent reasonableness ─────────────
// We can't easily fabricate a depgraph-evaluable project in a test
// without a heavy fixture, but we CAN verify the eval-path swallows
// errors gracefully when depgraph throws on minimal input — the
// invariant check must degrade to "skipped" rather than block Init Rig.
{
  // Malformed project (no parameters, no canvas) — depgraph should
  // either return [] or throw. Either way, the framework must not crash
  // and must report `ok=true` (no violations) for the structural set.
  const project = {
    canvas: { width: 1000, height: 1000 },
    nodes: [
      // A bare bone with no parts — depgraph may produce 0 frames.
      { id: 'bone1', type: 'group', name: 'root', boneRole: 'root',
        transform: { pivotX: 500, pivotY: 500 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  // Structural checks pass; eval-time skipped or 0 frames — neither is a violation.
  assert(r.ok, 'I-8/I-9 graceful degradation: minimal project does not crash framework',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── degenerate input: null project / empty nodes ──────────────────────
{
  const r1 = runRigInvariantChecks(null);
  assert(r1.ok && r1.violationCount === 0, 'null project → clean summary');
  const r2 = runRigInvariantChecks({ nodes: [] });
  assert(r2.ok && r2.violationCount === 0, 'empty nodes → clean summary');
  const r3 = runRigInvariantChecks({});
  assert(r3.ok && r3.violationCount === 0, 'no nodes key → clean summary');
}

// restore the logger
logger.error = _origError;
logger.info = _origInfo;

console.log(`rigInvariantCheck: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
