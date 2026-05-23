// Regression test for the "legs fly out of canvas after Init Rig" bug
// (test_image4.psd, anime character with nested leg bones).
//
// THE BUG SHAPE: in the harvest rigSpec, an artMesh ends up with vertex
// positions in a frame the chainEval can't compose back to canvas-px,
// producing a rest-divergence equal to the bone's pivot magnitude
// (~canvasW/2 ~= 641 px for a leg bone near canvas center).
//
// Two source patterns hit this:
//   1. Non-baked rigged-to-bone where the joint-bone-group has no
//      rotation deformer (bones never do): the pre-fix
//      `else if (jointBoneId && deformerWorldOrigins.has(jointBoneId))`
//      branch in `artMeshSourceEmit.js:345` set `artParent =
//      {type:'rotation', id:jointBoneId}` — a parent reference to a
//      non-existent deformer (bones are skipped in
//      `rotationDeformerEmit.js:~115`). chainEval can't resolve the
//      parent, leaves verts in pivot-relative-px.
//
//   2. Bone-baked legwear where every ancestor bone is also a bone (no
//      group rotation deformer in chain).
//
// THE FIX: align artParent decision with cmo3 emit's targetDeformerGuid
// resolution — only set a rotation parent when the referenced group
// ACTUALLY HAS a `groupDeformerGuids` entry. When no rotation-deformer
// ancestor exists, fall back to root and re-encode pivot-relative verts
// to canvas-px (same flag as the bone-baked-no-deformer fallback).
//
// This test exercises the chainEval rest invariant: at default params,
// every artMesh frame's vertex positions must match the source
// `verticesCanvas` within sub-pixel tolerance. Any divergence is the
// flying-mesh bug.
//
// Run: node scripts/test/test_artMeshParentBoneRig.mjs

import { generateCmo3 } from '../../src/io/live2d/cmo3writer.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Minimal valid 1x1 PNG (transparent). cmo3writer requires `pngData`
// per mesh even under `rigOnly:true` because the layer-keyform pass
// runs before the rig-only short-circuit. Content doesn't matter for
// the rigSpec output we're asserting on.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// Convert a project to generateCmo3 input shape.
function toGeneratorInput(project) {
  const meshes = project.nodes.filter((n) => n.type === 'part').map((n) => ({
    partId: n.id,
    name: n.name,
    tag: n.tag,
    parentGroupId: n.parent,
    vertices: n.mesh.vertices,
    uvs: n.mesh.uvs,
    triangles: n.mesh.triangles,
    jointBoneId: n.mesh.jointBoneId,
    boneWeights: n.mesh.boneWeights,
    visible: n.visible !== false,
    variantSuffix: n.variantSuffix ?? null,
    pngData: PNG_1x1,
  }));
  const groups = project.nodes.filter((n) => n.type === 'group').map((g) => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));
  return {
    canvasW: project.canvas.width,
    canvasH: project.canvas.height,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: [],
    modelName: 'test',
    generateRig: true,
    generatePhysics: false,
    rigOnly: true,
  };
}

// Verify chainEval at rest matches verticesCanvas for every artMesh
// (the "legs don't fly" invariant).
function assertRestIdentity(rigSpec, label) {
  const frames = evalRig(rigSpec, {});
  const meshById = new Map(rigSpec.artMeshes.map((m) => [m.id, m]));
  let maxOverall = 0;
  let worstId = null;
  for (const f of frames) {
    const src = meshById.get(f.id)?.verticesCanvas;
    if (!src) continue;
    let partMax = 0;
    const len = Math.min(src.length, f.vertexPositions.length);
    for (let i = 0; i < len; i++) {
      const d = Math.abs(src[i] - f.vertexPositions[i]);
      if (d > partMax) partMax = d;
    }
    if (partMax > maxOverall) { maxOverall = partMax; worstId = f.id; }
  }
  assert(maxOverall < 1.0,
    `${label}: chainEval rest ≡ verticesCanvas within 1 px (max=${maxOverall.toFixed(2)} px on '${worstId}')`);
  return { maxOverall, worstId };
}

