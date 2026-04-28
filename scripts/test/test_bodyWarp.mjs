// Tests for src/io/live2d/rig/bodyWarp.js (makeBodyWarpNormalizers) +
// src/io/live2d/rig/bodyWarpStore.js — Stage 10 (body warp chain
// keyform persistence).
// Run: node scripts/test_bodyWarp.mjs

import { buildBodyWarpChain, makeBodyWarpNormalizers } from '../../src/io/live2d/rig/bodyWarp.js';
import {
  serializeBodyWarpChain,
  deserializeBodyWarpChain,
  resolveBodyWarp,
  seedBodyWarpChain,
  clearBodyWarp,
} from '../../src/io/live2d/rig/bodyWarpStore.js';

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

function assertClose(actual, expected, eps, name) {
  if (Math.abs(actual - expected) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} — expected ~${expected}, got ${actual}`);
}

function arraysClose(a, b, eps, name) {
  if (a.length !== b.length) {
    failed++;
    console.error(`FAIL: ${name} — length mismatch ${a.length} vs ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) {
      failed++;
      console.error(`FAIL: ${name} at idx=${i} — ${a[i]} vs ${b[i]}`);
      return;
    }
  }
  passed++;
}

// Synthetic mesh layout: a single full-canvas mesh roughly approximating
// a character silhouette. Keep small for fast equivalence checks.
function makeMeshes() {
  return [
    // body silhouette ~ rectangle 100..700 horizontally, 50..550 vertically
    { vertices: [100, 50, 700, 50, 700, 550, 100, 550] },
    // head ~ smaller rectangle near top
    { vertices: [300, 80, 500, 80, 500, 220, 300, 220] },
  ];
}

function makeChainCtx({ hasParamBodyAngleX = true } = {}) {
  return {
    perMesh: makeMeshes(),
    canvasW: 800,
    canvasH: 600,
    bodyAnalysis: null,  // exercise the defaults path
    hasParamBodyAngleX,
  };
}

// --- buildBodyWarpChain: shape contract ---

{
  const chain = buildBodyWarpChain(makeChainCtx());
  assertEq(chain.specs.length, 4, 'chain has 4 specs (BZ, BY, Breath, BX)');
  assertEq(chain.specs.map(s => s.id),
    ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp'],
    'spec ids in expected order');
  assertEq(chain.specs[0].parent, { type: 'root', id: null }, 'BZ parents to root');
  assertEq(chain.specs[1].parent, { type: 'warp', id: 'BodyWarpZ' }, 'BY parents to BZ');
  assertEq(chain.specs[2].parent, { type: 'warp', id: 'BodyWarpY' }, 'Breath parents to BY');
  assertEq(chain.specs[3].parent, { type: 'warp', id: 'BreathWarp' }, 'BX parents to Breath');
  assert(chain.specs[0].baseGrid instanceof Float64Array, 'BZ baseGrid is Float64Array');
  assertEq(chain.specs[0].baseGrid.length, 6 * 6 * 2, 'BZ baseGrid 36 points × 2');
  assertEq(chain.specs[0].keyforms.length, 3, 'BZ has 3 keyforms (-10/0/10)');
  assertEq(chain.specs[2].keyforms.length, 2, 'Breath has 2 keyforms (0/1)');
  assertEq(chain.specs[0].localFrame, 'canvas-px', 'BZ localFrame canvas-px');
  assertEq(chain.specs[1].localFrame, 'normalized-0to1', 'BY localFrame normalized-0to1');
  assert(typeof chain.canvasToBodyXX === 'function', 'canvasToBodyXX is a function');
  assert(typeof chain.canvasToBodyXY === 'function', 'canvasToBodyXY is a function');
  assert(typeof chain.layout.BZ_MIN_X === 'number', 'layout.BZ_MIN_X is number');
  assert(typeof chain.layout.BX_MIN === 'number', 'layout.BX_MIN is number');
  assertEq(chain.debug.bodyFracSource, 'defaults', 'debug.bodyFracSource defaults when no anatomy');
}

// --- buildBodyWarpChain: hasParamBodyAngleX:false drops BX ---

