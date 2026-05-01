// v2 R6 — Unit tests for chainEval.
// Run: node scripts/test_chainEval.mjs

import { evalRig, evalArtMeshFrame } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function arrEq(a, b, eps = 1e-6) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEq(a[i], b[i], eps)) return false;
  return true;
}

const f32 = (xs) => new Float32Array(xs);
const f64 = (xs) => new Float64Array(xs);

// ── Empty rigSpec → empty output ──
{
  assert(evalRig(null, {}).length === 0, 'null rigSpec → []');
  assert(evalRig({}, {}).length === 0, 'empty rigSpec → []');
  assert(evalRig({ artMeshes: [] }, {}).length === 0, 'no artMeshes → []');
}

// ── Root-parented art mesh: positions pass through unchanged ──
{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh-A',
      name: 'A',
      parent: { type: 'root', id: null },
      bindings: [{ parameterId: 'P', keys: [0, 1] }],
      keyforms: [
        { keyTuple: [0], vertexPositions: f32([10, 10, 20, 10]), opacity: 1 },
        { keyTuple: [1], vertexPositions: f32([10, 10, 20, 10]), opacity: 1 },
      ],
      drawOrder: 500,
    }],
  };
  const frames = evalRig(rigSpec, { P: 0.5 });
  assert(frames.length === 1, 'root mesh: 1 frame');
  assert(frames[0].id === 'mesh-A', 'root mesh: id preserved');
  assert(arrEq(frames[0].vertexPositions, [10, 10, 20, 10]),
    'root mesh: positions pass through unchanged');
  assert(frames[0].opacity === 1, 'root mesh: opacity 1');
  assert(frames[0].drawOrder === 500, 'root mesh: drawOrder 500');
}

// ── Single warp parent: bilinear FFD applies ──
{
  // Warp grid 1×1: rest = unit square (0,0)-(100,100). Single keyform.
  // Mesh stored in normalized-0to1 — positions [0.25, 0.5] should map
  // to canvas (25, 50).
  const restGrid = f64([
    0, 0,    // (0, 0)
    100, 0,  // (1, 0)
    0, 100,  // (0, 1)
    100, 100, // (1, 1)
  ]);
  const rigSpec = {
    warpDeformers: [{
      id: 'BodyXWarp',
      name: 'BodyXWarp',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [{ parameterId: 'P', keys: [0, 1] }],
      keyforms: [
        { keyTuple: [0], positions: restGrid, opacity: 1 },
        { keyTuple: [1], positions: restGrid, opacity: 1 },
      ],
    }],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh-B',
      name: 'B',
      parent: { type: 'warp', id: 'BodyXWarp' },
      localFrame: 'normalized-0to1',
      bindings: [{ parameterId: 'P', keys: [0, 1] }],
      keyforms: [
        { keyTuple: [0], vertexPositions: f32([0.25, 0.5]), opacity: 1 },
        { keyTuple: [1], vertexPositions: f32([0.25, 0.5]), opacity: 1 },
      ],
      drawOrder: 500,
    }],
  };
  const frames = evalRig(rigSpec, { P: 0.5 });
  assert(frames.length === 1, 'warp parent: 1 frame');
  // bilinearFFD(restGrid, 1×1, 0.25, 0.5) → (25, 50)
  assert(arrEq(frames[0].vertexPositions, [25, 50]),
    'warp parent: bilinear FFD maps normalized → canvas-px');
}

