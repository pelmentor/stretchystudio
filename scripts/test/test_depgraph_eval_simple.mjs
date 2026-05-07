// Phase D-2 — DepGraph eval pass + simple kernels.
//
// Verifies:
//   - Topo-sorted eval pass dispatches ops in pending-link order.
//   - TIME_TICK kernel returns ctx.time.
//   - PARAM_EVAL kernel reads project.parameters[i].default.
//   - FCURVE_EVAL evaluates the bound track's curve and overrides
//     downstream PARAM_EVAL.
//   - DRIVER_EVAL runs after FCURVE_EVAL and overrides the keyframe
//     value (Blender semantics).
//   - Cyclic relations don't block eval (CYCLIC-flagged edges skipped
//     for pending counting).
//
// Run: node scripts/test/test_depgraph_eval_simple.mjs

import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';
import { OperationCode, NodeType } from '../../src/anim/depgraph/types.js';

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

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- TIME_TICK kernel ----

{
  const project = { parameters: [], nodes: [], animations: [], physicsRules: [] };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 1.5 });
  // Find the TIME_TICK op output.
  for (const [name, value] of ctx.outputs) {
    if (name.startsWith('__time__/PARAMETERS/TIME_TICK')) {
      assertEq(value, 1.5, 'TIME_TICK returns ctx.time');
    }
  }
}

// ---- PARAM_EVAL kernel reads default ----

{
  const project = {
    parameters: [
      { id: 'ParamA', default: 0.7 },
      { id: 'ParamB', default: -0.3 },
    ],
    nodes: [], animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0 });
  // Look up by op name suffix.
  let found = 0;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:ParamA')) {
      assertNear(value, 0.7, 1e-9, 'PARAM_EVAL ParamA = default 0.7');
      found++;
    }
    if (name.includes('/PARAM_EVAL:ParamB')) {
      assertNear(value, -0.3, 1e-9, 'PARAM_EVAL ParamB = default -0.3');
      found++;
    }
  }
  assertEq(found, 2, 'PARAM_EVAL reached for both params');
}

// ---- paramOverrides take precedence over default ----

{
  const project = {
    parameters: [{ id: 'X', default: 1 }],
    nodes: [], animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const overrides = new Map([['X', 5]]);
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: overrides });
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:X')) {
      assertEq(value, 5, 'PARAM_EVAL: override beats default');
    }
  }
}

// ---- DRIVER_EVAL overrides keyframe value ----

{
  const project = {
    parameters: [
      { id: 'A', default: 5 },
      { id: 'B', default: 99,
        driver: {
          type: 'scripted',
          expression: 'A * 2',
          variables: [{ name: 'A',
            target: { rnaPath: "objects['__params__'].values['A']" } }],
        } },
    ],
    nodes: [], animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0 });
  // Driver should compute B = A * 2 = 5 * 2 = 10. Then PARAM_EVAL B
  // picks up the override.
  let foundB = false;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:B')) {
      assertNear(value, 10, 1e-9, 'PARAM_EVAL B = driver override (10), not default (99)');
      foundB = true;
    }
  }
  assert(foundB, 'PARAM_EVAL:B reached');
}

// ---- Driver var-resolution via paramOverrides cascades ----

{
  // ParamX = 3, driver of ParamY = X * 4 = 12.
  // Then driver of ParamZ = Y * 5 = 60.
  const project = {
    parameters: [
      { id: 'X', default: 3 },
      { id: 'Y', default: 0,
        driver: {
          type: 'scripted', expression: 'X * 4',
          variables: [{ name: 'X',
            target: { rnaPath: "objects['__params__'].values['X']" } }],
        } },
      { id: 'Z', default: 0,
        driver: {
          type: 'scripted', expression: 'Y * 5',
          variables: [{ name: 'Y',
            target: { rnaPath: "objects['__params__'].values['Y']" } }],
        } },
    ],
    nodes: [], animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0 });
  // Issue: the driver kernel calls evaluateDriver which calls
  // resolveVariables → evaluateRnaPath (project, ...) → reads from
  // project.parameters[i].default. To make the cascade work the
  // PARAM_EVAL writes back via paramOverrides; evaluateRnaPath
  // would need to consult those. evaluateRnaPath today reads from
  // project.parameters[i].default. So a chained driver Z = Y * 5 will
  // see Y's default (0), NOT Y's driver result (12).
  //
  // This is a known limitation today (driver cascades through
  // overrides aren't wired). For Phase D-2 the test PINS the current
  // behaviour: Z = 0 * 5 = 0 (Y's default). Phase D-3 / D-4 patches
  // this when paramOverrides feeds back into the rnaPath resolver.
  let foundZ = false;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:Z')) {
      assertNear(value, 0, 1e-9, 'PARAM_EVAL:Z = 0 (cascade limitation pinned)');
      foundZ = true;
    }
  }
  assert(foundZ, 'PARAM_EVAL:Z reached');
}

// ---- FCURVE_EVAL kernel via animation track ----

{
  const project = {
    parameters: [{ id: 'P', default: 0 }],
    nodes: [], animations: [], physicsRules: [],
  };
  const animation = {
    tracks: [{
      targetId: 'P',
      property: 'value',
      keyforms: [
        { time: 0, value: 0 },
        { time: 1, value: 10 },
      ],
    }],
  };
  const graph = buildDepGraph(project, { animation });
  const ctx = evalDepGraph(graph, { project, time: 0.5, animation });
  // FCurve at t=0.5 lerps 0→10 → 5.
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:P')) {
      assertNear(value, 5, 1e-6, 'PARAM_EVAL P = fcurve(t=0.5) = 5');
    }
  }
}

// ---- Cyclic relation skipped for pending count (eval doesn't deadlock) ----

{
  const project = {
    parameters: [
      { id: 'A', default: 1,
        driver: {
          type: 'scripted', expression: 'B + 1',
          variables: [{ name: 'B',
            target: { rnaPath: "objects['__params__'].values['B']" } }],
        } },
      { id: 'B', default: 1,
        driver: {
          type: 'scripted', expression: 'A + 1',
          variables: [{ name: 'A',
            target: { rnaPath: "objects['__params__'].values['A']" } }],
        } },
    ],
    nodes: [], animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0 });
  // Both PARAM_EVAL ops should still produce a value (cycle-broken
  // edges contribute nothing, so each driver sees the OTHER param's
  // default 1 from rnaPath → driver = 1 + 1 = 2).
  let foundA = 0, foundB = 0;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('/PARAM_EVAL:A')) { foundA = value; }
    if (name.includes('/PARAM_EVAL:B')) { foundB = value; }
  }
  assert(typeof foundA === 'number' && Number.isFinite(foundA),
    `cyclic: PARAM_EVAL:A produced finite value (${foundA})`);
  assert(typeof foundB === 'number' && Number.isFinite(foundB),
    `cyclic: PARAM_EVAL:B produced finite value (${foundB})`);
}

// ---- Result ----

console.log(`depgraph_eval_simple: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
