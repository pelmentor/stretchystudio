// Tests for src/io/live2d/rig/rigWarpsStore.js — Stage 9b (per-mesh
// rig warp keyform persistence). Run: node scripts/test_rigWarps.mjs
//
// Covers:
//   - serialize: spec iterable → { [partId]: storedSpec }, Float64Array → number[]
//   - serialize: drops entries without targetPartId, preserves all fields
//   - deserialize: object map → Map<partId, spec>, number[] → Float64Array
//   - deserialize: drops obviously broken entries; tolerates missing optionals
//   - JSON.stringify round-trip preserves bit-exact positions (1e-15)
//   - resolve(project): project.rigWarps absent / empty / populated
//   - seed(project, ...): destructive, accepts Map or iterable
//   - clear(project): resets to {}
//   - Stored entries bypass any external recompute; reader-fork would use them verbatim

import {
  serializeRigWarps,
  deserializeRigWarps,
  resolveRigWarps,
  seedRigWarps,
  clearRigWarps,
} from '../src/io/live2d/rig/rigWarpsStore.js';

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

// Synthetic rigWarpSpec mirroring what cmo3writer.js produces inside
// the per-mesh emission loop. Covers all fields the store handles.
function makeSpec({
  partId = 'part-A',
  bindings = [
    { parameterId: 'ParamHairFront', keys: [-1, 0, 1], interpolation: 'LINEAR' },
  ],
  numKf = 3,
  warpRows = 2,
  warpCols = 2,
  parent = { type: 'warp', id: 'BodyXWarp' },
  bbox = { minX: 100, minY: 50, W: 200, H: 150 },
} = {}) {
  const gW = warpCols + 1;
  const gH = warpRows + 1;
  const pts = gW * gH;
  // Synthesize a baseGrid: regular lattice in 0..1 normalized space.
  const baseGrid = new Float64Array(pts * 2);
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      baseGrid[(r * gW + c) * 2]     = c / (gW - 1);
      baseGrid[(r * gW + c) * 2 + 1] = r / (gH - 1);
    }
  }
  const keyforms = [];
  for (let i = 0; i < numKf; i++) {
    const positions = new Float64Array(baseGrid);
    // Inject a keyform-specific delta so the comparison can detect
    // round-trip slip.
    for (let p = 0; p < positions.length; p += 2) {
      positions[p]     += i * 0.01;
      positions[p + 1] += i * 0.0123456789;
    }
    keyforms.push({
      keyTuple: [bindings[0]?.keys?.[i] ?? i],
      positions,
      opacity: 1,
    });
  }
  return {
    id: `RigWarp_${partId}`,
    name: `${partId} Warp`,
    parent,
    targetPartId: partId,
    canvasBbox: bbox,
    gridSize: { rows: warpRows, cols: warpCols },
    baseGrid,
    localFrame: 'normalized-0to1',
    bindings,
    keyforms,
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// --- serializeRigWarps: shape contract ---

{
  const specs = [makeSpec({ partId: 'A' }), makeSpec({ partId: 'B' })];
  const stored = serializeRigWarps(specs);
  assert(typeof stored === 'object', 'stored is plain object');
  assertEq(Object.keys(stored).sort(), ['A', 'B'], 'keyed by targetPartId');
  assert(Array.isArray(stored.A.baseGrid), 'baseGrid is plain Array');
  assertEq(stored.A.baseGrid.length, 18, 'baseGrid 9 points × 2');
  assert(Array.isArray(stored.A.keyforms[0].positions),
    'keyform positions are plain Array');
  assert(typeof stored.A.baseGrid[0] === 'number', 'plain numbers in baseGrid');
  assertEq(stored.A.bindings[0].parameterId, 'ParamHairFront',
    'binding parameterId preserved');
  assertEq(stored.A.gridSize, { rows: 2, cols: 2 }, 'gridSize preserved');
  assertEq(stored.A.canvasBbox.W, 200, 'canvasBbox.W preserved');
  assertEq(stored.A.parent, { type: 'warp', id: 'BodyXWarp' }, 'parent preserved');
  assertEq(stored.A.localFrame, 'normalized-0to1', 'localFrame preserved');
  assertEq(stored.A.isVisible, true, 'isVisible preserved');
  assertEq(stored.A.isLocked, false, 'isLocked preserved');
  assertEq(stored.A.isQuadTransform, false, 'isQuadTransform preserved');
}

// --- serializeRigWarps: drops entries without targetPartId ---

{
  const a = makeSpec({ partId: 'A' });
  const b = makeSpec({ partId: 'B' });
  delete b.targetPartId;
  const stored = serializeRigWarps([a, b]);
  assertEq(Object.keys(stored), ['A'], 'B without targetPartId is dropped');
}

{
  const stored = serializeRigWarps([null, undefined, makeSpec({ partId: 'X' })]);
  assertEq(Object.keys(stored), ['X'],
    'null/undefined entries silently dropped');
}

// --- serializeRigWarps: empty input → empty object ---

{
  assertEq(serializeRigWarps([]), {}, 'empty array → empty object');
}

// --- serializeRigWarps: same partId twice — last wins (deterministic) ---

{
  const a = makeSpec({ partId: 'X' });
  const b = makeSpec({ partId: 'X' });
  // Mark b distinct so we can tell which one survived.
  b.name = 'Second';
  const stored = serializeRigWarps([a, b]);
  assertEq(stored.X.name, 'Second', 'duplicate partId: last wins');
}

// --- deserializeRigWarps: object map → Map<partId, spec> ---

{
  const specs = [makeSpec({ partId: 'A' }), makeSpec({ partId: 'B' })];
  const stored = serializeRigWarps(specs);
  const restored = deserializeRigWarps(stored);
  assert(restored instanceof Map, 'returns Map');
  assertEq(restored.size, 2, 'size matches');
  assert(restored.has('A'), 'has A');
  assert(restored.has('B'), 'has B');
  const a = restored.get('A');
  assert(a.baseGrid instanceof Float64Array, 'baseGrid restored as Float64Array');
  assert(a.keyforms[0].positions instanceof Float64Array,
    'keyform positions restored as Float64Array');
}

// --- deserializeRigWarps: round-trip exact (1e-15) ---

{
  const original = makeSpec({ partId: 'A', numKf: 3 });
  const stored = serializeRigWarps([original]);
  const restored = deserializeRigWarps(stored).get('A');
  arraysClose(restored.baseGrid, original.baseGrid, 1e-15,
    'baseGrid round-trip exact');
  for (let i = 0; i < original.keyforms.length; i++) {
    arraysClose(restored.keyforms[i].positions,
      original.keyforms[i].positions, 1e-15,
      `keyform[${i}] positions round-trip exact`);
    assertEq(restored.keyforms[i].keyTuple, original.keyforms[i].keyTuple,
      `keyform[${i}] keyTuple round-trip`);
    assertEq(restored.keyforms[i].opacity, original.keyforms[i].opacity,
      `keyform[${i}] opacity round-trip`);
  }
  assertEq(restored.bindings, original.bindings, 'bindings round-trip');
  assertEq(restored.gridSize, original.gridSize, 'gridSize round-trip');
  assertEq(restored.canvasBbox, original.canvasBbox, 'canvasBbox round-trip');
  assertEq(restored.parent, original.parent, 'parent round-trip');
}

// --- deserializeRigWarps: malformed input handling ---

{
  assert(deserializeRigWarps(null).size === 0, 'null → empty map');
  assert(deserializeRigWarps(undefined).size === 0, 'undefined → empty map');
  assert(deserializeRigWarps('string').size === 0, 'non-object → empty map');
  assert(deserializeRigWarps([]).size === 0, 'array (treated as object) → empty map');
}

{
  // Mix of valid + invalid; only valid survives.
  const stored = {
    A: serializeRigWarps([makeSpec({ partId: 'A' })])['A'],
    B: { /* missing targetPartId */ },
    C: { targetPartId: 'C', baseGrid: [], keyforms: [{ positions: [1, 2] }] },
    D: { targetPartId: 'D' /* missing baseGrid + keyforms */ },
    E: { targetPartId: 'E', baseGrid: [1, 2, 3, 4], keyforms: [/* missing positions */ {}] },
  };
  const restored = deserializeRigWarps(stored);
  assert(restored.has('A'), 'valid A survives');
  assert(!restored.has('B'), 'B without targetPartId dropped');
  assert(!restored.has('C'), 'C with empty baseGrid dropped');
  assert(!restored.has('D'), 'D without baseGrid/keyforms dropped');
  assert(!restored.has('E'), 'E with malformed keyform dropped');
  assertEq(restored.size, 1, 'only valid entries survive');
}

// --- deserializeRigWarps: lenient on optional fields ---

{
  const minimal = {
    M: {
      targetPartId: 'M',
      baseGrid: [0, 0, 1, 0, 1, 1, 0, 1],
      keyforms: [{ positions: [0, 0, 1, 0, 1, 1, 0, 1] }],
    },
  };
  const restored = deserializeRigWarps(minimal);
  assert(restored.has('M'), 'minimal entry passes');
  const m = restored.get('M');
  assertEq(m.parent.type, 'warp', 'default parent applied');
  assertEq(m.localFrame, 'normalized-0to1', 'default localFrame applied');
  assertEq(m.isVisible, true, 'default isVisible applied');
  assertEq(m.isQuadTransform, false, 'default isQuadTransform applied');
  assertEq(m.bindings, [], 'missing bindings → empty array');
  assertEq(m.keyforms[0].opacity, 1, 'missing keyform.opacity → 1');
  assertEq(m.keyforms[0].keyTuple, [], 'missing keyform.keyTuple → []');
}

// --- JSON.stringify round-trip preserves positions exactly ---

{
  const original = makeSpec({ partId: 'A' });
  const stored = serializeRigWarps([original]);
  const json = JSON.stringify(stored);
  const reparsed = JSON.parse(json);
  const restored = deserializeRigWarps(reparsed).get('A');
  arraysClose(restored.baseGrid, original.baseGrid, 1e-15,
    'JSON round-trip baseGrid exact');
  for (let i = 0; i < original.keyforms.length; i++) {
    arraysClose(restored.keyforms[i].positions,
      original.keyforms[i].positions, 1e-15,
      `JSON round-trip keyform[${i}] positions exact`);
  }
}

// --- resolveRigWarps(project): null / missing / empty / populated ---

{
  assertEq(resolveRigWarps({}).size, 0, 'no project.rigWarps → empty Map');
  assertEq(resolveRigWarps({ rigWarps: null }).size, 0,
    'project.rigWarps null → empty Map');
  assertEq(resolveRigWarps({ rigWarps: {} }).size, 0,
    'project.rigWarps empty → empty Map');
  assertEq(resolveRigWarps(null).size, 0, 'null project → empty Map');
  assertEq(resolveRigWarps(undefined).size, 0, 'undefined project → empty Map');
}

{
  const specs = [makeSpec({ partId: 'A' }), makeSpec({ partId: 'B' })];
  const project = { rigWarps: serializeRigWarps(specs) };
  const resolved = resolveRigWarps(project);
  assertEq(resolved.size, 2, 'resolve populated → size 2');
  assert(resolved.has('A'), 'resolve has A');
  assert(resolved.has('B'), 'resolve has B');
}

// --- seedRigWarps: accepts Map ---

{
  const project = {};
  const map = new Map([
    ['A', makeSpec({ partId: 'A' })],
    ['B', makeSpec({ partId: 'B' })],
  ]);
  const stored = seedRigWarps(project, map);
  assert(project.rigWarps === stored, 'seed assigns project.rigWarps');
  assertEq(Object.keys(project.rigWarps).sort(), ['A', 'B'], 'seeded both');
  const resolved = resolveRigWarps(project);
  assertEq(resolved.size, 2, 'resolve reads back size');
}

// --- seedRigWarps: accepts iterable of specs ---

{
  const project = {};
  const specs = [makeSpec({ partId: 'X' }), makeSpec({ partId: 'Y' })];
  seedRigWarps(project, specs);
  assertEq(Object.keys(project.rigWarps).sort(), ['X', 'Y'],
    'iterable input keyed by targetPartId');
}

// --- seedRigWarps: destructive — overwrites prior storage ---

{
  const project = {};
  seedRigWarps(project, [makeSpec({ partId: 'A' })]);
  assertEq(Object.keys(project.rigWarps), ['A'], 'first seed → A only');
  seedRigWarps(project, [makeSpec({ partId: 'B' })]);
  assertEq(Object.keys(project.rigWarps), ['B'], 'second seed replaces');
  assert(!('A' in project.rigWarps), 'A removed');
}

// --- clearRigWarps: resets to {} ---

{
  const project = {};
  seedRigWarps(project, [makeSpec({ partId: 'A' })]);
  assert(Object.keys(project.rigWarps).length > 0, 'seeded');
  clearRigWarps(project);
  assertEq(project.rigWarps, {}, 'clear → {}');
  assertEq(resolveRigWarps(project).size, 0, 'resolve after clear: empty');
}

// --- Full JSON.stringify→parse→resolve round-trip (simulates .stretch save/load) ---

{
  const original = makeSpec({ partId: 'A', numKf: 3 });
  const project = {};
  seedRigWarps(project, [original]);
  const json = JSON.stringify(project);
  const reloaded = JSON.parse(json);
  const resolved = resolveRigWarps(reloaded);
  assert(resolved.has('A'), 'survives full project round-trip');
  const restored = resolved.get('A');
  arraysClose(restored.baseGrid, original.baseGrid, 1e-15,
    'project round-trip: baseGrid exact');
  for (let i = 0; i < original.keyforms.length; i++) {
    arraysClose(restored.keyforms[i].positions,
      original.keyforms[i].positions, 1e-15,
      `project round-trip: keyform[${i}] positions exact`);
  }
}

// --- Stored entries bypass anything external; reader fork uses positions verbatim ---

{
  const original = makeSpec({ partId: 'A' });
  // Inject a marker delta so we can tell stored value from any new compute.
  for (let i = 0; i < original.keyforms[0].positions.length; i++) {
    original.keyforms[0].positions[i] = 999.0 + i * 0.001;
  }
  const project = {};
  seedRigWarps(project, [original]);
  const resolved = resolveRigWarps(project);
  arraysClose(resolved.get('A').keyforms[0].positions,
    original.keyforms[0].positions, 1e-15,
    'stored keyform[0] positions returned verbatim');
  // Sanity: distinct from baseGrid.
  let diff = 0;
  for (let i = 0; i < original.baseGrid.length; i++) {
    diff += Math.abs(resolved.get('A').keyforms[0].positions[i] - original.baseGrid[i]);
  }
  assert(diff > 100, 'sanity: stored positions differ from baseGrid');
}

// --- Multi-keyform / multi-binding shape preserved ---

{
  const spec = makeSpec({
    partId: 'multi',
    bindings: [
      { parameterId: 'ParamEyeBallX', keys: [-1, 0, 1], interpolation: 'LINEAR' },
      { parameterId: 'ParamEyeBallY', keys: [-1, 0, 1], interpolation: 'LINEAR' },
    ],
    numKf: 9,
  });
  const project = {};
  seedRigWarps(project, [spec]);
  const resolved = resolveRigWarps(project).get('multi');
  assertEq(resolved.bindings.length, 2, 'multi-binding preserved');
  assertEq(resolved.keyforms.length, 9, '9 keyforms preserved (3×3 cartesian)');
  for (let i = 0; i < spec.keyforms.length; i++) {
    arraysClose(resolved.keyforms[i].positions,
      spec.keyforms[i].positions, 1e-15,
      `multi: keyform[${i}] positions exact`);
  }
}

// --- Reader-fork shape: keyform count + per-keyform position length ---
// (mirrors the validity guard inside cmo3writer.js's per-mesh loop)

{
  const spec = makeSpec({ partId: 'A', numKf: 3 });
  const project = {};
  seedRigWarps(project, [spec]);
  const resolved = resolveRigWarps(project).get('A');
  // The cmo3writer.js validity check would do:
  //   stored && Array.isArray(stored.keyforms)
  //   && stored.keyforms.length === numKf
  //   && every k => k.positions.length === warpGridPts*2
  assert(Array.isArray(resolved.keyforms), 'keyforms is array (after deserialize, technically Array of objects)');
  assert(resolved.keyforms.length === 3, 'keyform count matches expected numKf');
  const expectedPosLen = (2 + 1) * (2 + 1) * 2;  // (rows+1)*(cols+1)*2
  for (const k of resolved.keyforms) {
    assert(k.positions.length === expectedPosLen,
      'each keyform.positions length matches warpGridPts*2');
  }
}

// --- Validity guard rejects a stale-shape stored entry ---

{
  // Simulate a save where the user re-meshed and the grid expanded
  // (was 2×2 / 9 points / 18 numbers, now suddenly 3×3 / 16 points / 32 numbers).
  const spec = makeSpec({ partId: 'A', numKf: 3 });
  const project = {};
  seedRigWarps(project, [spec]);
  const resolved = resolveRigWarps(project).get('A');

  // What the writer would compute today:
  const numKfExpected = 3;
  const newWarpGridPts = (3 + 1) * (3 + 1);
  const expectedPosLen = newWarpGridPts * 2;
  const validShape = !!(resolved
    && Array.isArray(resolved.keyforms)
    && resolved.keyforms.length === numKfExpected
    && resolved.keyforms.every(k => k && k.positions && k.positions.length === expectedPosLen));
  assert(!validShape,
    'stale-grid-size stored entry rejected by writer-side validity guard');
}

{
  // Now an entry where keyform count differs (binding axis added).
  const spec = makeSpec({ partId: 'A', numKf: 3 });
  const project = {};
  seedRigWarps(project, [spec]);
  const resolved = resolveRigWarps(project).get('A');
  const numKfExpected = 9; // pretend a 2nd binding was added (3×3 cartesian)
  const validShape = !!(resolved
    && Array.isArray(resolved.keyforms)
    && resolved.keyforms.length === numKfExpected);
  assert(!validShape,
    'stale-keyform-count stored entry rejected by writer-side validity guard');
}

// --- Determinism: serialize is pure (same input → same output) ---

{
  const a = serializeRigWarps([makeSpec({ partId: 'X' })]);
  const b = serializeRigWarps([makeSpec({ partId: 'X' })]);
  assertEq(a, b, 'serialize deterministic');
}

// --- Summary ---

console.log(`rigWarps: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
