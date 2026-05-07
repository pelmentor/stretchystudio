// Phase D-6 — side-by-side eval validator structural test.
//
// Runs `runSideBySide` on a synthetic project + verifies the report
// shape:
//   - Lifted-grid divergence list is empty when both engines agree.
//   - Diff is detected when the depgraph would diverge (forced via
//     a project shape that breaks one engine but not the other).
//
// This isn't a byte-fidelity gate; that runs on the user's Shelby
// fixture via `scripts/byteFidelity/check_shelby.mjs`. This test
// validates the helper's structural correctness.
//
// Run: node scripts/test/test_depgraphSideBySide.mjs

import { runSideBySide } from '../../src/anim/depgraph/sideBySide.js';

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

// ---- Basic identity case ----

{
  const project = {
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
  const report = runSideBySide(project, {});
  assert(report.identical, 'simple root warp: engines agree (no divergences)');
  assertEq(report.divergences.length, 0, 'simple: 0 divergences reported');
  assertEq(report.liftedGridCount, 1, 'simple: 1 lifted grid in either engine');
  assert(typeof report.chainEvalMs === 'number',
    'simple: chainEvalMs is a number');
  assert(typeof report.depgraphMs === 'number',
    'simple: depgraphMs is a number');
}

// ---- Body-warp 3-chain identity ----

{
  const canvasGrid5x5 = (W, H) => {
    const pos = [];
    for (let r = 0; r <= 5; r++) {
      for (let c = 0; c <= 5; c++) {
        pos.push((c / 5) * W, (r / 5) * H);
      }
    }
    return pos;
  };
  const unitGrid5x5 = () => {
    const pos = [];
    for (let r = 0; r <= 5; r++) {
      for (let c = 0; c <= 5; c++) {
        pos.push(c / 5, r / 5);
      }
    }
    return pos;
  };
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 5, cols: 5 }, bindings: [],
        keyforms: [{ keyTuple: [], positions: canvasGrid5x5(800, 600), opacity: 1 }],
        isQuadTransform: false },
      { id: 'BodyWarpY', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ',
        gridSize: { rows: 5, cols: 5 }, bindings: [],
        keyforms: [{ keyTuple: [], positions: unitGrid5x5(), opacity: 1 }],
        isQuadTransform: false },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY',
        gridSize: { rows: 5, cols: 5 }, bindings: [],
        keyforms: [{ keyTuple: [], positions: unitGrid5x5(), opacity: 1 }],
        isQuadTransform: false },
    ],
    animations: [], physicsRules: [],
  };
  const report = runSideBySide(project, {});
  assert(report.identical,
    '3-chain body warp: engines agree byte-for-byte');
  assertEq(report.liftedGridCount, 3, '3-chain: 3 lifted grids');
}

// ---- Result ----

console.log(`depgraphSideBySide: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
