// Tests for src/io/live2d/extractMeshExportStruct.js — the per-part
// bone-binding extract used by exporter.js's mesh-struct construction
// (`exportLive2DProject` + `buildMeshesForRig`). Wraps the Cubism
// Adapter rigid-strip rule.
//
// Two crucial corners covered here:
//   1. Audit Issue 8 — hand-only sub-meshes whose `computeSkinWeights`
//      clamped every weight to 1.0 BUT whose jointBoneId differs from
//      the structural-parent bone. Adapter MUST preserve.
//   2. Phase 1 round-trip — a project with rigid-1.0 weights freshly
//      seeded by `seedDefaultRigidWeights` produces a stripped export
//      struct that's byte-identical to the legacy non-weighted shape.
//
// Run: node scripts/test/test_extractMeshExportStruct.mjs

import {
  extractMeshExportStruct,
  indexProjectNodesById,
} from '../../src/io/live2d/extractMeshExportStruct.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── Test 1: rigid-intent weights (all-1.0, jointBoneId === structural parent) ─

{
  // The Cubism Adapter target case. After `seedDefaultRigidWeights`, a
  // torso-followed part has all-1.0 weights with jointBoneId='torso'
  // and torso IS its nearest bone ancestor. Adapter strips both fields
  // → cmo3 emits the legacy non-weighted shape.
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { pivotX: 640, pivotY: 800 } },
      { id: 'topwear', type: 'part', parent: 'torso',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          boneWeights: [1.0, 1.0, 1.0],
          jointBoneId: 'torso',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'topwear');
  const result = extractMeshExportStruct(part.mesh, part, byId, 3);
  assert(result.stripped === true, 'Test 1: rigid-intent → stripped');
  assert(result.boneWeights === null, 'Test 1: stripped → boneWeights null');
  assert(result.jointBoneId === null, 'Test 1: stripped → jointBoneId null');
  assert(result.jointPivotX === null, 'Test 1: stripped → jointPivotX null');
  assert(result.jointPivotY === null, 'Test 1: stripped → jointPivotY null');
}

// ── Test 2: real skinned weights (per-vertex variation) — preserve ────

