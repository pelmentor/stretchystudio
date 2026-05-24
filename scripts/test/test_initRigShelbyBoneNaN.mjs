// URGENT reproduction harness — Shelby-like PSD → Init Rig → SkeletonOverlay NaN.
//
// The user is BLOCKED at HEAD `1304fbf`: fresh PSD import → Init Rig → React
// SVG warnings for `cx/cy/x1/y1/x2/y2/x/y` and invisible body parts. The
// hypothesis is that `migrateGroupRotationDeformersToBones` derives bone
// pivots from `mesh.vertices − runtime.keyforms[0].vertexPositions` for parts
// whose `.parent === groupName`. If the topology signal fails to match (parts
// don't sit directly under the group, or the keyforms cascade NaN), pivots
// fall back to `rk?.originX ?? 0` — and if rk.originX itself is NaN, every
// downstream consumer (SkeletonOverlay reading `node.transform.pivotX`) gets
// NaN attributes.
//
// Run:  node scripts/test/test_initRigShelbyBoneNaN.mjs
//
// No browser stubs needed — `harvestRealRig` already runs the real generator
// in Node, and `seedRigSpecToNodes` is the test-mirror of seedAllRig's peer
// sequence (artMesh runtime persist + modifier-stack synth).

import { harvestRealRig, seedRigSpecToNodes } from './realRigHarness.mjs';
import { migrateGroupRotationDeformersToBones } from '../../src/store/migrations/groupRotationToBone.js';
import { synthesizeModifierStacks, synthesizeDeformerParents } from '../../src/store/deformerNodeSync.js';
import { isGroupRotationBoneNode } from '../../src/store/warpLatticeAccess.js';

// ── Synthetic Shelby-like project ──────────────────────────────────────────
// 23 parts, humanoid layout. Bone groups match the runtime log: root, head,
// leftArm, rightArm, leftElbow, rightElbow, leftLeg, rightLeg, leftKnee,
// rightKnee. Limb parts (handwear/legwear) sit under their elbow/knee group
// so the migration's topology signal (`part.parent === groupName`) hits.

const CW = 1280;
const CH = 1280;
const CX = CW / 2;

// Helper to build a rectangular mesh at (cx,cy) sized (w,h) with N×M grid.
function rectMesh(cx, cy, w, h, nx = 4, ny = 4) {
  const verts = [];
  const uvs = [];
  const tris = [];
  const x0 = cx - w / 2, y0 = cy - h / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1), v = j / (ny - 1);
      verts.push(x0 + u * w, y0 + v * h);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      tris.push(a, b, c, b, d, c);
    }
  }
  return { vertices: verts, uvs, triangles: tris, jointBoneId: null, boneWeights: null };
}

// Mesh with ~150 verts (10×15) — bone-baked limb mesh size per the bug spec.
function bigRectMesh(cx, cy, w, h) {
  return rectMesh(cx, cy, w, h, 10, 15);
}

