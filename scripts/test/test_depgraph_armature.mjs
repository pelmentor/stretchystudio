// Phase 0.D — bone post-chain composition (LBS / overlay) inside
// `kernelArtMeshEval` ([src/anim/depgraph/kernels/artMesh.js]), driven
// from TRANSFORM_COMPOSE outputs ([src/anim/depgraph/kernels/transformCompose.js]).
//
// The depgraph version applies skinning INSIDE the kernel; the classic
// engine applies it via the renderer's post-loop. Parity holds when:
//   evalProjectFrameViaDepgraph(project, vals)
//     ==
//   evalRig(rigSpec, vals)  + applyTwoBoneSkinning / applyOverlayMatrix
//                              using `computeBoneWorldMatrices(project.nodes)`
//
// Test matrix:
//   1. Single-bone, weight=1.0  → vertices follow joint bone WORLD.
//   2. Single-bone, weight=0.0  → vertices follow parent bone WORLD
//      (identity when the bone is top-level — verts stay at rest).
//   3. Two-bone elbow chain, mixed weights (0/0.5/1).
//   4. Overlay rigid-follow (part with bone-group ancestor, no weights).
//   5. Bone with LIMIT_ROTATION constraint — depgraph clamps the pose
//      before skinning. Verifies TRANSFORM_COMPOSE feeds the skin pass.
//
// Run: node scripts/test/test_depgraph_armature.mjs
//
// Resume entry: docs/plans/ANIMATION_PHASE_0_PROGRESS.md (gate #1).

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import {
  computeBoneWorldMatrices,
  computeBoneParentMap,
  computeBoneOverlayMatrices,
} from '../../src/renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinning } from '../../src/renderer/boneSkinning.js';
import { applyOverlayMatrixFlat } from '../../src/renderer/boneOverlayMatrix.js';
import { pickBonePostChainComposition } from '../../src/renderer/bonePostChainComposition.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';

let passed = 0;
let failed = 0;

function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

