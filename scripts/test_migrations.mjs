// Tests for src/store/projectMigrations.js. Run:
//   node scripts/test_migrations.mjs
// Exits non-zero on first failure.

import {
  CURRENT_SCHEMA_VERSION,
  migrateProject,
} from '../src/store/projectMigrations.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// ---- v0 → v1 migration (no schemaVersion → current) ----

{
  // Empty project (only what an old save might have).
  const p = { version: '0.1' };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v0 empty: schemaVersion set');
  assert(p.canvas && p.canvas.width === 800, 'v0 empty: canvas defaults filled');
  assertEq(p.textures, [], 'v0 empty: textures []');
  assertEq(p.nodes, [], 'v0 empty: nodes []');
  assertEq(p.animations, [], 'v0 empty: animations []');
  assertEq(p.parameters, [], 'v0 empty: parameters []');
  assertEq(p.physics_groups, [], 'v0 empty: physics_groups []');
}

{
  // Existing canvas values preserved through spread.
  const p = { canvas: { width: 1920, height: 1080, bgColor: '#000000' } };
  migrateProject(p);
  assertEq(p.canvas.width, 1920, 'v0 canvas width preserved');
  assertEq(p.canvas.height, 1080, 'v0 canvas height preserved');
  assertEq(p.canvas.bgColor, '#000000', 'v0 canvas bgColor preserved');
  assertEq(p.canvas.x, 0, 'v0 canvas x default added');
  assertEq(p.canvas.bgEnabled, false, 'v0 canvas bgEnabled default added');
}

{
  // Per-node defaults applied (mimics an old save where nodes lacked
  // blendShapes / blendShapeValues).
  const p = {
    nodes: [
      { id: 'a', type: 'part', mesh: { vertices: [], uvs: [], triangles: [] } },
      { id: 'b', type: 'group' },
    ],
  };
  migrateProject(p);
  assertEq(p.nodes[0].blendShapes, [], 'node 0: blendShapes default');
  assertEq(p.nodes[0].blendShapeValues, {}, 'node 0: blendShapeValues default');
  assertEq(p.nodes[1].blendShapes, [], 'node 1: blendShapes default');
}

{
  // v11: legacy puppetWarp / puppet_pins tracks are stripped.
  const p = {
    schemaVersion: 10,
    nodes: [
      { id: 'a', type: 'part', puppetWarp: { enabled: true, pins: [{ id: 'p1', restX: 0, restY: 0, x: 5, y: 5 }] } },
      { id: 'b', type: 'group' },
    ],
    animations: [
      {
        id: 'anim1',
        tracks: [
          { nodeId: 'a', property: 'puppet_pins', keyframes: [] },
          { nodeId: 'a', property: 'x', keyframes: [] },
        ],
      },
    ],
  };
  migrateProject(p);
  assert(!('puppetWarp' in p.nodes[0]), 'v11: node puppetWarp deleted');
  assertEq(p.animations[0].tracks.length, 1, 'v11: puppet_pins track removed');
  assertEq(p.animations[0].tracks[0].property, 'x', 'v11: non-puppet track preserved');
}

{
  // Existing per-node fields preserved (don't trample user data).
  const existingShapes = [{ id: 's1', name: 'Smile', deltas: [] }];
  const p = {
    nodes: [
      { id: 'a', type: 'part', blendShapes: existingShapes, blendShapeValues: { s1: 0.5 } },
    ],
  };
  migrateProject(p);
  assertEq(p.nodes[0].blendShapes, existingShapes, 'existing blendShapes preserved');
  assertEq(p.nodes[0].blendShapeValues, { s1: 0.5 }, 'existing blendShapeValues preserved');
}

