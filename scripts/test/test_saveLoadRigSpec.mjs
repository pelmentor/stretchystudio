// BUG-023 triage — verify save→load produces a working rig WITHOUT
// re-running Init Rig. Specifically:
//
//   1. After loadProject, the rigSpecStore auto-fill subscriber fires
//      and populates rigSpec from the loaded project.
//   2. paramValuesStore.seedMissingDefaults runs and populates values
//      with parameters[].default for non-zero defaults (eyes open, etc.)
//   3. Every binding's parameterId resolves to an entry in
//      project.parameters (paramOrphans is empty).
//   4. selectRigSpec.artMeshes is non-empty (rig is "complete" by
//      _isComplete's gate), which is what the auto-fill subscriber
//      checks before populating rigSpec.
//
// This test exists because the file-format round-trip
// (test_projectRoundTrip.mjs) is clean but BUG-023 still repros in the
// browser — meaning the breakage is at the live-store layer, not the
// JSON-byte layer.
//
// Run: node scripts/test/test_saveLoadRigSpec.mjs

import { saveProject, loadProject as loadProjectFromFile } from '../../src/io/projectFile.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

async function saveAndReload(project) {
  const blob = await saveProject(project);
  const buf = await blob.arrayBuffer();
  return loadProjectFromFile(buf);
}

// ── Fixture: a rigged project with parts, parameters, deformer nodes
// binding to those params, and lastInitRigCompletedAt set (= "Init Rig
// completed in a prior session"). Mirrors the post-Init-Rig shape that
// LoadModal hands to projectStore.loadProject.
function makeRiggedFixture() {
  const partVerts = [];
  const restVerts = [];
  // 3×3 grid of verts in canvas-px → 9 verts, 8 triangles in a fan
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 400 + c * 100;
      const y = 400 + r * 100;
      partVerts.push({ x, y, restX: x, restY: y });
      restVerts.push(x, y);
    }
  }
  const tris = [];
  // Two triangles per cell (4 cells in a 2×2 layout of the 3×3 verts)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      const b = a + 1;
      const cIdx = a + 3;
      const d = a + 4;
      tris.push(a, b, d, a, d, cIdx);
    }
  }

  return {
    version: '0.1',
    schemaVersion: 17,
    canvas: { width: 1024, height: 1024 },
    textures: [],
    parameters: [
      { id: 'ParamAngleX',     name: 'AngleX',     min: -30, max: 30, default: 0,   tag: null },
      { id: 'ParamAngleY',     name: 'AngleY',     min: -30, max: 30, default: 0,   tag: null },
      { id: 'ParamEyeLOpen',   name: 'EyeLOpen',   min: 0,   max: 1,  default: 1,   tag: null },
      { id: 'ParamBodyAngleZ', name: 'BodyAngleZ', min: -10, max: 10, default: 0,   tag: null },
    ],
    nodes: [
      // Parts-collection group
      {
        id: 'g-root', type: 'group', name: 'root', parent: null,
        opacity: 1, visible: true,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      },
      // One part with a real mesh — selectRigSpec.artMeshes derivation
      // lights up only when at least one part has mesh data.
      {
        id: 'p-face', type: 'part', name: 'face', parent: 'g-root',
        opacity: 1, visible: true,
        rigParent: 'FaceParallax',
        mesh: {
          vertices: partVerts,
          triangles: tris,
          uvs: new Float32Array(partVerts.length * 2).fill(0.5),
          edgeIndices: [],
        },
      },
      // FaceParallax warp deformer (parent of the face part)
      {
        id: 'FaceParallax', type: 'deformer', deformerKind: 'warp',
        name: 'FaceParallax', parent: 'g-root', visible: true,
        gridSize: { rows: 5, cols: 5 },
        baseGrid: Array.from({ length: 25 * 2 }, (_, i) =>
          (i % 2 === 0)
            ? 400 + Math.floor(i / 2) % 5 * 100
            : 400 + Math.floor(Math.floor(i / 2) / 5) * 100
        ),
        localFrame: 'canvas-px',
        bindings: [
          { parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' },
          { parameterId: 'ParamAngleY', keys: [-30, 0, 30], interpolation: 'LINEAR' },
        ],
        keyforms: [
          { keyTuple: [0, 0], positions: Array.from({ length: 25 * 2 }, (_, i) => i * 1.0), opacity: 1 },
          { keyTuple: [1, 1], positions: Array.from({ length: 25 * 2 }, (_, i) => i * 1.01), opacity: 1 },
          { keyTuple: [2, 2], positions: Array.from({ length: 25 * 2 }, (_, i) => i * 1.02), opacity: 1 },
        ],
      },
      // BodyWarpZ — separate chain
      {
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
        name: 'BodyWarpZ', parent: null, visible: true,
        gridSize: { rows: 3, cols: 3 },
        baseGrid: Array.from({ length: 9 * 2 }, (_, i) => i * 50),
        localFrame: 'canvas-px',
        bindings: [
          { parameterId: 'ParamBodyAngleZ', keys: [-10, 0, 10], interpolation: 'LINEAR' },
        ],
        keyforms: [
          { keyTuple: [0], positions: Array.from({ length: 9 * 2 }, (_, i) => i * 50.1), opacity: 1 },
        ],
      },
    ],
    animations: [],
    physics_groups: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    bodyWarpLayout: null,
    meshSignatures: {},
    lastInitRigCompletedAt: '2026-05-01T18:00:00.000Z',
    rigStageLastRunAt: {},
  };
}

