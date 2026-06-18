// Verifies the disappear diagnostic in the ART_MESH_EVAL kernel fires when
// a part's final eval verts land off-canvas, and dumps the causal state
// (modifier stack, composition, jointBone world/pose). "Stop guessing —
// make logging" instrumentation for the Apply-armature disappearance.
//
// Run: node scripts/test/test_artMeshDisappearDiag.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL: ${m}`); } };

// Capture console.warn (logger mirrors to it).
const calls = [];
const origWarn = console.warn;
console.warn = (...args) => { calls.push(args.join(' ')); };

const TRI = [200, 150, 600, 150, 400, 450];
const project = {
  canvas: { width: 800, height: 600 },
  parameters: [],
  nodes: [
    // Bone with a RUNAWAY pose translation → LBS flings the part far off-canvas.
    {
      id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow', parent: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      pose: { rotation: 0, x: 999999, y: 999999, scaleX: 1, scaleY: 1 },
    },
    {
      id: 'p', type: 'part', name: 'handwear-l', parent: 'leftElbow', modifiers: [
        { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3,
          data: { jointBoneId: 'leftElbow', parentBoneId: null } },
      ],
      mesh: {
        vertices: [{ x: 200, y: 150 }, { x: 600, y: 150 }, { x: 400, y: 450 }],
        triangles: [0, 1, 2], uvs: [0, 0, 1, 0, 0.5, 1],
        boneWeights: [1, 1, 1], jointBoneId: 'leftElbow',
        runtime: { bindings: [], keyforms: [{ keyTuple: [], vertexPositions: [...TRI], opacity: 1 }] },
      },
    },
  ],
};

const rigSpec = selectRigSpec(project);
evalProjectFrameViaDepgraph(project, {}, { rigSpec });

console.warn = origWarn;

const diag = calls.find((c) => c.includes('artMeshDisappearDiag'));
ok(!!diag, 'diagnostic fired when part evaled off-canvas');
ok(diag && diag.includes('handwear-l'), 'diagnostic names the vanished part');
ok(diag && diag.includes('off-canvas'), 'diagnostic states the reason');
ok(diag && diag.includes('armature'), 'diagnostic dumps the modifier stack (armature present)');
ok(diag && diag.includes('composition=lbs'), 'diagnostic dumps the composition decision (lbs = still skinning)');

// Healthy part (no runaway pose) must NOT trip the diagnostic.
const calls2 = [];
console.warn = (...args) => { calls2.push(args.join(' ')); };
const healthy = {
  canvas: { width: 800, height: 600 }, parameters: [],
  nodes: [{
    id: 'q', type: 'part', name: 'face', parent: null, modifiers: [],
    mesh: { vertices: [{ x: 200, y: 150 }, { x: 600, y: 150 }, { x: 400, y: 450 }], triangles: [0, 1, 2], uvs: [0, 0, 1, 0, 0.5, 1],
      runtime: { bindings: [], keyforms: [{ keyTuple: [], vertexPositions: [...TRI], opacity: 1 }] } },
  }],
};
evalProjectFrameViaDepgraph(healthy, {}, { rigSpec: selectRigSpec(healthy) });
console.warn = origWarn;
ok(!calls2.some((c) => c.includes('artMeshDisappearDiag')), 'healthy on-canvas part does NOT trip the diagnostic');

console.log(`\nartMeshDisappearDiag: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