const nodes = [
  // Bone groups (non-bone at source; pipeline + migration converts to bone).
  { id: 'root',       type: 'group', name: 'root',       boneRole: null, parent: null },
  { id: 'head',       type: 'group', name: 'head',       boneRole: null, parent: 'root' },
  { id: 'leftArm',    type: 'group', name: 'leftArm',    boneRole: null, parent: 'root' },
  { id: 'rightArm',   type: 'group', name: 'rightArm',   boneRole: null, parent: 'root' },
  { id: 'leftElbow',  type: 'group', name: 'leftElbow',  boneRole: null, parent: 'leftArm' },
  { id: 'rightElbow', type: 'group', name: 'rightElbow', boneRole: null, parent: 'rightArm' },
  { id: 'leftLeg',    type: 'group', name: 'leftLeg',    boneRole: null, parent: 'root' },
  { id: 'rightLeg',   type: 'group', name: 'rightLeg',   boneRole: null, parent: 'root' },
  { id: 'leftKnee',   type: 'group', name: 'leftKnee',   boneRole: null, parent: 'leftLeg' },
  { id: 'rightKnee',  type: 'group', name: 'rightKnee',  boneRole: null, parent: 'rightLeg' },

  // 23 parts. tag drives auto-rig classification.
  // Torso / clothing.
  part('torso',      'torso',      'root',       rectMesh(CX,      720, 280, 360)),
  part('topwear',    'topwear',    'root',       rectMesh(CX,      720, 290, 360)),
  part('bottomwear', 'bottomwear', 'root',       rectMesh(CX,      940, 280, 220)),

  // Limbs — bone-baked (~150 verts), positioned at canvas arm/leg coords.
  part('handwear-l', 'handwear',   'leftElbow',  bigRectMesh(CX - 220, 820, 80, 200)),
  part('handwear-r', 'handwear',   'rightElbow', bigRectMesh(CX + 220, 820, 80, 200)),
  part('legwear-l',  'legwear',    'leftKnee',   bigRectMesh(CX - 80, 1080, 90, 220)),
  part('legwear-r',  'legwear',    'rightKnee',  bigRectMesh(CX + 80, 1080, 90, 220)),

  // Head + face features. All under `head` group.
  part('head-shape', 'head',       'head',       rectMesh(CX,      420, 280, 320)),
  part('neck',       'neck',       'head',       rectMesh(CX,      580, 120,  80)),
  part('hair-front', 'hair',       'head',       rectMesh(CX,      360, 320, 240)),
  part('hair-back',  'hair',       'head',       rectMesh(CX,      400, 360, 320)),
  part('tail',       'hair',       'head',       rectMesh(CX,      300, 100, 200)),
  part('ears-l',     'ear',        'head',       rectMesh(CX - 150, 380, 60,  80)),
  part('ears-r',     'ear',        'head',       rectMesh(CX + 150, 380, 60,  80)),
  part('eyebrows-l', 'eyebrow',    'head',       rectMesh(CX - 70, 380, 60, 20)),
  part('eyebrows-r', 'eyebrow',    'head',       rectMesh(CX + 70, 380, 60, 20)),
  part('eyes-l',     'eye',        'head',       rectMesh(CX - 70, 420, 80, 40)),
  part('eyes-r',     'eye',        'head',       rectMesh(CX + 70, 420, 80, 40)),
  part('eyelash-l',  'eyelash',    'head',       rectMesh(CX - 70, 410, 80, 20)),
  part('eyelash-r',  'eyelash',    'head',       rectMesh(CX + 70, 410, 80, 20)),
  part('irides-l',   'iris',       'head',       rectMesh(CX - 70, 420, 30, 30)),
  part('irides-r',   'iris',       'head',       rectMesh(CX + 70, 420, 30, 30)),
  part('eyewhite-l', 'eyewhite',   'head',       rectMesh(CX - 70, 420, 70, 30)),
  part('eyewhite-r', 'eyewhite',   'head',       rectMesh(CX + 70, 420, 70, 30)),
  part('mouth',      'mouth',      'head',       rectMesh(CX,      490, 80, 30)),
];

function part(id, tag, parent, mesh) {
  return { id, type: 'part', name: id, tag, parent, visible: true, mesh };
}

const project = {
  schemaVersion: 0,
  canvas: { width: CW, height: CH },
  parameters: [],
  physics_groups: [],
  animations: [],
  nodes,
};

// ── Run Init Rig pipeline (real generateCmo3 + real seedAllRig peers) ──────
console.log('Step 1: harvestRealRig (runs generateCmo3 in Node)...');
const rigSpec = await harvestRealRig(project);
console.log(`  → ${rigSpec.rotationDeformers?.length ?? 0} rotation deformers, ${rigSpec.artMeshes?.length ?? 0} art meshes`);

console.log('Step 2: seedRigSpecToNodes (mirror of seedAllRig peer sequence)...');
const seeded = seedRigSpecToNodes(project, rigSpec);

console.log('Step 3: migrateGroupRotationDeformersToBones (the suspect)...');
migrateGroupRotationDeformersToBones(seeded);

console.log('Step 4: synthesizeModifierStacks + synthesizeDeformerParents...');
synthesizeModifierStacks(seeded);
synthesizeDeformerParents(seeded);

