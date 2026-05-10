// Phase 0.C — TRANSFORM_COMPOSE op tests.
//
// Pins the constraint composition op + its build-time target ordering.
// Run: node scripts/test/test_depgraph_eval_transformCompose.mjs

import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';

let passed = 0;
let failed = 0;

function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

function readCompose(ctx, ownerId, ownerType = 'group') {
  const key = `${ownerId}/TRANSFORM/TRANSFORM_COMPOSE`;
  return ctx.outputs.get(key);
}

// ---------------------------------------------------------------------
// Test 1: passthrough — no constraints, output equals authored transform.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'A', type: 'group', name: 'A', transform: { x: 100, y: 50, rotation: 0.5, scaleX: 1, scaleY: 1 } },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: new Map() });
  const out = readCompose(ctx, 'A');
  assert(out, 'passthrough: TRANSFORM_COMPOSE produced an output');
  assert(out && approx(out.transform.x, 100), 'passthrough: x=100');
  assert(out && approx(out.transform.y, 50),  'passthrough: y=50');
  assert(out && approx(out.transform.rotation, 0.5), 'passthrough: rotation=0.5');
  assert(out?.ranConstraints === 0, 'passthrough: ranConstraints=0');
}

// ---------------------------------------------------------------------
// Test 2: COPY_LOCATION — owner inherits target's x/y.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'target', type: 'group', name: 'target',
        transform: { x: 250, y: 175, rotation: 0, scaleX: 1, scaleY: 1 } },
      { id: 'owner', type: 'group', name: 'owner',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'c1', type: 'COPY_LOCATION', name: 'CL', enabled: true, influence: 1,
            payload: { targetId: 'target', useX: true, useY: true, invertX: false, invertY: false, offset: false } },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: new Map() });
  const out = readCompose(ctx, 'owner');
  assert(out && approx(out.transform.x, 250), 'COPY_LOCATION: x copied from target');
  assert(out && approx(out.transform.y, 175), 'COPY_LOCATION: y copied from target');
  assert(out?.ranConstraints === 1, 'COPY_LOCATION: ranConstraints=1');
}

// ---------------------------------------------------------------------
// Test 3: chained constraints — A copies B which copies C. Topology
// must run C → B → A so A picks up the FULL chain.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'C', type: 'group', name: 'C',
        transform: { x: 999, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
      { id: 'B', type: 'group', name: 'B',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'b1', type: 'COPY_LOCATION', enabled: true, influence: 1,
            payload: { targetId: 'C', useX: true, useY: true, invertX: false, invertY: false, offset: false } },
        ] },
      { id: 'A', type: 'group', name: 'A',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'a1', type: 'COPY_LOCATION', enabled: true, influence: 1,
            payload: { targetId: 'B', useX: true, useY: true, invertX: false, invertY: false, offset: false } },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: new Map() });
  const outA = readCompose(ctx, 'A');
  const outB = readCompose(ctx, 'B');
  assert(outB && approx(outB.transform.x, 999), 'chain: B inherits 999 from C');
  assert(outA && approx(outA.transform.x, 999), 'chain: A inherits 999 transitively (target-first ordering)');
}

// ---------------------------------------------------------------------
// Test 4: LIMIT_ROTATION — clamps owner's rotation to [min, max].
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'limited', type: 'group', name: 'limited',
        transform: { x: 0, y: 0, rotation: 1.5, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'lr', type: 'LIMIT_ROTATION', enabled: true, influence: 1,
            payload: { useMin: true, min: -0.5, useMax: true, max: 0.5 } },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: new Map() });
  const out = readCompose(ctx, 'limited');
  assert(out && approx(out.transform.rotation, 0.5),
    'LIMIT_ROTATION: 1.5 clamped to max 0.5',
    `got rotation=${out?.transform?.rotation}`);
}

// ---------------------------------------------------------------------
// Test 5: disabled constraint — passthrough.
// ---------------------------------------------------------------------
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'target', type: 'group', name: 'target',
        transform: { x: 999, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
      { id: 'owner', type: 'group', name: 'owner',
        transform: { x: 7, y: 8, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: [
          { id: 'cd', type: 'COPY_LOCATION', enabled: false, influence: 1,
            payload: { targetId: 'target', useX: true, useY: true, invertX: false, invertY: false, offset: false } },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: new Map() });
  const out = readCompose(ctx, 'owner');
  assert(out && approx(out.transform.x, 7) && approx(out.transform.y, 8),
    'disabled constraint: authored transform passes through');
}

console.log(`depgraph_eval_transformCompose: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
