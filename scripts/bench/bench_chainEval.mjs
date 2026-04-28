// R10 — micro-benchmark for the v2 evaluator hot path.
//
// Synthesises a realistic Hiyori-scale rigSpec (≈30 meshes, ≈64 verts
// each, 5-level parent chain, mixed 1D/2D parameter bindings) and runs
// `evalRig` + `tickPhysics` in a tight loop. Measures ms/iter and
// allocations-per-iter (when run with `--expose-gc --inspect`).
//
// This is not part of `npm test` — it's a local profiling tool. Run
// with `node scripts/bench_chainEval.mjs`.
//
// Goal: identify hot spots before optimising. Typical wins to expect:
//
//   * Float32Array allocation per parent step in chainEval
//     (worst-case 30 meshes × 5 chain hops = 150 allocs/frame).
//   * findDeformer linear search (20 warps + 10 rotations × 5 chain
//     hops × 30 meshes = 4500 array-finds/frame).
//   * cellSelect indices/weights array allocation per call.
//
// Baseline-vs-optimised numbers go into NATIVE_RIG_REFACTOR_PLAN.md
// R10 shipped subsection.

import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
} from '../../src/io/live2d/runtime/physicsTick.js';

// ── synth helpers ────────────────────────────────────────────────────────
const MESH_COUNT = 30;
const VERTS_PER_MESH = 64;
const WARP_GRID = { rows: 5, cols: 5 };          // 6×6 control points
const WARP_GRID_FLOATS = (WARP_GRID.rows + 1) * (WARP_GRID.cols + 1) * 2;

function makeRestGrid(canvasW, canvasH) {
  const arr = new Float64Array(WARP_GRID_FLOATS);
  let i = 0;
  for (let r = 0; r <= WARP_GRID.rows; r++) {
    const v = r / WARP_GRID.rows;
    for (let c = 0; c <= WARP_GRID.cols; c++) {
      const u = c / WARP_GRID.cols;
      arr[i++] = u;
      arr[i++] = v;
    }
  }
  return arr;
}

function makeShiftedGrid(amountX, amountY) {
  const arr = new Float64Array(WARP_GRID_FLOATS);
  let i = 0;
  for (let r = 0; r <= WARP_GRID.rows; r++) {
    const v = r / WARP_GRID.rows;
    for (let c = 0; c <= WARP_GRID.cols; c++) {
      const u = c / WARP_GRID.cols;
      arr[i++] = u + amountX;
      arr[i++] = v + amountY;
    }
  }
  return arr;
}

function makeRandomMeshVerts(seed) {
  // Deterministic pseudo-random verts in a normalized 0..1 box.
  let s = seed | 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1000) / 1000;
  };
  const arr = new Float32Array(VERTS_PER_MESH * 2);
  for (let i = 0; i < arr.length; i++) arr[i] = 0.1 + next() * 0.8;
  return arr;
}

