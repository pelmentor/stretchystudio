// V3 Re-Rig Phase 3 — runStage integration: pose preservation + telemetry.
//
// Boots a minimal in-memory project via direct projectStore mutation, sets
// some paramValues + bone transform state, runs a config-only stage refit,
// and verifies:
//   - paramValuesStore values survive (the load-bearing Phase 1 promise:
//     per-stage refit does NOT reset to defaults like full Re-Init Rig does).
//   - Bone transforms survive (capturePose + restorePose round-trip).
//   - `project.rigStageLastRunAt[stage]` gets stamped with an ISO timestamp.
//
// Stages 9-11 (keyform-bearing) need real meshes + canvas geometry to
// produce useful harvest output, so this test exercises a config stage
// (boneConfig) which validates the dispatch + telemetry + lock-release
// path without dragging in the full harvest pipeline.
//
// Run: node scripts/test/test_runStageIntegration.mjs

import { runStage, RIG_STAGE_NAMES } from '../../src/services/RigService.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';

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

// ── Set up a minimal project that passes preflightBuildRig ─────────

useProjectStore.setState((s) => ({
  ...s,
  project: {
    ...s.project,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' },
    nodes: [
      {
        id: 'g1', type: 'group', name: 'hair_root', boneRole: 'hair_root',
        transform: { x: 0, y: 0, rotation: 30, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 200 },
        parent: null,
      },
      {
        id: 'p1', type: 'part', name: 'face',
        parent: null, draw_order: 0, opacity: 1, visible: true,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        mesh: { vertices: [0,0, 100,0, 100,100, 0,100], uvs: [0,0, 1,0, 1,1, 0,1], triangles: [0,1,2, 0,2,3] },
      },
    ],
    parameters: [
      { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
      { id: 'ParamAngleY', min: -30, max: 30, default: 0 },
    ],
  },
}));

// Seed paramValues with a non-default value the user "moved the slider to".
useParamValuesStore.getState().setParamValue('ParamAngleX', 15);
useParamValuesStore.getState().setParamValue('ParamAngleY', -10);

// ── runStage('boneConfig') — config-only, no harvest needed ──────

{
  const t0 = Date.now();
  const result = await runStage('boneConfig', { mode: 'merge' });
  assert(result.ok, `runStage(boneConfig) ok (got: ${result.error ?? 'no error'})`);

  // Pose survives — this is the load-bearing Phase 1 promise.
  const pv = useParamValuesStore.getState().values;
  assertEq(pv.ParamAngleX, 15, 'paramValues.ParamAngleX preserved across runStage');
  assertEq(pv.ParamAngleY, -10, 'paramValues.ParamAngleY preserved across runStage');

  // Bone transform untouched (config stages don't touch transforms).
  const proj = useProjectStore.getState().project;
  const bone = proj.nodes.find((n) => n.id === 'g1');
  assertEq(bone.transform.rotation, 30, 'bone rotation preserved');
  assertEq(bone.transform.pivotX, 100, 'bone pivotX preserved');
  assertEq(bone.transform.pivotY, 200, 'bone pivotY preserved');

  // Telemetry stamped with a parseable ISO timestamp.
  const stamp = proj.rigStageLastRunAt?.boneConfig;
  assert(typeof stamp === 'string', 'rigStageLastRunAt.boneConfig is a string');
  const parsedMs = Date.parse(stamp ?? '');
  assert(Number.isFinite(parsedMs), 'rigStageLastRunAt.boneConfig parses as a valid ISO timestamp');
  assert(parsedMs >= t0 - 5000 && parsedMs <= Date.now() + 5000,
    'rigStageLastRunAt.boneConfig is within the test window');

  // Other stages remain unstamped (only the one we ran).
  for (const otherStage of RIG_STAGE_NAMES) {
    if (otherStage === 'boneConfig') continue;
    assert(!proj.rigStageLastRunAt?.[otherStage],
      `rigStageLastRunAt[${otherStage}] not stamped (only boneConfig was run)`);
  }
}

// ── runStage('parameters') — pure-default seeder (no mode arg used) ──

{
  const result = await runStage('parameters');
  assert(result.ok, `runStage(parameters) ok (got: ${result.error ?? 'no error'})`);

  // Two stages now stamped.
  const stamps = useProjectStore.getState().project.rigStageLastRunAt ?? {};
  assert(typeof stamps.boneConfig === 'string', 'boneConfig still stamped after second run');
  assert(typeof stamps.parameters === 'string', 'parameters now stamped');
}

// ── runStage('autoRigConfig') — verifies subsystems clobber-fix path ─

{
  // Pre-set subsystems.hairRig=false (mimics InitRigOptionsPopover edit).
  useProjectStore.setState((s) => {
    const next = JSON.parse(JSON.stringify(s.project));
    next.autoRigConfig = next.autoRigConfig ?? null;
    if (!next.autoRigConfig) {
      // Bootstrap minimum shape so seedAutoRigConfig sees a `subsystems`
      // field to preserve. (Phase 0 fix is "preserve from prior config".)
      next.autoRigConfig = {
        subsystems: { hairRig: false, eyeRig: true, mouthRig: true,
                       faceRig: true, clothingRig: true, bodyWarps: true, armPhysics: true },
      };
    } else {
      next.autoRigConfig.subsystems = { ...(next.autoRigConfig.subsystems ?? {}), hairRig: false };
    }
    return { ...s, project: next };
  });

  const result = await runStage('autoRigConfig', { mode: 'replace' });
  assert(result.ok, `runStage(autoRigConfig) ok (got: ${result.error ?? 'no error'})`);

  // Subsystems clobber-fix: hairRig=false survives even in REPLACE mode.
  const proj = useProjectStore.getState().project;
  assertEq(proj.autoRigConfig.subsystems.hairRig, false,
    'runStage(autoRigConfig, replace): hairRig=false survives clobber-fix');
}

console.log(`runStageIntegration: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