// ── NaN audit ───────────────────────────────────────────────────────────────
const findings = [];

function check(label, val, where) {
  if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
    findings.push(`${where}: ${label} = ${val}`);
    return false;
  }
  return true;
}

console.log('\nStep 5: walk bone groups checking transform + pose for NaN/non-finite...');
let boneCount = 0;
for (const node of seeded.nodes) {
  if (!isGroupRotationBoneNode(node)) continue;
  boneCount++;
  const t = node.transform ?? {};
  const p = node.pose ?? {};
  const where = `bone "${node.id}" (boneRole=${node.boneRole})`;
  check('transform.pivotX',  t.pivotX,  where);
  check('transform.pivotY',  t.pivotY,  where);
  check('transform.x',       t.x,       where);
  check('transform.y',       t.y,       where);
  check('transform.rotation',t.rotation,where);
  check('transform.scaleX',  t.scaleX,  where);
  check('transform.scaleY',  t.scaleY,  where);
  check('pose.rotation',     p.rotation,where);
  check('pose.x',            p.x,       where);
  check('pose.y',            p.y,       where);
  check('pose.scaleX',       p.scaleX,  where);
  check('pose.scaleY',       p.scaleY,  where);
}
console.log(`  → ${boneCount} bone groups walked`);

console.log('\nStep 6: walk every part mesh.runtime.keyforms[0].vertexPositions for NaN...');
let partCount = 0;
let nanVertParts = 0;
for (const node of seeded.nodes) {
  if (node.type !== 'part') continue;
  partCount++;
  const kfs = node.mesh?.runtime?.keyforms;
  if (!Array.isArray(kfs) || kfs.length === 0) continue;
  const kf0 = kfs[0];
  const vp = kf0?.vertexPositions;
  if (!Array.isArray(vp) && !ArrayBuffer.isView(vp)) continue;
  let nanCount = 0;
  for (let i = 0; i < vp.length; i++) {
    if (Number.isNaN(vp[i]) || !Number.isFinite(vp[i])) nanCount++;
  }
  if (nanCount > 0) {
    nanVertParts++;
    findings.push(`part "${node.id}" (parent=${node.parent}): ${nanCount}/${vp.length} vertex coords NaN/non-finite`);
  }
  // Also check originX/Y on the keyform.
  if (kf0.originX !== undefined) check('runtime.keyforms[0].originX', kf0.originX, `part "${node.id}"`);
  if (kf0.originY !== undefined) check('runtime.keyforms[0].originY', kf0.originY, `part "${node.id}"`);
}
console.log(`  → ${partCount} parts walked, ${nanVertParts} with NaN vertex positions`);

// ── Also walk rigSpec.rotationDeformers' rest keyform origins ─────────────
console.log('\nStep 7: rigSpec rotation deformer rest keyform origins (pre-migration view)...');
for (const def of rigSpec.rotationDeformers ?? []) {
  const rk = (def.keyforms ?? []).find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? def.keyforms?.[0];
  if (!rk) continue;
  const where = `rigSpec rotDef "${def.id}" rest keyform`;
  check('originX', rk.originX, where);
  check('originY', rk.originY, where);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
if (findings.length === 0) {
  console.log('RESULT: NO NaN/non-finite values detected. Harness did NOT reproduce.');
  console.log('═'.repeat(70));
  // Also dump bone pivots for sanity inspection.
  console.log('\nBone pivots (for inspection):');
  for (const node of seeded.nodes) {
    if (!isGroupRotationBoneNode(node)) continue;
    const t = node.transform;
    console.log(`  ${node.id.padEnd(12)} pivot=(${t.pivotX?.toFixed(2)}, ${t.pivotY?.toFixed(2)})  parent=${node.parent}`);
  }
  process.exit(0);
} else {
  console.log(`RESULT: REPRODUCED — ${findings.length} NaN/non-finite finding(s):`);
  console.log('═'.repeat(70));
  for (const f of findings) console.log(`  ${f}`);
  process.exit(1);
}