// ── Single warp parent: deformed grid affects output ──
{
  // Same as above but with the warp shifted. Keyform 1 shifts entire grid by (+50, 0).
  const restGrid = f64([0, 0, 100, 0, 0, 100, 100, 100]);
  const shiftedGrid = f64([50, 0, 150, 0, 50, 100, 150, 100]);
  const rigSpec = {
    warpDeformers: [{
      id: 'W',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [{ parameterId: 'P', keys: [0, 1] }],
      keyforms: [
        { keyTuple: [0], positions: restGrid, opacity: 1 },
        { keyTuple: [1], positions: shiftedGrid, opacity: 1 },
      ],
    }],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'warp', id: 'W' },
      localFrame: 'normalized-0to1',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([0.5, 0.5]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  // P=0 → no shift → (50, 50)
  let frame = evalRig(rigSpec, { P: 0 })[0];
  assert(arrEq(frame.vertexPositions, [50, 50]), 'warp parent at P=0 → (50, 50)');
  // P=1 → full shift → (100, 50)
  frame = evalRig(rigSpec, { P: 1 })[0];
  assert(arrEq(frame.vertexPositions, [100, 50]), 'warp parent at P=1 → (100, 50)');
  // P=0.5 → mid shift → (75, 50)
  frame = evalRig(rigSpec, { P: 0.5 })[0];
  assert(arrEq(frame.vertexPositions, [75, 50]), 'warp parent at P=0.5 → (75, 50)');
}

// ── Rotation parent: mat3 applied ──
{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [{
      id: 'R',
      name: 'R',
      parent: { type: 'root', id: null },
      bindings: [{ parameterId: 'A', keys: [-90, 0, 90] }],
      keyforms: [
        { keyTuple: [-90], angle: -90, originX: 100, originY: 100, scale: 1, opacity: 1 },
        { keyTuple: [0],   angle: 0,   originX: 100, originY: 100, scale: 1, opacity: 1 },
        { keyTuple: [90],  angle: 90,  originX: 100, originY: 100, scale: 1, opacity: 1 },
      ],
    }],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'rotation', id: 'R' },
      localFrame: 'pivot-relative',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([10, 0]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  // Cubism Warp Port Phase 2a — rotation kernel matches the DLL, not v3's
  // textbook rotation. At A=0, the Cubism kernel is NOT the identity:
  //   out.x = px·(-sin·s·ry) + py·(cos·s·rx) + ox
  //         = 10·0 + 0·1 + 100 = 100
  //   out.y = px·(cos·s·ry) + py·(sin·s·rx) + oy
  //         = 10·1 + 0·0 + 100 = 110
  // So Cubism's "rotation deformer at θ=0" is structurally a 90° rotation
  // relative to the textbook identity. Cubism Editor accounts for this when
  // authoring keyforms; the kernel reads them as-is. See cubismRotationEval.js.
  let frame = evalRig(rigSpec, { A: 0 })[0];
  assert(arrEq(frame.vertexPositions, [100, 110]),
    'rotation 0°: Cubism kernel (10,0)→(100,110) not v3 (110,100)');
  // A=90: sin=1, cos=0 → out.x = -10+100 = 90, out.y = 0+100 = 100
  frame = evalRig(rigSpec, { A: 90 })[0];
  assert(arrEq(frame.vertexPositions, [90, 100], 1e-5),
    'rotation 90°: Cubism kernel (10,0)→(90,100)');
  // A=-90: sin=-1, cos=0 → out.x = 10+100 = 110, out.y = 0+100 = 100
  frame = evalRig(rigSpec, { A: -90 })[0];
  assert(arrEq(frame.vertexPositions, [110, 100], 1e-5),
    'rotation -90°: Cubism kernel (10,0)→(110,100)');
}

// ── Multiple meshes share a parent (cache verification) ──
{
  const restGrid = f64([0, 0, 100, 0, 0, 100, 100, 100]);
  const rigSpec = {
    warpDeformers: [{
      id: 'W',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [{ keyTuple: [], positions: restGrid, opacity: 1 }],
    }],
    rotationDeformers: [],
    artMeshes: [
      {
        id: 'mesh-1',
        parent: { type: 'warp', id: 'W' },
        localFrame: 'normalized-0to1',
        bindings: [],
        keyforms: [{ keyTuple: [], vertexPositions: f32([0.0, 0.0]), opacity: 1 }],
        drawOrder: 500,
      },
      {
        id: 'mesh-2',
        parent: { type: 'warp', id: 'W' },
        localFrame: 'normalized-0to1',
        bindings: [],
        keyforms: [{ keyTuple: [], vertexPositions: f32([1.0, 1.0]), opacity: 1 }],
        drawOrder: 500,
      },
    ],
  };
  const frames = evalRig(rigSpec, {});
  assert(frames.length === 2, 'cache: 2 meshes evaluated');
  assert(arrEq(frames[0].vertexPositions, [0, 0]), 'cache mesh-1: TL corner');
  assert(arrEq(frames[1].vertexPositions, [100, 100]), 'cache mesh-2: BR corner');
}

// ── Unknown parent → chain terminates (treats as root) ──
{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'warp', id: 'NonExistent' },
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([42, 42]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  const frames = evalRig(rigSpec, {});
  assert(arrEq(frames[0].vertexPositions, [42, 42]),
    'unknown parent: positions unchanged (treated as root)');
}

// ── Two-deep chain: rotation under warp (canonical pivot-relative-canvas-px) ──
{
  // Canonical convention from cmo3writer + moc3writer:
  //   - Mesh keyform positions are CANVAS-PX offsets from the rotation's
  //     pivot (not 0..1 of the warp's domain). The rotation matrix
  //     multiplies its linear part by `1 / canvasMaxDim` when its parent
  //     is a warp, converting those pixel offsets into the warp's
  //     normalized 0..1 input. Origin stays in normalized.
  //
  //   moc3writer.js:1213 emits `rotation_deformer_keyform.scales = 1/canvasMaxDim`
  //   for warp-parented rotations; chainEval mirrors that here.
  const restGrid = f64([0, 0, 100, 0, 0, 100, 100, 100]);
  const rigSpec = {
    canvas: { w: 100, h: 100 }, // canvasMaxDim = 100 → scale = 0.01
    warpDeformers: [{
      id: 'OuterW',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [{ keyTuple: [], positions: restGrid, opacity: 1 }],
    }],
    rotationDeformers: [{
      id: 'R',
      parent: { type: 'warp', id: 'OuterW' },
      bindings: [],
      keyforms: [{
        keyTuple: [],
        angle: 0,
        originX: 0.5, // pivot in OuterW's normalized domain
        originY: 0.5,
        scale: 1,
        opacity: 1,
      }],
    }],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'rotation', id: 'R' },
      // 10 px to the right of pivot, in canvas-px scale (matches cmo3writer
      // convention `verts = canvasVerts - dfOrigin`).
      localFrame: 'pivot-relative',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([10, 0]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  const frame = evalRig(rigSpec, {})[0];
  // Step 1: artMesh positions = (10, 0) [pivot-relative canvas-px]
  // Step 2: R at angle=0 with parent=warp → Cubism kernel + extraSx/Sy=0.01:
  //   m[0]=-sin·s·ry·sx=0, m[1]=cos·s·rx·sx=0.01, m[2]=ox=0.5
  //   m[3]=cos·s·ry·sy=0.01, m[4]=sin·s·rx·sy=0, m[5]=oy=0.5
  //   (10, 0) → (0·10 + 0.01·0 + 0.5, 0.01·10 + 0·0 + 0.5) = (0.5, 0.6) [normalized]
  // Step 3: bilinearFFD(restGrid, 1×1, 0.5, 0.6) → (50, 60) canvas-px
  // Note: pre-port v3 produced (60, 50); the swap reflects Cubism's kernel
  // applying the rotation as a 90°-offset textbook rotation (BUG-003 root).
  assert(arrEq(frame.vertexPositions, [50, 60], 1e-5),
    'two-deep chain: rotation→warp with Cubism kernel');
}

// ── Regression: rotation under warp WITHOUT canvasMaxDim scaling = wrong ──
{
  // Confirms the bug fix: same chain as above but without the canvas
  // dim, the scale defaults to 1 (no conversion) → output stays in
  // pixel magnitudes that the warp interprets as 0..1 → ~corner clamp.
  // We verify the FIXED behavior diverges from the unscaled case.
  const restGrid = f64([0, 0, 1000, 0, 0, 1000, 1000, 1000]); // 1000-px canvas
  const rigSpec = {
    canvas: { w: 1000, h: 1000 }, // canvasMaxDim = 1000
    warpDeformers: [{
      id: 'OuterW',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [{ keyTuple: [], positions: restGrid, opacity: 1 }],
    }],
    rotationDeformers: [{
      id: 'R',
      parent: { type: 'warp', id: 'OuterW' },
      bindings: [],
      keyforms: [{
        keyTuple: [],
        angle: 0,
        originX: 0.4,  // pivot at (400, 400) canvas in normalized
        originY: 0.4,
        scale: 1,
        opacity: 1,
      }],
    }],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'rotation', id: 'R' },
      localFrame: 'pivot-relative',
      bindings: [],
      // 100 px right + 50 px up of the pivot (canvas-px offsets).
      keyforms: [{ keyTuple: [], vertexPositions: f32([100, -50]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  const frame = evalRig(rigSpec, {})[0];
  // Step 1: (100, -50) pivot-relative-px
  // Step 2: Cubism kernel + scale 0.001 (extraSx/Sy):
  //   m[0]=0, m[1]=0.001, m[2]=0.4
  //   m[3]=0.001, m[4]=0, m[5]=0.4
  //   (100, -50) → (0·100 + 0.001·(-50) + 0.4, 0.001·100 + 0·(-50) + 0.4)
  //              = (0.35, 0.5) [normalized]
  // Step 3: bilinearFFD on 1000-px restGrid at (0.35, 0.5) → (350, 500)
  // Pre-port produced (500, 350); the swap is the Cubism kernel's
  // structural 90° offset.
  assert(arrEq(frame.vertexPositions, [350, 500], 1e-3),
    'regression: rotation→warp scale converts canvas-px → normalized (Cubism kernel)');
}

// ── No canvas in spec: fallback scale=1 (legacy behavior preserved) ──
{
  const restGrid = f64([0, 0, 100, 0, 0, 100, 100, 100]);
  const rigSpec = {
    // no canvas field — older fixtures
    warpDeformers: [{
      id: 'OuterW',
      parent: { type: 'root', id: null },
      gridSize: { rows: 1, cols: 1 },
      baseGrid: restGrid,
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [{ keyTuple: [], positions: restGrid, opacity: 1 }],
    }],
    rotationDeformers: [{
      id: 'R',
      parent: { type: 'warp', id: 'OuterW' },
      bindings: [],
      keyforms: [{
        keyTuple: [], angle: 0, originX: 0.5, originY: 0.5, scale: 1, opacity: 1,
      }],
    }],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'rotation', id: 'R' },
      localFrame: 'pivot-relative',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([0.1, 0]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  const frame = evalRig(rigSpec, {})[0];
  // canvasMaxDim falls back to 1 → scale 1 → input passes through Cubism
  // kernel directly. At angle=0:
  //   out.x = 0.1·0 + 0·1 + 0.5 = 0.5
  //   out.y = 0.1·1 + 0·0 + 0.5 = 0.6
  // bilinearFFD at (0.5, 0.6) → (50, 60). Pre-port produced (60, 50).
  assert(arrEq(frame.vertexPositions, [50, 60], 1e-5),
    'no-canvas fallback: scale=1 (Cubism kernel)');
}

// ── Output is fresh Float32Array (no aliasing of keyform buffer) ──
{
  const v = f32([1, 2, 3, 4]);
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'root', id: null },
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: v, opacity: 1 }],
      drawOrder: 500,
    }],
  };
  const frame = evalRig(rigSpec, {})[0];
  frame.vertexPositions[0] = 999;
  assert(v[0] === 1, 'output not aliased to keyform buffer');
}