{
  const chain = buildBodyWarpChain(makeChainCtx({ hasParamBodyAngleX: false }));
  assertEq(chain.specs.length, 3, 'no BX → 3 specs');
  assertEq(chain.specs.map(s => s.id),
    ['BodyWarpZ', 'BodyWarpY', 'BreathWarp'],
    'specs are BZ/BY/Breath');
}

// --- buildBodyWarpChain: deterministic ---

{
  const a = buildBodyWarpChain(makeChainCtx());
  const b = buildBodyWarpChain(makeChainCtx());
  for (let i = 0; i < a.specs.length; i++) {
    arraysClose(a.specs[i].baseGrid, b.specs[i].baseGrid, 1e-15,
      `spec[${i}] baseGrid deterministic`);
    for (let k = 0; k < a.specs[i].keyforms.length; k++) {
      arraysClose(a.specs[i].keyforms[k].positions, b.specs[i].keyforms[k].positions,
        1e-15, `spec[${i}] keyforms[${k}] deterministic`);
    }
  }
}

// --- buildBodyWarpChain: rest keyform (k=0) equals baseGrid for ±10 ranges ---

{
  const chain = buildBodyWarpChain(makeChainCtx());
  // BZ middle keyform (key=0) should equal baseGrid.
  const bzRest = chain.specs[0].keyforms.find(k => k.keyTuple[0] === 0);
  arraysClose(bzRest.positions, chain.specs[0].baseGrid, 1e-15, 'BZ rest = baseGrid');
  // Breath's k=0 also equals baseGrid (binding [0,1]).
  const brRest = chain.specs[2].keyforms.find(k => k.keyTuple[0] === 0);
  arraysClose(brRest.positions, chain.specs[2].baseGrid, 1e-15, 'Breath rest = baseGrid');
}

// --- makeBodyWarpNormalizers: matches inline closure math ---

{
  const chain = buildBodyWarpChain(makeChainCtx());
  const { canvasToBodyXX, canvasToBodyXY } = makeBodyWarpNormalizers(chain.layout);
  // Sample a few canvas points and compare to chain's own closures.
  const pts = [
    [200, 150], [400, 300], [600, 450], [100, 50], [700, 550],
  ];
  for (const [cx, cy] of pts) {
    assertClose(canvasToBodyXX(cx), chain.canvasToBodyXX(cx), 1e-15,
      `helper canvasToBodyXX(${cx}) matches chain closure`);
    assertClose(canvasToBodyXY(cy), chain.canvasToBodyXY(cy), 1e-15,
      `helper canvasToBodyXY(${cy}) matches chain closure`);
  }
}

// --- buildBodyWarpChain: bodyAnalysis flips bodyFracSource ---

{
  const ctx = {
    ...makeChainCtx(),
    bodyAnalysis: {
      anchors: { hipY: 320, feetY: 540, shoulderY: 120 },
      widthProfile: [
        { y: 50,  spineX: 400, coreWidth: 100 },
        { y: 300, spineX: 405, coreWidth: 200 },
        { y: 550, spineX: 410, coreWidth: 80  },
      ],
      widthStats: { maxCoreWidth: 200 },
    },
  };
  const chain = buildBodyWarpChain(ctx);
  assert(chain.debug.bodyFracSource !== 'defaults',
    'bodyAnalysis present → bodyFracSource is no longer defaults');
  assert(chain.debug.spineCfShifts.length === 6,
    'spineCfShifts has 6 entries (one per row)');
}

// --- serializeBodyWarpChain: Float64Array → plain arrays ---

{
  const chain = buildBodyWarpChain(makeChainCtx());
  const stored = serializeBodyWarpChain(chain);
  assertEq(stored.specs.length, 4, 'stored.specs length');
  assert(Array.isArray(stored.specs[0].baseGrid), 'stored baseGrid is plain Array');
  assertEq(stored.specs[0].baseGrid.length, 72, 'stored baseGrid 72 numbers');
  assert(Array.isArray(stored.specs[0].keyforms[0].positions),
    'stored keyform positions is plain Array');
  assert(typeof stored.specs[0].baseGrid[0] === 'number',
    'stored array contains plain numbers');
  assertEq(stored.hasParamBodyAngleX, true, 'hasParamBodyAngleX inferred from BX presence');
  assertEq(typeof stored.layout.BZ_W, 'number', 'layout serialized as plain numbers');
  assertEq(typeof stored.debug.HIP_FRAC, 'number', 'debug.HIP_FRAC serialized');
  assert(Array.isArray(stored.debug.spineCfShifts), 'debug.spineCfShifts serialized as Array');
}

