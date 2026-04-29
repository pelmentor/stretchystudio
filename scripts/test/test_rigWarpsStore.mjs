// v3 Phase 0F.23 - tests for src/io/live2d/rig/rigWarpsStore.js
//
// Per-mesh rig warp keyform store. Same JSON-survive-Float64Array
// concern as faceParallaxStore, plus a partId map shape and the
// _isWellFormedSpec validator that drops broken entries silently.
//
// Run: node scripts/test/test_rigWarpsStore.mjs

import {
  serializeRigWarps,
  deserializeRigWarps,
  resolveRigWarps,
  seedRigWarps,
  clearRigWarps,
} from '../../src/io/live2d/rig/rigWarpsStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeSpec(partId) {
  return {
    id: `RigWarp_${partId}`,
    name: `RigWarp ${partId}`,
    parent: { type: 'warp', id: 'BodyXWarp' },
    targetPartId: partId,
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array([0, 0, 0.5, 0, 1, 0]),
    localFrame: 'normalized-0to1',
    bindings: [
      { parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' },
    ],
    keyforms: [
      { keyTuple: [-30], positions: new Float64Array([1, 2, 3]), opacity: 1 },
      { keyTuple: [0],   positions: new Float64Array([4, 5, 6]), opacity: 1 },
    ],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// ── serializeRigWarps from iterable ───────────────────────────────

{
  const specs = [makeSpec('p1'), makeSpec('p2')];
  const stored = serializeRigWarps(specs);
  assert(typeof stored === 'object', 'serialize: returns object map');
  assert(stored.p1 && stored.p2, 'serialize: keyed by targetPartId');
  assert(Array.isArray(stored.p1.baseGrid), 'serialize: baseGrid → plain array');
  // JSON safety
  const json = JSON.stringify(stored);
  const parsed = JSON.parse(json);
  assert(parsed.p1.baseGrid[0] === 0, 'serialize: baseGrid survives JSON');
  assert(Array.isArray(parsed.p1.keyforms[0].positions),
    'serialize: keyform.positions plain array');
}

{
  // Specs without targetPartId are skipped silently
  const stored = serializeRigWarps([
    makeSpec('p1'),
    { ...makeSpec('p2'), targetPartId: undefined },
  ]);
  assert(Object.keys(stored).length === 1, 'serialize: drops spec without targetPartId');
}

// ── deserializeRigWarps round-trip ────────────────────────────────

{
  const stored = serializeRigWarps([makeSpec('p1')]);
  const map = deserializeRigWarps(stored);
  assert(map instanceof Map, 'deserialize: returns Map');
  assert(map.has('p1'), 'deserialize: keyed by partId');
  const back = map.get('p1');
  assert(back.baseGrid instanceof Float64Array, 'deserialize: baseGrid → Float64Array');
  assert(back.keyforms[0].positions instanceof Float64Array,
    'deserialize: positions → Float64Array');
  assert(back.targetPartId === 'p1', 'deserialize: targetPartId preserved');
}

// ── deserialize is defensive ──────────────────────────────────────

{
  assert(deserializeRigWarps(null).size === 0, 'deserialize: null → empty Map');
  assert(deserializeRigWarps(undefined).size === 0, 'deserialize: undefined → empty Map');
  assert(deserializeRigWarps('string').size === 0, 'deserialize: string → empty Map');
  assert(deserializeRigWarps({}).size === 0, 'deserialize: empty obj → empty Map');
}

{
  // Malformed entries dropped silently, well-formed kept
  const stored = {
    p_good: serializeRigWarps([makeSpec('p_good')]).p_good,
    p_no_baseGrid: { targetPartId: 'p_no_baseGrid', keyforms: [{positions:[1]}] },
    p_no_keyforms: { targetPartId: 'p_no_keyforms', baseGrid: [1, 2] },
    p_empty_baseGrid: { targetPartId: 'p_empty_baseGrid', baseGrid: [], keyforms: [{positions:[1]}] },
    p_no_partId: { baseGrid: [1, 2], keyforms: [{positions:[1]}] },
    p_keyform_no_positions: { targetPartId: 'p_keyform_no_positions', baseGrid: [1, 2], keyforms: [{}] },
  };
  const map = deserializeRigWarps(stored);
  assert(map.has('p_good'), 'deserialize: well-formed kept');
  assert(!map.has('p_no_baseGrid'), 'deserialize: missing baseGrid dropped');
  assert(!map.has('p_no_keyforms'), 'deserialize: missing keyforms dropped');
  assert(!map.has('p_empty_baseGrid'), 'deserialize: empty baseGrid dropped');
  assert(!map.has('p_no_partId'), 'deserialize: missing targetPartId dropped');
  assert(!map.has('p_keyform_no_positions'),
    'deserialize: keyform without positions array dropped');
}

// ── resolveRigWarps ───────────────────────────────────────────────

{
  assert(resolveRigWarps(null).size === 0, 'resolve: null project → empty');
  assert(resolveRigWarps({}).size === 0, 'resolve: no rigWarps → empty');

  const project = { rigWarps: serializeRigWarps([makeSpec('q')]) };
  const map = resolveRigWarps(project);
  assert(map.has('q'), 'resolve: with stored data → populated Map');
}

// ── seedRigWarps from Map ─────────────────────────────────────────

{
  const project = {};
  const inputMap = new Map([
    ['p1', makeSpec('p1')],
    ['p2', makeSpec('p2')],
  ]);
  const stored = seedRigWarps(project, inputMap);
  assert(project.rigWarps === stored, 'seed: returns and stores same reference');
  assert(Object.keys(project.rigWarps).length === 2, 'seed (Map): both entries written');
  assert(project.rigWarps.p1.targetPartId === 'p1', 'seed (Map): p1 keyed');
}

// ── seedRigWarps from iterable ────────────────────────────────────

{
  const project = {};
  seedRigWarps(project, [makeSpec('p1'), makeSpec('p2')]);
  assert(Object.keys(project.rigWarps).length === 2, 'seed (array): both entries');
}

// ── clearRigWarps ─────────────────────────────────────────────────

{
  const project = {};
  seedRigWarps(project, [makeSpec('p1')]);
  clearRigWarps(project);
  assert(typeof project.rigWarps === 'object', 'clear: still an object');
  assert(Object.keys(project.rigWarps).length === 0, 'clear: empty map');
}

console.log(`rigWarpsStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