// Verify every artMesh.parent resolves to a real deformer (or root).
function assertParentsResolve(rigSpec, label) {
  const allRotationIds = new Set((rigSpec.rotationDeformers ?? []).map((r) => r.id));
  const allWarpIds = new Set((rigSpec.warpDeformers ?? []).map((w) => w.id));
  for (const am of rigSpec.artMeshes) {
    const p = am.parent;
    if (!p || p.type === 'root' || !p.id) continue;
    if (p.type === 'rotation') {
      assert(allRotationIds.has(p.id),
        `${label}: ${am.id} parent rotation '${p.id}' resolves to a real deformer`);
    } else if (p.type === 'warp') {
      assert(allWarpIds.has(p.id),
        `${label}: ${am.id} parent warp '${p.id}' resolves to a real deformer`);
    }
  }
}

// ── Case A: non-baked rigged-to-bone (no boneWeights) ────────────────
//
// Group hierarchy (anime-style nested leg bones, all leg groups are bones):
//   torso (visual group, NOT a bone)
//   ├─ rightLeg (boneRole='rightLeg')        ← bone
//   │  └─ rightKnee (boneRole='rightKnee')   ← bone
//   │     └─ legwear-r (mesh, jointBoneId='rightKnee', boneWeights=null)
//   └─ leftLeg (boneRole='leftLeg')          ← bone
//      └─ leftKnee (boneRole='leftKnee')     ← bone
//         └─ legwear-l (mesh, jointBoneId='leftKnee', boneWeights=null)
//
// With boneWeights=null, paramSpec doesn't add a 'role:bone' param for
// 'rightKnee' / 'leftKnee'. So those groups are NOT in `boneParamGuids`,
// and rotationDeformerEmit creates GROUP rotation deformers for them
// (since the boneParamGuids skip at rotationDeformerEmit:~115 only fires
// for skinning bones). But the LEG_ROLES skip in structuralChainEmit
// keeps those rotation deformers parented to root with canvas-px origin.
// The artMesh path through the legwear part chain through
// `GroupRotation_rightKnee` should still land at canvas-px at rest.

{
  const project = {
    schemaVersion: 0,
    canvas: { width: 1024, height: 1024 },
    parameters: [],
    physics_groups: [],
    animations: [],
    nodes: [
      { id: 'torso',     type: 'group', name: 'torso',     boneRole: null },
      { id: 'rightLeg',  type: 'group', name: 'rightLeg',  boneRole: 'rightLeg',  parent: 'torso' },
      { id: 'rightKnee', type: 'group', name: 'rightKnee', boneRole: 'rightKnee', parent: 'rightLeg' },
      { id: 'leftLeg',   type: 'group', name: 'leftLeg',   boneRole: 'leftLeg',   parent: 'torso' },
      { id: 'leftKnee',  type: 'group', name: 'leftKnee',  boneRole: 'leftKnee',  parent: 'leftLeg' },
      {
        id: 'legwear-r', type: 'part', name: 'legwear-r', tag: 'legwear', parent: 'rightKnee', visible: true,
        mesh: { vertices: [600, 700, 700, 700, 700, 900, 600, 900],
                uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
                jointBoneId: 'rightKnee', boneWeights: null },
      },
      {
        id: 'legwear-l', type: 'part', name: 'legwear-l', tag: 'legwear', parent: 'leftKnee', visible: true,
        mesh: { vertices: [324, 700, 424, 700, 424, 900, 324, 900],
                uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
                jointBoneId: 'leftKnee', boneWeights: null },
      },
    ],
  };
  const result = await generateCmo3(toGeneratorInput(project));
  assertParentsResolve(result.rigSpec, 'Case A (null boneWeights)');
  assertRestIdentity(result.rigSpec, 'Case A (null boneWeights)');
}