{
  // Animations: ensure audioTracks + tracks arrays exist.
  const p = {
    animations: [
      { id: 'a1', name: 'idle' },                              // missing both
      { id: 'a2', name: 'wave', tracks: [{ nodeId: 'x' }] },   // has tracks, missing audioTracks
    ],
  };
  migrateProject(p);
  assertEq(p.animations[0].tracks, [], 'animation 0: tracks default');
  assertEq(p.animations[0].audioTracks, [], 'animation 0: audioTracks default');
  assertEq(p.animations[1].tracks, [{ nodeId: 'x' }], 'animation 1: existing tracks preserved');
  assertEq(p.animations[1].audioTracks, [], 'animation 1: audioTracks default');
}

// ---- Idempotence: running migration twice is a no-op ----

{
  const p = { canvas: { width: 1024, height: 768 } };
  migrateProject(p);
  const afterFirst = JSON.stringify(p);
  migrateProject(p);
  const afterSecond = JSON.stringify(p);
  assertEq(afterFirst, afterSecond, 'idempotent: second migrate is a no-op');
}

// ---- Already-current files: no rewrite, just version touch ----

{
  // File at current version with all fields populated — migration must
  // not touch existing data.
  const p = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { width: 100, height: 50, x: 10, y: 20, bgEnabled: true, bgColor: '#abcdef' },
    textures: [{ id: 't1', source: 'tx.png' }],
    nodes: [],
    animations: [],
    parameters: [{ id: 'ParamFoo', min: 0, max: 1, default: 0.5 }],
    physics_groups: [],
  };
  const before = JSON.stringify(p);
  migrateProject(p);
  const after = JSON.stringify(p);
  assertEq(before, after, 'current-version file passes through unchanged');
}

// ---- v1 → v2 → v3: incremental migrations ----

{
  // A save at v1 lacks maskConfigs (added by v2) and physicsRules (added by v3).
  const p = { schemaVersion: 1, canvas: { width: 800, height: 600 }, nodes: [] };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v1→current: schemaVersion bumped');
  assertEq(p.maskConfigs, [], 'v1→current: maskConfigs added empty');
  assertEq(p.physicsRules, [], 'v1→current: physicsRules added empty');
}

{
  // A save at v2 lacks physicsRules. v3 migration adds it.
  const p = { schemaVersion: 2, maskConfigs: [{ maskedMeshId: 'a', maskMeshIds: ['b'] }] };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v2→current: schemaVersion bumped');
  assertEq(p.physicsRules, [], 'v2→current: physicsRules added');
  assertEq(p.maskConfigs.length, 1, 'v2→current: existing maskConfigs preserved');
}

{
  // Pre-existing physicsRules preserved.
  const existing = [{ id: 'CustomRule', inputs: [], outputs: [], vertices: [] }];
  const p = { schemaVersion: 2, physicsRules: existing };
  migrateProject(p);
  assertEq(p.physicsRules, existing, 'v2→current: existing physicsRules preserved');
}

{
  // A save at v3 lacks boneConfig. v4 migration adds it (as null).
  const p = { schemaVersion: 3, physicsRules: [{ id: 'r' }] };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v3→current: schemaVersion bumped');
  assert(p.boneConfig === null, 'v3→current: boneConfig added as null (resolver provides defaults)');
  assertEq(p.physicsRules, [{ id: 'r' }], 'v3→current: existing physicsRules preserved');
}

{
  // Pre-existing boneConfig preserved through migrations.
  const cfg = { bakedKeyformAngles: [-30, 0, 30] };
  const p = { schemaVersion: 3, boneConfig: cfg };
  migrateProject(p);
  assert(p.boneConfig === cfg, 'v3→current: existing boneConfig preserved');
}

{
  // A save at v4 lacks variantFadeRules + eyeClosureConfig. v5 migration
  // adds them as null (resolvers provide defaults).
  const p = { schemaVersion: 4, boneConfig: null };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v4→current: schemaVersion bumped');
  assert(p.variantFadeRules === null, 'v4→current: variantFadeRules added as null');
  assert(p.eyeClosureConfig === null, 'v4→current: eyeClosureConfig added as null');
}

