// v3 Phase 0F.24 - tests for src/io/live2d/rig/bodyWarpStore.js
//
// Body warp chain storage (Stage 10 of native rig refactor). The
// chain has THREE non-JSON-friendly elements: Float64Array baseGrid
// + keyform.positions (in each spec), and the canvasToBodyXX/Y
// closures (rebuilt from layout at deserialize time). A bug here
// silently corrupts body sway across the whole rig.
//
// Run: node scripts/test/test_bodyWarpStore.mjs

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

function makeSpec(id) {
  return {
    id, name: id,
    parent: { type: 'root', id: null },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array([0, 0, 0.5, 0.5, 1, 1]),
    localFrame: 'canvas-px',
    bindings: [
      { parameterId: 'ParamBodyAngleX', keys: [-10, 0, 10], interpolation: 'LINEAR' },
    ],
    keyforms: [
      { keyTuple: [-10], positions: new Float64Array([1, 2, 3]), opacity: 1 },
      { keyTuple: [0],   positions: new Float64Array([4, 5, 6]), opacity: 1 },
      { keyTuple: [10],  positions: new Float64Array([7, 8, 9]), opacity: 1 },
    ],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
}

function makeChain(withBX) {
  const specs = [
    makeSpec('BodyWarpZ'),
    makeSpec('BodyWarpY'),
    makeSpec('BreathWarp'),
  ];
  if (withBX) specs.push(makeSpec('BodyXWarp'));
  return {
    specs,
    layout: {
      BZ_MIN_X: 0, BZ_MIN_Y: 0, BZ_W: 800, BZ_H: 600,
      BY_MIN: -10, BY_MAX: 10,
      BR_MIN: -10, BR_MAX: 10,
      BX_MIN: -10, BX_MAX: 10,
    },
    canvasToBodyXX: (x) => x,
    canvasToBodyXY: (y) => y,
    debug: {
      HIP_FRAC: 0.45, FEET_FRAC: 0.75,
      bodyFracSource: 'computed',
      spineCfShifts: [0.1, 0.2, 0.3],
    },
  };
}

// ── serialize chain ───────────────────────────────────────────────

{
  const chain = makeChain(true);
  const stored = serializeBodyWarpChain(chain);

  // JSON safety
  const json = JSON.stringify(stored);
  const parsed = JSON.parse(json);
  assert(parsed.specs.length === 4, 'serialize: 4 specs preserved (with BX)');
  assert(Array.isArray(parsed.specs[0].baseGrid),
    'serialize: spec.baseGrid → plain array');
  assert(Array.isArray(parsed.specs[0].keyforms[0].positions),
    'serialize: keyform.positions → plain array');

  // Layout passed through
  assert(stored.layout.BZ_W === 800, 'serialize: layout.BZ_W');
  assert(stored.layout.BX_MAX === 10, 'serialize: layout.BX_MAX');

  // hasParamBodyAngleX correctly set when BX present
  assert(stored.hasParamBodyAngleX === true, 'serialize: hasParamBodyAngleX=true with BX');

  // Debug preserved
  assert(stored.debug.HIP_FRAC === 0.45, 'serialize: debug.HIP_FRAC');
  assert(Array.isArray(stored.debug.spineCfShifts),
    'serialize: spineCfShifts → plain array');
  assert(stored.debug.spineCfShifts[1] === 0.2, 'serialize: spineCfShifts values');

  // Closures NOT serialized (good - they're not JSON-safe anyway)
  assert(stored.canvasToBodyXX === undefined, 'serialize: closures dropped');
}

{
  // Without BX
  const stored = serializeBodyWarpChain(makeChain(false));
  assert(stored.specs.length === 3, 'serialize: 3 specs (no BX)');
  assert(stored.hasParamBodyAngleX === false,
    'serialize: hasParamBodyAngleX=false without BX');
}

// ── deserialize round-trip ────────────────────────────────────────

{
  const stored = serializeBodyWarpChain(makeChain(true));
  const back = deserializeBodyWarpChain(stored);

  assert(back !== null, 'deserialize: returns chain');
  assert(back.specs.length === 4, 'deserialize: 4 specs');
  assert(back.specs[0].baseGrid instanceof Float64Array,
    'deserialize: baseGrid → Float64Array');
  assert(back.specs[0].keyforms[0].positions instanceof Float64Array,
    'deserialize: keyform.positions → Float64Array');

  // Layout preserved
  assert(back.layout.BZ_W === 800, 'deserialize: layout.BZ_W');

  // Closures REBUILT from layout (not stored)
  assert(typeof back.canvasToBodyXX === 'function',
    'deserialize: canvasToBodyXX is a function');
  assert(typeof back.canvasToBodyXY === 'function',
    'deserialize: canvasToBodyXY is a function');

  // Debug
  assert(back.debug.HIP_FRAC === 0.45, 'deserialize: debug.HIP_FRAC');
  assert(Array.isArray(back.debug.spineCfShifts), 'deserialize: spineCfShifts array');
}

// ── deserialize defensive ─────────────────────────────────────────

{
  assert(deserializeBodyWarpChain(null) === null, 'deserialize: null → null');
  assert(deserializeBodyWarpChain(undefined) === null, 'deserialize: undefined → null');
  assert(deserializeBodyWarpChain('string') === null, 'deserialize: string → null');
  assert(deserializeBodyWarpChain({}) === null, 'deserialize: empty obj → null');
  assert(deserializeBodyWarpChain({ specs: [] }) === null,
    'deserialize: empty specs → null');
  assert(deserializeBodyWarpChain({ specs: [{}], layout: null }) === null,
    'deserialize: null layout → null');
  assert(deserializeBodyWarpChain({ specs: [{}] }) === null,
    'deserialize: missing layout → null');
}

// ── deserialize: missing debug fields default ────────────────────

{
  const stored = serializeBodyWarpChain(makeChain(true));
  // Strip debug fields
  stored.debug = {};
  const back = deserializeBodyWarpChain(stored);
  assert(back.debug.HIP_FRAC === 0.45, 'deserialize default: HIP_FRAC = 0.45');
  assert(back.debug.FEET_FRAC === 0.75, 'deserialize default: FEET_FRAC = 0.75');
  assert(back.debug.bodyFracSource === 'stored', 'deserialize default: bodyFracSource');
  assert(Array.isArray(back.debug.spineCfShifts) && back.debug.spineCfShifts.length === 0,
    'deserialize default: spineCfShifts = []');
}

// ── resolveBodyWarp ───────────────────────────────────────────────
// (BFA-006 Phase 6: chain specs persist as deformer nodes; layout +
//  debug live in `project.bodyWarpLayout` sidetable.)

{
  assert(resolveBodyWarp(null) === null, 'resolve: null project → null');
  assert(resolveBodyWarp({}) === null, 'resolve: no nodes/layout → null');
  assert(resolveBodyWarp({ nodes: [] }) === null,
    'resolve: empty nodes → null');

  const project = { nodes: [] };
  seedBodyWarpChain(project, makeChain(true));
  const r = resolveBodyWarp(project);
  assert(r !== null, 'resolve: with chain nodes + layout → object');
  assert(r.specs.length === 4, 'resolve: spec count preserved');
  assert(typeof r.canvasToBodyXX === 'function', 'resolve: closures rebuilt from layout');
}

// ── seedBodyWarpChain ─────────────────────────────────────────────

{
  const project = { nodes: [] };
  const stored = seedBodyWarpChain(project, makeChain(true));
  assert(stored != null, 'seed: returns serialized chain');
  const chainNodes = project.nodes.filter((n) => n.type === 'deformer');
  assert(chainNodes.length === 4, 'seed: 4 chain deformer nodes written');
  assert(project.bodyWarpLayout != null, 'seed: bodyWarpLayout sidetable populated');
  assert(Array.isArray(chainNodes[0].baseGrid),
    'seed: node baseGrid is plain array (JSON-safe)');
}

// ── clearBodyWarp ─────────────────────────────────────────────────

{
  const project = { nodes: [] };
  seedBodyWarpChain(project, makeChain(true));
  clearBodyWarp(project);
  const chainNodes = project.nodes.filter((n) => n.type === 'deformer');
  assert(chainNodes.length === 0, 'clear: chain nodes removed');
  assert(project.bodyWarpLayout === null, 'clear: bodyWarpLayout nulled');
}

console.log(`bodyWarpStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
