// Phase N-1 — NodeTree eval pass tests.
//
// Validates that `evalNodeTree(tree, ctx)` walks the graph in
// topological order, resolves input sockets via incoming links, and
// dispatches each node's `execute` callback.
//
// Plus: verify that a built RigTree's evaluation reads the depgraph's
// outputs map at the right keys (mirrors what Phase D-3b already
// does, just through the nodetree dispatch).
//
// Run: node scripts/test/test_nodetree_eval.mjs

import {
  makeNodeTree, addNodeToTree, addLinkToTree, NodeTreeType,
} from '../../src/anim/nodetree/types.js';
import { registerNodeType, getNodeType } from '../../src/anim/nodetree/registry.js';
import { evalNodeTree, evalAllRigTrees } from '../../src/anim/nodetree/eval.js';
import { buildRigTreeForPart } from '../../src/anim/nodetree/build.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (got ${JSON.stringify(a)} want ${JSON.stringify(b)})`);
}

// ---- Register synthetic test nodes ----

registerNodeType({
  typeId: 'TestSource', label: 'TestSource', category: 'common',
  sockets: [{ identifier: 'out', name: 'Out', type: 'value', inOut: 'output' }],
  execute: (node) => ({ out: node.storage?.value ?? 0 }),
});

registerNodeType({
  typeId: 'TestAdd', label: 'TestAdd', category: 'common',
  sockets: [
    { identifier: 'a',   name: 'A',   type: 'value', inOut: 'input' },
    { identifier: 'b',   name: 'B',   type: 'value', inOut: 'input', defaultValue: 0 },
    { identifier: 'sum', name: 'Sum', type: 'value', inOut: 'output' },
  ],
  execute: (_node, ctx) => ({
    sum: (ctx.inputs?.a ?? 0) + (ctx.inputs?.b ?? 0),
  }),
});

registerNodeType({
  typeId: 'TestSink', label: 'TestSink', category: 'common',
  sockets: [{ identifier: 'in', name: 'In', type: 'value', inOut: 'input' }],
  execute: (_node, ctx) => ctx.inputs?.in ?? null,
});

// ---- Linear pipeline: source → add → sink ----

{
  const t = makeNodeTree('test', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'src5', typeId: 'TestSource', inputs: [], outputs: [], storage: { value: 5 } });
  addNodeToTree(t, { id: 'src7', typeId: 'TestSource', inputs: [], outputs: [], storage: { value: 7 } });
  addNodeToTree(t, { id: 'add',  typeId: 'TestAdd',
    inputs: [{ identifier: 'a', name: 'A', type: 'value', inOut: 'input' },
             { identifier: 'b', name: 'B', type: 'value', inOut: 'input' }],
    outputs:[{ identifier: 'sum', name: 'Sum', type: 'value', inOut: 'output' }] });
  addNodeToTree(t, { id: 'sink', typeId: 'TestSink',
    inputs: [{ identifier: 'in', name: 'In', type: 'value', inOut: 'input' }],
    outputs: [] });
  addLinkToTree(t, { fromNode: 'src5', fromSocket: 'out', toNode: 'add', toSocket: 'a' });
  addLinkToTree(t, { fromNode: 'src7', fromSocket: 'out', toNode: 'add', toSocket: 'b' });
  addLinkToTree(t, { fromNode: 'add',  fromSocket: 'sum', toNode: 'sink', toSocket: 'in' });
  const out = evalNodeTree(t, {});
  assertEq(out.get('sink'), 12,
    'pipeline: source(5) + source(7) → add → sink = 12');
}

// ---- Default-value fallback for unlinked input ----

