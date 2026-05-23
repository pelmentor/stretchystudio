// Slice-1 (RULE №4 follow-up audit Leak #1) — bone-rotation keyform
// adapter-ization. The Cubism XML emit still produces N CArtMeshForm
// entries (one per BAKED_ANGLE), because the cmo3 format is "everything
// is keyforms on a param" — that's the adapter side.
//
// The Blender-faithful viewport model is different: bone-baked parts
// are deformed by LIVE LBS (`applyBonePostChainSkin` /
// `applyTwoBoneSkinning`) driven by `bone.pose.rotation`. The N-per-
// angle bake is an EXPORT-ONLY artefact — at viewport eval time those
// keyforms are DEAD STORAGE (selectRigSpec previously collapsed them
// post-persist; this slice moves the collapse upstream so the rigSpec
// is clean from the source, removing 3 wasted code paths: dead
// keyforms in mesh.runtime, spurious `ParamRotation_*` → artMesh
// dep edges in the depgraph build, and the selectRigSpec shim).
//
// THIS TEST locks the new contract for `emitArtMeshSources` (the
// rigCollector → rigSpec path that selectRigSpec/depgraph/persist all
// consume). The cmo3 XML emit shape is unchanged by construction: we
// only modify the rigCollector push inside the `pm.hasBakedKeyforms`
// branch; the `kfList` carray_list + per-angle `emitArtMeshForm`
// calls stay intact. Byte-level export fidelity is pinned downstream
// by `test_e2e_equivalence.mjs` + `test_shelbyByteFidelity.mjs`.
//
// Sister test: `test_artMeshParentBoneRig.mjs` exercises the same
// generateCmo3 path with a Shelby-shaped legwear bone-baked rig and
// asserts the rest-invariant (chainEval at param=0 = canvas verts).
// That test still passes because we leave the rest verts untouched.
//
// Run: node scripts/test/test_boneBakedArtMeshAdapter.mjs

import { generateCmo3 } from '../../src/io/live2d/cmo3writer.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}
function approx(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

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
    jointPivotX: n.mesh.jointPivotX,
    jointPivotY: n.mesh.jointPivotY,
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
    rigOnly: false, // need full XML emit to count CArtMeshForms
  };
}

// Shelby-shaped bone-baked legwear rig: torso (non-bone) → leftLeg (bone)
// → leftKnee (bone) → legwear-l (part, jointBoneId='leftKnee',
// boneWeights=[1,1,1,1]). The leftLeg group has no directly-skinned
// mesh of its own, so `rotationDeformerEmit` synthesises a
// `GroupRotation_leftLeg` deformer for it — the bone-baked legwear
// ends up artParent={type:'rotation', id:'GroupRotation_leftLeg'} with
// pivot-relative vertex frames. Mirrors test_artMeshParentBoneRig.mjs
// Case B (the path post-2026-05-22 `bakedReencodeToCanvas` covers).
function buildBoneBakedRig() {
  return {
    schemaVersion: 0,
    canvas: { width: 1024, height: 1024 },
    parameters: [],
    physics_groups: [],
    animations: [],
    nodes: [
      { id: 'torso',     type: 'group', name: 'torso',     boneRole: null },
      { id: 'leftLeg',   type: 'group', name: 'leftLeg',   boneRole: 'leftLeg',   parent: 'torso' },
      { id: 'leftKnee',  type: 'group', name: 'leftKnee',  boneRole: 'leftKnee',  parent: 'leftLeg' },
      {
        id: 'legwear-l', type: 'part', name: 'legwear-l', tag: 'legwear',
        parent: 'leftKnee', visible: true,
        mesh: {
          vertices: [324, 700, 424, 700, 424, 900, 324, 900],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          triangles: [0, 1, 2, 0, 2, 3],
          jointBoneId: 'leftKnee',
          boneWeights: [1, 1, 1, 1],
          jointPivotX: 374,
          jointPivotY: 750,
        },
      },
    ],
  };
}

