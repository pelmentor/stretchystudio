// Slice G validation — migrate GroupRotation deformers → bones on the REAL
// pipeline's rig structure (not a hand-authored fixture), proving the flip is
// safe across the COMPLEX cases the synthetic `test_groupRotationMigration`
// doesn't cover: MULTIPLE group rotations and NESTED ones (a group rotation
// whose chain parent is another group rotation).
//
// Pipeline: author a source with nested non-bone groups → `harvestRealRig`
// (real `generateCmo3`) → `seedRigSpecToNodes` (the real seedAllRig peer
// sequence) gives the deformer-model project → eval baseline (depgraph) →
// `migrateGroupRotationDeformersToBones` → eval the bone model (depgraph) →
// assert byte-equivalence at rest, single-rotation, AND nested-rotation.
//
// The make-or-break path: nested rotations compose innermost-first in the
// deformer chain; the bone model composes via the group-parent bone hierarchy
// (`resolveBoneWorldFromCtx`). This test is the arbiter that the two orders
// agree (they must, per RULE №4 — the bone model is the authoring truth).
//
// Run: node scripts/test/test_groupRotationMigrationRealRig.mjs

import { harvestRealRig, seedRigSpecToNodes } from './realRigHarness.mjs';
import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { migrateGroupRotationDeformersToBones } from '../../src/store/migrations/groupRotationToBone.js';
import { synthesizeModifierStacks, synthesizeDeformerParents } from '../../src/store/deformerNodeSync.js';
import { isGroupRotationBoneNode } from '../../src/store/warpLatticeAccess.js';

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
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
function evalPart(project, params, partId) {
  const frames = evalProjectFrameViaDepgraph(project, params);
  const f = frames.find((fr) => fr.id === partId);
  return f ? Array.from(f.vertexPositions) : null;
}

// ── Source: nested non-bone groups. `accessory` + `trinket` are children of
//    `torso`; the pipeline gives each non-bone group a GroupRotation deformer,
//    so `GroupRotation_accessory`/`_trinket` are chain-parented to
//    `GroupRotation_torso` (the NESTED case). `charm` rides accessory, `bead`
//    rides trinket. ──
const source = {
  schemaVersion: 0,
  canvas: { width: 1024, height: 1024 },
  parameters: [],
  physics_groups: [],
  animations: [],
  nodes: [
    { id: 'torso', type: 'group', name: 'torso', boneRole: null },
    { id: 'accessory', type: 'group', name: 'accessory', boneRole: null, parent: 'torso' },
    { id: 'trinket', type: 'group', name: 'trinket', boneRole: null, parent: 'torso' },
    { id: 'charm', type: 'part', name: 'charm', tag: 'accessory', parent: 'accessory', visible: true,
      mesh: { vertices: [500, 400, 600, 400, 600, 520, 500, 520], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        triangles: [0, 1, 2, 0, 2, 3], jointBoneId: null, boneWeights: null } },
    { id: 'bead', type: 'part', name: 'bead', tag: 'trinket', parent: 'trinket', visible: true,
      mesh: { vertices: [700, 300, 760, 300, 760, 360, 700, 360], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        triangles: [0, 1, 2, 0, 2, 3], jointBoneId: null, boneWeights: null } },
  ],
};

const rigSpec = await harvestRealRig(source);

// Confirm the real pipeline produced the nested structure this test exists for.
const rotById = new Map((rigSpec.rotationDeformers ?? []).map((r) => [r.id, r]));
assert(rotById.has('GroupRotation_torso') && rotById.has('GroupRotation_accessory') && rotById.has('GroupRotation_trinket'),
  'real pipeline: three group rotations present',
  `ids=${JSON.stringify([...rotById.keys()])}`);
assert(rotById.get('GroupRotation_accessory')?.parent?.type === 'rotation'
  && rotById.get('GroupRotation_accessory')?.parent?.id === 'GroupRotation_torso',
  'real pipeline: GroupRotation_accessory is NESTED under GroupRotation_torso (the complex case)',
  `parent=${JSON.stringify(rotById.get('GroupRotation_accessory')?.parent)}`);

const P_TORSO = 'ParamRotation_torso';
const P_ACC = 'ParamRotation_accessory';
const P_TRI = 'ParamRotation_trinket';

// ── Deformer-model baselines (depgraph) ──
const deformer = seedRigSpecToNodes(source, rigSpec);
const baseRest = evalPart(deformer, {}, 'charm');
const baseAcc30 = evalPart(deformer, { [P_ACC]: 30 }, 'charm');            // single (innermost)
const baseTorso20 = evalPart(deformer, { [P_TORSO]: 20 }, 'charm');        // single (outer)
const baseNested = evalPart(deformer, { [P_TORSO]: 20, [P_ACC]: 30 }, 'charm'); // NESTED
const beadRest = evalPart(deformer, {}, 'bead');
const beadNested = evalPart(deformer, { [P_TORSO]: 20, [P_TRI]: -25 }, 'bead');

assert(maxDelta(baseRest, [500, 400, 600, 400, 600, 520, 500, 520]) < 0.05,
  'deformer rest == canvas-px verts', `rest=${baseRest?.map((v) => v.toFixed(2))}`);