// --- serializeBodyWarpChain: JSON.stringify round-trip ---

{
  const chain = buildBodyWarpChain(makeChainCtx());
  const stored = serializeBodyWarpChain(chain);
  const json = JSON.stringify(stored);
  const reparsed = JSON.parse(json);
  // Round-trip preserves all fields (we round-trip via JSON to confirm
  // Float64Array → number[] really survives stringify).
  assertEq(reparsed.specs.length, 4, 'JSON round-trip preserves spec count');
  assertEq(reparsed.specs[0].baseGrid.length, 72, 'JSON round-trip preserves baseGrid length');
}

// --- deserializeBodyWarpChain: round-trip exact ---

{
  const original = buildBodyWarpChain(makeChainCtx());
  const stored = serializeBodyWarpChain(original);
  const restored = deserializeBodyWarpChain(stored);
  assertEq(restored.specs.length, original.specs.length, 'restored spec count');
  for (let i = 0; i < original.specs.length; i++) {
    assert(restored.specs[i].baseGrid instanceof Float64Array,
      `restored spec[${i}].baseGrid is Float64Array`);
    arraysClose(restored.specs[i].baseGrid, original.specs[i].baseGrid, 1e-15,
      `spec[${i}] baseGrid round-trip exact`);
    for (let k = 0; k < original.specs[i].keyforms.length; k++) {
      arraysClose(restored.specs[i].keyforms[k].positions,
        original.specs[i].keyforms[k].positions, 1e-15,
        `spec[${i}] keyform[${k}] round-trip exact`);
    }
    assertEq(restored.specs[i].bindings, original.specs[i].bindings,
      `spec[${i}] bindings round-trip`);
  }
}

// --- deserializeBodyWarpChain: closures rebuilt from layout match originals ---

{
  const original = buildBodyWarpChain(makeChainCtx());
  const stored = serializeBodyWarpChain(original);
  const restored = deserializeBodyWarpChain(stored);
  const samples = [
    [200, 150], [400, 300], [600, 450], [100, 50], [700, 550], [350, 400],
  ];
  for (const [cx, cy] of samples) {
    assertClose(restored.canvasToBodyXX(cx), original.canvasToBodyXX(cx), 1e-15,
      `restored canvasToBodyXX(${cx}) matches`);
    assertClose(restored.canvasToBodyXY(cy), original.canvasToBodyXY(cy), 1e-15,
      `restored canvasToBodyXY(${cy}) matches`);
  }
}

// --- deserializeBodyWarpChain: 3-spec (no BX) round-trip ---

{
  const original = buildBodyWarpChain(makeChainCtx({ hasParamBodyAngleX: false }));
  const stored = serializeBodyWarpChain(original);
  assertEq(stored.hasParamBodyAngleX, false, 'no-BX chain stores hasParamBodyAngleX=false');
  const restored = deserializeBodyWarpChain(stored);
  assertEq(restored.specs.length, 3, 'restored spec count is 3 when no BX');
  assertEq(restored.specs.map(s => s.id), ['BodyWarpZ', 'BodyWarpY', 'BreathWarp'],
    'restored spec ids without BX');
}

// --- deserializeBodyWarpChain: malformed input ---

{
  assert(deserializeBodyWarpChain(null) === null, 'null → null');
  assert(deserializeBodyWarpChain(undefined) === null, 'undefined → null');
  assert(deserializeBodyWarpChain('string') === null, 'non-object → null');
  assert(deserializeBodyWarpChain({}) === null, 'empty object → null');
  assert(deserializeBodyWarpChain({ specs: [] }) === null, 'empty specs → null');
  assert(deserializeBodyWarpChain({ specs: [{ id: 'x' }] }) === null,
    'specs without layout → null');
}

