// Phase D-3a — Audit Gap D pin: modifier-stack iteration order
// is leaf-first.
//
// Stack `[RigWarp, BodyXWarp, BreathWarp, BodyYWarp, BodyZWarp]` —
// the leaf (innermost / closest to the part) is index 0; the root
// (outermost / canvas-frame ancestor) is the last entry. The
// GEOMETRY_EVAL_DEFORMED kernel must iterate index 0 → last so that
// each modifier's deformVerts sees positions already pushed forward
// by all leaf-side modifiers.
//
// This matches both:
//   - Blender's `mesh_calc_modifiers` walking `md = next` from the
//     ListBase head (`reference/blender/source/blender/blenkernel/intern/DerivedMesh.cc`).
//   - SS's chainEval which walks meshSpec.parent → parent.parent ...
//     (chainEval.js:228+) — leaf-first composition.
//
// Run: node scripts/test/test_modifierIterationOrder.mjs

import { kernelGeometryEvalDeformed } from '../../src/anim/depgraph/kernels/geometry.js';
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

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- Stack iteration order via direct kernel invocation ----

{
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp' },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp' },
      { id: 'RigWarp_face', type: 'deformer', deformerKind: 'warp' },
      { id: 'face', type: 'part',
        mesh: { vertices: [10, 20], uvs: [], triangles: [] },
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face', enabled: true },
          { type: 'warp', deformerId: 'BodyXWarp',    enabled: true },
          { type: 'warp', deformerId: 'BreathWarp',   enabled: true },
          { type: 'warp', deformerId: 'BodyWarpY',    enabled: true },
          { type: 'warp', deformerId: 'BodyWarpZ',    enabled: true },
        ] },
    ],
    parameters: [], animations: [], physicsRules: [],
  };

  // Synthesize an op-like shape for direct kernel test.
  const op = /** @type {any} */ ({
    owner: { owner: { idRef: 'face' }, type: NodeType.GEOMETRY },
  });
  const ctx = {
    project,
    time: 0,
    paramOverrides: new Map(),
    outputs: new Map(),
  };
  const result = kernelGeometryEvalDeformed(op, ctx);
  const trace = result?.modifierTrace ?? [];
  assertEq(trace.length, 5, 'all 5 modifiers visited');
  assertEq(trace[0].deformerId, 'RigWarp_face',
    'AUDIT-GAP-D: leaf (modifiers[0]) iterates first → RigWarp_face');
  assertEq(trace[1].deformerId, 'BodyXWarp',  'leaf+1 = BodyXWarp');
  assertEq(trace[2].deformerId, 'BreathWarp', 'leaf+2 = BreathWarp');
  assertEq(trace[3].deformerId, 'BodyWarpY',  'leaf+3 = BodyWarpY');
  assertEq(trace[4].deformerId, 'BodyWarpZ',
    'AUDIT-GAP-D: root (modifiers[N-1]) iterates last → BodyWarpZ');
  assert(trace.every((t) => t.applied), 'all modifiers applied');
}

// ---- Disabled modifier excluded; iteration continues ----

{
  const project = {
    canvas: { width: 800, height: 600 },
    nodes: [
      { id: 'A', type: 'deformer', deformerKind: 'warp' },
      { id: 'B', type: 'deformer', deformerKind: 'warp' },
      { id: 'C', type: 'deformer', deformerKind: 'warp' },
      { id: 'face', type: 'part',
        mesh: { vertices: [0, 0], uvs: [], triangles: [] },
        modifiers: [
          { type: 'warp', deformerId: 'A', enabled: true },
          { type: 'warp', deformerId: 'B', enabled: false },
          { type: 'warp', deformerId: 'C', enabled: true },
        ] },
    ],
    parameters: [], animations: [], physicsRules: [],
  };
  const op = /** @type {any} */ ({
    owner: { owner: { idRef: 'face' }, type: NodeType.GEOMETRY },
  });
  const ctx = { project, time: 0, paramOverrides: new Map(), outputs: new Map() };
  const result = kernelGeometryEvalDeformed(op, ctx);
  const trace = result?.modifierTrace ?? [];
  assertEq(trace.map((t) => `${t.deformerId}/${t.applied}`),
    ['A/true', 'B/false', 'C/true'],
    'disabled middle: visited but not applied; A and C applied');
  assertEq(trace[1].reason, 'mode-gated',
    'disabled modifier reason = mode-gated');
}

// ---- Through full depgraph eval (smoke + topology) ----

{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [
      { id: 'ParamBodyAngleZ', default: 0 },
      { id: 'ParamBreath', default: 0 },
    ],
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null,
        bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-30, 0, 30] }],
        keyforms: [
          { keyTuple: [-30], positions: [], opacity: 1 },
          { keyTuple: [0], positions: [], opacity: 1 },
          { keyTuple: [30], positions: [], opacity: 1 },
        ] },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ',
        bindings: [{ parameterId: 'ParamBreath', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], positions: [], opacity: 1 },
          { keyTuple: [1], positions: [], opacity: 1 },
        ] },
      { id: 'face', type: 'part',
        mesh: { vertices: [0, 0], uvs: [], triangles: [] },
        rigParent: 'BreathWarp',
        modifiers: [
          { type: 'warp', deformerId: 'BreathWarp', enabled: true },
          { type: 'warp', deformerId: 'BodyWarpZ',  enabled: true },
        ] },
    ],
    animations: [], physicsRules: [],
  };
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0 });
  // GEOMETRY_EVAL_DEFORMED ran for face.
  let foundGeom = false;
  for (const [name, value] of ctx.outputs) {
    if (name.includes('face/GEOMETRY/GEOMETRY_EVAL_DEFORMED')) {
      foundGeom = value !== undefined;
      assertEq(value?.modifierTrace?.length, 2, 'face: 2 modifiers traced');
      assertEq(value?.modifierTrace?.[0].deformerId, 'BreathWarp',
        'face leaf = BreathWarp (modifiers[0])');
      assertEq(value?.modifierTrace?.[1].deformerId, 'BodyWarpZ',
        'face root = BodyWarpZ (modifiers[1])');
    }
  }
  assert(foundGeom, 'GEOMETRY_EVAL_DEFORMED ran end-to-end via depgraph');
}

// ---- Result ----

console.log(`modifierIterationOrder: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
