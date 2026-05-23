// Phase 0.D.0 — ART_MESH_EVAL kernel + evalProjectFrameViaDepgraph
// parity tests against chainEval's `evalRig`.
//
// The depgraph runner must produce byte-equal `ArtMeshFrame[]` output
// for the production rAF callback to swap engines transparently.
//
// Run: node scripts/test/test_depgraph_eval_artMesh.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import { evalWarpKernelCubism } from '../../src/io/live2d/runtime/evaluator/cubismWarpEval.js';

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
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

// ---------------------------------------------------------------------
// Helpers: synthesise a 4-vert quad part with a `runtime` payload.
// ---------------------------------------------------------------------

function quadVerts() {
  return [100, 50,  300, 50,  100, 250,  300, 250];
}

function makeBareRuntime() {
  return {
    parent: { type: 'root', id: null },
    bindings: [],
    keyforms: [
      { keyTuple: [], opacity: 1, vertexPositions: quadVerts() },
    ],
  };
}

// ---------------------------------------------------------------------
// Test 1: root-parented part — no modifiers, identity passthrough.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: null, modifiers: [],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: quadVerts(),
          runtime: makeBareRuntime(),
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(ce.length === 1, 'root-only: chainEval emits 1 frame');
  assert(dg.length === 1, 'root-only: depgraph emits 1 frame');
  assert(ce[0].id === dg[0].id, `root-only: id matches (${ce[0].id} vs ${dg[0].id})`);
  const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-5, `root-only: vertexPositions byte-equal (delta=${d})`);
  assert(Math.abs(ce[0].opacity - dg[0].opacity) < 1e-9,
    `root-only: opacity matches (${ce[0].opacity} vs ${dg[0].opacity})`);
}

