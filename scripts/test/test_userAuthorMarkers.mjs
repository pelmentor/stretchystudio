// Tests for src/io/live2d/rig/userAuthorMarkers.js — V3 Re-Rig Phase 0.
// Covers:
//   - markUserAuthored / isUserAuthored (idempotent stamp + predicate)
//   - mergeAuthored (preservation, key-collision drop, order)
//   - mergeAuthoredByStage (stage-key dispatch)
//   - Per-seeder merge mode (maskConfigs, physicsRules, faceParallax,
//     bodyWarp, rigWarps) — verifies _userAuthored entries survive.
//   - seedAutoRigConfig clobber-fix (subsystems preserved across re-init).
//
// Run: node scripts/test/test_userAuthorMarkers.mjs

import {
  markUserAuthored,
  isUserAuthored,
  mergeAuthored,
  mergeAuthoredByStage,
  STAGE_KEY,
} from '../../src/io/live2d/rig/userAuthorMarkers.js';
import { seedMaskConfigs } from '../../src/io/live2d/rig/maskConfigs.js';
import { seedPhysicsRules } from '../../src/io/live2d/rig/physicsConfig.js';
import { seedAutoRigConfig } from '../../src/io/live2d/rig/autoRigConfig.js';
import { seedFaceParallax } from '../../src/io/live2d/rig/faceParallaxStore.js';
import { seedBodyWarpChain } from '../../src/io/live2d/rig/bodyWarpStore.js';
import { seedRigWarps } from '../../src/io/live2d/rig/rigWarpsStore.js';

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

// --- markUserAuthored / isUserAuthored ---

{
  const e = { id: 'foo' };
  assert(!isUserAuthored(e), 'fresh entry not marked');
  const ret = markUserAuthored(e);
  assert(isUserAuthored(e), 'after mark, predicate true');
  assert(ret === e, 'markUserAuthored returns same ref for chaining');
  // Idempotent
  markUserAuthored(e);
  assert(isUserAuthored(e), 'mark is idempotent');
}

{
  // Defensive: predicate against null / non-object inputs.
  assert(!isUserAuthored(null), 'null is not authored');
  assert(!isUserAuthored(undefined), 'undefined is not authored');
  assert(!isUserAuthored(42), 'number is not authored');
  assert(!isUserAuthored('foo'), 'string is not authored');
  assert(!isUserAuthored({ _userAuthored: 1 }), 'truthy non-true is not authored');
  assert(!isUserAuthored({ _userAuthored: 'yes' }), 'string truthy is not authored');
  assert(isUserAuthored({ _userAuthored: true }), 'literal true is authored');
}

// --- mergeAuthored: pure function ---

{
  // No existing → autoSeeded passes through.
  const auto = [{ id: 'a' }, { id: 'b' }];
  const out = mergeAuthored(auto, [], (e) => e.id);
  assertEq(out, auto, 'empty existing → autoSeeded passes through');
  assert(out !== auto, 'returns a fresh array (not aliased)');
}

{
  // No marked entries in existing → behaviour same as empty.
  const auto = [{ id: 'a' }, { id: 'b' }];
  const existing = [{ id: 'x' }, { id: 'y' }]; // not marked
  const out = mergeAuthored(auto, existing, (e) => e.id);
  assertEq(out, auto, 'unmarked existing → autoSeeded passes through');
}

{
  // Marked entry preserved; auto seed without collision is added.
  const existing = [markUserAuthored({ id: 'manual1' })];
  const auto = [{ id: 'a' }, { id: 'b' }];
  const out = mergeAuthored(auto, existing, (e) => e.id);
  assert(out.length === 3, 'preserved + 2 auto = 3 entries');
  assert(out[0].id === 'manual1', 'preserved entry first');
  assert(isUserAuthored(out[0]), 'preserved entry retains marker');
  assert(out[1].id === 'a' && out[2].id === 'b', 'auto entries follow');
}

{
  // Key collision: auto entry whose key matches a preserved entry is dropped.
  const existing = [markUserAuthored({ id: 'a', tag: 'manual' })];
  const auto = [{ id: 'a', tag: 'auto' }, { id: 'b' }];
  const out = mergeAuthored(auto, existing, (e) => e.id);
  assert(out.length === 2, 'colliding auto entry dropped');
  assertEq(out[0], { id: 'a', tag: 'manual', _userAuthored: true }, 'manual wins on collision');
  assert(out[1].id === 'b', 'non-colliding auto entry kept');
}

