// GROUND-TRUTH characterization: how does the REAL Init-Rig pipeline frame a
// part driven by a group rotation? Answers the coord-space question the
// RotationDeformer→bone migration depends on — empirically, via the real
// pipeline (no browser / no assumed fixture).
//
// Builds a non-bone group with a mesh (the pipeline gives such a group a
// `GroupRotation_<g>` deformer + `ParamRotation_<g>` param), harvests the real
// rigSpec, and reports: the part's artMesh.parent, its keyform vertex FRAME
// (canvas-px? pivot-relative?), and the eval at rest + rotated. Frozen as the
// grounded baseline the migration must reproduce.
//
// Run: node scripts/test/test_groupRotationRealRig.mjs

import { harvestRealRig, evalRigSpec, artMeshOf, rotationOf } from './realRigHarness.mjs';

let passed = 0;
let failed = 0;
function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

const project = {
  schemaVersion: 0,
  canvas: { width: 1024, height: 1024 },
  parameters: [],
  physics_groups: [],
  animations: [],
  nodes: [
    { id: 'torso', type: 'group', name: 'torso', boneRole: null },
    // A non-bone, non-skipped group → gets a GroupRotation deformer.
    { id: 'accessory', type: 'group', name: 'accessory', boneRole: null, parent: 'torso' },
    { id: 'charm', type: 'part', name: 'charm', tag: 'accessory', parent: 'accessory', visible: true,
      mesh: {
        vertices: [500, 400, 600, 400, 600, 520, 500, 520],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        triangles: [0, 1, 2, 0, 2, 3],
        jointBoneId: null, boneWeights: null,
      } },
  ],
};

const rigSpec = await harvestRealRig(project);

// 1. The pipeline created a group rotation deformer for the non-bone group.
const rotIds = (rigSpec.rotationDeformers ?? []).map((r) => r.id);
console.log(`  [diag] rotationDeformers: ${JSON.stringify(rotIds)}`);
const groupRot = (rigSpec.rotationDeformers ?? []).find((r) => /accessory/i.test(r.id) || /accessory/i.test(JSON.stringify(r.bindings ?? [])));
assert(!!groupRot, 'pipeline created a GroupRotation deformer for the non-bone group',
  `rotationDeformers=${JSON.stringify(rotIds)}`);

// 2. The charm artMesh — what frame + parent did the pipeline give it?
const am = artMeshOf(rigSpec, 'charm');
assert(!!am, 'charm artMesh present');
if (am) {
  const k0 = am.keyforms?.[0]?.vertexPositions;
  console.log(`  [diag] charm artMesh.parent = ${JSON.stringify(am.parent)}`);
  console.log(`  [diag] charm verticesCanvas = ${am.verticesCanvas ? Array.from(am.verticesCanvas).map((v) => v.toFixed(1)) : 'n/a'}`);
  console.log(`  [diag] charm keyform[0] verts = ${k0 ? Array.from(k0).map((v) => v.toFixed(1)) : 'n/a'}`);
  console.log(`  [diag] charm bindings = ${JSON.stringify(am.bindings)}`);
}

// 3. REST identity — the real eval reproduces the canvas-px source verts.
{
  const frames = evalRigSpec(rigSpec, {});
  const f = frames.find((fr) => fr.id === 'charm');
  assert(!!f, 'rest eval produced a charm frame');
  if (f && am?.verticesCanvas) {
    let maxD = 0;
    for (let i = 0; i < f.vertexPositions.length; i++) {
      maxD = Math.max(maxD, Math.abs(f.vertexPositions[i] - am.verticesCanvas[i]));
    }
    console.log(`  [diag] charm rest eval vs verticesCanvas maxDelta = ${maxD.toFixed(3)}`);
    assert(maxD < 1.0, 'rest eval ≡ canvas-px source verts (within 1px)');
  }
}

// GROUNDED FINDINGS (frozen from the real pipeline — the migration relies on these):
//  - the part's keyforms are PIVOT-RELATIVE (centred near origin), while
//    `verticesCanvas` already holds the canvas-px rest → the bone-model
//    conversion is just "use verticesCanvas + the rotation pivot", no guessing.
{
  const k0 = Array.from(am?.keyforms?.[0]?.vertexPositions ?? []);
  const vc = Array.from(am?.verticesCanvas ?? []);
  const isPivotRelative = k0.length > 0 && k0.every((v) => Math.abs(v) < 200);
  assert(isPivotRelative, 'GROUNDED: group-rotation keyforms are pivot-relative (not canvas-px)');
  // The rotation is WARP-PARENTED (authored originX/Y is warp-local (0,0)); the
  // CANVAS-FINAL rest pivot — what the part actually rotates around, = the
  // future bone head — is verticesCanvas[i] − pivotRelKeyform[i] (constant).
  const restK = (groupRot.keyforms ?? []).find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? groupRot.keyforms?.[0];
  console.log(`  [diag] GroupRotation authored pivot (warp-local) = (${restK?.originX}, ${restK?.originY})`);
  const boneHeadX = vc[0] - k0[0];
  const boneHeadY = vc[1] - k0[1];
  console.log(`  [diag] derived canvas-final rest pivot (= bone head) = (${boneHeadX}, ${boneHeadY})`);
  assert(Math.abs(boneHeadX - 550) < 1 && Math.abs(boneHeadY - 460) < 1,
    'GROUNDED: bone head = canvas-final rest pivot = part centroid (550,460), derivable from verticesCanvas − keyform');
  assert((restK?.originX ?? -1) === 0 && (restK?.originY ?? -1) === 0,
    'GROUNDED: authored pivot is warp-local (0,0) — group rotations are WARP-PARENTED by default');
}

// 4. Rotated baseline — FROZEN from the real pipeline. The migrated bone model
//    must reproduce these verts (proven equivalent by test_groupRotationBoneEval).
{
  const paramId = groupRot.bindings?.[0]?.parameterId;
  const ROT30 = [536.70, 383.04, 623.30, 433.04, 563.30, 536.96, 476.70, 486.96];
  const frames = evalRigSpec(rigSpec, { [paramId]: 30 });
  const f = frames.find((fr) => fr.id === 'charm');
  assert(!!f, 'rotated eval produced a charm frame');
  if (f) {
    let maxD = 0;
    for (let i = 0; i < ROT30.length; i++) maxD = Math.max(maxD, Math.abs(f.vertexPositions[i] - ROT30[i]));
    assert(maxD < 0.05,
      `GROUNDED baseline @ ${paramId}=30 locked (maxDelta=${maxD.toFixed(3)})`);
  }
}

console.log(`groupRotationRealRig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