// ── Cycle guard: malformed parent loop is bounded ──
{
  const rigSpec = {
    warpDeformers: [
      {
        id: 'W1',
        parent: { type: 'warp', id: 'W2' },
        gridSize: { rows: 1, cols: 1 },
        baseGrid: f64([0, 0, 1, 0, 0, 1, 1, 1]),
        localFrame: 'normalized-0to1',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: f64([0, 0, 1, 0, 0, 1, 1, 1]), opacity: 1 }],
      },
      {
        id: 'W2',
        parent: { type: 'warp', id: 'W1' }, // cycle!
        gridSize: { rows: 1, cols: 1 },
        baseGrid: f64([0, 0, 1, 0, 0, 1, 1, 1]),
        localFrame: 'normalized-0to1',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: f64([0, 0, 1, 0, 0, 1, 1, 1]), opacity: 1 }],
      },
    ],
    rotationDeformers: [],
    artMeshes: [{
      id: 'mesh',
      parent: { type: 'warp', id: 'W1' },
      localFrame: 'normalized-0to1',
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: f32([0.5, 0.5]), opacity: 1 }],
      drawOrder: 500,
    }],
  };
  // Should NOT hang — safety counter terminates after 32 hops.
  const frames = evalRig(rigSpec, {});
  assert(frames.length === 1, 'cycle guard: returns 1 frame (terminated by safety counter)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