{
  // Multiple preserved + multiple new + one collision.
  const existing = [
    markUserAuthored({ id: 'm1' }),
    { id: 'unmarked' },         // not preserved
    markUserAuthored({ id: 'm2' }),
  ];
  const auto = [{ id: 'm1' }, { id: 'a' }, { id: 'b' }, { id: 'm2' }];
  const out = mergeAuthored(auto, existing, (e) => e.id);
  assert(out.length === 4, '2 preserved + 2 non-colliding auto = 4');
  // Order: preserved first (in their existing order), then non-colliding auto.
  assert(out[0].id === 'm1' && out[1].id === 'm2', 'preserved order maintained');
  assert(out[2].id === 'a' && out[3].id === 'b', 'auto order maintained');
}

{
  // Null / undefined existing handled.
  const auto = [{ id: 'a' }];
  assertEq(mergeAuthored(auto, null, (e) => e.id), auto, 'null existing → autoSeeded');
  assertEq(mergeAuthored(auto, undefined, (e) => e.id), auto, 'undefined existing → autoSeeded');
}

// --- mergeAuthoredByStage: stage-key dispatch ---

{
  // maskConfigs: keyed on maskedMeshId.
  const existing = [
    markUserAuthored({ maskedMeshId: 'm1', maskMeshIds: ['mask1'] }),
  ];
  const auto = [
    { maskedMeshId: 'm1', maskMeshIds: ['autoMask'] },  // collision
    { maskedMeshId: 'm2', maskMeshIds: ['autoMask2'] }, // no collision
  ];
  const out = mergeAuthoredByStage('maskConfigs', auto, existing);
  assert(out.length === 2, 'maskConfigs: 1 preserved + 1 auto');
  assertEq(out[0].maskMeshIds, ['mask1'], 'maskConfigs: manual wins on collision');
}

{
  // physicsRules: keyed on id.
  const existing = [markUserAuthored({ id: 'rule-imported', name: 'Imported' })];
  const auto = [{ id: 'rule-imported', name: 'Auto' }, { id: 'rule-auto' }];
  const out = mergeAuthoredByStage('physicsRules', auto, existing);
  assert(out.length === 2, 'physicsRules: collision drops auto');
  assertEq(out[0].name, 'Imported', 'physicsRules: imported rule wins');
}

{
  // Unknown stage throws.
  let caught = false;
  try { mergeAuthoredByStage('bogus', [], []); }
  catch (_e) { caught = true; }
  assert(caught, 'unknown stage throws');
}

{
  // STAGE_KEY entries return the right key.
  assertEq(STAGE_KEY.maskConfigs({ maskedMeshId: 'foo' }), 'foo', 'STAGE_KEY.maskConfigs');
  assertEq(STAGE_KEY.physicsRules({ id: 'rule-1' }), 'rule-1', 'STAGE_KEY.physicsRules');
  assertEq(STAGE_KEY.rigWarps({ targetPartId: 'p1' }), 'p1', 'STAGE_KEY.rigWarps');
  assertEq(STAGE_KEY.maskConfigs(null), null, 'STAGE_KEY.maskConfigs(null) → null');
  assertEq(STAGE_KEY.maskConfigs({}), null, 'STAGE_KEY.maskConfigs({}) → null');
}

// --- seedMaskConfigs: replace vs merge ---

function makeMaskProject() {
  return {
    nodes: [
      { id: 'm1', type: 'part', name: 'eyewhite-l', visible: true, mesh: {} },
      { id: 'm2', type: 'part', name: 'irides-l', visible: true, mesh: {} },
      { id: 'm3', type: 'part', name: 'eyewhite-r', visible: true, mesh: {} },
      { id: 'm4', type: 'part', name: 'irides-r', visible: true, mesh: {} },
    ],
  };
}

{
  // Default mode (replace) wipes any prior manual configs — back-compat.
  const project = makeMaskProject();
  project.maskConfigs = [
    markUserAuthored({ maskedMeshId: 'mFoo', maskMeshIds: ['mBar'] }),
  ];
  seedMaskConfigs(project); // default mode = 'replace'
  // Auto pairs irides-l→eyewhite-l + irides-r→eyewhite-r.
  assert(project.maskConfigs.length === 2, 'replace: 2 auto pairs');
  assert(!project.maskConfigs.some((c) => c.maskedMeshId === 'mFoo'),
    'replace: manual mask wiped');
}

{
  // Explicit replace mode: same as default.
  const project = makeMaskProject();
  project.maskConfigs = [markUserAuthored({ maskedMeshId: 'mFoo', maskMeshIds: ['mBar'] })];
  seedMaskConfigs(project, 'replace');
  assert(!project.maskConfigs.some((c) => c.maskedMeshId === 'mFoo'),
    'explicit replace: manual mask wiped');
}

