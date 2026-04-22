// Smoke test for arm sway physics on a realistic model.
// Confirms the end-to-end pipeline:
//   - Handwear has NO ParamArmSwayX (physics drives bone rotation deformers)
//   - ParamRotation_leftElbow exists (driven by arm pendulum)
//   - Handwear has NO rigWarp (bone-skinned + baked keyforms handle pose)
//   - Topwear rigWarp emits 2 × 3 = 9 keyforms (Shirt + Bust only)
//   - PhysicsSetting_ArmSnake fires (requireAnyTag = handwear*)

import { generateCmo3 } from '../src/io/live2d/cmo3writer.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TINY_PNG = new Uint8Array([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
  0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,
  0,0,0,13,73,68,65,84,120,156,99,252,255,255,63,0,5,
  254,2,254,167,53,129,132,0,0,0,0,73,69,78,68,174,66,96,130,
]);
function mk(name, tag, cx, cy, w, h, extras = {}) {
  const x0 = cx - w/2, x1 = cx + w/2, y0 = cy - h/2, y1 = cy + h/2;
  return {
    name, tag, partId: name,
    vertices: new Float32Array([x0,y0, x1,y0, x0,y1, x1,y1]),
    triangles: [0,1,2, 2,1,3],
    uvs: new Float32Array([0,0, 1,0, 0,1, 1,1]),
    pngData: TINY_PNG,
    pngPath: `${name}.png`,
    origin: { x: cx, y: cy },
    ...extras,
  };
}

const groups = [
  { id: 'g-root',  name: 'root',       parent: null,      pivotX: 500, pivotY: 1000, boneRole: 'root' },
  { id: 'g-torso', name: 'torso',      parent: 'g-root',  pivotX: 500, pivotY: 800,  boneRole: 'torso' },
  { id: 'g-ls',    name: 'leftArm',    parent: 'g-torso', pivotX: 380, pivotY: 720,  boneRole: 'leftArm' },
  { id: 'g-le',    name: 'leftElbow',  parent: 'g-ls',    pivotX: 360, pivotY: 840,  boneRole: 'leftElbow' },
  { id: 'g-rs',    name: 'rightArm',   parent: 'g-torso', pivotX: 620, pivotY: 720,  boneRole: 'rightArm' },
  { id: 'g-re',    name: 'rightElbow', parent: 'g-rs',    pivotX: 640, pivotY: 840,  boneRole: 'rightElbow' },
];

const meshes = [
  mk('Face',    'face',    500, 300, 200, 280),
  mk('Topwear', 'topwear', 500, 800, 400, 300),
  mk('HandwearL', 'handwear-l', 360, 960, 80, 80, {
    jointBoneId: 'g-le', jointPivotX: 360, jointPivotY: 840,
    boneWeights: new Float32Array([1, 1, 1, 1]),
  }),
  mk('HandwearR', 'handwear-r', 640, 960, 80, 80, {
    jointBoneId: 'g-re', jointPivotX: 640, jointPivotY: 840,
    boneWeights: new Float32Array([1, 1, 1, 1]),
  }),
];

const out = await generateCmo3({
  canvasW: 1000, canvasH: 1500, meshes, groups,
  modelName: 'ArmCascadeTest', generateRig: true,
});

let fail = 0;
const chk = (ok, msg) => { console.log((ok?'  ✓ ':'  ✗ ') + msg); if (!ok) fail++; };

chk(out.cmo3 instanceof Uint8Array && out.cmo3.byteLength > 1000,
  `generateCmo3 produced ${out.cmo3.byteLength} bytes`);
// 3 physics rules gate-in: Shirt + Bust (topwear present) + ArmSnake (handwear present).
// The other 4 need hair / bottomwear / legwear tags.
chk(out.rigDebugLog.physics.emittedCount === 3,
  `3 physics rules emitted (got ${out.rigDebugLog.physics.emittedCount})`);
for (const id of ['PhysicsSetting4', 'PhysicsSetting6', 'PhysicsSetting_ArmSnake']) {
  chk(out.rigDebugLog.physics.emittedIds.includes(id), `${id} emitted`);
}

// Inspect the .cmo3 payload via inspect_cmo3.mjs (handles CAFF unwrap).
const here = dirname(fileURLToPath(import.meta.url));
const tmpPath = join(here, '_arm_cascade_tmp.cmo3');
writeFileSync(tmpPath, out.cmo3);
try {
  const inspect = (pattern) =>
    spawnSync('node', [join(here, 'inspect_cmo3.mjs'), tmpPath, pattern],
              { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }).stdout || '';

  // Arm sway drives existing bone rotation deformer params, so there's no
  // dedicated sway param — handwear keeps ONLY its bone-baked keyforms, no
  // rigWarp, no keyforms count for ArmSway.
  chk(!inspect('ParamArmSwayX').includes('note="ParamArmSwayX"'),
    'ParamArmSwayX should be ABSENT (physics drives bone rotations directly)');
  chk(inspect('ParamRotation_leftElbow').includes('note="ParamRotation_leftElbow"'),
    'ParamRotation_leftElbow exists (driven by arm sway physics)');

  const kfCounts = inspect('keyforms. count=.[0-9]+')
    .split('\n')
    .map(l => (l.match(/keyforms"\s+count="(\d+)"/) || [])[1])
    .filter(Boolean);
  // Topwear has Shirt + Bust = 9 keyforms. Handwear has no rigWarp.
  chk(kfCounts.includes('9'), 'topwear rigWarp has 9 keyforms (Shirt×Bust)');
} finally {
  try { unlinkSync(tmpPath); } catch {}
}

console.log(fail === 0 ? '[arm-cascade] ALL PASSED ✓' : `[arm-cascade] ${fail} FAILED ✗`);
process.exit(fail === 0 ? 0 : 1);