{
  // Limb output of computeSkinWeights — variation along the elbow blend
  // zone. Adapter passes through unchanged.
  const project = {
    nodes: [
      { id: 'leftArm',  type: 'group', boneRole: 'leftArm',  parent: null,
        transform: { pivotX: 500, pivotY: 600 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 400, pivotY: 500 } },
      { id: 'arm-mesh', type: 'part', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
          boneWeights: [0.0, 0.3, 0.7, 1.0],   // variation
          jointBoneId: 'leftElbow',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'arm-mesh');
  const result = extractMeshExportStruct(part.mesh, part, byId, 4);
  assert(result.stripped === false, 'Test 2: variation → not stripped');
  assert(result.boneWeights === part.mesh.boneWeights, 'Test 2: boneWeights pass-through');
  assert(result.jointBoneId === 'leftElbow', 'Test 2: jointBoneId preserved');
  assert(result.jointPivotX === 400, 'Test 2: jointPivotX from joint bone transform');
  assert(result.jointPivotY === 500, 'Test 2: jointPivotY from joint bone transform');
}

// ── Test 3: BONE-ROUTING INTENT (Audit Issue 8) — preserve ──────────

{
  // Hand-only sub-mesh: structural parent leftArm, jointBoneId leftElbow,
  // ALL weights 1.0 (because every vertex is past the elbow blend zone
  // and computeSkinWeights clamped them all to 1.0). The variance is
  // nominally rigid, but the weights encode bone-routing intent ("follow
  // leftElbow specifically, not leftArm") that the legacy non-weighted
  // wire format cannot express. Adapter MUST preserve.
  const project = {
    nodes: [
      { id: 'leftArm',  type: 'group', boneRole: 'leftArm',  parent: null,
        transform: { pivotX: 500, pivotY: 600 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 400, pivotY: 500 } },
      // Hand mesh under leftArm (NOT leftElbow), with jointBoneId routing
      // to leftElbow and all-1.0 weights.
      { id: 'hand', type: 'part', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          boneWeights: [1.0, 1.0, 1.0],
          jointBoneId: 'leftElbow',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'hand');
  const result = extractMeshExportStruct(part.mesh, part, byId, 3);
  assert(result.stripped === false,
    'Test 3: bone-routing-intent (jointBoneId !== nearest-bone-ancestor) → preserved');
  assert(result.boneWeights === part.mesh.boneWeights,
    'Test 3: boneWeights preserved (would-be hand-detach regression averted)');
  assert(result.jointBoneId === 'leftElbow',
    'Test 3: jointBoneId preserved → cmo3 emits hand under leftElbow');
}

// ── Test 4: no boneWeights at all (legacy non-rigged part) ──────────

{
  const project = {
    nodes: [
      { id: 'face-deformer', type: 'group', parent: null },
      { id: 'eyebrow', type: 'part', parent: 'face-deformer',
        mesh: { vertices: [{ x: 0, y: 0 }] } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'eyebrow');
  const result = extractMeshExportStruct(part.mesh, part, byId, 1);
  assert(result.stripped === false, 'Test 4: no weights → no strip');
  assert(result.boneWeights === null, 'Test 4: boneWeights null');
  assert(result.jointBoneId === null, 'Test 4: jointBoneId null');
}

// ── Test 5: weights but no jointBoneId (malformed input) ────────────

{
  // The predicate requires both boneWeights AND jointBoneId. With
  // weights present but jointBoneId missing, adapter does NOT strip
  // (predicate returns false on missing jointBoneId).
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { pivotX: 640, pivotY: 800 } },
      { id: 'p', type: 'part', parent: 'torso',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
          boneWeights: [1.0, 1.0],
          // no jointBoneId
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'p');
  const result = extractMeshExportStruct(part.mesh, part, byId, 2);
  assert(result.stripped === false, 'Test 5: malformed (weights but no jointBoneId) → not stripped');
  // The full extract preserves whatever the input had — null jointBoneId
  // means we don't look up the pivot.
  assert(result.jointBoneId === null, 'Test 5: jointBoneId null when input null');
}

// ── Test 6: indexProjectNodesById defensive cases ───────────────────

{
  assert(indexProjectNodesById(null).size === 0, 'Test 6a: null project → empty index');
  assert(indexProjectNodesById({}).size === 0, 'Test 6b: missing nodes → empty index');
  assert(indexProjectNodesById({ nodes: 'broken' }).size === 0, 'Test 6c: malformed nodes → empty');
  const idx = indexProjectNodesById({ nodes: [{ id: 'x', type: 'part' }, null, { type: 'part' }] });
  assert(idx.size === 1, 'Test 6d: only valid id strings indexed');
  assert(idx.get('x')?.type === 'part', 'Test 6e: index lookup works');
}

// ── Test 7: float32 round-trip drift on rigid weights (still stripped) ─

{
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { pivotX: 640, pivotY: 800 } },
      { id: 'topwear', type: 'part', parent: 'torso',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
          boneWeights: [0.99999994, 1.0000001],   // float32 drift
          jointBoneId: 'torso',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'topwear');
  const result = extractMeshExportStruct(part.mesh, part, byId, 2);
  assert(result.stripped === true, 'Test 7: drift within eps=1e-6 still strips');
}

// ── Test 8: nearest-bone walk skips plain group between part and bone ─

{
  // Real-world fixture shape: PSD-imported skin folder (plain group)
  // sits between bone and part. The walk must skip past it.
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { pivotX: 640, pivotY: 800 } },
      { id: 'skin-folder', type: 'group', parent: 'torso' },   // plain
      { id: 'topwear', type: 'part', parent: 'skin-folder',
        mesh: {
          vertices: [{ x: 0, y: 0 }],
          boneWeights: [1.0],
          jointBoneId: 'torso',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'topwear');
  const result = extractMeshExportStruct(part.mesh, part, byId, 1);
  assert(result.stripped === true,
    'Test 8: walk skips plain group → finds torso → matches jointBoneId → strips');
}

console.log(`\nextractMeshExportStruct: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