{
  // Merge mode: marked manual mask preserved.
  const project = makeMaskProject();
  project.maskConfigs = [
    markUserAuthored({ maskedMeshId: 'mFoo', maskMeshIds: ['mBar'] }),
  ];
  seedMaskConfigs(project, 'merge');
  // Should have 1 manual + 2 auto pairs.
  assert(project.maskConfigs.length === 3, 'merge: 1 manual + 2 auto');
  assert(project.maskConfigs.some((c) => c.maskedMeshId === 'mFoo'),
    'merge: manual mask preserved');
}

{
  // Merge mode: unmarked existing entry NOT preserved.
  const project = makeMaskProject();
  project.maskConfigs = [
    { maskedMeshId: 'mFoo', maskMeshIds: ['mBar'] }, // no marker
  ];
  seedMaskConfigs(project, 'merge');
  assert(!project.maskConfigs.some((c) => c.maskedMeshId === 'mFoo'),
    'merge: unmarked entry NOT preserved');
}

// --- seedPhysicsRules: replace vs merge ---

function makePhysicsProject() {
  return {
    nodes: [
      { id: 'g1', type: 'group', name: 'hair_front_root', boneRole: 'hair_front_root' },
    ],
  };
}

{
  // Default replace wipes imported rules.
  const project = makePhysicsProject();
  project.physicsRules = [markUserAuthored({
    id: 'imported-1',
    name: 'Imported Custom',
    category: 'imported',
    inputs: [{ paramId: 'X', type: 'SRC_TO_X', weight: 100, isReverse: false }],
    outputs: [{ paramId: 'ParamY', vertexIndex: 1, scale: 10, isReverse: false }],
    vertices: [{ x: 0, y: 0 }, { x: 0, y: 10 }],
    normalization: { posMin: -10, posDef: 0, posMax: 10, angleMin: -10, angleDef: 0, angleMax: 10 },
  })];
  seedPhysicsRules(project); // 'replace' default
  assert(!project.physicsRules.some((r) => r.id === 'imported-1'),
    'replace: imported rule wiped');
}

{
  // Merge: imported rule preserved alongside auto-derived rules.
  const project = makePhysicsProject();
  project.physicsRules = [markUserAuthored({
    id: 'imported-1',
    name: 'Imported Custom',
    category: 'imported',
    inputs: [{ paramId: 'X', type: 'SRC_TO_X', weight: 100, isReverse: false }],
    outputs: [{ paramId: 'ParamY', vertexIndex: 1, scale: 10, isReverse: false }],
    vertices: [{ x: 0, y: 0 }, { x: 0, y: 10 }],
    normalization: { posMin: -10, posDef: 0, posMax: 10, angleMin: -10, angleDef: 0, angleMax: 10 },
  })];
  seedPhysicsRules(project, 'merge');
  assert(project.physicsRules.some((r) => r.id === 'imported-1'),
    'merge: imported rule preserved');
  // Plus the auto rules from defaults.
  assert(project.physicsRules.length > 1, 'merge: imported + auto rules');
}

// --- seedAutoRigConfig: subsystems preservation (clobber bug fix) ---

{
  // Pre-Phase-0 bug: full re-init silently reset hairRig=false to true.
  // After Phase 0: subsystems carry forward in BOTH replace and merge modes.
  const project = {
    autoRigConfig: {
      bodyWarp: { canvasPadFrac: 0.99 }, // malformed → fresh defaults
      subsystems: { hairRig: false, eyeRig: true, mouthRig: true },
    },
  };
  seedAutoRigConfig(project); // 'replace' default
  assert(project.autoRigConfig.subsystems.hairRig === false,
    'clobber-fix: hairRig=false survives replace mode');
  // Other fields ARE reset (replace mode).
  assertEq(project.autoRigConfig.bodyWarp.canvasPadFrac, 0.10,
    'replace: bodyWarp.canvasPadFrac reset to default');
}

{
  // Merge mode: same subsystems-preservation behaviour.
  const project = {
    autoRigConfig: {
      bodyWarp: { canvasPadFrac: 0.99 },
      subsystems: { hairRig: false, clothingRig: false },
    },
  };
  seedAutoRigConfig(project, 'merge');
  assert(project.autoRigConfig.subsystems.hairRig === false,
    'merge: hairRig=false preserved');
  assert(project.autoRigConfig.subsystems.clothingRig === false,
    'merge: clothingRig=false preserved');
  assert(project.autoRigConfig.subsystems.eyeRig === true,
    'merge: unspecified subsystems get default true');
}

