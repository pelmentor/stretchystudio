// Phase D-3b — depgraph GRID_LIFT_TO_PARENT byte-fidelity vs
// chainEval's `cache.getLiftedGrid`. The lifted grid is the
// foundation of the deformer chain — if it matches across engines at
// the byte level, the rest of the eval pipeline (which feeds into
// `evalWarpKernelCubism` against this grid) will match too.
//
// Test cases:
//   1. Root-parented warp: lifted grid = current-frame grid (no chain).
//   2. Two-warp chain: child's lifted = bilinear of child's grid through
//      parent's lifted grid.
//   3. Three-warp chain (Body Z → Y → Breath): full body chain.
//
// The chainEval reference path uses `selectRigSpec(project)` then a
// fresh `DeformerStateCache` to extract `getLiftedGrid` for each warp
// at the same param values; the depgraph path uses `buildDepGraph` +
// `evalDepGraph`. We compare the lifted grids per-CP at float-eq
// tolerance.
//
// Run: node scripts/test/test_depgraph_eval_liftedGrid.mjs

import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
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

function maxAbsDiff(a, b) {
  if (!a || !b) return Infinity;
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

/**
 * Run chainEval to populate its lifted-grid cache, return Map<warpId, Float64Array>.
 */
function chainEvalLiftedGrids(project, paramValues) {
  const rigSpec = selectRigSpec(project);
  const liftedOut = new Map();
  // evalRig will force-lift every warp into liftedOut (see chainEval.js:117).
  evalRig(rigSpec, paramValues, { out: { liftedGrids: liftedOut } });
  return liftedOut;
}

/**
 * Run depgraph eval, return Map<warpId, Float64Array> from
 * GRID_LIFT_TO_PARENT outputs.
 */
function depgraphLiftedGrids(project, paramValues) {
  const graph = buildDepGraph(project, {});
  const overrides = new Map(Object.entries(paramValues ?? {}));
  const ctx = evalDepGraph(graph, { project, timeMs: 0, paramOverrides: overrides });
  const out = new Map();
  for (const [name, value] of ctx.outputs) {
    if (!name.endsWith('/GEOMETRY/GRID_LIFT_TO_PARENT')) continue;
    if (!value?.lifted) continue;
    // Op name shape: `<deformerId>/GEOMETRY/GRID_LIFT_TO_PARENT`.
    const id = name.split('/')[0];
    out.set(id, value.lifted);
  }
  return out;
}

// ---- 1. Root-parented warp: lifted = current grid ----

{
  const positions = [
    0, 0,    400, 0,    800, 0,
    0, 300,  400, 300,  800, 300,
    0, 600,  400, 600,  800, 600,
  ];
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'RootWarp', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 2, cols: 2 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions, opacity: 1 }],
        isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
  const chainOut = chainEvalLiftedGrids(project, {});
  const depOut = depgraphLiftedGrids(project, {});
  const a = chainOut.get('RootWarp');
  const b = depOut.get('RootWarp');
  assert(a !== undefined, 'chainEval lifted RootWarp');
  assert(b !== undefined, 'depgraph  lifted RootWarp');
  assertNear(maxAbsDiff(a, b), 0, 1e-9,
    'root warp: depgraph lifted grid byte-equal to chainEval');
}

// ---- 2. Two-warp chain ----

{
  // Parent root warp: identity canvas-px grid.
  const parentPositions = [
    0, 0,    800, 0,
    0, 600,  800, 600,
  ];
  // Child warp: 0..1 grid (uniform), so child's lifted = parent's lifted
  // bilinear-warped at child's CPs (which are 0..1 → canvas-px).
  const childPositions = [
    0,   0,    1,   0,
    0,   1,    1,   1,
  ];
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'ParentW', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions: parentPositions, opacity: 1 }],
        isQuadTransform: false },
      { id: 'ChildW', type: 'deformer', deformerKind: 'warp', parent: 'ParentW',
        gridSize: { rows: 1, cols: 1 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions: childPositions, opacity: 1 }],
        isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
  const chainOut = chainEvalLiftedGrids(project, {});
  const depOut = depgraphLiftedGrids(project, {});
  const aParent = chainOut.get('ParentW');
  const bParent = depOut.get('ParentW');
  assertNear(maxAbsDiff(aParent, bParent), 0, 1e-9,
    'two-chain parent: byte-equal');
  const aChild = chainOut.get('ChildW');
  const bChild = depOut.get('ChildW');
  assertNear(maxAbsDiff(aChild, bChild), 0, 1e-9,
    'two-chain child: byte-equal lift through parent');
}

// ---- 3. Body-warp chain (BodyZ → BodyY → Breath) — Shelby topology ----

{
  // 5x5 grid for each body warp (matches SS bodyWarp synth).
  function unitGrid5x5() {
    // Source frame [0..1]×[0..1] uniform 5×5 control points.
    const pos = [];
    for (let r = 0; r <= 5; r++) {
      for (let c = 0; c <= 5; c++) {
        pos.push(c / 5, r / 5);
      }
    }
    return pos;
  }
  function canvasGrid5x5(W, H) {
    const pos = [];
    for (let r = 0; r <= 5; r++) {
      for (let c = 0; c <= 5; c++) {
        pos.push((c / 5) * W, (r / 5) * H);
      }
    }
    return pos;
  }
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 5, cols: 5 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions: canvasGrid5x5(800, 600), opacity: 1 }],
        isQuadTransform: false },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ',
        gridSize: { rows: 5, cols: 5 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions: unitGrid5x5(), opacity: 1 }],
        isQuadTransform: false },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY',
        gridSize: { rows: 5, cols: 5 },
        bindings: [],
        keyforms: [{ keyTuple: [], positions: unitGrid5x5(), opacity: 1 }],
        isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
  const chainOut = chainEvalLiftedGrids(project, {});
  const depOut = depgraphLiftedGrids(project, {});
  for (const id of ['BodyWarpZ', 'BodyWarpY', 'BreathWarp']) {
    const a = chainOut.get(id);
    const b = depOut.get(id);
    assert(a !== undefined && b !== undefined, `${id} present in both engines`);
    assertNear(maxAbsDiff(a, b), 0, 1e-6,
      `body chain ${id}: depgraph lifted grid byte-equal to chainEval`);
  }
}

// ---- Result ----

console.log(`depgraph_eval_liftedGrid: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
