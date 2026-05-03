// PP2-005b — Identity-at-rest verification for PP1-002 neutralised rigWarps.
//
// PP1-002 claims that an opted-out subsystem's per-part rigWarp, after
// neutralisation (single rest keyform, empty bindings), evaluates to
// identity at default params: the art mesh's source canvas verts pass
// through the inert warp chain unchanged.
//
// User report (PP2-005b): hair STILL visibly shifts after Init Rig with
// hairRig=false. Either (a) the claim is wrong, or (b) the shift comes
// from something other than the neutralised warp (FaceParallax warp,
// A.6b widening, etc.). This test pins down (a) so the investigation
// can rule it in or out.
//
// Construction:
//   - 1024×1024 canvas.
//   - Body warp (root-level, canvas-px): unit corners at (0,0)–(1024,1024).
//   - FaceParallax warp under body: 2×2 grid spanning (300,200)–(700,600)
//     in canvas-px (so its rest grid in body's normalised space is
//     ((300/1024, 200/1024), …)).
//   - Hair warp under FaceParallax: per-part rigWarp for `front hair` part
//     with bbox (350,250)–(550,400) padded 10% → (330,235)–(570,415).
//     Grid points in FaceParallax's 0..1 space.
//   - Hair art mesh: 4 verts at canvas (380, 280), (450, 320), (500, 360),
//     (520, 390). Stored in hair warp's normalised 0..1 space.
//   - Apply applySubsystemOptOutToRigSpec({hairRig: false}) → hair warp
//     gets bindings=[], keyforms=[restOnly].
//   - evalRig at default params (everything 0).
//   - Assert: hair frame's vertexPositions ≈ source canvas verts within 1px.
//
// Run: node scripts/test/test_neutralisedWarpIdentity.mjs

import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import { applySubsystemOptOutToRigSpec } from '../../src/io/live2d/rig/initRig.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

const f32 = (xs) => new Float32Array(xs);
const f64 = (xs) => new Float64Array(xs);

// Build a 2×2 control grid (3×3 control points = 9 points × 2 = 18 floats)
// uniformly spanning a canvas-px rectangle. Used for the body warp.
function uniformGrid(minX, minY, maxX, maxY, cols, rows) {
  const nPts = (rows + 1) * (cols + 1);
  const grid = new Float64Array(nPts * 2);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const idx = (r * (cols + 1) + c) * 2;
      grid[idx]     = minX + (c / cols) * (maxX - minX);
      grid[idx + 1] = minY + (r / rows) * (maxY - minY);
    }
  }
  return grid;
}