{
  // Pre-existing variantFadeRules + eyeClosureConfig preserved.
  const fade = { backdropTags: ['face', 'ears', 'helmet'] };
  const eye = { closureTags: ['eyelash-l', 'eyelash-r'], lashStripFrac: 0.08, binCount: 4 };
  const p = { schemaVersion: 4, variantFadeRules: fade, eyeClosureConfig: eye };
  migrateProject(p);
  assert(p.variantFadeRules === fade, 'v4→current: existing variantFadeRules preserved');
  assert(p.eyeClosureConfig === eye, 'v4→current: existing eyeClosureConfig preserved');
}

{
  // A save at v5 lacks rotationDeformerConfig. v6 migration adds it as null.
  const p = { schemaVersion: 5 };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v5→current: schemaVersion bumped');
  assert(p.rotationDeformerConfig === null, 'v5→current: rotationDeformerConfig added as null');
}

{
  // Pre-existing rotationDeformerConfig preserved.
  const cfg = {
    skipRotationRoles: ['torso'],
    paramAngleRange: { min: -45, max: 45 },
    groupRotation: { paramKeys: [-30, 0, 30], angles: [-45, 0, 45] },
    faceRotation: { paramKeys: [-30, 0, 30], angles: [-15, 0, 15] },
  };
  const p = { schemaVersion: 5, rotationDeformerConfig: cfg };
  migrateProject(p);
  assert(p.rotationDeformerConfig === cfg, 'v5→current: existing rotationDeformerConfig preserved');
}

{
  // A save at v6 lacks autoRigConfig. v7 migration adds it as null.
  const p = { schemaVersion: 6 };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v6→current: schemaVersion bumped');
  assert(p.autoRigConfig === null, 'v6→current: autoRigConfig added as null');
}

{
  // Pre-existing autoRigConfig preserved.
  const cfg = {
    bodyWarp: {
      canvasPadFrac: 0.15, hipFracDefault: 0.5, feetFracDefault: 0.8,
      feetMarginRf: 0.06, bxRange: { min: 0.10, max: 0.90 },
      byMargin: 0.07, breathMargin: 0.06,
      upperBodyTCap: 0.55, upperBodySlope: 1.6,
    },
    faceParallax: {
      depthK: 0.85, edgeDepthK: 0.30,
      maxAngleXDeg: 18, maxAngleYDeg: 10,
      depthAmp: 3.0, eyeParallaxAmpX: 1.4, farEyeSquashAmp: 0.20,
      protectionStrength: 1.0, protectionFalloffBuffer: 0.12,
      protectionPerTag: { mouth: 0.4 },
      superGroups: { 'eye-l': ['eyelash-l'] },
    },
    neckWarp: { tiltFrac: 0.10 },
  };
  const p = { schemaVersion: 6, autoRigConfig: cfg };
  migrateProject(p);
  assert(p.autoRigConfig === cfg, 'v6→current: existing autoRigConfig preserved');
}

{
  // A save at v7 lacks faceParallax. v8 migration adds it as null.
  const p = { schemaVersion: 7 };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v7→current: schemaVersion bumped');
  assert(p.faceParallax === null, 'v7→current: faceParallax added as null');
}