function buildSyntheticRigSpec() {
  const canvasW = 1024, canvasH = 1024;

  // Innermost body warp (parent = root)
  const bodyWarp = {
    id: 'BodyXWarp',
    name: 'Body X',
    parent: { type: 'root', id: null },
    gridSize: WARP_GRID,
    baseGrid: makeRestGrid(canvasW, canvasH),
    localFrame: 'canvas-px',
    bindings: [{ parameterId: 'ParamBodyAngleX', keys: [-10, 0, 10] }],
    keyforms: [
      { keyTuple: [-10], positions: makeShiftedGrid(-0.05, 0) },
      { keyTuple: [0],   positions: makeRestGrid(canvasW, canvasH) },
      { keyTuple: [10],  positions: makeShiftedGrid(+0.05, 0) },
    ],
  };

  // Mid-level face rotation (parent = bodyWarp)
  const faceRotation = {
    id: 'FaceRotation',
    name: 'Face Rotation',
    parent: { type: 'warp', id: 'BodyXWarp' },
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }],
    keyforms: [
      { keyTuple: [-30], angle: -10, originX: 0.5, originY: 0.4, scale: 1 },
      { keyTuple: [0],   angle: 0,   originX: 0.5, originY: 0.4, scale: 1 },
      { keyTuple: [30],  angle: +10, originX: 0.5, originY: 0.4, scale: 1 },
    ],
  };

  // Per-mesh rig warp (parent = faceRotation), one per mesh
  const rigWarps = [];
  for (let i = 0; i < MESH_COUNT; i++) {
    rigWarps.push({
      id: `RigWarp_${i}`,
      name: `RigWarp_${i}`,
      parent: { type: 'rotation', id: 'FaceRotation' },
      gridSize: WARP_GRID,
      baseGrid: makeRestGrid(canvasW, canvasH),
      localFrame: 'pivot-relative',
      bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30] }],
      keyforms: [
        { keyTuple: [-30], positions: makeShiftedGrid(-0.02, 0) },
        { keyTuple: [0],   positions: makeRestGrid(canvasW, canvasH) },
        { keyTuple: [+30], positions: makeShiftedGrid(+0.02, 0) },
      ],
    });
  }

  // Art meshes (parent = rigWarp_i)
  const artMeshes = [];
  for (let i = 0; i < MESH_COUNT; i++) {
    artMeshes.push({
      id: `mesh_${i}`,
      name: `mesh_${i}`,
      parent: { type: 'warp', id: `RigWarp_${i}` },
      verticesCanvas: makeRandomMeshVerts(i + 1),
      triangles: new Uint16Array([0, 1, 2]),
      uvs: new Float32Array(VERTS_PER_MESH * 2),
      variantSuffix: null,
      textureId: null,
      bindings: [{ parameterId: 'ParamAngleY', keys: [-30, 0, 30] }],
      keyforms: [
        { keyTuple: [-30], vertexPositions: makeRandomMeshVerts(i + 100) },
        { keyTuple: [0],   vertexPositions: makeRandomMeshVerts(i + 200) },
        { keyTuple: [+30], vertexPositions: makeRandomMeshVerts(i + 300) },
      ],
    });
  }

  return {
    parameters: [
      { id: 'ParamAngleX',     min: -30, max: 30,  default: 0 },
      { id: 'ParamAngleY',     min: -30, max: 30,  default: 0 },
      { id: 'ParamAngleZ',     min: -30, max: 30,  default: 0 },
      { id: 'ParamBodyAngleX', min: -10, max: 10,  default: 0 },
      { id: 'ParamBodyAngleY', min: -10, max: 10,  default: 0 },
      { id: 'ParamBodyAngleZ', min: -10, max: 10,  default: 0 },
      { id: 'ParamHairFront',  min: -1,  max: 1,   default: 0 },
      { id: 'ParamHairBack',   min: -1,  max: 1,   default: 0 },
      { id: 'ParamSkirt',      min: -1,  max: 1,   default: 0 },
    ],
    parts: [],
    warpDeformers: [bodyWarp, ...rigWarps],
    rotationDeformers: [faceRotation],
    artMeshes,
    canvas: { w: canvasW, h: canvasH },
    physicsRules: [
      {
        id: 'BenchHair',
        name: 'Hair',
        category: 'hair',
        requireTag: null,
        inputs: [
          { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
          { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
          { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
          { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
        ],
        vertices: [
          { x: 0, y: 0, mobility: 1, delay: 1, acceleration: 1, radius: 0 },
          { x: 0, y: 3, mobility: 0.95, delay: 0.9, acceleration: 1.5, radius: 3 },
        ],
        normalization: { posMin: -10, posMax: 10, posDef: 0, angleMin: -10, angleMax: 10, angleDef: 0 },
        outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 1.522, isReverse: false }],
      },
    ],
  };
}

// ── benchmark runner ─────────────────────────────────────────────────────
function bench(name, fn, iterations = 1000) {
  // warmup
  for (let i = 0; i < 50; i++) fn(i);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn(i);
  const elapsedNs = Number(process.hrtime.bigint() - start);
  const elapsedMs = elapsedNs / 1e6;
  const perIter = elapsedMs / iterations;
  console.log(`  ${name.padEnd(36)} ${perIter.toFixed(3)} ms/iter   ${(1000 / perIter).toFixed(0)} fps-equiv   (${iterations} iters, ${elapsedMs.toFixed(1)} ms total)`);
  return perIter;
}

const rigSpec = buildSyntheticRigSpec();
const paramSpecs = buildParamSpecs(rigSpec.parameters);
const physState = createPhysicsState(rigSpec.physicsRules);

console.log(`\nSynthetic rig: ${MESH_COUNT} meshes × ${VERTS_PER_MESH} verts, 5-deep chain (root → bodyWarp → faceRotation → rigWarp_i → mesh)`);
console.log(`Params: ${rigSpec.parameters.length} · Warp deformers: ${rigSpec.warpDeformers.length} · Rotation deformers: ${rigSpec.rotationDeformers.length} · Physics rules: ${rigSpec.physicsRules.length}\n`);

// Vary param values per iteration so the cache doesn't statically lock.
let pv = { ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0, ParamBodyAngleX: 0 };

bench('evalRig (rest)', (i) => {
  evalRig(rigSpec, pv);
});

bench('evalRig (animated)', (i) => {
  pv.ParamAngleX = Math.sin(i * 0.05) * 30;
  pv.ParamAngleY = Math.cos(i * 0.05) * 30;
  pv.ParamAngleZ = Math.sin(i * 0.07) * 30;
  pv.ParamBodyAngleX = Math.cos(i * 0.03) * 10;
  evalRig(rigSpec, pv);
});

bench('tickPhysics (animated)', (i) => {
  pv.ParamAngleZ = Math.sin(i * 0.07) * 30;
  pv.ParamBodyAngleX = Math.cos(i * 0.03) * 10;
  tickPhysics(physState, rigSpec.physicsRules, pv, paramSpecs, 1 / 60);
});

bench('tickPhysics + evalRig (animated)', (i) => {
  pv.ParamAngleX = Math.sin(i * 0.05) * 30;
  pv.ParamAngleY = Math.cos(i * 0.05) * 30;
  pv.ParamAngleZ = Math.sin(i * 0.07) * 30;
  pv.ParamBodyAngleX = Math.cos(i * 0.03) * 10;
  tickPhysics(physState, rigSpec.physicsRules, pv, paramSpecs, 1 / 60);
  evalRig(rigSpec, pv);
});

console.log('');
