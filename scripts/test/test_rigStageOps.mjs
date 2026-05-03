// V3 Re-Rig Phase 1 — runStage dispatch + single-flight + telemetry plumbing.
//
// Smoke-level checks that exercise the pure surface of RigService.runStage
// without spinning up a full project + zustand stores. Integration tests
// (full harvest pipeline through to store mutations) are covered indirectly
// by the seeder tests + the existing rig diff harness.
//
// Run: node scripts/test/test_rigStageOps.mjs

import {
  RIG_STAGE_NAMES,
  runStage,
  refitAll,
  _resetRunStageInFlightForTest,
} from '../../src/services/RigService.js';

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

// ── RIG_STAGE_NAMES contract ────────────────────────────────────────

{
  assertEq(RIG_STAGE_NAMES.length, 11, 'RIG_STAGE_NAMES: exactly 11 stages');
  // Order matches seedAllRig order.
  assertEq(RIG_STAGE_NAMES[0],  'parameters',             'order[0] parameters');
  assertEq(RIG_STAGE_NAMES[1],  'maskConfigs',            'order[1] maskConfigs');
  assertEq(RIG_STAGE_NAMES[2],  'physicsRules',           'order[2] physicsRules');
  assertEq(RIG_STAGE_NAMES[3],  'boneConfig',             'order[3] boneConfig');
  assertEq(RIG_STAGE_NAMES[4],  'variantFadeRules',       'order[4] variantFadeRules');
  assertEq(RIG_STAGE_NAMES[5],  'eyeClosureConfig',       'order[5] eyeClosureConfig');
  assertEq(RIG_STAGE_NAMES[6],  'rotationDeformerConfig', 'order[6] rotationDeformerConfig');
  assertEq(RIG_STAGE_NAMES[7],  'autoRigConfig',          'order[7] autoRigConfig');
  assertEq(RIG_STAGE_NAMES[8],  'faceParallax',           'order[8] faceParallax');
  assertEq(RIG_STAGE_NAMES[9],  'bodyWarpChain',          'order[9] bodyWarpChain');
  assertEq(RIG_STAGE_NAMES[10], 'rigWarps',               'order[10] rigWarps');
}

// ── runStage: unknown stage rejected ────────────────────────────────
//
// We can call runStage in node — it bails out at the unknown-stage
// check before touching any zustand state. Same for the in-flight
// guard. The preflight check runs against the live projectStore which
// in node has the empty default state → fails preflight; that's the
// expected error string when arg validation passes.

{
  const r = await runStage(/** @type {any} */ ('bogus'));
  assert(r.ok === false, 'runStage: unknown stage rejected');
  assert(/unknown stage/.test(r.error ?? ''),
    `runStage error mentions unknown stage (got: ${r.error})`);
}

// ── runStage: preflight rejection (empty project in node env) ─────

{
  // Default zustand projectStore in node has no parts → preflight fails.
  // This validates the preflight gate is wired into runStage.
  const r = await runStage('parameters');
  assert(r.ok === false, 'runStage: empty project preflight fails');
  assert(/no part|no project/.test(r.error ?? ''),
    `runStage preflight error mentions no parts/project (got: ${r.error})`);
}

// ── refitAll: same preflight gate ──────────────────────────────────

{
  const r = await refitAll();
  assert(r.ok === false, 'refitAll: empty project preflight fails');
}

// ── single-flight reset helper ─────────────────────────────────────

{
  // After repeated runStage calls (all fast-failed at preflight) the
  // lock should be released. The reset helper returns the prior state.
  const wasLocked = _resetRunStageInFlightForTest();
  assert(wasLocked === false, 'reset helper: returns prior unlocked state');
}

console.log(`rigStageOps: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
