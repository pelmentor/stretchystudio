// Tests for src/io/live2d/extractMeshExportStruct.js — the per-part
// bone-binding extract used by exporter.js's mesh-struct construction
// (`exportLive2DProject` + `buildMeshesForRig`).
//
// 2026-05-09 (afternoon): the Cubism Adapter rigid-strip rule was
// removed when the adapter pattern was reverted toward Blender parity
// (see `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`). This
// module simplified to a basic field-extract + jointPivot lookup;
// these tests cover the post-revert contract.
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

// ── Test 1: skinned weights — pass through with jointPivot looked up ──

{
  // Limb output of computeSkinWeights — variable per-vertex weights
  // along the elbow blend zone. Extractor passes through unchanged
  // and resolves jointPivot from the joint bone's transform.
  const project = {
    nodes: [
      { id: 'leftArm',  type: 'group', boneRole: 'leftArm',  parent: null,
        transform: { pivotX: 500, pivotY: 600 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 400, pivotY: 500 } },
      { id: 'arm-mesh', type: 'part', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
          boneWeights: [0.0, 0.3, 0.7, 1.0],   // variable
          jointBoneId: 'leftElbow',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'arm-mesh');
  const result = extractMeshExportStruct(part.mesh, part, byId, 4);
  assert(result.boneWeights === part.mesh.boneWeights, 'Test 1: boneWeights pass-through');
  assert(result.jointBoneId === 'leftElbow', 'Test 1: jointBoneId preserved');
  assert(result.jointPivotX === 400, 'Test 1: jointPivotX from joint bone transform');
  assert(result.jointPivotY === 500, 'Test 1: jointPivotY from joint bone transform');
}

// ── Test 2: bone-routing intent (Audit Issue 8) — pass through ──────

{
  // Hand-only sub-mesh: structural parent leftArm, jointBoneId leftElbow,
  // ALL weights 1.0 (every vertex past the elbow blend zone, clamped to
  // 1.0). Pre-revert the adapter strip would have nullified these
  // unless the predicate's 4-arg form caught the bone-routing intent.
  // Post-revert there's no strip — fields pass through verbatim.
  const project = {
    nodes: [
      { id: 'leftArm',  type: 'group', boneRole: 'leftArm',  parent: null,
        transform: { pivotX: 500, pivotY: 600 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 400, pivotY: 500 } },
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
  assert(result.boneWeights === part.mesh.boneWeights,
    'Test 2: boneWeights preserved (would-be hand-detach regression averted)');
  assert(result.jointBoneId === 'leftElbow',
    'Test 2: jointBoneId preserved → cmo3 emits hand under leftElbow');
}

// ── Test 3: no boneWeights (rigid-follow part post-revert) ──────────

{
  // After the Cubism Adapter revert, rigid-follow parts carry NO
  // vertex groups. Extractor returns null for both fields and skips
  // the pivot lookup.
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
  assert(result.boneWeights === null, 'Test 3: boneWeights null when absent');
  assert(result.jointBoneId === null, 'Test 3: jointBoneId null when absent');
  assert(result.jointPivotX === null, 'Test 3: jointPivotX null (no jointBoneId)');
  assert(result.jointPivotY === null, 'Test 3: jointPivotY null (no jointBoneId)');
}

// ── Test 4: weights but no jointBoneId (malformed input) ────────────

{
  // Defensive input: weights present, jointBoneId missing. Extractor
  // doesn't compute jointPivot (no joint bone to look up).
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
  assert(result.boneWeights === part.mesh.boneWeights, 'Test 4: weights preserved');
  assert(result.jointBoneId === null, 'Test 4: jointBoneId null when input null');
  assert(result.jointPivotX === null, 'Test 4: jointPivotX null without jointBoneId');
}

// ── Test 5: indexProjectNodesById defensive cases ───────────────────

{
  assert(indexProjectNodesById(null).size === 0, 'Test 5a: null project → empty index');
  assert(indexProjectNodesById({}).size === 0, 'Test 5b: missing nodes → empty index');
  assert(indexProjectNodesById({ nodes: 'broken' }).size === 0, 'Test 5c: malformed nodes → empty');
  const idx = indexProjectNodesById({ nodes: [{ id: 'x', type: 'part' }, null, { type: 'part' }] });
  assert(idx.size === 1, 'Test 5d: only valid id strings indexed');
  assert(idx.get('x')?.type === 'part', 'Test 5e: index lookup works');
}

// ── Test 6: jointBone without transform ─────────────────────────────

{
  // Defensive: jointBoneId points at a node that exists but has no
  // transform field. Extractor returns null pivots without crashing.
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null },  // no transform
      { id: 'p', type: 'part', parent: 'torso',
        mesh: {
          vertices: [{ x: 0, y: 0 }],
          boneWeights: [1.0],
          jointBoneId: 'torso',
        } },
    ],
  };
  const byId = indexProjectNodesById(project);
  const part = project.nodes.find((n) => n.id === 'p');
  const result = extractMeshExportStruct(part.mesh, part, byId, 1);
  assert(result.jointBoneId === 'torso', 'Test 6: jointBoneId pass-through');
  assert(result.jointPivotX === null, 'Test 6: jointPivotX null when bone has no transform');
  assert(result.jointPivotY === null, 'Test 6: jointPivotY null when bone has no transform');
}

console.log(`\nextractMeshExportStruct: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
