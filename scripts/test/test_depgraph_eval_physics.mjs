// Phase D-4 — depgraph PHYSICS_EVAL kernel byte-fidelity vs direct
// tickPhysics calls.
//
// Setup: a single hair-pendulum rule (3-vertex chain). Run the same
// rule through:
//   A) chainEval-equivalent: createPhysicsState → tickPhysics(60×) →
//      capture final paramValues.
//   B) depgraph: buildDepGraph → evalDepGraph 60× with same dtSeconds
//      → capture ctx.paramOverrides outputs.
//
// Audit Gap B pin: the comparison uses WARM state (60 pre-warmed
// frames) before sampling outputs, NOT cold state at frame 0.
//
// Run: node scripts/test/test_depgraph_eval_physics.mjs

import {
  tickPhysics,
  createPhysicsState,
  setPhysicsKernel,
} from '../../src/io/live2d/runtime/physicsTick.js';

// The cubism-port kernel needs cubism-shaped rule data (not the
// synthetic legacy rules below). Force the legacy v3 kernel for this
// test — it's the simpler, deterministic verlet-based pendulum the
// depgraph kernel is byte-fidelity tested against.
setPhysicsKernel('v3-legacy');
import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertNear(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (|${a} - ${b}| > ${eps})`);
}

function makeProject() {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [
      { id: 'ParamAngleX', default: 0 },
      { id: 'ParamHairFrontX', default: 0 },
    ],
    nodes: [],
    animations: [],
    physicsRules: [
      {
        id: 'hair-front',
        inputs: [{ paramId: 'ParamAngleX', type: 'SRC_TO_G_ANGLE', weight: 100 }],
        outputs: [{ paramId: 'ParamHairFrontX', kind: 'angle', scale: 1, vertexIndex: 2 }],
        vertices: [
          { x: 0, y: 0,  radius: 0,  mobility: 1, delay: 0.5, acceleration: 1.0 },
          { x: 0, y: 15, radius: 15, mobility: 1, delay: 0.5, acceleration: 1.0 },
          { x: 0, y: 30, radius: 15, mobility: 1, delay: 0.5, acceleration: 1.0 },
        ],
        gravity: { x: 0, y: 1 },
        wind: { x: 0, y: 0 },
        normalization: { angleMax: 10 },
      },
    ],
  };
}

function paramSpecsForProject(project) {
  const map = new Map();
  for (const p of project.parameters ?? []) {
    map.set(p.id, { min: -30, max: 30, default: typeof p.default === 'number' ? p.default : 0 });
  }
  return map;
}

// ---- Reference: direct tickPhysics, 60 warm frames + 1 sample frame ----

function runDirectReference(project, paramInputs, dt) {
  const state = createPhysicsState(project.physicsRules);
  const paramSpecs = paramSpecsForProject(project);
  const paramValues = { ...paramInputs };
  // Warm: 60 frames at fixed dt.
  for (let f = 0; f < 60; f++) {
    paramValues.ParamAngleX = paramInputs.ParamAngleX;
    tickPhysics(state, project.physicsRules, paramValues, paramSpecs, dt);
  }
  // Sample frame.
  paramValues.ParamAngleX = paramInputs.ParamAngleX;
  tickPhysics(state, project.physicsRules, paramValues, paramSpecs, dt);
  return paramValues.ParamHairFrontX;
}

// ---- Depgraph eval: build once + 60 warm frames + 1 sample frame ----

function runDepgraphEval(project, paramInputs, dt) {
  const state = createPhysicsState(project.physicsRules);
  const paramSpecs = paramSpecsForProject(project);
  const graph = buildDepGraph(project, {});

  let last = 0;
  for (let f = 0; f < 61; f++) {
    const overrides = new Map(Object.entries(paramInputs));
    const ctx = evalDepGraph(graph, {
      project,
      time: f * dt,
      paramOverrides: overrides,
      // Provide physics ctx for kernel.
      ...({ physics: { state, paramSpecs, dtSeconds: dt } }),
    });
    const out = ctx.paramOverrides?.get('ParamHairFrontX');
    if (typeof out === 'number') last = out;
  }
  return last;
}

// ---- 1. Identity input: rest state, no rotation → outputs near 0 ----

{
  const project = makeProject();
  const dt = 1 / 60;
  const ref = runDirectReference(project, { ParamAngleX: 0 }, dt);
  const dep = runDepgraphEval(project, { ParamAngleX: 0 }, dt);
  assertNear(dep, ref, 1e-6,
    'rest input: depgraph physics matches direct tickPhysics (warm 60 frames)');
}

// ---- 2. Non-zero input drives pendulum; warm state matches ----

{
  const project = makeProject();
  const dt = 1 / 60;
  const ref = runDirectReference(project, { ParamAngleX: 15 }, dt);
  const dep = runDepgraphEval(project, { ParamAngleX: 15 }, dt);
  assertNear(dep, ref, 1e-6,
    'non-zero input: depgraph physics matches direct tickPhysics (warm)');
}

// ---- 3. AUDIT GAP B: cold-start frame 0 vs warm frame 60 differ ----

{
  const project = makeProject();
  const state = createPhysicsState(project.physicsRules);
  const paramSpecs = paramSpecsForProject(project);
  const dt = 1 / 60;
  const cold = { ...{ ParamAngleX: 15, ParamHairFrontX: 0 } };
  tickPhysics(state, project.physicsRules, cold, paramSpecs, dt);
  const coldOut = cold.ParamHairFrontX;

  const warmState = createPhysicsState(project.physicsRules);
  const warm = { ParamAngleX: 15, ParamHairFrontX: 0 };
  for (let f = 0; f < 60; f++) {
    tickPhysics(warmState, project.physicsRules, warm, paramSpecs, dt);
  }
  const warmOut = warm.ParamHairFrontX;
  // Cold-start has zero accumulator, no integration history; warm has 60×PHYSICS_DT
  // of pendulum integration. They MUST diverge — pinning Audit Gap B.
  assert(coldOut !== warmOut,
    'AUDIT-GAP-B: cold-start output ≠ warm-start output (engine is stateful)');
}

// ---- Result ----

console.log(`depgraph_eval_physics: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