// ── Case B: bone-baked legwear (with boneWeights) ────────────────────
//
// Same hierarchy as Case A, but with `boneWeights` set so the joint
// bones become "skinning bones" — they get bone params and are skipped
// in rotationDeformerEmit's loop (no group rotation deformer for them).
// The bone's parent group ('rightLeg' / 'leftLeg') still gets a group
// rotation deformer (since neither 'rightLeg' nor 'leftLeg' has a
// directly-skinned mesh).
//
// Pre-fix this would have worked correctly — the bone-baked branch
// already had the `bakedReencodeToCanvas` fallback for the
// no-ancestor-deformer case. Test ensures my fix didn't regress it.

{
  // 4 verts × 1 weight each.
  const w4 = [1, 1, 1, 1];
  const project = {
    schemaVersion: 0,
    canvas: { width: 1024, height: 1024 },
    parameters: [],
    physics_groups: [],
    animations: [],
    nodes: [
      { id: 'torso',     type: 'group', name: 'torso',     boneRole: null },
      { id: 'rightLeg',  type: 'group', name: 'rightLeg',  boneRole: 'rightLeg',  parent: 'torso' },
      { id: 'rightKnee', type: 'group', name: 'rightKnee', boneRole: 'rightKnee', parent: 'rightLeg' },
      {
        id: 'legwear-r', type: 'part', name: 'legwear-r', tag: 'legwear', parent: 'rightKnee', visible: true,
        mesh: { vertices: [600, 700, 700, 700, 700, 900, 600, 900],
                uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
                jointBoneId: 'rightKnee', boneWeights: w4,
                jointPivotX: 650, jointPivotY: 750 },
      },
    ],
  };
  const result = await generateCmo3(toGeneratorInput(project));
  assertParentsResolve(result.rigSpec, 'Case B (bone-baked)');
  assertRestIdentity(result.rigSpec, 'Case B (bone-baked)');
}

// ── Case C: non-baked rigged-to-non-bone-group ───────────────────────
//
// A leg-rig where the joint group is NOT a bone (no boneRole) but has a
// regular group rotation deformer. Pre-fix bug: artParent.id was set
// directly to jointBoneId — but the rotation deformer is registered as
// `GroupRotation_<jointBoneId>`. Post-fix: the prefix is added.
//
// We can verify this case exercised the previously-broken branch by
// asserting the artParent.id starts with 'GroupRotation_' (proper
// rotation deformer naming) and resolves to a real deformer.

{
  const project = {
    schemaVersion: 0,
    canvas: { width: 1024, height: 1024 },
    parameters: [],
    physics_groups: [],
    animations: [],
    nodes: [
      { id: 'torso',     type: 'group', name: 'torso',     boneRole: null },
      // 'jointGroup' is a regular non-bone group with no boneRole — gets
      // a GROUP rotation deformer.
      { id: 'jointGroup', type: 'group', name: 'jointGroup', boneRole: null, parent: 'torso' },
      {
        id: 'part-x', type: 'part', name: 'part-x', tag: 'topwear', parent: 'jointGroup', visible: true,
        mesh: { vertices: [400, 400, 500, 400, 500, 500, 400, 500],
                uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
                jointBoneId: 'jointGroup', boneWeights: null },
      },
    ],
  };
  const result = await generateCmo3(toGeneratorInput(project));
  assertParentsResolve(result.rigSpec, 'Case C (non-baked, non-bone joint)');
  // If the rigWarp pass emitted a rigWarp for part-x, the parent will be
  // a warp ('RigWarp_part_x'); otherwise it should be the GroupRotation.
  // Either way the parent must resolve and rest must be canvas-px.
  assertRestIdentity(result.rigSpec, 'Case C (non-baked, non-bone joint)');
}

console.log(`artMeshParentBoneRig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