{
  const t = makeNodeTree('test2', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'src', typeId: 'TestSource', inputs: [], outputs: [], storage: { value: 10 } });
  addNodeToTree(t, { id: 'add', typeId: 'TestAdd',
    inputs: [
      { identifier: 'a', name: 'A', type: 'value', inOut: 'input' },
      { identifier: 'b', name: 'B', type: 'value', inOut: 'input', defaultValue: 100 },
    ],
    outputs:[{ identifier: 'sum', name: 'Sum', type: 'value', inOut: 'output' }] });
  addLinkToTree(t, { fromNode: 'src', fromSocket: 'out', toNode: 'add', toSocket: 'a' });
  // 'b' is unlinked → defaultValue 100 used.
  const out = evalNodeTree(t, {});
  assertEq(out.get('add'), { sum: 110 },
    'unlinked input: defaultValue 100 used → 10+100=110');
}

// ---- RigTree built from modifier stack evaluates without crashing ----

{
  const part = {
    id: 'face', type: 'part',
    modifiers: [
      { type: 'warp', deformerId: 'BodyXWarp', enabled: true },
    ],
  };
  const tree = buildRigTreeForPart(part);
  // Synthesize a depgraph-like outputs map. WarpModifier reads
  // `${deformerId}/GEOMETRY/GRID_LIFT_TO_PARENT`.
  const depgraphOutputs = new Map();
  depgraphOutputs.set('BodyXWarp/GEOMETRY/GRID_LIFT_TO_PARENT',
    { lifted: new Float64Array([0, 0, 1, 1]), gridSize: { rows: 1, cols: 1 } });
  const out = evalNodeTree(tree, {
    partVertices: new Float32Array([0.5, 0.5]),
    depgraphOutputs,
  });
  // PartInput emits partVertices; WarpModifier reads from depgraphOutputs.
  const inputOut = out.get('face__input');
  assert(inputOut instanceof Float32Array,
    'RigTree eval: PartInput emitted partVertices');
  const warpOut = out.get('face__mod_0');
  assert(warpOut?.lifted instanceof Float64Array,
    'RigTree eval: WarpModifier read depgraph output');
}

// ---- evalAllRigTrees: per-part outputs ----

{
  const project = {
    nodes: [
      { id: 'face', type: 'part', modifiers: [] },
      { id: 'shirt', type: 'part', modifiers: [] },
    ],
    nodeTrees: {
      rig: {
        face: buildRigTreeForPart({
          id: 'face', type: 'part', modifiers: [],
        }),
        shirt: buildRigTreeForPart({
          id: 'shirt', type: 'part', modifiers: [],
        }),
      },
    },
  };
  const partVerts = {
    face:  new Float32Array([1, 1]),
    shirt: new Float32Array([2, 2]),
  };
  const out = evalAllRigTrees(project, { partVertices: partVerts });
  assertEq(Array.from(out.get('face') ?? []), [1, 1],
    'evalAllRigTrees: face output = its partVertices (empty stack passthrough)');
  assertEq(Array.from(out.get('shirt') ?? []), [2, 2],
    'evalAllRigTrees: shirt output = its partVertices (empty stack passthrough)');
}

// ---- Cycle tolerance: eval doesn't infinite-loop ----

{
  const t = makeNodeTree('cyc', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'a', typeId: 'TestAdd',
    inputs: [{ identifier: 'a', name: 'A', type: 'value', inOut: 'input' }],
    outputs:[{ identifier: 'sum', name: 'Sum', type: 'value', inOut: 'output' }] });
  addNodeToTree(t, { id: 'b', typeId: 'TestAdd',
    inputs: [{ identifier: 'a', name: 'A', type: 'value', inOut: 'input' }],
    outputs:[{ identifier: 'sum', name: 'Sum', type: 'value', inOut: 'output' }] });
  addLinkToTree(t, { fromNode: 'a', fromSocket: 'sum', toNode: 'b', toSocket: 'a' });
  addLinkToTree(t, { fromNode: 'b', fromSocket: 'sum', toNode: 'a', toSocket: 'a' });
  const out = evalNodeTree(t, {});
  assert(out.size >= 2, 'cycle tolerance: produced outputs for both nodes');
}

// ---- Result ----

console.log(`nodetree_eval: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
