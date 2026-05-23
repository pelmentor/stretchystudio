// BUG-NECK_NULL_BBOX integration regression test (2026-05-08).
//
// The bug: `buildNeckWarpSpec` and `perPartRigWarps.js` emit
// `WarpDeformerSpec` with Float64Array `baseGrid` and
// `keyforms[i].positions`. `seedAllRig` passes them directly to
// `warpSpecToDeformerNode` (no serializer in between). Pre-fix the
// silent `Array.isArray ? slice : []` dropped Float64Array to `[]`,
// causing `chainEvalLift` to produce `[null, null]` bboxes for
// NeckWarp + RigWarp_neck — the user-facing "neck gone before
// re-init" symptom.
//
// This test wires the full pipeline (Float64Array spec → deformer
// node → modifier.data → synthesizeDeformerNodesForExport) and
// asserts the data survives every hop. Bug surface cannot regress
// without this test failing.
//
// Run: node scripts/test/test_neckWarpFloat64Pipeline.mjs

import {
  warpSpecToDeformerNode,
  upsertDeformerNode,
  synthesizeModifierStacks,
} from '../../src/store/deformerNodeSync.js';
import { synthesizeDeformerNodesForExport, resetSynthFlare }
  from '../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (eq) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
}

// ── Stage 1: Float64Array WarpDeformerSpec → warpSpecToDeformerNode ──

const NECK_BASE_GRID = new Float64Array([
  // 5×5 grid of x,y pairs — synthetic but deterministic
  100, 200, 200, 200, 300, 200, 400, 200, 500, 200,
  100, 250, 200, 250, 300, 250, 400, 250, 500, 250,
  100, 300, 200, 300, 300, 300, 400, 300, 500, 300,
  100, 350, 200, 350, 300, 350, 400, 350, 500, 350,
  100, 400, 200, 400, 300, 400, 400, 400, 500, 400,
]);
const NECK_KF_NEG30 = new Float64Array(NECK_BASE_GRID).map((v, i) => v + (i % 2 === 0 ? -10 : 0));
const NECK_KF_ZERO  = new Float64Array(NECK_BASE_GRID);
const NECK_KF_POS30 = new Float64Array(NECK_BASE_GRID).map((v, i) => v + (i % 2 === 0 ? +10 : 0));

// Mimics buildNeckWarpSpec output verbatim — Float64Array everywhere.
const neckSpec = {
  id: 'NeckWarp',
  name: 'NeckWarp',
  parent: { type: 'warp', id: 'BodyXWarp' },
  gridSize: { rows: 4, cols: 4 },
  baseGrid: NECK_BASE_GRID,
  localFrame: 'canvas-px',
  bindings: [
    { parameterId: 'ParamAngleZ', keys: new Float64Array([-30, 0, 30]), interpolation: 'LINEAR' },
  ],
  keyforms: [
    { keyTuple: new Float64Array([-30]), positions: NECK_KF_NEG30, opacity: 1 },
    { keyTuple: new Float64Array([0]),   positions: NECK_KF_ZERO,  opacity: 1 },
    { keyTuple: new Float64Array([30]),  positions: NECK_KF_POS30, opacity: 1 },
  ],
  isVisible: true, isLocked: false, isQuadTransform: false,
};

const neckNode = warpSpecToDeformerNode(neckSpec);

assert(Array.isArray(neckNode.baseGrid), 'Stage 1: node.baseGrid is plain Array (not silently []');
assert(neckNode.baseGrid.length === NECK_BASE_GRID.length,
  'Stage 1: node.baseGrid length matches input');
assertEq(neckNode.baseGrid[0], NECK_BASE_GRID[0], 'Stage 1: baseGrid[0] preserved');
assertEq(neckNode.baseGrid[5], NECK_BASE_GRID[5], 'Stage 1: baseGrid[5] preserved');

assert(Array.isArray(neckNode.keyforms[0].positions),
  'Stage 1: keyform[-30].positions is plain Array');
assert(neckNode.keyforms[0].positions.length === NECK_KF_NEG30.length,
  'Stage 1: keyform[-30].positions length matches input');
assertEq(neckNode.keyforms[0].positions[0], NECK_KF_NEG30[0],
  'Stage 1: keyform[-30].positions[0] preserved');

assert(Array.isArray(neckNode.bindings[0].keys),
  'Stage 1: binding.keys is plain Array');
assertEq(neckNode.bindings[0].keys.length, 3, 'Stage 1: 3 binding keys');
assertEq(neckNode.bindings[0].keys[0], -30, 'Stage 1: binding.keys[0] preserved');

// ── Stage 2: project.nodes → synthesizeModifierStacks → modifier.data ──