// ── Test 1: the auto-fill subscriber populates rigSpec post-load ────
// The subscriber is registered at rigSpecStore module-import time. We
// import projectStore + rigSpecStore BEFORE calling loadProject so
// the subscriber sees the project change.
{
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useRigSpecStore } = await import('../../src/store/rigSpecStore.js');
  const { useParamValuesStore } = await import('../../src/store/paramValuesStore.js');

  // Defensive — clear any stale module-state from sibling tests.
  useRigSpecStore.setState({ rigSpec: null, isBuilding: false, lastBuiltGeometryVersion: -1, error: null });
  useParamValuesStore.getState().reset();

  const original = makeRiggedFixture();
  const { project: reloaded } = await saveAndReload(original);

  // Verify the reload produced a sane shape.
  assert(reloaded.lastInitRigCompletedAt === original.lastInitRigCompletedAt,
    'Test 1: lastInitRigCompletedAt survives round-trip');
  assert(reloaded.parameters.length === 4,
    'Test 1: 4 parameters preserved');
  const reloadedDeformers = reloaded.nodes.filter((n) => n.type === 'deformer');
  assert(reloadedDeformers.length === 2,
    'Test 1: 2 deformer nodes preserved');
  const reloadedParts = reloaded.nodes.filter((n) => n.type === 'part');
  assert(reloadedParts.length === 1,
    'Test 1: 1 part node preserved');
  assert(Array.isArray(reloadedParts[0]?.mesh?.vertices) && reloadedParts[0].mesh.vertices.length === 9,
    'Test 1: part mesh.vertices preserved (9 verts)');

  // Now simulate LoadModal.loadFromRecord — calls loadProject on store.
  useProjectStore.getState().loadProject(reloaded);

  // Subscriber #1 (geometry version) fires synchronously inside loadProject
  // (via the immer set), so by the time loadProject returns, both subs
  // should have run.
  const rigSpecAfter = useRigSpecStore.getState().rigSpec;
  assert(rigSpecAfter !== null,
    'Test 1: rigSpec auto-populated by subscriber post-load');

  if (rigSpecAfter) {
    assert(Array.isArray(rigSpecAfter.warpDeformers) && rigSpecAfter.warpDeformers.length === 2,
      `Test 1: rigSpec.warpDeformers has 2 entries (got ${rigSpecAfter.warpDeformers?.length})`);
    assert(Array.isArray(rigSpecAfter.artMeshes) && rigSpecAfter.artMeshes.length >= 1,
      `Test 1: rigSpec.artMeshes non-empty (got ${rigSpecAfter.artMeshes?.length})`);
    assert(Array.isArray(rigSpecAfter.parameters) && rigSpecAfter.parameters.length === 4,
      `Test 1: rigSpec.parameters has 4 entries (got ${rigSpecAfter.parameters?.length})`);
  }
}

