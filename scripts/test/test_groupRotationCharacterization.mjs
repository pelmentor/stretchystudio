// Slice A — characterization oracle for the RotationDeformer → bone refactor.
//
// Locks the CURRENT depgraph eval output for a part driven by a Cubism
// GroupRotation deformer, so every later refactor slice (synth layer,
// migration, seedAllRig flip) can be proven byte-non-breaking: the eval must
// reproduce these exact verts after the rotation deformer becomes a bone +
// is re-synthesized at eval time.
//
// This is the safety net that makes Slices B–F shippable blind: if the
// rotation chain still produces these positions, the refactor preserved
// behavior. (Captured by running once, then frozen as the baseline.)
//
// Run: node scripts/test/test_groupRotationCharacterization.mjs

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

// A part `face` parented to a GroupRotation deformer at pivot (400,300).
// The part's runtime carries pivot-relative rest verts (the rotation's local
// frame); the rotation's canvas-final matrix maps them to canvas-px.
function makeProject() {
  const localVerts = [-50, -50, 50, -50, -50, 50, 50, 50]; // pivot-relative
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [
      { id: 'ParamRotation_grp', name: 'ParamRotation_grp', defaultValue: 0, minValue: -30, maxValue: 30 },
    ],
    nodes: [
      { id: 'GroupRotation_grp', type: 'deformer', deformerKind: 'rotation',
        parent: null, name: 'GroupRotation_grp', visible: true,
        bindings: [{ parameterId: 'ParamRotation_grp', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [0],   angle:   0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [30],  angle:  30, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'GroupRotation_grp',
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: localVerts.slice(),
          runtime: {
            parent: { type: 'rotation', id: 'GroupRotation_grp' },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: localVerts.slice() }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
}

function evalFace(paramValue) {
  const project = makeProject();
  synthesizeModifierStacks(project);
  const frames = evalProjectFrameViaDepgraph(project, { ParamRotation_grp: paramValue });
  const f = frames.find((fr) => fr.id === 'face');
  return f ? Array.from(f.vertexPositions) : null;
}

// ── Baseline (captured from current behavior; FROZEN) ──
// At rest (param 0): the rotation is identity → verts land at canvas pivot
// + their pivot-relative offsets = (350,250),(450,250),(350,350),(450,350).
const REST = [350, 250, 450, 250, 350, 350, 450, 350];
// At param 30: rotated 30° about (400,300). Frozen baseline (the refactor
// must reproduce these to the tolerance below).
const ROT30 = [381.699, 231.699, 468.301, 281.699, 331.699, 318.301, 418.301, 368.301];

{
  const at0 = evalFace(0);
  assert(at0 != null, 'eval produced a face frame at rest');
  assert(maxDelta(at0, REST) < 1e-3,
    `rest pose locked: face at pivot+offsets (got ${at0?.map((v) => v.toFixed(2))})`);
}
{
  const at30 = evalFace(30);
  assert(maxDelta(at30, ROT30) < 1e-2,
    `param=30 locked: GroupRotation eval reproduces frozen baseline (got ${at30?.map((v) => v.toFixed(3))})`);
  // Non-vacuous: rotation actually moved the verts off rest.
  assert(maxDelta(at30, REST) > 1,
    'param=30 actually rotated the part (not at rest)');
}

console.log(`groupRotationCharacterization: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
