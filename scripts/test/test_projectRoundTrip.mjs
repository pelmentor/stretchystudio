// GAP-011 Phase A — verify saveProject/loadProject round-trip preserves the
// four rig fields that previously vanished silently:
//   - autoRigConfig
//   - faceParallax
//   - bodyWarp
//   - rigWarps
//
// See docs/PROJECT_DATA_LAYER.md for the full audit.
//
// Run: node scripts/test/test_projectRoundTrip.mjs

import { saveProject, loadProject } from '../../src/io/projectFile.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// Realistic-shaped fixtures — match what seedAllRig/initRig actually produces.
function makeFixtureProject() {
  return {
    version: '0.1',
    canvas: { width: 1792, height: 1792, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [],
    nodes: [
      { id: 'g1', type: 'group', name: 'root', parent: null, opacity: 1, visible: true,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 } },
    ],
    animations: [],

    // Tier 1 — already saved (sanity check they still survive).
    parameters: [
      { id: 'ParamBodyAngleX', name: 'BodyAngleX', min: -10, max: 10, default: 0, tag: null },
      { id: 'ParamBreath',     name: 'Breath',     min: 0,   max: 1,  default: 0, tag: null },
    ],
    physics_groups: [],
    maskConfigs: [{ targetId: 'irides-l', clipperId: 'eyewhite-l' }],
    physicsRules: [{ name: 'hair-front', requireTag: 'front hair', outputs: ['hair-front-1'] }],
    boneConfig: { bakedKeyformAngles: [-90, -45, 0, 45, 90] },
    variantFadeRules: { backdropTags: ['face', 'ears', 'front hair', 'back hair'] },
    eyeClosureConfig: {
      closureTags: { left: ['eyelash-l', 'eyewhite-l', 'irides-l'] },
      lashStripFrac: 0.06,
      binCount: 32,
    },
    rotationDeformerConfig: {
      skipRoles: ['torso', 'eyes', 'neck'],
      deformerAngleMin: -30,
      deformerAngleMax: 30,
    },

    // Tier 2 — these are the FOUR that were lost on save/load before the fix.
    autoRigConfig: {
      bodyWarp:     { hipFracFallback: 0.55, feetFracFallback: 0.05 },
      faceParallax: { protectionByTag: { face: 1.0, eyebrow: 0.7 } },
      neckWarp:     { tiltFrac: 0.07 },
    },
    faceParallax: {
      id: 'FaceParallax',
      name: 'FaceParallax',
      parent: { type: 'part', id: 'face-grp' },
      gridSize: { rows: 5, cols: 5 },
      // Float-grids are stored as flat number[] for JSON friendliness.
      baseGrid: new Array(36 * 2).fill(0).map((_, i) => i * 0.01),
      bindings: [
        { paramId: 'ParamAngleX', type: 'normal', keyValues: [-30, 0, 30] },
        { paramId: 'ParamAngleY', type: 'normal', keyValues: [-30, 0, 30] },
      ],
      keyforms: [
        { keyTuple: [0, 0], positions: new Array(36 * 2).fill(0).map((_, i) => i * 0.011), opacity: 1 },
        { keyTuple: [1, 1], positions: new Array(36 * 2).fill(0).map((_, i) => i * 0.012), opacity: 1 },
      ],
      isVisible: true,
      isLocked: false,
      isQuadTransform: false,
    },
    bodyWarp: {
      // Layout block + chain of warp specs.
      layout: {
        BZ: { centerX: 0.5, centerY: 0.5, halfW: 0.45, halfH: 0.45 },
        BY: { centerX: 0.5, centerY: 0.5, halfW: 0.40, halfH: 0.40 },
        BR: { centerX: 0.5, centerY: 0.5, halfW: 0.35, halfH: 0.35 },
        BX: { centerX: 0.5, centerY: 0.5, halfW: 0.30, halfH: 0.30 },
      },
      bodyFracSource: 'measured',
      bodyFrac: { hip: 0.55, feet: 0.05 },
      specs: [
        { id: 'BodyWarpZ', parent: { type: 'root' }, gridSize: { rows: 3, cols: 3 },
          baseGrid: new Array(16 * 2).fill(0).map((_, i) => i * 0.01),
          bindings: [{ paramId: 'ParamBodyAngleZ', type: 'normal', keyValues: [-10, 0, 10] }],
          keyforms: [
            { keyTuple: [0], positions: new Array(16 * 2).fill(0).map((_, i) => i * 0.012), opacity: 1 },
          ],
        },
      ],
    },
    rigWarps: {
      'hair-front-mesh-id': {
        id: 'RigWarp_hair-front',
        parent: { type: 'part', id: 'hair-grp' },
        targetPartId: 'hair-front-mesh-id',
        canvasBbox: { minX: 100, minY: 100, maxX: 300, maxY: 400 },
        gridSize: { rows: 4, cols: 4 },
        baseGrid: new Array(25 * 2).fill(0).map((_, i) => i * 0.013),
        bindings: [{ paramId: 'ParamHairFront', type: 'normal', keyValues: [-1, 0, 1] }],
        keyforms: [
          { keyTuple: [0], positions: new Array(25 * 2).fill(0).map((_, i) => i * 0.014), opacity: 1 },
        ],
        opacity: 1,
        isVisible: true,
        isLocked: false,
        isQuadTransform: false,
      },
    },
  };
}