{
  // Pristine project (no prior subsystems): defaults kick in unchanged.
  const project = { autoRigConfig: null };
  seedAutoRigConfig(project);
  assert(project.autoRigConfig.subsystems.hairRig === true, 'pristine: hairRig defaults to true');
  assert(project.autoRigConfig.subsystems.faceRig === true, 'pristine: faceRig defaults to true');
}

// --- seedFaceParallax / seedBodyWarpChain / seedRigWarps: merge mode ---

function makeFaceParallaxSpec() {
  return {
    id: 'FaceParallaxWarp',
    name: 'Face Parallax',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array(72),
    localFrame: 'pivot-relative',
    bindings: [],
    keyforms: [{ keyTuple: [0, 0], positions: new Float64Array(72), opacity: 1 }],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

{
  // Replace overwrites prior, regardless of marker.
  const project = { faceParallax: { _userAuthored: true, sentinel: 'manual' } };
  seedFaceParallax(project, makeFaceParallaxSpec()); // 'replace' default
  assert(project.faceParallax.sentinel === undefined,
    'replace: prior _userAuthored value overwritten');
}

{
  // Merge with marker: prior preserved.
  const project = { faceParallax: { _userAuthored: true, sentinel: 'manual' } };
  const ret = seedFaceParallax(project, makeFaceParallaxSpec(), 'merge');
  assertEq(ret, null, 'merge: returns null when preserving');
  assert(project.faceParallax.sentinel === 'manual',
    'merge: marked prior value preserved');
}

{
  // Merge without marker: replaced.
  const project = { faceParallax: { sentinel: 'auto' } };
  seedFaceParallax(project, makeFaceParallaxSpec(), 'merge');
  assert(project.faceParallax.sentinel === undefined,
    'merge: unmarked prior value replaced');
}

function makeBodyWarpChain() {
  return {
    specs: [{
      id: 'BodyZWarp', name: 'BodyZ',
      parent: { type: 'root', id: null },
      gridSize: { rows: 4, cols: 4 },
      baseGrid: new Float64Array(50),
      localFrame: 'normalized-0to1',
      bindings: [],
      keyforms: [{ keyTuple: [0], positions: new Float64Array(50), opacity: 1 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    }],
    layout: {
      BZ_MIN_X: 0, BZ_MIN_Y: 0, BZ_W: 100, BZ_H: 100,
      BY_MIN: 0, BY_MAX: 1, BR_MIN: 0, BR_MAX: 1,
      BX_MIN: 0, BX_MAX: 1,
    },
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    debug: { HIP_FRAC: 0.45, FEET_FRAC: 0.75, bodyFracSource: 'defaults', spineCfShifts: [] },
  };
}

{
  // bodyWarp merge with marker: preserved.
  const project = { bodyWarp: { _userAuthored: true, sentinel: 'manual' } };
  const ret = seedBodyWarpChain(project, makeBodyWarpChain(), 'merge');
  assertEq(ret, null, 'bodyWarp merge: returns null when preserving');
  assert(project.bodyWarp.sentinel === 'manual', 'bodyWarp merge: marked prior preserved');
}

{
  // rigWarps merge: per-partId preservation.
  const auto = new Map();
  auto.set('p1', {
    id: 'w1', name: 'AutoWarp', targetPartId: 'p1',
    parent: { type: 'warp', id: 'BodyXWarp' },
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array([0,0, 1,0, 0,1, 1,1, 0,0, 1,0, 0,1, 1,1, 0,0]),
    localFrame: 'normalized-0to1',
    bindings: [],
    keyforms: [{ keyTuple: [0], positions: new Float64Array(18), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  });
  auto.set('p2', {
    id: 'w2', name: 'AutoWarp2', targetPartId: 'p2',
    parent: { type: 'warp', id: 'BodyXWarp' },
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array([0,0, 1,0, 0,1, 1,1, 0,0, 1,0, 0,1, 1,1, 0,0]),
    localFrame: 'normalized-0to1',
    bindings: [],
    keyforms: [{ keyTuple: [0], positions: new Float64Array(18), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  });
  const project = {
    rigWarps: {
      p1: { _userAuthored: true, targetPartId: 'p1', sentinel: 'manual', baseGrid: [0], keyforms: [{positions:[0]}] },
    },
  };
  seedRigWarps(project, auto, 'merge');
  assertEq(project.rigWarps.p1.sentinel, 'manual', 'rigWarps merge: marked p1 preserved');
  assert(project.rigWarps.p2 != null, 'rigWarps merge: p2 auto-seeded');
  assert(project.rigWarps.p2._userAuthored !== true, 'rigWarps merge: p2 not marked');
}

// --- Summary ---

console.log(`userAuthorMarkers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