// ── Test 2: paramValuesStore seeds defaults from loaded params ──────
{
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useRigSpecStore } = await import('../../src/store/rigSpecStore.js');
  const { useParamValuesStore } = await import('../../src/store/paramValuesStore.js');

  useRigSpecStore.setState({ rigSpec: null, isBuilding: false, lastBuiltGeometryVersion: -1, error: null });
  useParamValuesStore.getState().reset();

  const original = makeRiggedFixture();
  const { project: reloaded } = await saveAndReload(original);
  useProjectStore.getState().loadProject(reloaded);

  const values = useParamValuesStore.getState().values;
  assert(values.ParamAngleX === 0,         `Test 2: ParamAngleX seeded to 0 (got ${values.ParamAngleX})`);
  assert(values.ParamAngleY === 0,         `Test 2: ParamAngleY seeded to 0 (got ${values.ParamAngleY})`);
  assert(values.ParamEyeLOpen === 1,       `Test 2: ParamEyeLOpen seeded to 1 (got ${values.ParamEyeLOpen})`);
  assert(values.ParamBodyAngleZ === 0,     `Test 2: ParamBodyAngleZ seeded to 0 (got ${values.ParamBodyAngleZ})`);
}

// ── Test 3: paramOrphans — every binding's parameterId resolves ────
{
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useRigSpecStore } = await import('../../src/store/rigSpecStore.js');
  useRigSpecStore.setState({ rigSpec: null, isBuilding: false, lastBuiltGeometryVersion: -1, error: null });

  const original = makeRiggedFixture();
  const { project: reloaded } = await saveAndReload(original);
  useProjectStore.getState().loadProject(reloaded);

  const proj = useProjectStore.getState().project;
  const paramIds = new Set((proj.parameters ?? []).map((p) => p.id));
  const orphans = [];
  for (const n of proj.nodes) {
    if (n.type !== 'deformer') continue;
    for (const b of n.bindings ?? []) {
      if (!paramIds.has(b.parameterId)) orphans.push({ node: n.id, paramId: b.parameterId });
    }
  }
  assert(orphans.length === 0,
    `Test 3: no paramOrphans post-load (got ${JSON.stringify(orphans)})`);
}

// ── Test 4: identity stability — rigSpec produced on load is stable
//          across redundant subscriber re-evaluations ────────────────
// Rationale: if selectRigSpec returned a fresh object each call, the
// CanvasViewport's chainEval rebuild gate `rigSpec === lastSeenRigSpec`
// would always miss and we'd thrash. Verify the WeakMap memoizes.
{
  const { selectRigSpec } = await import('../../src/io/live2d/rig/selectRigSpec.js');
  const original = makeRiggedFixture();
  const { project: reloaded } = await saveAndReload(original);
  const a = selectRigSpec(reloaded);
  const b = selectRigSpec(reloaded);
  assert(a === b, 'Test 4: selectRigSpec memoized on project identity');
}

// ── Test 5: load → re-load (different project) re-fires subscriber ──
// Page-reload flow simulator. After the FIRST load populates rigSpec,
// loading a SECOND project must invalidate + repopulate. Skips during
// the auto-fill if rigSpec is non-null (gate: `if (rigSpec || isBuilding) return`),
// so the geometry-version subscriber MUST invalidate first for the
// second load to populate.
{
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useRigSpecStore } = await import('../../src/store/rigSpecStore.js');
  useRigSpecStore.setState({ rigSpec: null, isBuilding: false, lastBuiltGeometryVersion: -1, error: null });

  // First load
  const proj1 = makeRiggedFixture();
  const { project: r1 } = await saveAndReload(proj1);
  useProjectStore.getState().loadProject(r1);
  const spec1 = useRigSpecStore.getState().rigSpec;
  assert(spec1 !== null, 'Test 5: first load populates rigSpec');

  // Second load — different project (rename the warp to make it distinct)
  const proj2 = makeRiggedFixture();
  proj2.nodes = proj2.nodes.map((n) =>
    n.id === 'FaceParallax' ? { ...n, name: 'FaceParallax_v2' } : n
  );
  const { project: r2 } = await saveAndReload(proj2);
  useProjectStore.getState().loadProject(r2);
  const spec2 = useRigSpecStore.getState().rigSpec;
  assert(spec2 !== null, 'Test 5: second load re-populates rigSpec');
  assert(spec2 !== spec1, 'Test 5: rigSpec identity changed between loads');
  if (spec2) {
    const fp = spec2.warpDeformers.find((w) => w.id === 'FaceParallax');
    assert(fp?.name === 'FaceParallax_v2',
      `Test 5: second load reflects new warp name (got ${fp?.name})`);
  }
}

console.log(`\nsaveLoadRigSpec: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
