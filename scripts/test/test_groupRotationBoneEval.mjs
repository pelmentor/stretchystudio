// Slice E — does the depgraph evaluate a group-rotation BONE to the SAME
// result the legacy rotation DEFORMER produced? (RULE №4 refactor.)
//
// The Slice-A characterization oracle (test_groupRotationCharacterization)
// froze a part driven by a `GroupRotation_grp` rotation deformer at:
//   rest  = [350,250, 450,250, 350,350, 450,350]
//   rot30 = [381.699,231.699, 468.301,281.699, 331.699,318.301, 418.301,368.301]
//
// Here the SAME geometry is expressed the Blender way: a group-rotation BONE
// (head = pivot (400,300)) with the part bound to it at weight 1 (canvas-px
// rest verts). The depgraph's existing LBS (applyBonePostChainSkin) should
// rotate those verts around the pivot by the pose angle and reproduce the
// frozen baseline — proving the bone model evals identically to the deformer
// model, so the migration just needs to bind parts to the bone.
//
// Run: node scripts/test/test_groupRotationBoneEval.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
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
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

const REST = [350, 250, 450, 250, 350, 350, 450, 350];
const ROT30 = [381.699, 231.699, 468.301, 281.699, 331.699, 318.301, 418.301, 368.301];

// Bone-model fixture: the group rotation is a BONE (head=pivot 400,300); the
// part carries canvas-px REST verts bound to the bone at weight 1.
function makeProject(poseRotation) {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [
      { id: 'ParamRotation_grp', name: 'ParamRotation_grp', defaultValue: 0, minValue: -30, maxValue: 30 },
    ],
    nodes: [
      { id: 'grp', type: 'group', boneRole: 'groupRotation_grp', name: 'grp', parent: null,
        transform: { pivotX: 400, pivotY: 300, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        pose: { rotation: poseRotation, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        parent: 'grp', rigParent: null,
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: REST.slice(),
          boneWeights: [1, 1, 1, 1],
          jointBoneId: 'grp',
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: REST.slice() }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
}

function evalFace(poseRotation) {
  const project = makeProject(poseRotation);
  synthesizeModifierStacks(project);
  const frames = evalProjectFrameViaDepgraph(project, {});
  const f = frames.find((fr) => fr.id === 'face');
  return f ? Array.from(f.vertexPositions) : null;
}

{
  const at0 = evalFace(0);
  assert(at0 != null, 'bone model produced a face frame');
  assert(maxDelta(at0, REST) < 1e-3,
    `bone model at rest == deformer-model rest (got ${at0?.map((v) => v.toFixed(2))})`);
}
{
  const at30 = evalFace(30);
  // Diagnostic — print the actual so any sign/convention gap is visible.
  console.log(`  [diag] bone LBS @ pose.rotation=30 → ${at30?.map((v) => v.toFixed(3))}`);
  console.log(`  [diag] deformer baseline ROT30      → ${ROT30.map((v) => v.toFixed(3))}`);
  assert(maxDelta(at30, ROT30) < 0.05,
    `bone model @30 == deformer-model rot30 (depgraph LBS reproduces the rotation deformer)`);
}

console.log(`groupRotationBoneEval: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