// --- resolveBodyWarp / seedBodyWarpChain / clearBodyWarp ---

{
  const project = {};
  assert(resolveBodyWarp(project) === null, 'no project.bodyWarp → null');
}

{
  const project = { bodyWarp: null };
  assert(resolveBodyWarp(project) === null, 'project.bodyWarp null → null');
}

{
  const original = buildBodyWarpChain(makeChainCtx());
  const project = {};
  const writeResult = seedBodyWarpChain(project, original);
  assert(project.bodyWarp === writeResult, 'seed assigns project.bodyWarp');
  assertEq(project.bodyWarp.specs.length, 4, 'seeded chain has 4 specs');
  // Resolve should reconstruct.
  const resolved = resolveBodyWarp(project);
  assert(resolved !== null, 'resolveBodyWarp post-seed not null');
  arraysClose(resolved.specs[0].baseGrid, original.specs[0].baseGrid, 1e-15,
    'resolved BZ baseGrid matches original');
  // Round-trip closures match.
  assertClose(resolved.canvasToBodyXX(400), original.canvasToBodyXX(400), 1e-15,
    'resolved closure equivalent to original');
}

{
  const original = buildBodyWarpChain(makeChainCtx());
  const project = {};
  seedBodyWarpChain(project, original);
  assert(project.bodyWarp !== null, 'seeded');
  clearBodyWarp(project);
  assert(project.bodyWarp === null, 'clearBodyWarp resets to null');
  assert(resolveBodyWarp(project) === null, 'resolve after clear: null');
}

// --- Full JSON.stringify→parse→resolve round-trip (simulates .stretch save/load) ---

{
  const original = buildBodyWarpChain(makeChainCtx());
  const project = {};
  seedBodyWarpChain(project, original);
  const json = JSON.stringify(project);
  const reloaded = JSON.parse(json);
  const resolved = resolveBodyWarp(reloaded);
  assert(resolved !== null, 'round-trip resolve not null');
  arraysClose(resolved.specs[0].baseGrid, original.specs[0].baseGrid, 1e-15,
    'round-trip BZ baseGrid exact');
  for (let i = 0; i < original.specs.length; i++) {
    for (let k = 0; k < original.specs[i].keyforms.length; k++) {
      arraysClose(resolved.specs[i].keyforms[k].positions,
        original.specs[i].keyforms[k].positions, 1e-15,
        `round-trip spec[${i}] keyform[${k}] exact`);
    }
  }
  assertClose(resolved.canvasToBodyXX(400), original.canvasToBodyXX(400), 1e-15,
    'round-trip closure equivalent');
}

// --- Stored chain bypasses heuristic: changes to mesh inputs don't affect output ---

{
  const original = buildBodyWarpChain(makeChainCtx());
  const project = {};
  seedBodyWarpChain(project, original);
  // resolveBodyWarp is pure — should not look at meshes/canvas/anatomy at all.
  const resolved = resolveBodyWarp(project);
  arraysClose(resolved.specs[0].baseGrid, original.specs[0].baseGrid, 1e-15,
    'resolved baseGrid frozen at seed time');
  // Even after producing a new chain with totally different inputs, the
  // stored one stays put.
  const otherChain = buildBodyWarpChain({
    perMesh: [{ vertices: [0, 0, 100, 0, 100, 100, 0, 100] }],
    canvasW: 200, canvasH: 200, bodyAnalysis: null,
  });
  const resolvedAfter = resolveBodyWarp(project);
  arraysClose(resolvedAfter.specs[0].baseGrid, original.specs[0].baseGrid, 1e-15,
    'stored chain unchanged regardless of new heuristic outputs');
  // Sanity: otherChain produces a different baseGrid.
  let diff = 0;
  for (let i = 0; i < original.specs[0].baseGrid.length; i++) {
    diff += Math.abs(otherChain.specs[0].baseGrid[i] - original.specs[0].baseGrid[i]);
  }
  assert(diff > 1, 'sanity: different inputs → different heuristic output');
}

// --- Summary ---

console.log(`bodyWarp: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
