// Tests for src/io/live2d/rig/initRig.js — Stage 1b (rig harvest + init
// orchestrator). Run: node scripts/test_initRig.mjs
//
// Covers `harvestSeedFromRigSpec` — the pure filter that splits a populated
// rigSpec into the three seedable shapes (faceParallaxSpec, bodyWarpChain,
// rigWarps map). The async `initializeRigFromProject` wraps a full
// generateCmo3 invocation which requires a live mesh fixture; that path is
// covered indirectly by test_e2e_equivalence.mjs and the export integration
// tests. Here we exercise the filter logic in isolation.

import { harvestSeedFromRigSpec } from '../src/io/live2d/rig/initRig.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${e}`);
  console.error(`  actual:   ${a}`);
}

function makeRigWarp(targetPartId, id = `RigWarp_${targetPartId}`) {
  return {
    id,
    name: id,
    parent: { type: 'warp', id: 'BodyXWarp' },
    targetPartId,
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array(18),
    localFrame: 'normalized-0to1',
    bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
    keyforms: [
      { keyTuple: [-30], positions: new Float64Array(18), opacity: 1 },
      { keyTuple: [0],   positions: new Float64Array(18), opacity: 1 },
      { keyTuple: [30],  positions: new Float64Array(18), opacity: 1 },
    ],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

function makeFaceParallaxSpec() {
  return {
    id: 'FaceParallaxWarp',
    name: 'FaceParallax',
    parent: { type: 'warp', id: 'FaceRotation' },
    targetPartId: null,
    canvasBbox: { minX: 0, minY: 0, W: 200, H: 200 },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array(72),
    localFrame: 'rotation-deformer-px',
    bindings: [
      { parameterId: 'ParamAngleY', keys: [-15, 0, 15], interpolation: 'LINEAR' },
      { parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' },
    ],
    keyforms: Array.from({ length: 9 }, (_, i) => ({
      keyTuple: [i % 3, (i / 3) | 0],
      positions: new Float64Array(72),
      opacity: 1,
    })),
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

function makeBodyChainSpec(id) {
  return {
    id,
    name: id,
    parent: { type: id === 'BodyZWarp' ? 'root' : 'warp', id: id === 'BodyZWarp' ? null : 'parent' },
    targetPartId: null,
    canvasBbox: { minX: 0, minY: 0, W: 800, H: 600 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array(18),
    localFrame: id === 'BodyZWarp' ? 'canvas-px' : 'normalized-0to1',
    bindings: [{ parameterId: `Param${id}`, keys: [-1, 0, 1], interpolation: 'LINEAR' }],
    keyforms: [],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

function makeNeckWarpSpec() {
  return {
    id: 'NeckWarp',
    name: 'NeckWarp',
    parent: { type: 'warp', id: 'BodyXWarp' },
    targetPartId: null,
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array(18),
    localFrame: 'normalized-0to1',
    bindings: [],
    keyforms: [],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// ── Empty / null inputs ──
{
  const r1 = harvestSeedFromRigSpec(null);
  assertEq(r1.faceParallaxSpec, null, 'null rigSpec → faceParallaxSpec=null');
  assertEq(r1.bodyWarpChain, null, 'null rigSpec → bodyWarpChain=null');
  assert(r1.rigWarps instanceof Map, 'null rigSpec → rigWarps=Map');
  assert(r1.rigWarps.size === 0, 'null rigSpec → rigWarps empty');

  const r2 = harvestSeedFromRigSpec({});
  assertEq(r2.faceParallaxSpec, null, 'empty rigSpec → faceParallaxSpec=null');
  assert(r2.rigWarps instanceof Map, 'empty rigSpec → rigWarps=Map');
  assert(r2.rigWarps.size === 0, 'empty rigSpec → rigWarps empty');

  const r3 = harvestSeedFromRigSpec({ warpDeformers: [] });
  assert(r3.rigWarps.size === 0, 'empty warpDeformers → rigWarps empty');
  assert(r3.bodyWarpChain === null, 'empty warpDeformers → bodyWarpChain=null');
}

// ── faceParallax extraction ──
{
  const fp = makeFaceParallaxSpec();
  const result = harvestSeedFromRigSpec({
    warpDeformers: [fp, makeRigWarp('part-A')],
  });
  assert(result.faceParallaxSpec === fp, 'face parallax extracted by id');
  assertEq(result.faceParallaxSpec.id, 'FaceParallaxWarp', 'face parallax id preserved');
  assert(!result.rigWarps.has(fp.id), 'face parallax does not leak into rigWarps');
}

// ── body warp chain stash ──
{
  const chain = {
    specs: [makeBodyChainSpec('BodyZWarp'), makeBodyChainSpec('BreathWarp')],
    layout: { BZ_MIN_X: 100, BZ_W: 600, BY_MIN: 0, BY_MAX: 1 },
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    debug: { HIP_FRAC: 0.45, FEET_FRAC: 0.75, bodyFracSource: 'measured' },
  };
  const result = harvestSeedFromRigSpec({
    warpDeformers: chain.specs,
    bodyWarpChain: chain,
  });
  assert(result.bodyWarpChain === chain, 'bodyWarpChain returned verbatim from rigCollector stash');
  assertEq(result.bodyWarpChain.layout.BZ_W, 600, 'chain.layout preserved');
  assertEq(result.rigWarps.size, 0, 'body chain specs do NOT leak into rigWarps');
}

// ── neck warp suppression ──
{
  const result = harvestSeedFromRigSpec({
    warpDeformers: [makeNeckWarpSpec(), makeRigWarp('part-A')],
  });
  assertEq(result.rigWarps.size, 1, 'neck warp suppressed; only per-mesh entries returned');
  assert(result.rigWarps.has('part-A'), 'rigWarps keyed by targetPartId');
}

// ── per-mesh rigWarps map ──
{
  const a = makeRigWarp('part-A');
  const b = makeRigWarp('part-B');
  const c = makeRigWarp('part-C');
  const result = harvestSeedFromRigSpec({
    warpDeformers: [a, b, c],
  });
  assertEq(result.rigWarps.size, 3, 'three per-mesh warps harvested');
  assert(result.rigWarps.get('part-A') === a, 'part-A spec preserved');
  assert(result.rigWarps.get('part-B') === b, 'part-B spec preserved');
  assert(result.rigWarps.get('part-C') === c, 'part-C spec preserved');
}

// ── duplicate targetPartId: last wins (same as serializeRigWarps) ──
{
  const a1 = makeRigWarp('part-X', 'RigWarp_X_v1');
  const a2 = makeRigWarp('part-X', 'RigWarp_X_v2');
  const result = harvestSeedFromRigSpec({
    warpDeformers: [a1, a2],
  });
  assertEq(result.rigWarps.size, 1, 'duplicate partId collapses to 1 entry');
  assert(result.rigWarps.get('part-X') === a2, 'duplicate partId — last wins');
}

// ── all three categories together ──
{
  const fp = makeFaceParallaxSpec();
  const bz = makeBodyChainSpec('BodyZWarp');
  const by = makeBodyChainSpec('BodyYWarp');
  const breath = makeBodyChainSpec('BreathWarp');
  const bx = makeBodyChainSpec('BodyXWarp');
  const neck = makeNeckWarpSpec();
  const m1 = makeRigWarp('mesh-1');
  const m2 = makeRigWarp('mesh-2');
  const chain = {
    specs: [bz, by, breath, bx],
    layout: { BZ_MIN_X: 0, BZ_W: 100, BY_MIN: 0, BY_MAX: 1 },
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    debug: { HIP_FRAC: 0.45, FEET_FRAC: 0.75, bodyFracSource: 'default' },
  };
  const result = harvestSeedFromRigSpec({
    warpDeformers: [bz, by, breath, bx, neck, fp, m1, m2],
    bodyWarpChain: chain,
  });
  assertEq(result.faceParallaxSpec.id, 'FaceParallaxWarp', 'mixed: face parallax extracted');
  assert(result.bodyWarpChain === chain, 'mixed: chain stash preserved');
  assertEq(result.rigWarps.size, 2, 'mixed: only per-mesh warps remain');
  assert(result.rigWarps.has('mesh-1'), 'mixed: mesh-1');
  assert(result.rigWarps.has('mesh-2'), 'mixed: mesh-2');
}

// ── tolerates malformed entries ──
{
  const result = harvestSeedFromRigSpec({
    warpDeformers: [
      null,
      undefined,
      { id: null },
      { id: 'NoTarget' }, // no targetPartId — neither face nor body nor per-mesh
      makeRigWarp('part-A'),
      { id: 'EmptyTarget', targetPartId: '' }, // empty string treated as no-target
    ],
  });
  assertEq(result.rigWarps.size, 1, 'malformed entries silently dropped');
  assert(result.rigWarps.has('part-A'), 'valid entry survives among malformed siblings');
  assertEq(result.faceParallaxSpec, null, 'no face parallax in malformed-only set');
}

// ── filter is order-independent ──
{
  const fp = makeFaceParallaxSpec();
  const m = makeRigWarp('part-Q');
  const r1 = harvestSeedFromRigSpec({ warpDeformers: [fp, m] });
  const r2 = harvestSeedFromRigSpec({ warpDeformers: [m, fp] });
  assertEq(r1.faceParallaxSpec.id, r2.faceParallaxSpec.id, 'order-independent: face parallax');
  assert(r1.rigWarps.get('part-Q') === r2.rigWarps.get('part-Q'),
    'order-independent: per-mesh map identity');
}

// ── bodyWarpChain absent on rigCollector ──
{
  const result = harvestSeedFromRigSpec({
    warpDeformers: [makeBodyChainSpec('BodyZWarp'), makeRigWarp('part-A')],
    // no bodyWarpChain field
  });
  assertEq(result.bodyWarpChain, null, 'missing rigCollector.bodyWarpChain → null');
  // body chain spec still suppressed from per-mesh map by id filter
  assertEq(result.rigWarps.size, 1, 'body chain spec suppressed by id even without chain stash');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