// ---------------------------------------------------------------------
// Test 2: part under a single rotation deformer (parent='Rotation_face').
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const verts = quadVerts();           // canvas-px
  // Pivot-relative version (offsets from rotation pivot at 400,300):
  const pivotRel = verts.map((v, i) => v - (i % 2 === 0 ? 400 : 300));
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      { id: 'Rotation_face', type: 'deformer', deformerKind: 'rotation', name: 'Rotation_face',
        visible: true, parent: null,
        bindings: [],
        keyforms: [
          { keyTuple: [], angle: 0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'Rotation_face',
        modifiers: [
          { type: 'rotation', deformerId: 'Rotation_face', enabled: true, mode: 7 },
        ],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: verts,
          runtime: {
            parent: { type: 'rotation', id: 'Rotation_face' },
            bindings: [],
            keyforms: [
              { keyTuple: [], opacity: 1, vertexPositions: pivotRel },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(ce.length === 1 && dg.length === 1, 'rotation parent: 1 frame each');
  const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `rotation parent: depgraph matches chainEval (delta=${d})`,
    `chainEval=${Array.from(ce[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
}

// ---------------------------------------------------------------------
// Test 3: part driven by a parameter — keyform blend follows paramValue.
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const restVerts = quadVerts();
  const offsetVerts = restVerts.map((v, i) => v + (i % 2 === 0 ? 50 : 0));
  const project = {
    canvas: { width: W, height: H },
    parameters: [
      { id: 'ParamX', name: 'ParamX', default: 0, defaultValue: 0, minValue: 0, maxValue: 1 },
    ],
    nodes: [
      { id: 'shape', type: 'part', name: 'shape', visible: true, draw_order: 100,
        rigParent: null, modifiers: [],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: restVerts,
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [
              { parameterId: 'ParamX', keys: [0, 1], interpolation: 'LINEAR' },
            ],
            keyforms: [
              { keyTuple: [0], opacity: 1, vertexPositions: restVerts },
              { keyTuple: [1], opacity: 1, vertexPositions: offsetVerts },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);

  // Param=0 → rest verts.
  {
    const ce = evalRig(rigSpec, { ParamX: 0 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 0 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=0: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 100) < 1e-4, 'param=0: x[0]=100');
  }
  // Param=1 → offset verts.
  {
    const ce = evalRig(rigSpec, { ParamX: 1 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 1 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=1: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 150) < 1e-4, 'param=1: x[0]=150 (offset applied)');
  }
  // Param=0.5 → blended (rest + offset)/2.
  {
    const ce = evalRig(rigSpec, { ParamX: 0.5 });
    const dg = evalProjectFrameViaDepgraph(project, { ParamX: 0.5 });
    const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
    assert(d < 1e-4, `param=0.5: depgraph matches chainEval (delta=${d})`);
    assert(Math.abs(dg[0].vertexPositions[0] - 125) < 1e-4, 'param=0.5: x[0]=125 (blended)');
  }
}

// ---------------------------------------------------------------------
// Test 4: BONE-BAKED part — post-RULE-№4 bone-group/armature shape.
//
// Pre-M2.1 this test used a pre-RULE-№4 fixture (rotation deformer in
// `runtime.parent`, empty modifiers[]) that exercised the depgraph's
// `walkDeformerParentChain` fallback. Post-M2.1 that fallback is deleted
// — bone-baked parts now carry an explicit Armature modifier the synth
// appends to every bone-weighted part's stack (v44 migration converted
// the legacy rotation deformers; `synthesizeModifierStacks` emits the
// armature entry; `applyBonePostChainSkin` handles the transform).
//
// The fixture mirrors what `synthesizeModifierStacks` would produce for
// a real bone-baked part: bone-group parent in `runtime.parent`, an
// Armature modifier as the tail of `modifiers[]`. Verifies the depgraph
// eval matches chainEval and the bone transform actually fires (verts
// land at canvas-px under the bone's WORLD matrix, not at the part's
// rest position).
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const verts = quadVerts(); // canvas-px rest positions (centred at 400,300 with half-extents 100/100)
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      // Bone group at canvas (400, 300) — same pivot as the legacy
      // rotation deformer this test previously used.
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow',
        transform: { x: 400, y: 300, rotation: 0, scale: 1, pivotX: 400, pivotY: 300 },
        pose: { rotation: 0 } },

      { id: 'handwear', type: 'part', name: 'handwear', visible: true, draw_order: 100,
        parent: 'leftElbow',
        modifiers: [
          // Armature modifier — the canonical post-RULE-№4 shape for a
          // bone-baked part. `applyBonePostChainSkin` reads jointBoneId
          // from the modifier's data block.
          { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3,
            showInEditor: true,
            data: {
              jointBoneId: 'leftElbow',
              jointBoneRole: 'leftElbow',
              parentBoneId: null,
              parentBoneRole: null,
              deformFlag: 1,
              vertexGroupName: '',
            } },
        ],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: verts,
          jointBoneId: 'leftElbow',
          boneWeights: [[1, 0], [1, 0], [1, 0], [1, 0]], // 100% weight on leftElbow
          runtime: {
            parent: { type: 'part', id: 'leftElbow' },
            bindings: [],
            keyforms: [
              { keyTuple: [], opacity: 1, vertexPositions: verts },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(ce.length === 1 && dg.length === 1, 'bone-baked: 1 frame each');
  const d = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(d < 1e-4, `bone-baked: depgraph matches chainEval (delta=${d})`,
    `chainEval=${Array.from(ce[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);
  // With pose.rotation=0 the bone's WORLD matrix is identity around the
  // pivot, so verts land at their canvas-px rest positions.
  assert(Math.abs(dg[0].vertexPositions[0] - 100) < 1e-4,
    `bone-baked: armature path resolved (x[0]=${dg[0].vertexPositions[0]}, want 100)`);
}

// ---------------------------------------------------------------------
// Test 4b (M2.1 pin, 2026-05-23): pre-RULE-№4 rotation-deformer fixture
// shape no longer gets the implicit-parent walk treatment.
//
// Before M2.1 a part with `runtime.parent.type === 'rotation'` and empty
// `modifiers[]` would have its verts brought from pivot-relative to
// canvas-px via `walkDeformerParentChain`. After M2.1 that fallback is
// gone — such a fixture WILL produce pivot-relative verts because no
// modifier entry covers the rotation. Production projects can never hit
// this shape (v44 migration is mandatory on load), but the test pins
// the deletion contract so a future regression bringing the fallback
// back would fail loudly.
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const verts = quadVerts();                                   // canvas-px
  const pivotRel = verts.map((v, i) => v - (i % 2 === 0 ? 400 : 300)); // offsets from pivot
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      { id: 'Rotation_leftArm', type: 'deformer', deformerKind: 'rotation', name: 'Rotation_leftArm',
        visible: true, parent: null,
        bindings: [],
        keyforms: [
          { keyTuple: [], angle: 0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'handwear', type: 'part', name: 'handwear', visible: true, draw_order: 100,
        rigParent: 'Rotation_leftArm',
        modifiers: [],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: verts,
          runtime: {
            parent: { type: 'rotation', id: 'Rotation_leftArm' },
            bindings: [],
            keyforms: [
              { keyTuple: [], opacity: 1, vertexPositions: pivotRel },
            ],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const dg = evalProjectFrameViaDepgraph(project, {});
  assert(dg.length === 1, 'M2.1 pin: pre-RULE-№4 fixture still produces a frame');
  // Without the implicit-parent walk, verts stay at the pivot-relative
  // value from runtime.keyforms — x[0] ≈ -300 (was -300 + 400 = 100 pre-M2.1).
  assert(Math.abs(dg[0].vertexPositions[0] - (-300)) < 1e-4,
    `M2.1 pin: implicit-parent fallback retired (x[0]=${dg[0].vertexPositions[0]}, want -300 not 100)`);
}

// ---------------------------------------------------------------------
// Test 5: `liftedGrids` out-param is surfaced for warp deformers.
// Pins the WarpDeformerOverlay fix — the depgraph composes
// GRID_LIFT_TO_PARENT for every warp; the runner now exposes those
// canvas-px grids via the optional `opts.liftedGrids` Map (the classic
// engine's `evalRig({ out:{liftedGrids} })` replacement).
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const grid = [300, 200,  500, 200,  300, 400,  500, 400]; // canvas-px CPs
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      { id: 'RigWarp_face', type: 'deformer', deformerKind: 'warp', name: 'RigWarp_face',
        visible: true, parent: null, targetPartId: 'face',
        gridSize: { rows: 1, cols: 1 },
        baseGrid: grid, localFrame: 'canvas-px',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: grid, opacity: 1 }],
        isLocked: false, isQuadTransform: false },

      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'RigWarp_face',
        modifiers: [{ type: 'warp', deformerId: 'RigWarp_face', enabled: true, mode: 7 }],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: quadVerts(),
          runtime: {
            parent: { type: 'warp', id: 'RigWarp_face' },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: quadVerts() }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const liftedGrids = new Map();
  const dg = evalProjectFrameViaDepgraph(project, {}, { liftedGrids });
  assert(dg.length === 1, 'liftedGrids out-param: 1 frame emitted');
  assert(liftedGrids.has('RigWarp_face'), 'liftedGrids out-param: warp grid surfaced');
  const lifted = liftedGrids.get('RigWarp_face');
  assert(lifted && lifted.length === 8,
    `liftedGrids out-param: 4 canvas-px CPs (got len=${lifted?.length})`);
  // A canvas-px warp's lifted grid equals its rest CPs.
  assert(Math.abs(lifted[0] - 300) < 1e-4 && Math.abs(lifted[1] - 200) < 1e-4,
    `liftedGrids out-param: CP[0] = (300,200) canvas-px (got ${lifted?.[0]},${lifted?.[1]})`);
  // No map supplied → no throw, frames still emitted.
  const dg2 = evalProjectFrameViaDepgraph(project, {});
  assert(dg2.length === 1, 'liftedGrids out-param: omitting the map is safe');
}

// ---------------------------------------------------------------------
// Test 6: MODIFIER-DISABLE reprojection parity (gap #1).
// The part stacks two root-pivoted rotations; the LEAF (RotInner) is
// disabled, so the effective leaf parent becomes RotRoot. selectRigSpec
// reprojects the keyforms from RotInner's frame to RotRoot's (offset =
// RotInnerPivot - RotRootPivot = (100,100)); chainEval consumes the
// reprojected verts. The depgraph must source the SAME reprojected
// keyforms (via the rigSpec it's now handed) — otherwise it feeds
// RotInner-frame verts through RotRoot and the mesh shifts by (100,100).
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  const innerVerts = [10, 10,  20, 10,  10, 20,  20, 20]; // RotInner-frame offsets
  const mkRot = (id, ox, oy) => ({
    id, type: 'deformer', deformerKind: 'rotation', name: id, visible: true, parent: null,
    bindings: [],
    keyforms: [{ keyTuple: [], angle: 0, originX: ox, originY: oy, scale: 1, opacity: 1, reflectX: false, reflectY: false }],
    baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
    isLocked: false, useBoneUiTestImpl: false,
  });
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      mkRot('RotInner', 500, 400),
      mkRot('RotRoot', 400, 300),
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'RotInner',
        modifiers: [
          { type: 'rotation', deformerId: 'RotInner', enabled: false, mode: 7 }, // leaf DISABLED
          { type: 'rotation', deformerId: 'RotRoot', enabled: true, mode: 7 },
        ],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: quadVerts(),
          runtime: {
            parent: { type: 'rotation', id: 'RotInner' }, // baked leaf (all-enabled)
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: innerVerts }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const dgFixed = evalProjectFrameViaDepgraph(project, {}, { rigSpec });
  const dgRaw = evalProjectFrameViaDepgraph(project, {}); // no rigSpec → legacy raw-runtime path
  assert(ce.length === 1 && dgFixed.length === 1, 'modifier-disable: 1 frame each');
  const dFixed = maxDelta(ce[0].vertexPositions, dgFixed[0].vertexPositions);
  assert(dFixed < 1e-4, `modifier-disable: depgraph(+rigSpec) matches chainEval (delta=${dFixed})`,
    `chainEval=${Array.from(ce[0].vertexPositions)}, depgraph=${Array.from(dgFixed[0].vertexPositions)}`);
  // Proves the fix matters: without the reprojected source the depgraph
  // diverges by exactly the pivot delta (100,100) → maxAbs = 100.
  const dRaw = maxDelta(ce[0].vertexPositions, dgRaw[0].vertexPositions);
  assert(Math.abs(dRaw - 100) < 1e-4,
    `modifier-disable: legacy raw-runtime path diverges by the reproject offset (delta=${dRaw}, want ~100)`);
}

// ---------------------------------------------------------------------
// Test 7: per-part LIFTED-GRID composition on a MID-STACK disable (gap #2).
// A leaf warp sits under two rotations (RotMid, then RotRoot). The part
// disables the MIDDLE rotation, so its effective chain-above for the leaf
// warp is [RotRoot] only — chainEval composes the warp's lifted grid
// through RotRoot, SKIPPING RotMid (`getLiftedGridForChain`). The depgraph
// used to apply the warp's GLOBAL GRID_LIFT_TO_PARENT, which walks
// `def.parent` (= RotMid → RotRoot) and therefore folds in the disabled
// RotMid. The kernel now re-lifts through the explicit enabled chain when
// an ancestor modifier is disabled.
// ---------------------------------------------------------------------
{
  const W = 800, H = 600;
  // Leaf warp: 1x1 quad of canvas-px-ish control points.
  const leafGrid = [200, 150,  400, 150,  200, 350,  400, 350];
  // Part verts: normalised (u,v) INSIDE the warp cell, so the warp maps
  // them by interior bilinear (predictable, no far-field extrapolation).
  const normVerts = [0.25, 0.25,  0.75, 0.25,  0.25, 0.75,  0.75, 0.75];
  const mkRot = (id, parent, ox, oy, angle) => ({
    id, type: 'deformer', deformerKind: 'rotation', name: id, visible: true, parent,
    bindings: [],
    keyforms: [{ keyTuple: [], angle, originX: ox, originY: oy, scale: 1, opacity: 1, reflectX: false, reflectY: false }],
    baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
    isLocked: false, useBoneUiTestImpl: false,
  });
  const project = {
    canvas: { width: W, height: H },
    parameters: [],
    nodes: [
      mkRot('RotRoot', null, 400, 300, 0),
      mkRot('RotMid', 'RotRoot', 300, 250, 45),   // mid-stack, non-identity
      { id: 'WarpLeaf', type: 'deformer', deformerKind: 'warp', name: 'WarpLeaf',
        visible: true, parent: 'RotMid', targetPartId: 'face',
        gridSize: { rows: 1, cols: 1 }, baseGrid: leafGrid, localFrame: 'canvas-px',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: leafGrid, opacity: 1 }],
        isLocked: false, isQuadTransform: true },
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        rigParent: 'WarpLeaf',
        modifiers: [
          { type: 'warp', deformerId: 'WarpLeaf', enabled: true, mode: 7 },
          { type: 'rotation', deformerId: 'RotMid', enabled: false, mode: 7 }, // MID disabled
          { type: 'rotation', deformerId: 'RotRoot', enabled: true, mode: 7 },
        ],
        mesh: {
          uvs: [0, 0,  1, 0,  0, 1,  1, 1],
          triangles: [0, 1, 2,  1, 3, 2],
          vertices: normVerts,
          runtime: {
            parent: { type: 'warp', id: 'WarpLeaf' }, // leaf unchanged → no keyform reproject
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: normVerts }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
  const rigSpec = selectRigSpec(project);
  const ce = evalRig(rigSpec, {});
  const liftedGrids = new Map();
  const dg = evalProjectFrameViaDepgraph(project, {}, { rigSpec, liftedGrids });
  assert(ce.length === 1 && dg.length === 1, 'mid-stack lift: 1 frame each');
  const dFixed = maxDelta(ce[0].vertexPositions, dg[0].vertexPositions);
  assert(dFixed < 1e-4, `mid-stack lift: depgraph matches chainEval (delta=${dFixed})`,
    `chainEval=${Array.from(ce[0].vertexPositions)}, depgraph=${Array.from(dg[0].vertexPositions)}`);

  // Prove the gap is real: the GLOBAL lifted grid (what the kernel used
  // before this fix) walks WarpLeaf.parent = RotMid → RotRoot, so it folds
  // in the disabled RotMid. Apply it to the same source verts and confirm
  // it diverges from chainEval — i.e. the per-part path is what makes the
  // depgraph correct, not the global op.
  const globalLifted = liftedGrids.get('WarpLeaf');
  assert(globalLifted && globalLifted.length === 8, 'mid-stack lift: global lift surfaced');
  const buggy = new Float32Array(8);
  evalWarpKernelCubism(globalLifted, { rows: 1, cols: 1 }, true,
    Float32Array.from(normVerts), buggy, 4);
  const dGap = maxDelta(ce[0].vertexPositions, buggy);
  assert(dGap > 1.0,
    `mid-stack lift: global lift (folds in disabled RotMid) diverges from chainEval (gap=${dGap})`);
}

console.log(`depgraph_eval_artMesh: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
