// Phase 0.A regression — chainEval / depgraph parity for warps under
// rotation deformers (per-part `RigWarp_*` shape).
//
// Bug closed: V2 close-out doc reported per-part `RigWarp_*` lifted
// grids diverging by ~`canvasW/2`. Root cause was the depgraph build
// missing a `parentMatrix -> liftOp` edge when a warp's parent was a
// rotation — so MATRIX_BUILD could topo-order AFTER the child warp's
// GRID_LIFT_TO_PARENT, the kernel found no matrix yet, and fell
// through to the unlifted pivot-relative grid.
//
// Fix: `src/anim/depgraph/build.js` now walks the parent chain at
// build time (mirroring the eval-time kernel walk) and adds a relation
// for every ancestor's MATRIX_BUILD (rotation) or GRID_LIFT_TO_PARENT
// (warp) until the first warp ancestor or root.
//
// This test pins the fix in place. Three shapes:
//   1. RigWarp_X → Rotation_root → root   (rest)
//   2. RigWarp_X → Rotation_root → root   (rotated 30°)
//   3. RigWarp_X → Rotation_inner → Rotation_outer → root
//      (multi-rotation chain — exercises the conservative chain walk)
//
// Run: node scripts/test/test_depgraphSideBySide_rotationParent.mjs

import { runSideBySide } from '../../src/anim/depgraph/sideBySide.js';

let passed = 0;
let failed = 0;

function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

const W = 800, H = 600;

// Build a project with: Rotation_face at canvas centre + RigWarp_face
// in pivot-relative frame. The warp's lifted grid in canvas-px MUST
// equal the rotation's pivot + the warp's pivot-relative offsets.
function makeSingleRotationProject() {
  return {
    canvas: { width: W, height: H, x: 0, y: 0 },
    parameters: [
      { id: 'ParamRotation_face', name: 'ParamRotation_face',
        defaultValue: 0, minValue: -30, maxValue: 30 },
    ],
    nodes: [
      { id: 'Rotation_face', type: 'deformer', deformerKind: 'rotation',
        parent: null, name: 'Rotation_face', visible: true,
        bindings: [{ parameterId: 'ParamRotation_face', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [0],   angle:   0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [30],  angle:  30, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'RigWarp_face', type: 'deformer', deformerKind: 'warp',
        parent: 'Rotation_face',
        name: 'RigWarp_face', visible: true,
        targetPartId: 'face',
        canvasBbox: { minX: 300, minY: 200, W: 200, H: 200 },
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [-100, -100,  100, -100,  -100, 100,  100, 100],
        localFrame: 'canvas-px',
        bindings: [],
        keyforms: [
          { keyTuple: [], positions: [-100, -100,  100, -100,  -100, 100,  100, 100], opacity: 1 },
        ],
        isLocked: false, isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
}

// Two stacked rotations: outer at canvas centre, inner offset (50,0)
// inside outer's frame. RigWarp_X is parented to inner, in inner's
// pivot-relative frame.
function makeDualRotationProject() {
  return {
    canvas: { width: W, height: H, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'Rotation_outer', type: 'deformer', deformerKind: 'rotation',
        parent: null, name: 'Rotation_outer', visible: true,
        bindings: [],
        keyforms: [
          { keyTuple: [], angle: 0, originX: 400, originY: 300, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'Rotation_inner', type: 'deformer', deformerKind: 'rotation',
        parent: 'Rotation_outer', name: 'Rotation_inner', visible: true,
        bindings: [],
        keyforms: [
          { keyTuple: [], angle: 0, originX: 50, originY: 0, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 100, circleRadiusOnCanvas: 50,
        isLocked: false, useBoneUiTestImpl: false },

      { id: 'RigWarp_inner', type: 'deformer', deformerKind: 'warp',
        parent: 'Rotation_inner',
        name: 'RigWarp_inner', visible: true,
        targetPartId: 'face',
        canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [-50, -50,  50, -50,  -50, 50,  50, 50],
        localFrame: 'canvas-px',
        bindings: [],
        keyforms: [
          { keyTuple: [], positions: [-50, -50,  50, -50,  -50, 50,  50, 50], opacity: 1 },
        ],
        isLocked: false, isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
}

// ---- Test 1: rest pose (angle=0) ----
{
  const proj = makeSingleRotationProject();
  const params = { ParamRotation_face: 0 };
  const report = runSideBySide(proj, params, { tol: 1e-6 });
  assert(report.identical,
    'single-rotation parent rest pose: engines agree byte-for-byte',
    `divergences=${JSON.stringify(report.divergences)}`);
  assert(report.liftedGridCount === 1, 'single-rotation: 1 lifted grid in either engine');
  assert(report.matrixCount === 1, 'single-rotation: 1 matrix in either engine');
}

// ---- Test 2: rotated 30° ----
{
  const proj = makeSingleRotationProject();
  const params = { ParamRotation_face: 30 };
  const report = runSideBySide(proj, params, { tol: 1e-6 });
  assert(report.identical,
    'single-rotation parent rotated 30°: engines agree byte-for-byte',
    `divergences=${JSON.stringify(report.divergences)}`);
}

// ---- Test 3: dual-rotation chain ----
//
// Conservative-walk verification: the depgraph build adds
// MATRIX_BUILD edges for EVERY rotation ancestor up to the first warp
// or root. With cubism-setup as the default kernel each rotation's
// matrix is canvas-final, so the eval-time walk breaks at the
// innermost rotation; but the build-time edges should still be there
// (and harmless). This test exercises the full graph shape regardless.
{
  const proj = makeDualRotationProject();
  const report = runSideBySide(proj, {}, { tol: 1e-6 });
  assert(report.identical,
    'dual-rotation chain: engines agree byte-for-byte',
    `divergences=${JSON.stringify(report.divergences)}`);
  assert(report.matrixCount === 2, 'dual-rotation: 2 matrices in either engine');
}

console.log(`depgraphSideBySide_rotationParent: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
