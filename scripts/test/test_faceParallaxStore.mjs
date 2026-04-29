// v3 Phase 0F.22 - tests for src/io/live2d/rig/faceParallaxStore.js
//
// Stage 4 of the native rig refactor. Float64Array doesn't survive
// JSON.stringify (becomes {}), so the store wraps spec ↔ JSON
// conversion. A bug here means face-parallax keyforms silently
// become empty after a save/load round-trip.
//
// Run: node scripts/test/test_faceParallaxStore.mjs

import {
  serializeFaceParallaxSpec,
  deserializeFaceParallaxSpec,
  resolveFaceParallax,
  seedFaceParallax,
  clearFaceParallax,
} from '../../src/io/live2d/rig/faceParallaxStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Build a representative spec
function makeSpec() {
  return {
    id: 'FaceParallaxWarp',
    name: 'Face Parallax',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array([0.1, 0.2, 0.3, 0.4]),
    localFrame: 'pivot-relative',
    bindings: [
      { parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' },
      { parameterId: 'ParamAngleY', keys: [-30, 0, 30], interpolation: 'LINEAR' },
    ],
    keyforms: [
      { keyTuple: [-30, -30], positions: new Float64Array([1, 2, 3, 4]), opacity: 0.9 },
      { keyTuple: [0, 0],     positions: new Float64Array([5, 6, 7, 8]), opacity: 1.0 },
    ],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// ── Serialization is JSON-safe ────────────────────────────────────

{
  const spec = makeSpec();
  const stored = serializeFaceParallaxSpec(spec);

  // Roundtrip through JSON to confirm it's actually JSON-safe (the
  // root concern: Float64Array would become {}).
  const json = JSON.stringify(stored);
  const parsed = JSON.parse(json);

  assert(Array.isArray(parsed.baseGrid), 'serialize: baseGrid is plain array after JSON');
  assert(parsed.baseGrid.length === 4, 'serialize: baseGrid length preserved');
  assert(parsed.baseGrid[0] === 0.1, 'serialize: baseGrid values preserved');
  assert(Array.isArray(parsed.keyforms[0].positions),
    'serialize: keyform.positions is plain array');
  assert(parsed.keyforms[0].positions.length === 4,
    'serialize: keyform.positions length');

  // Inputs unchanged (Pillar Q in spirit)
  assert(spec.baseGrid instanceof Float64Array, 'serialize: input baseGrid still Float64Array');
}

// ── Round-trip preserves shape ────────────────────────────────────

{
  const spec = makeSpec();
  const back = deserializeFaceParallaxSpec(serializeFaceParallaxSpec(spec));

  assert(back.id === spec.id, 'roundtrip: id preserved');
  assert(back.name === spec.name, 'roundtrip: name preserved');
  assert(back.parent.id === spec.parent.id, 'roundtrip: parent.id');
  assert(back.parent.type === spec.parent.type, 'roundtrip: parent.type');
  assert(back.gridSize.rows === 5, 'roundtrip: gridSize.rows');
  assert(back.localFrame === 'pivot-relative', 'roundtrip: localFrame');
  assert(back.baseGrid instanceof Float64Array, 'roundtrip: baseGrid → Float64Array');
  assert(back.baseGrid[0] === 0.1, 'roundtrip: baseGrid[0]');
  assert(back.bindings.length === 2, 'roundtrip: bindings count');
  assert(back.bindings[0].parameterId === 'ParamAngleX', 'roundtrip: bindings.parameterId');
  assert(back.keyforms.length === 2, 'roundtrip: keyforms count');
  assert(back.keyforms[0].positions instanceof Float64Array,
    'roundtrip: keyform.positions → Float64Array');
  assert(back.keyforms[0].positions[2] === 3, 'roundtrip: positions[2]');
  assert(back.keyforms[0].opacity === 0.9, 'roundtrip: opacity');
}

// ── Deserialize handles malformed input ───────────────────────────

{
  assert(deserializeFaceParallaxSpec(null) === null, 'deserialize: null → null');
  assert(deserializeFaceParallaxSpec(undefined) === null, 'deserialize: undefined → null');
  assert(deserializeFaceParallaxSpec('string') === null, 'deserialize: string → null');
  assert(deserializeFaceParallaxSpec({}) === null, 'deserialize: empty obj → null');
  assert(deserializeFaceParallaxSpec({ keyforms: [] }) === null,
    'deserialize: empty keyforms → null');
  assert(deserializeFaceParallaxSpec({ keyforms: [{}], baseGrid: 'no' }) === null,
    'deserialize: non-array baseGrid → null');
}

// ── Deserialize fills missing fields with defaults ────────────────

{
  const minimal = {
    keyforms: [{ keyTuple: [0], positions: [1, 2], opacity: 1 }],
    baseGrid: [0, 0],
  };
  const r = deserializeFaceParallaxSpec(minimal);
  assert(r.id === 'FaceParallaxWarp', 'deserialize default: id');
  assert(r.name === 'Face Parallax', 'deserialize default: name');
  assert(r.parent.type === 'rotation' && r.parent.id === 'FaceRotation',
    'deserialize default: parent → FaceRotation');
  assert(r.gridSize.rows === 5 && r.gridSize.cols === 5,
    'deserialize default: gridSize');
  assert(r.localFrame === 'pivot-relative', 'deserialize default: localFrame');
  assert(r.isVisible === true, 'deserialize default: isVisible');
  assert(r.isLocked === false, 'deserialize default: isLocked');
}

{
  // Keyform without opacity gets default 1
  const r = deserializeFaceParallaxSpec({
    keyforms: [{ keyTuple: [0], positions: [] }],  // no opacity
    baseGrid: [],
  });
  assert(r.keyforms[0].opacity === 1, 'deserialize: missing opacity → 1');
}

// ── resolveFaceParallax ───────────────────────────────────────────

{
  assert(resolveFaceParallax(null) === null, 'resolve: null project → null');
  assert(resolveFaceParallax({}) === null, 'resolve: no faceParallax field → null');
  assert(resolveFaceParallax({ faceParallax: null }) === null,
    'resolve: explicit null faceParallax → null');

  const project = { faceParallax: serializeFaceParallaxSpec(makeSpec()) };
  const r = resolveFaceParallax(project);
  assert(r !== null, 'resolve: with stored spec → object');
  assert(r.id === 'FaceParallaxWarp', 'resolve: id preserved');
}

// ── seedFaceParallax ──────────────────────────────────────────────

{
  const project = {};
  const stored = seedFaceParallax(project, makeSpec());
  assert(project.faceParallax !== null, 'seed: writes to project');
  assert(project.faceParallax === stored, 'seed: returns the stored shape');
  assert(Array.isArray(project.faceParallax.baseGrid),
    'seed: stored is JSON-safe (plain array)');

  // Idempotent — re-seed overwrites
  const second = seedFaceParallax(project, makeSpec());
  assert(project.faceParallax === second, 'seed: re-seed overwrites');
}

// ── clearFaceParallax ─────────────────────────────────────────────

{
  const project = {};
  seedFaceParallax(project, makeSpec());
  clearFaceParallax(project);
  assert(project.faceParallax === null, 'clear: sets to null');
}

console.log(`faceParallaxStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