// ── Contract 1: rigCollector entry for bone-baked part is Blender-faithful ─
//
// Before this slice: N keyforms (per BAKED_ANGLE) + ParamRotation_<bone>
// binding — dead store-side (selectRigSpec collapses anyway).
// After this slice: 1 rest keyform + default ParamOpacity[1.0] binding
// (matches the default `else` branch in artMeshSourceEmit). Bone LBS
// owns the deformation; the param/keyform dim is a no-op pass-through.

{
  const result = await generateCmo3(toGeneratorInput(buildBoneBakedRig()));
  const am = result.rigSpec.artMeshes.find((m) => m.id === 'legwear-l');
  assert(!!am, 'legwear-l artMesh present in rigSpec');
  assert(am.parent?.type === 'rotation' && am.parent?.id === 'GroupRotation_leftLeg',
    `legwear-l artParent={type:'rotation', id:'GroupRotation_leftLeg'} (got ${JSON.stringify(am?.parent)})`);

  // Bindings: exactly one ParamOpacity[1.0] entry; NO ParamRotation_*.
  // Bone LBS owns the rotation; the param-driven keyform indirection
  // is an export-only adapter that the rigCollector must NOT mirror.
  assertEq(am.bindings.length, 1,
    `legwear-l bindings.length === 1 (got ${am?.bindings?.length})`);
  assertEq(am.bindings[0]?.parameterId, 'ParamOpacity',
    `legwear-l binding[0].parameterId === 'ParamOpacity' (got '${am?.bindings?.[0]?.parameterId}')`);
  assertEq(Array.from(am.bindings[0]?.keys ?? []), [1.0],
    'legwear-l binding[0].keys === [1.0] (default plan, no per-angle bake)');
  const hasParamRotation = am.bindings.some(
    (b) => typeof b?.parameterId === 'string' && b.parameterId.startsWith('ParamRotation_'),
  );
  assert(!hasParamRotation,
    'legwear-l carries NO ParamRotation_<bone> binding (bone LBS owns rotation, not keyforms)');

  // Keyforms: exactly 1 rest keyform (pivot-relative under
  // GroupRotation_leftLeg). The exact vertex values are pinned by
  // Contract 2's chainEval rest-invariant (verticesCanvas round-trip).
  assertEq(am.keyforms.length, 1,
    `legwear-l keyforms.length === 1 (got ${am?.keyforms?.length})`);
  assertEq(Array.from(am.keyforms[0]?.keyTuple ?? []), [1.0],
    'legwear-l keyforms[0].keyTuple === [1.0] (matches ParamOpacity binding)');
  const kfVerts = am.keyforms[0]?.vertexPositions;
  assert(kfVerts && kfVerts.length === 8,
    `legwear-l keyforms[0].vertexPositions has 8 entries (got ${kfVerts?.length})`);
}

// ── Contract 2: chainEval rest invariant ─────────────────────────────
// Critical sibling test (test_artMeshParentBoneRig.mjs) asserts this for
// the same fixture — we re-pin it here so a regression on Slice 1B is
// caught BEFORE the sibling suite. At param=0 (no pose), chainEval's
// output for the bone-baked part = canvas rest verts.

{
  const result = await generateCmo3(toGeneratorInput(buildBoneBakedRig()));
  const frames = evalRig(result.rigSpec, {});
  const frame = frames.find((f) => f.id === 'legwear-l');
  assert(!!frame, 'evalRig produced a frame for legwear-l');
  const src = result.rigSpec.artMeshes.find((m) => m.id === 'legwear-l')?.verticesCanvas;
  let maxDelta = 0;
  for (let i = 0; i < src.length; i++) {
    const d = Math.abs(src[i] - frame.vertexPositions[i]);
    if (d > maxDelta) maxDelta = d;
  }
  assert(maxDelta < 1.0,
    `legwear-l chainEval rest === verticesCanvas within 1 px (maxDelta=${maxDelta.toFixed(3)})`);
}

console.log(`\nboneBakedArtMeshAdapter: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