const project = {
  nodes: [
    // Parent of NeckWarp in the chain
    { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
      parent: null, name: 'BodyXWarp',
      gridSize: { rows: 4, cols: 4 }, baseGrid: NECK_BASE_GRID, // ok to share
      localFrame: 'canvas-px',
      bindings: [], keyforms: [{ keyTuple: [], positions: Array.from(NECK_BASE_GRID), opacity: 1 }],
      visible: true,
    },
    neckNode,
    // A part with NeckWarp as its chain leaf (post-M4: authoring
    // writes the leaf into modifiers[0], not rigParent).
    { id: 'partA', type: 'part', name: 'neck part', modifiers: [
      { type: 'warp', deformerId: 'NeckWarp', enabled: true, mode: 7, showInEditor: true },
    ] },
  ],
};

upsertDeformerNode(project.nodes, neckNode); // idempotent — already there
synthesizeModifierStacks(project);

const partA = project.nodes.find((n) => n.id === 'partA');
assert(Array.isArray(partA.modifiers), 'Stage 2: partA has modifiers stack');
assertEq(partA.modifiers.length, 2, 'Stage 2: stack walks NeckWarp → BodyXWarp');
assertEq(partA.modifiers[0].deformerId, 'NeckWarp', 'Stage 2: leaf is NeckWarp');
assertEq(partA.modifiers[1].deformerId, 'BodyXWarp', 'Stage 2: outermost is BodyXWarp');

const modData = partA.modifiers[0].data;
assert(modData != null, 'Stage 2: modifier.data populated');
assert(Array.isArray(modData.baseGrid),
  'Stage 2: modifier.data.baseGrid is plain Array');
assertEq(modData.baseGrid.length, NECK_BASE_GRID.length,
  'Stage 2: modifier.data.baseGrid length matches');
assertEq(modData.keyforms.length, 3, 'Stage 2: modifier.data has 3 keyforms');
assertEq(modData.keyforms[0].positions.length, NECK_KF_NEG30.length,
  'Stage 2: modifier.data keyform positions length matches');
assertEq(modData.keyforms[0].positions[0], NECK_KF_NEG30[0],
  'Stage 2: modifier.data keyform positions[0] preserved');

// ── Stage 3: synthesizeDeformerNodesForExport produces non-empty data ──

resetSynthFlare();
const synth = synthesizeDeformerNodesForExport(project, { suppressFlare: true });

const synthNeck = synth.find((n) => n.id === 'NeckWarp');
assert(!!synthNeck, 'Stage 3: synth has NeckWarp');
assertEq(synthNeck.parent, 'BodyXWarp', 'Stage 3: synth NeckWarp parent = BodyXWarp');
assert(Array.isArray(synthNeck.baseGrid),
  'Stage 3: synth NeckWarp.baseGrid is plain Array');
assertEq(synthNeck.baseGrid.length, NECK_BASE_GRID.length,
  'Stage 3: synth NeckWarp.baseGrid length matches original');
assertEq(synthNeck.keyforms.length, 3, 'Stage 3: synth NeckWarp has 3 keyforms');
assertEq(synthNeck.keyforms[0].positions.length, NECK_KF_NEG30.length,
  'Stage 3: synth NeckWarp keyform positions length matches');

// ── Stage 4: bbox of synth.baseGrid is non-degenerate ───────────────

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < synthNeck.baseGrid.length; i += 2) {
  const x = synthNeck.baseGrid[i], y = synthNeck.baseGrid[i + 1];
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
assert(Number.isFinite(minX) && Number.isFinite(maxX),
  'Stage 4: bbox X is finite (not the [Infinity,-Infinity] → null bug)');
assert(Number.isFinite(minY) && Number.isFinite(maxY),
  'Stage 4: bbox Y is finite');
assert(maxX > minX && maxY > minY, 'Stage 4: bbox has positive extent');
assertEq(minX, 100, 'Stage 4: bbox minX = 100 (matches NECK_BASE_GRID)');
assertEq(maxX, 500, 'Stage 4: bbox maxX = 500');

// ── Stage 5: defensive — coerced data survives JSON roundtrip ────────

const json = JSON.stringify(project);
const loaded = JSON.parse(json);
const loadedNeck = loaded.nodes.find((n) => n.id === 'NeckWarp');
assert(Array.isArray(loadedNeck.baseGrid),
  'Stage 5: post-JSON-roundtrip baseGrid is Array');
assertEq(loadedNeck.baseGrid.length, NECK_BASE_GRID.length,
  'Stage 5: post-JSON-roundtrip baseGrid length preserved');
assertEq(loadedNeck.keyforms[0].positions[0], NECK_KF_NEG30[0],
  'Stage 5: post-JSON-roundtrip keyform positions preserved');

// ── Summary ───────────────────────────────────────────────────────

console.log(`neckWarpFloat64Pipeline: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