function maxDelta(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

/**
 * Mirror of CanvasViewport's post-loop skinning step. Takes evalRig's
 * frames, applies bone composition to each via the same primitives the
 * renderer uses, returns a fresh ArtMeshFrame[] with post-skin verts.
 */
function applyClassicPostSkin(project, frames) {
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  const boneParents = computeBoneParentMap(project.nodes);
  const boneOverlay = computeBoneOverlayMatrices(project.nodes, boneWorld);
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  return frames.map((f) => {
    const node = byId.get(f.id);
    const partMesh = node?.mesh ?? null;
    const positions = new Float32Array(f.vertexPositions);
    if (!node) return { ...f, vertexPositions: positions };
    const decision = pickBonePostChainComposition(node, partMesh);
    if (decision.kind === 'lbs') {
      const childMatrix = boneWorld.get(decision.jointBoneId) ?? null;
      const parentBoneId = decision.parentBoneId ?? boneParents.get(decision.jointBoneId) ?? null;
      const parentMatrix = parentBoneId ? (boneWorld.get(parentBoneId) ?? null) : null;
      applyTwoBoneSkinning(positions, parentMatrix, childMatrix, partMesh?.boneWeights);
    } else if (decision.kind === 'overlay') {
      const m = boneOverlay.get(node.id) ?? null;
      applyOverlayMatrixFlat(positions, m);
    }
    return { ...f, vertexPositions: positions };
  });
}

function quadVerts() {
  return [100, 50,  300, 50,  100, 250,  300, 250];
}

function bareRuntime(verts) {
  return {
    parent: { type: 'root', id: null },
    bindings: [],
    keyforms: [
      { keyTuple: [], opacity: 1, vertexPositions: verts.slice() },
    ],
  };
}

// ---------------------------------------------------------------------
// Test 1: Single bone, weight=1.0 everywhere — verts follow joint bone.
// ---------------------------------------------------------------------
{
  const verts = quadVerts();
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso',
        transform: { pivotX: 200, pivotY: 150 },
        pose: { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'shirt', type: 'part', name: 'shirt', visible: true, draw_order: 100,
        parent: 'torso', rigParent: null,
        modifiers: [],
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: verts.slice(),
          boneWeights: [1, 1, 1, 1],
          jointBoneId: 'torso',
          runtime: bareRuntime(verts),
        } },
    ],
    animations: [], physicsRules: [],
  };
  synthesizeModifierStacks(project);
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const cePostSkin = applyClassicPostSkin(project, ce);
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(dg.length === 1 && cePostSkin.length === 1, 'Test 1: 1 frame each');
  const d = maxDelta(cePostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `Test 1 (single-bone weight=1.0): depgraph matches classic+postSkin (delta=${d})`,
    `classic=${Array.from(cePostSkin[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
}

// ---------------------------------------------------------------------
// Test 2: Single bone, weight=0.0 everywhere — verts unchanged when
// the bone is top-level (parentMatrix=null → identity in two-bone
// fallback).
// ---------------------------------------------------------------------
{
  const verts = quadVerts();
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso',
        transform: { pivotX: 200, pivotY: 150 },
        pose: { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'shirt', type: 'part', name: 'shirt', visible: true, draw_order: 100,
        parent: 'torso', rigParent: null,
        modifiers: [],
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: verts.slice(),
          boneWeights: [0, 0, 0, 0],
          jointBoneId: 'torso',
          runtime: bareRuntime(verts),
        } },
    ],
    animations: [], physicsRules: [],
  };
  synthesizeModifierStacks(project);
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const cePostSkin = applyClassicPostSkin(project, ce);
  const dg = evalProjectFrameViaDepgraph(project, {});
  const d = maxDelta(cePostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `Test 2 (single-bone weight=0.0): depgraph matches classic+postSkin (delta=${d})`,
    `classic=${Array.from(cePostSkin[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
  // Verify the verts are at rest (not transformed) since parent matrix
  // is identity for a top-level bone.
  const restMatch = maxDelta(dg[0].vertexPositions, new Float32Array(verts));
  assert(restMatch < 1e-4, `Test 2: weight=0 + top-level bone → verts at rest (delta=${restMatch})`);
}

// ---------------------------------------------------------------------
// Test 3: Two-bone elbow chain. Parent=leftArm pose=20°, child=leftElbow
// pose=15°. Mixed per-vertex weights cover the LBS interior.
// ---------------------------------------------------------------------
{
  const verts = [50, 0,  100, 0,  150, 0,  200, 0]; // four collinear verts
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm',
        transform: { pivotX: 50, pivotY: 0 },
        pose: { rotation: 20, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 150, pivotY: 0 },
        pose: { rotation: 15, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'arm', type: 'part', name: 'arm', visible: true, draw_order: 100,
        parent: 'leftElbow', rigParent: null,
        modifiers: [],
        mesh: {
          uvs: [0, 0, 0.33, 0, 0.66, 0, 1, 0],
          triangles: [0, 1, 2, 1, 2, 3],
          vertices: verts.slice(),
          // Linear weight ramp from leftArm (0.0) to leftElbow (1.0).
          boneWeights: [0, 0.33, 0.66, 1],
          jointBoneId: 'leftElbow',
          runtime: bareRuntime(verts),
        } },
    ],
    animations: [], physicsRules: [],
  };
  synthesizeModifierStacks(project);
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const cePostSkin = applyClassicPostSkin(project, ce);
  const dg = evalProjectFrameViaDepgraph(project, {});
  const d = maxDelta(cePostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `Test 3 (two-bone elbow, mixed weights): depgraph matches classic+postSkin (delta=${d})`,
    `classic=${Array.from(cePostSkin[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
}

// ---------------------------------------------------------------------
// Test 4: Overlay rigid-follow — part with bone-group ancestor, no
// boneWeights, no Armature modifier. Both engines apply uniform world
// matrix.
// ---------------------------------------------------------------------
{
  const verts = quadVerts();
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso',
        transform: { pivotX: 200, pivotY: 150 },
        pose: { rotation: 25, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'topwear', type: 'part', name: 'topwear', visible: true, draw_order: 100,
        parent: 'torso', rigParent: null,
        modifiers: [],
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: verts.slice(),
          // NO boneWeights → overlay branch.
          runtime: bareRuntime(verts),
        } },
    ],
    animations: [], physicsRules: [],
  };
  // synthesizeModifierStacks should leave modifiers empty (no armature
  // emitted because no boneWeights). Run anyway for fidelity.
  synthesizeModifierStacks(project);
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const cePostSkin = applyClassicPostSkin(project, ce);
  const dg = evalProjectFrameViaDepgraph(project, {});
  const d = maxDelta(cePostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `Test 4 (overlay rigid-follow): depgraph matches classic+postSkin (delta=${d})`,
    `classic=${Array.from(cePostSkin[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
  // Verify the verts ARE transformed (not at rest) — overlay path
  // applied the bone's 25° rotation around (200, 150).
  const restMatch = maxDelta(dg[0].vertexPositions, new Float32Array(verts));
  assert(restMatch > 1, `Test 4: overlay actually deformed the verts (delta from rest=${restMatch.toFixed(2)})`);
}

// ---------------------------------------------------------------------
// Test 5: Bone with LIMIT_ROTATION constraint clamps pose value 1.0
// down to 0.5. The depgraph's TRANSFORM_COMPOSE runs the constraint,
// then the skin pass uses the clamped pose.
//
// Notes on units: the constraint engine uses the same numeric units as
// `pose.rotation` (see scripts/test/test_constraints.mjs:347 for the
// existing convention). The matrix builder treats `pose.rotation` as
// degrees; the constraint subsystem clamps the same value through
// `wrapPi`/`clampAngle`. To stay safely inside (-π, π] for both
// engines, we author small values so wrapPi is a no-op.
//
// Parity expectation: depgraph (with constraint) == classic+postSkin
// using a hand-clamped pose (no constraint).
// ---------------------------------------------------------------------
{
  const verts = quadVerts();
  const constrainedProject = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso',
        transform: { pivotX: 200, pivotY: 150 },
        pose: { rotation: 1.0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'cl', type: 'LIMIT_ROTATION', name: 'LR', enabled: true,
            payload: { useMin: true, useMax: true, min: -0.5, max: 0.5 } },
        ],
      },
      { id: 'shirt', type: 'part', name: 'shirt', visible: true, draw_order: 100,
        parent: 'torso', rigParent: null,
        modifiers: [],
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: verts.slice(),
          boneWeights: [1, 1, 1, 1],
          jointBoneId: 'torso',
          runtime: bareRuntime(verts),
        } },
    ],
    animations: [], physicsRules: [],
  };
  synthesizeModifierStacks(constrainedProject);
  const dg = evalProjectFrameViaDepgraph(constrainedProject, {});

  // Hand-build the expected output: identical project but with pose
  // pre-clamped to 0.5 (no constraint). Run classic+postSkin on that.
  const clampedProject = JSON.parse(JSON.stringify(constrainedProject));
  clampedProject.nodes[0].pose.rotation = 0.5;
  clampedProject.nodes[0].constraints = [];
  clampedProject.nodes[1].mesh.runtime = bareRuntime(verts);
  synthesizeModifierStacks(clampedProject);
  const expectedRig = selectRigSpec(clampedProject);
  const expectedCe = evalRig(expectedRig, {});
  const expectedPostSkin = applyClassicPostSkin(clampedProject, expectedCe);

  const d = maxDelta(expectedPostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `Test 5 (LIMIT_ROTATION pre-skin): depgraph clamped pose matches hand-built clamped reference (delta=${d})`,
    `clamped-ref=${Array.from(expectedPostSkin[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);

  // And confirm depgraph DIDN'T just use the unclamped pose (would
  // match classic+postSkin if it did — the assertion is "depgraph
  // diverges from unclamped").
  const unclampedRig = selectRigSpec(constrainedProject);
  const unclampedCe = evalRig(unclampedRig, {});
  const unclampedPostSkin = applyClassicPostSkin(constrainedProject, unclampedCe);
  const dDiverge = maxDelta(unclampedPostSkin[0].vertexPositions, dg[0].vertexPositions);
  assert(dDiverge > 0.1, `Test 5: depgraph DIVERGES from unclamped (constraint actually applied; delta=${dDiverge.toFixed(4)})`);
}

console.log(`depgraph_armature: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
