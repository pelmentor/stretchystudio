// V2 final wire (2026-05-07) — shadow validator structural test.
//
// `runShadowDepgraphTick` is what CanvasViewport calls when
// `preferences.evalEngine === 'depgraph'`. The validator throttles
// builds to ~1 Hz and diffs lifted grids against a chainEval map
// passed in. This script exercises:
//
//   1. First call after fresh project → ran=true (free pass past throttle).
//   2. Identity case — chainLifted matches depgraph → divergenceCount=0.
//   3. Forced shape mismatch → divergence flagged with kind='shape'.
//   4. Forced value mismatch above tol → divergence flagged with kind='value'.
//   5. Throttle gate — second call within window → ran=false.
//   6. Empty chainLifted → ran=true, warpsCompared=0 (graph still warmed).
//   7. resetShadowFlare clears the throttle so a new project re-runs fresh.
//
// Run: node scripts/test/test_depgraphShadow.mjs

import { runShadowDepgraphTick, resetShadowFlare } from '../../src/anim/depgraph/shadowValidate.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (actual === expected) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (got ${actual}, want ${expected})`);
}

function makeProject() {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'RootW', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        bindings: [],
        keyforms: [{
          keyTuple: [],
          positions: [0, 0,  800, 0,  0, 600,  800, 600],
          opacity: 1,
        }],
        isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
}

function liftedFromChainEval(project) {
  const rigSpec = selectRigSpec(project);
  const liftedGrids = new Map();
  evalRig(rigSpec, {}, { out: { liftedGrids } });
  return liftedGrids;
}

// ---- 1+2: first-call free pass + identity ----
{
  resetShadowFlare();
  const project = makeProject();
  const lifted = liftedFromChainEval(project);
  const r = runShadowDepgraphTick(project, {}, lifted);
  assert(r.ran === true, 'first call after reset: ran=true');
  assertEq(r.divergenceCount, 0, 'identity: 0 divergences');
  assert(r.warpsCompared >= 1, 'identity: at least one warp compared');
}

// ---- 3: shape mismatch ----
{
  resetShadowFlare();
  const project = makeProject();
  const fakeLifted = new Map();
  fakeLifted.set('RootW', new Float64Array(2)); // wrong length (should be 8)
  const r = runShadowDepgraphTick(project, {}, fakeLifted);
  assert(r.ran === true, 'shape: ran=true');
  assert(r.divergenceCount === 1, 'shape: exactly 1 divergence');
  assertEq(r.divergences?.[0]?.kind, 'shape', 'shape: kind=shape');
}

// ---- 4: value mismatch above tol ----
{
  resetShadowFlare();
  const project = makeProject();
  const lifted = liftedFromChainEval(project);
  // Perturb one entry above the default tol of 1e-6.
  const arr = lifted.get('RootW');
  if (arr) arr[0] += 1.0;
  const r = runShadowDepgraphTick(project, {}, lifted);
  assert(r.ran === true, 'value: ran=true');
  assert(r.divergenceCount === 1, 'value: exactly 1 divergence');
  assertEq(r.divergences?.[0]?.kind, 'value', 'value: kind=value');
  assert((r.divergences?.[0]?.delta ?? 0) >= 0.999, 'value: delta close to 1.0');
}

// ---- 5: throttle gate ----
{
  resetShadowFlare();
  const project = makeProject();
  const lifted = liftedFromChainEval(project);
  const r1 = runShadowDepgraphTick(project, {}, lifted);
  const r2 = runShadowDepgraphTick(project, {}, lifted);
  assert(r1.ran === true, 'throttle: first call ran=true');
  assertEq(r2.ran, false, 'throttle: second call within window ran=false');
}

// ---- 6: empty chainLifted ----
{
  resetShadowFlare();
  const project = makeProject();
  const r = runShadowDepgraphTick(project, {}, new Map());
  assert(r.ran === true, 'empty: ran=true');
  assertEq(r.warpsCompared, 0, 'empty: warpsCompared=0');
  assertEq(r.divergenceCount, 0, 'empty: divergenceCount=0');
}

// ---- 7: reset + new project re-runs fresh ----
{
  resetShadowFlare();
  const projectA = makeProject();
  const liftedA = liftedFromChainEval(projectA);
  const r1 = runShadowDepgraphTick(projectA, {}, liftedA);
  const r2 = runShadowDepgraphTick(projectA, {}, liftedA);
  assertEq(r2.ran, false, 'reset/new: throttled within window');
  // Project identity flips → throttle is reset by the validator.
  const projectB = makeProject();
  const liftedB = liftedFromChainEval(projectB);
  const r3 = runShadowDepgraphTick(projectB, {}, liftedB);
  assertEq(r3.ran, true, 'reset/new: project-id flip resets throttle');
}

console.log(`depgraphShadow: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
