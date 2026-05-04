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
    meshSignatures: {
      'hair-front-mesh-id': { vertexCount: 24, triCount: 30, uvHash: 1234567890 },
      'face-mesh-id':       { vertexCount: 60, triCount: 80, uvHash: 987654321 },
    },
    lastInitRigCompletedAt: '2026-05-01T18:00:00.000Z',
    // V3 Re-Rig Phase 1 — per-stage refit telemetry (ISO timestamps).
    // RigStagesTab reads these to render "stale" / "fresh" pills.
    rigStageLastRunAt: {
      psdImport:    '2026-05-01T18:00:00.000Z',
      meshGen:      '2026-05-01T18:00:01.000Z',
      paramSpec:    '2026-05-01T18:00:02.000Z',
      faceParallax: '2026-05-01T18:00:03.000Z',
      bodyWarp:     '2026-05-01T18:00:04.000Z',
      rigWarps:     '2026-05-01T18:00:05.000Z',
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

  // ── meshSignatures (GAP-012 Phase A — fingerprint round-trip) ──
  assert(reloaded.meshSignatures && Object.keys(reloaded.meshSignatures).length > 0,
    'meshSignatures is non-empty after reload');
  assert(deepEqual(reloaded.meshSignatures, original.meshSignatures),
    'meshSignatures deep-equals original (GAP-012)');

  // ── lastInitRigCompletedAt (Hole I-8 — explicit seed marker) ──
  assert(reloaded.lastInitRigCompletedAt === original.lastInitRigCompletedAt,
    'lastInitRigCompletedAt survives round-trip (I-8)');

  // ── rigStageLastRunAt (V3 Re-Rig Phase 1 — per-stage refit telemetry) ──
  // RigStagesTab depends on these timestamps to render freshness pills;
  // losing them on save→load was the original symptom that motivated the
  // GAP-011 audit. Verify the map round-trips intact.
  assert(reloaded.rigStageLastRunAt && Object.keys(reloaded.rigStageLastRunAt).length > 0,
    'rigStageLastRunAt is non-empty after reload');
  assert(deepEqual(reloaded.rigStageLastRunAt, original.rigStageLastRunAt),
    'rigStageLastRunAt deep-equals original (V3 Re-Rig)');

  // ── Empty/null handling — make sure loaded.field is sensible when original is null ──
  const empty = makeFixtureProject();
  empty.autoRigConfig = null;
  empty.faceParallax = null;
  empty.bodyWarp = null;
  empty.rigWarps = {};
  empty.meshSignatures = {};
  empty.lastInitRigCompletedAt = null;
  empty.rigStageLastRunAt = {};
  const { project: emptyReloaded } = await saveAndReload(empty);
  assert(emptyReloaded.autoRigConfig === null, 'autoRigConfig stays null when not seeded');
  assert(emptyReloaded.faceParallax === null, 'faceParallax stays null when not seeded');
  assert(emptyReloaded.bodyWarp === null, 'bodyWarp stays null when not seeded');
  assert(deepEqual(emptyReloaded.rigWarps, {}), 'rigWarps stays {} when not seeded');
  assert(deepEqual(emptyReloaded.meshSignatures, {}), 'meshSignatures stays {} when not seeded');
  assert(emptyReloaded.lastInitRigCompletedAt === null, 'lastInitRigCompletedAt stays null when not seeded');
  assert(deepEqual(emptyReloaded.rigStageLastRunAt, {}), 'rigStageLastRunAt stays {} when not seeded');

  // ── Strict mode (Hole I-9) ─────────────────────────────────────────
  // strict:true throws on first asset error instead of console.error +
  // continue. We trigger a controlled failure by giving a texture
  // entry an unfetchable source (file:// path that fetch rejects in
  // Node) and asserting saveProject throws.
  {
    const p = makeFixtureProject();
    p.textures = [{ id: 'broken-tex', source: 'file:///nope/does/not/exist.png' }];
    let threw = false;
    try {
      await saveProject(p, { strict: true });
    } catch (err) {
      threw = true;
      assert(/saveProject\(strict\)/.test(String(err?.message ?? err)),
        'strict-mode error message identifies caller (I-9)');
    }
    assert(threw, 'saveProject({strict:true}) throws on unfetchable texture (I-9)');

    // Default mode (no strict) on the same fixture should NOT throw —
    // it falls back to placeholder source per current behaviour.
    let defaultThrew = false;
    try {
      await saveProject(p); // no strict
    } catch (err) {
      defaultThrew = true;
    }
    assert(!defaultThrew, 'saveProject() default mode swallows asset errors (back-compat)');
  }

  // ── projectStore.loadProject hydration — the path LoadModal takes ──
  //
  // saveAndReload above only exercises the file-level round-trip.
  // LoadModal then calls `useProjectStore.getState().loadProject(project)`
  // which copies each field into the immer-managed state. Verify the
  // post-Init-Rig fields land in the running store too — historically
  // the missing assignments here is what made GAP-011 a silent loss.
  {
    const { useProjectStore } = await import('../../src/store/projectStore.js');
    const original = makeFixtureProject();
    const { project: reloaded } = await saveAndReload(original);
    useProjectStore.getState().loadProject(reloaded);
    const storeState = useProjectStore.getState();
    const stored = storeState.project;

    assert(deepEqual(stored.autoRigConfig, original.autoRigConfig),
      'projectStore.loadProject hydrates autoRigConfig');
    assert(deepEqual(stored.faceParallax, original.faceParallax),
      'projectStore.loadProject hydrates faceParallax');
    assert(deepEqual(stored.bodyWarp, original.bodyWarp),
      'projectStore.loadProject hydrates bodyWarp');
    assert(deepEqual(stored.rigWarps, original.rigWarps),
      'projectStore.loadProject hydrates rigWarps');
    assert(deepEqual(stored.meshSignatures, original.meshSignatures),
      'projectStore.loadProject hydrates meshSignatures');
    assert(stored.lastInitRigCompletedAt === original.lastInitRigCompletedAt,
      'projectStore.loadProject hydrates lastInitRigCompletedAt');
    assert(deepEqual(stored.rigStageLastRunAt, original.rigStageLastRunAt),
      'projectStore.loadProject hydrates rigStageLastRunAt');
    assert(stored.parameters.length === original.parameters.length,
      'projectStore.loadProject hydrates parameters');
    // versionControl bumps mark a stale rigSpec — the live evaluator
    // re-builds on next click. Verify the bump fired so subscribers see it.
    // versionControl + hasUnsavedChanges are on the store ROOT (not project).
    assert(storeState.versionControl.geometryVersion >= 1,
      'projectStore.loadProject bumps geometryVersion (rigSpec invalidates)');
    assert(storeState.hasUnsavedChanges === false,
      'projectStore.loadProject clears hasUnsavedChanges (load is a clean slate)');
  }

  console.log(`projectRoundTrip: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
})().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