assert(maxDelta(baseAcc30, baseRest) > 1, 'deformer @acc30 actually moved (non-vacuous)');
assert(maxDelta(baseNested, baseAcc30) > 1, 'deformer nested ≠ single (torso rotation contributes)');

// ── Migrate → bone model ──
const bone = seedRigSpecToNodes(source, rigSpec);
migrateGroupRotationDeformersToBones(bone);
// The real seedAllRig flip re-runs synth after the migration so the bone-bound
// parts gain an Armature modifier + lose the stale rotation entries.
synthesizeModifierStacks(bone);
synthesizeDeformerParents(bone);
const byId = new Map(bone.nodes.map((n) => [n.id, n]));
const torsoB = byId.get('torso');
const accB = byId.get('accessory');
const triB = byId.get('trinket');
const charmB = byId.get('charm');

// Structure
assert(isGroupRotationBoneNode(torsoB) && isGroupRotationBoneNode(accB) && isGroupRotationBoneNode(triB),
  'migration: all three groups became groupRotation bones');
assert(!bone.nodes.some((n) => n?.type === 'deformer' && n.deformerKind === 'rotation'),
  'migration: every rotation deformer node removed');
assert(accB?.parent === 'torso' && triB?.parent === 'torso',
  'migration: bone hierarchy preserved (accessory/trinket parent = torso)');
assert(Math.abs(accB.transform.pivotX - 550) < 1 && Math.abs(accB.transform.pivotY - 460) < 1,
  'migration: accessory bone head = canvas-final rest pivot (550,460)',
  `pivot=(${accB.transform.pivotX},${accB.transform.pivotY})`);
// torso is a no-direct-part container: its canvas-final pivot is recovered from
// a child rotation (childPivot − child.authoredOrigin), CONSISTENT across both
// children — accessory: 550−(−80)=630, 460−50=410; trinket: 730−100=630,
// 330−(−80)=410 → (630,410). NOT the warp-local authored origin (0.5,0.5).
assert(Math.abs(torsoB.transform.pivotX - 630) < 1 && Math.abs(torsoB.transform.pivotY - 410) < 1,
  'migration: torso (no direct part) bone head recovered from child rotation = (630,410)',
  `pivot=(${torsoB.transform.pivotX},${torsoB.transform.pivotY})`);
assert(charmB.mesh.jointBoneId === 'accessory'
  && JSON.stringify(charmB.mesh.boneWeights) === JSON.stringify([1, 1, 1, 1]),
  'migration: charm bound weight-1 to the accessory bone');

// ── Bone model reproduces the deformer baseline ──
function setRot(id, deg) { byId.get(id).pose.rotation = deg; }

setRot('torso', 0); setRot('accessory', 0); setRot('trinket', 0);
const boneRest = evalPart(bone, {}, 'charm');
assert(maxDelta(boneRest, baseRest) < 0.05,
  `bone rest == deformer rest (maxDelta=${maxDelta(boneRest, baseRest).toFixed(4)})`);

setRot('accessory', 30);
const boneAcc30 = evalPart(bone, {}, 'charm');
assert(maxDelta(boneAcc30, baseAcc30) < 0.05,
  `bone @acc30 == deformer @acc30 (maxDelta=${maxDelta(boneAcc30, baseAcc30).toFixed(4)})`,
  `bone=${boneAcc30?.map((v) => v.toFixed(2))} def=${baseAcc30?.map((v) => v.toFixed(2))}`);

setRot('accessory', 0); setRot('torso', 20);
const boneTorso20 = evalPart(bone, {}, 'charm');
assert(maxDelta(boneTorso20, baseTorso20) < 0.05,
  `bone @torso20 == deformer @torso20 (maxDelta=${maxDelta(boneTorso20, baseTorso20).toFixed(4)})`,
  `bone=${boneTorso20?.map((v) => v.toFixed(2))} def=${baseTorso20?.map((v) => v.toFixed(2))}`);

setRot('torso', 20); setRot('accessory', 30);
const boneNested = evalPart(bone, {}, 'charm');
assert(maxDelta(boneNested, baseNested) < 0.05,
  `bone NESTED == deformer NESTED — MIGRATION PRESERVES NESTED EVAL (maxDelta=${maxDelta(boneNested, baseNested).toFixed(4)})`,
  `bone=${boneNested?.map((v) => v.toFixed(2))} def=${baseNested?.map((v) => v.toFixed(2))}`);

// Second mesh under a sibling nested rotation.
setRot('torso', 20); setRot('trinket', -25);
const boneBeadNested = evalPart(bone, {}, 'bead');
assert(maxDelta(beadRest, [700, 300, 760, 300, 760, 360, 700, 360]) < 0.05, 'deformer bead rest == canvas-px');
assert(maxDelta(boneBeadNested, beadNested) < 0.05,
  `bone bead NESTED == deformer bead NESTED (maxDelta=${maxDelta(boneBeadNested, beadNested).toFixed(4)})`,
  `bone=${boneBeadNested?.map((v) => v.toFixed(2))} def=${beadNested?.map((v) => v.toFixed(2))}`);

console.log(`groupRotationMigrationRealRig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