{
  // Pre-existing faceParallax preserved (Stage 4 stores serialized warp specs).
  const fp = {
    id: 'FaceParallaxWarp',
    name: 'Face Parallax',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Array(72).fill(0),
    localFrame: 'pivot-relative',
    bindings: [],
    keyforms: [{ keyTuple: [0, 0], positions: new Array(72).fill(0), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  const p = { schemaVersion: 7, faceParallax: fp };
  migrateProject(p);
  assert(p.faceParallax === fp, 'v7→current: existing faceParallax preserved');
}

{
  // A save at v8 lacks bodyWarp. v9 migration adds it as null.
  const p = { schemaVersion: 8 };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v8→current: schemaVersion bumped');
  assert(p.bodyWarp === null, 'v8→current: bodyWarp added as null');
}

{
  // Pre-existing bodyWarp preserved (Stage 10 stores serialized chain).
  const bw = {
    specs: [
      {
        id: 'BodyWarpZ', name: 'Body Warp Z',
        parent: { type: 'root', id: null },
        gridSize: { rows: 5, cols: 5 },
        baseGrid: new Array(72).fill(0),
        localFrame: 'canvas-px',
        bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-10, 0, 10], interpolation: 'LINEAR' }],
        keyforms: [{ keyTuple: [-10], positions: new Array(72).fill(0), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false,
      },
    ],
    layout: {
      BZ_MIN_X: 0, BZ_MIN_Y: 0, BZ_W: 800, BZ_H: 600,
      BY_MIN: 0.065, BY_MAX: 0.935, BR_MIN: 0.055, BR_MAX: 0.945,
      BX_MIN: 0.10, BX_MAX: 0.90,
    },
    hasParamBodyAngleX: false,
    debug: { HIP_FRAC: 0.45, FEET_FRAC: 0.75, bodyFracSource: 'defaults', spineCfShifts: [] },
  };
  const p = { schemaVersion: 8, bodyWarp: bw };
  migrateProject(p);
  assert(p.bodyWarp === bw, 'v8→current: existing bodyWarp preserved');
}

{
  // A save at v9 lacks rigWarps. v10 migration adds it as {}.
  const p = { schemaVersion: 9 };
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v9→current: schemaVersion bumped');
  assertEq(p.rigWarps, {}, 'v9→current: rigWarps added as empty object');
}

{
  // Pre-existing rigWarps preserved (Stage 9b stores per-mesh keyform map).
  const rw = {
    'part-A': {
      id: 'RigWarp_part_A',
      name: 'part-A Warp',
      parent: { type: 'warp', id: 'BodyXWarp' },
      targetPartId: 'part-A',
      canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
      gridSize: { rows: 2, cols: 2 },
      baseGrid: new Array(18).fill(0),
      localFrame: 'normalized-0to1',
      bindings: [{ parameterId: 'ParamHairFront', keys: [-1, 0, 1], interpolation: 'LINEAR' }],
      keyforms: [
        { keyTuple: [-1], positions: new Array(18).fill(0), opacity: 1 },
        { keyTuple: [0],  positions: new Array(18).fill(0), opacity: 1 },
        { keyTuple: [1],  positions: new Array(18).fill(0), opacity: 1 },
      ],
      isVisible: true, isLocked: false, isQuadTransform: false,
    },
  };
  const p = { schemaVersion: 9, rigWarps: rw };
  migrateProject(p);
  assert(p.rigWarps === rw, 'v9→current: existing rigWarps preserved');
}

{
  // v0 (no schemaVersion) walks through all migrations.
  const p = {};
  migrateProject(p);
  assertEq(p.schemaVersion, CURRENT_SCHEMA_VERSION, 'v0→current: walked all migrations');
  assertEq(p.maskConfigs, [], 'v0→current: maskConfigs added');
  assertEq(p.physicsRules, [], 'v0→current: physicsRules added');
  assert(p.boneConfig === null, 'v0→current: boneConfig added as null');
  assert(p.variantFadeRules === null, 'v0→current: variantFadeRules added as null');
  assert(p.eyeClosureConfig === null, 'v0→current: eyeClosureConfig added as null');
  assert(p.rotationDeformerConfig === null, 'v0→current: rotationDeformerConfig added as null');
  assert(p.autoRigConfig === null, 'v0→current: autoRigConfig added as null');
  assert(p.faceParallax === null, 'v0→current: faceParallax added as null');
  assert(p.bodyWarp === null, 'v0→current: bodyWarp added as null');
  assertEq(p.rigWarps, {}, 'v0→current: rigWarps added as {}');
  assert(Array.isArray(p.parameters), 'v0→current: v1 fields still added');
}

// ---- Future version: throws ----

{
  const p = { schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
  assertThrows(() => migrateProject(p), 'future schema version rejected');
}

// ---- Summary ----

console.log(`migrations: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