// ── Realistic 3-warp chain: body → faceParallax → hair (neutralised) ──
{
  const CANVAS_W = 1024;
  const CANVAS_H = 1024;

  // Body warp (root-level): 1×1 grid spanning the whole canvas.
  // localFrame = canvas-px, control points already in canvas units.
  const bodyGrid = uniformGrid(0, 0, CANVAS_W, CANVAS_H, 1, 1);

  // FaceParallax warp under body: 2×2 grid spanning (300,200)-(700,600)
  // in canvas-px. Its rest grid is stored in body's normalised 0..1 space
  // (same convention perPartRigWarps.js uses for non-root warps).
  const FP_BB = { minX: 300, minY: 200, maxX: 700, maxY: 600 };
  const fpGridInBody = uniformGrid(
    FP_BB.minX / CANVAS_W, FP_BB.minY / CANVAS_H,
    FP_BB.maxX / CANVAS_W, FP_BB.maxY / CANVAS_H,
    2, 2,
  );

  // Hair warp under FaceParallax — 4×4 grid in FaceParallax's 0..1 space,
  // bbox padded 10% per perPartRigWarps.js (matching real auto-rig output).
  const hairTightBb = { minX: 350, minY: 250, maxX: 550, maxY: 400 };
  const padX = (hairTightBb.maxX - hairTightBb.minX) * 0.1;
  const padY = (hairTightBb.maxY - hairTightBb.minY) * 0.1;
  const hairBb = {
    minX: hairTightBb.minX - padX,
    minY: hairTightBb.minY - padY,
    maxX: hairTightBb.maxX + padX,
    maxY: hairTightBb.maxY + padY,
  };
  // Map (canvas) → FaceParallax's 0..1: (canvas - FP_BB.min) / FP_BB.size
  const toFpU = (cx) => (cx - FP_BB.minX) / (FP_BB.maxX - FP_BB.minX);
  const toFpV = (cy) => (cy - FP_BB.minY) / (FP_BB.maxY - FP_BB.minY);
  const HAIR_COLS = 4;
  const HAIR_ROWS = 4;
  const hairGridInFp = new Float64Array((HAIR_ROWS + 1) * (HAIR_COLS + 1) * 2);
  for (let r = 0; r <= HAIR_ROWS; r++) {
    for (let c = 0; c <= HAIR_COLS; c++) {
      const idx = (r * (HAIR_COLS + 1) + c) * 2;
      const cx = hairBb.minX + (c / HAIR_COLS) * (hairBb.maxX - hairBb.minX);
      const cy = hairBb.minY + (r / HAIR_ROWS) * (hairBb.maxY - hairBb.minY);
      hairGridInFp[idx]     = toFpU(cx);
      hairGridInFp[idx + 1] = toFpV(cy);
    }
  }

  // Hair art mesh — verts in hair-warp normalised 0..1.
  const hairCanvasVerts = [380, 280, 450, 320, 500, 360, 520, 390];
  const hairNormVerts = new Float32Array(hairCanvasVerts.length);
  for (let i = 0; i < hairCanvasVerts.length; i += 2) {
    hairNormVerts[i]     = (hairCanvasVerts[i]     - hairBb.minX) / (hairBb.maxX - hairBb.minX);
    hairNormVerts[i + 1] = (hairCanvasVerts[i + 1] - hairBb.minY) / (hairBb.maxY - hairBb.minY);
  }

  const rigSpec = {
    canvas: { width: CANVAS_W, height: CANVAS_H },
    warpDeformers: [
      // Body warp at root.
      {
        id: 'BodyWarp',
        parent: { type: 'root', id: null },
        gridSize: { rows: 1, cols: 1 },
        baseGrid: bodyGrid,
        localFrame: 'canvas-px',
        bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-10, 0, 10] }],
        keyforms: [
          { keyTuple: [-10], positions: bodyGrid, opacity: 1 },
          { keyTuple: [0],   positions: bodyGrid, opacity: 1 },
          { keyTuple: [10],  positions: bodyGrid, opacity: 1 },
        ],
      },
      // FaceParallax under body.
      {
        id: 'FaceParallax',
        parent: { type: 'warp', id: 'BodyWarp' },
        gridSize: { rows: 2, cols: 2 },
        baseGrid: fpGridInBody,
        localFrame: 'normalized-0to1',
        bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], positions: fpGridInBody, opacity: 1 },
          { keyTuple: [0],   positions: fpGridInBody, opacity: 1 },
          { keyTuple: [30],  positions: fpGridInBody, opacity: 1 },
        ],
      },
      // Hair warp under FaceParallax — single keyform, but has full
      // bindings + keyforms before neutralisation. We start with a
      // 3-keyform table on a hair-only param so applySubsystemOptOutToRigSpec
      // has a non-trivial structure to neutralise.
      {
        id: 'RigWarp_FrontHair',
        targetPartId: 'p-front-hair',
        parent: { type: 'warp', id: 'FaceParallax' },
        gridSize: { rows: HAIR_ROWS, cols: HAIR_COLS },
        baseGrid: hairGridInFp,
        localFrame: 'normalized-0to1',
        bindings: [{ parameterId: 'ParamHairFront', keys: [0, 0.5, 1] }],
        keyforms: [
          { keyTuple: [0],   positions: hairGridInFp, opacity: 1 },
          { keyTuple: [0.5], positions: hairGridInFp, opacity: 1 },
          { keyTuple: [1],   positions: hairGridInFp, opacity: 1 },
        ],
      },
    ],
    rotationDeformers: [],
    artMeshes: [
      {
        id: 'p-front-hair',
        name: 'front hair',
        parent: { type: 'warp', id: 'RigWarp_FrontHair' },
        localFrame: 'normalized-0to1',
        bindings: [{ parameterId: 'ParamOpacity', keys: [1.0] }],
        keyforms: [
          { keyTuple: [1.0], vertexPositions: hairNormVerts, opacity: 1.0 },
        ],
        drawOrder: 500,
      },
    ],
  };

  // Pre-neutralisation: at default params, what does the hair output look like?
  const beforeFrames = evalRig(rigSpec, {});
  assert(beforeFrames.length === 1, 'pre-neutralise: 1 frame');
  const before = beforeFrames[0].vertexPositions;
  let beforeMaxDelta = 0;
  for (let i = 0; i < before.length; i++) {
    const delta = Math.abs(before[i] - hairCanvasVerts[i]);
    if (delta > beforeMaxDelta) beforeMaxDelta = delta;
  }
  console.log(`  pre-neutralise: max delta vs source = ${beforeMaxDelta.toFixed(4)} px`);
  assert(beforeMaxDelta < 1.0,
    `pre-neutralise: identity at default params (within 1 px) — got ${beforeMaxDelta.toFixed(4)}`);

  // Now neutralise via applySubsystemOptOutToRigSpec (hairRig=false).
  const neutralised = applySubsystemOptOutToRigSpec(rigSpec, {
    subsystems: { hairRig: false },
    nodes: [{ id: 'p-front-hair', name: 'front hair' }],
  });
  assert(neutralised.neutralisedWarpIds.length === 1,
    'neutralisation: 1 hair warp neutralised');

  // Re-eval at default params on neutralised rigSpec.
  const afterFrames = evalRig(neutralised.rigSpec, {});
  assert(afterFrames.length === 1, 'post-neutralise: 1 frame');
  const after = afterFrames[0].vertexPositions;
  let afterMaxDelta = 0;
  for (let i = 0; i < after.length; i++) {
    const delta = Math.abs(after[i] - hairCanvasVerts[i]);
    if (delta > afterMaxDelta) afterMaxDelta = delta;
  }
  console.log(`  post-neutralise: max delta vs source = ${afterMaxDelta.toFixed(4)} px`);
  assert(afterMaxDelta < 1.0,
    `post-neutralise: identity at default params (within 1 px) — got ${afterMaxDelta.toFixed(4)}`);

  // Crucially: the post-neutralise output must match the pre-neutralise
  // output at default params (i.e. neutralisation doesn't introduce a
  // shift relative to the rig at rest).
  let beforeAfterMaxDelta = 0;
  for (let i = 0; i < after.length; i++) {
    const delta = Math.abs(after[i] - before[i]);
    if (delta > beforeAfterMaxDelta) beforeAfterMaxDelta = delta;
  }
  console.log(`  before-vs-after: max delta = ${beforeAfterMaxDelta.toFixed(6)} px`);
  assert(beforeAfterMaxDelta < 1e-3,
    `neutralisation produces same output as full rig at default params — got ${beforeAfterMaxDelta.toFixed(6)}`);
}

console.log(`neutralisedWarpIdentity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failed tests:', failures);
  process.exit(1);
}