// ── Round-trip test ────────────────────────────────────────────────

// JSZip's `type: 'blob'` output in Node yields a Blob that
// JSZip.loadAsync can't read back directly. Convert via ArrayBuffer
// (which JSZip handles uniformly across Node + browser).
async function saveAndReload(project) {
  const blob = await saveProject(project);
  const buf = await blob.arrayBuffer();
  return loadProject(buf);
}

(async () => {
  const original = makeFixtureProject();
  const { project: reloaded } = await saveAndReload(original);

  // ── Tier 1 (sanity check — these always worked) ──
  assert(deepEqual(reloaded.canvas, original.canvas), 'canvas survives round-trip');
  assert(deepEqual(reloaded.parameters, original.parameters), 'parameters survives');
  assert(deepEqual(reloaded.maskConfigs, original.maskConfigs), 'maskConfigs survives');
  assert(deepEqual(reloaded.physicsRules, original.physicsRules), 'physicsRules survives');
  assert(deepEqual(reloaded.boneConfig, original.boneConfig), 'boneConfig survives');
  assert(deepEqual(reloaded.variantFadeRules, original.variantFadeRules), 'variantFadeRules survives');
  assert(deepEqual(reloaded.eyeClosureConfig, original.eyeClosureConfig), 'eyeClosureConfig survives');
  assert(deepEqual(reloaded.rotationDeformerConfig, original.rotationDeformerConfig), 'rotationDeformerConfig survives');

  // ── Tier 2 (the GAP-011 fix — these vanished before the fix) ──
  assert(reloaded.autoRigConfig !== null, 'autoRigConfig is not null after reload');
  assert(deepEqual(reloaded.autoRigConfig, original.autoRigConfig), 'autoRigConfig deep-equals original (GAP-011)');

  assert(reloaded.faceParallax !== null, 'faceParallax is not null after reload');
  assert(deepEqual(reloaded.faceParallax, original.faceParallax), 'faceParallax deep-equals original (GAP-011)');

  assert(reloaded.bodyWarp !== null, 'bodyWarp is not null after reload');
  assert(deepEqual(reloaded.bodyWarp, original.bodyWarp), 'bodyWarp deep-equals original (GAP-011)');

  assert(reloaded.rigWarps && Object.keys(reloaded.rigWarps).length > 0, 'rigWarps is non-empty after reload');
  assert(deepEqual(reloaded.rigWarps, original.rigWarps), 'rigWarps deep-equals original (GAP-011)');

  // ── Empty/null handling — make sure loaded.field is sensible when original is null ──
  const empty = makeFixtureProject();
  empty.autoRigConfig = null;
  empty.faceParallax = null;
  empty.bodyWarp = null;
  empty.rigWarps = {};
  const { project: emptyReloaded } = await saveAndReload(empty);
  assert(emptyReloaded.autoRigConfig === null, 'autoRigConfig stays null when not seeded');
  assert(emptyReloaded.faceParallax === null, 'faceParallax stays null when not seeded');
  assert(emptyReloaded.bodyWarp === null, 'bodyWarp stays null when not seeded');
  assert(deepEqual(emptyReloaded.rigWarps, {}), 'rigWarps stays {} when not seeded');

  console.log(`projectRoundTrip: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
})().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
