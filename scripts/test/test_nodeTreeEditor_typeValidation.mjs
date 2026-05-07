// Phase N-5 — type-validation contract pin.
//
// Verifies that drag-link rejects mismatched-type pairings BEFORE the
// link record is created. No auto-conversion in V2 — the user must
// insert an explicit conversion node. Pinning this contract prevents
// silent corruption from a UI bug (e.g., mesh→value link would crash
// the eval pass if it slipped through).
//
// Run: node scripts/test/test_nodeTreeEditor_typeValidation.mjs

import { validateLink, addValidatedLink, addNodeAtPosition } from '../../src/anim/nodetree/edits.js';
import { makeNodeTree, NodeTreeType, addNodeToTree } from '../../src/anim/nodetree/types.js';
import { registerNodeType } from '../../src/anim/nodetree/registry.js';
import '../../src/anim/nodetree/nodes/drivers.js';
import '../../src/anim/nodetree/nodes/animation.js';

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

// Register a synthetic mesh-emitting node + a value-only sink — we
// need explicit type-mismatched ports to test the validator without
// relying on internal driver/animation node behavior.

registerNodeType({
  typeId: 'TestMeshSource',
  label: 'TestMeshSource',
  category: 'common',
  sockets: [{ identifier: 'mesh', name: 'M', type: 'mesh', inOut: 'output' }],
});

registerNodeType({
  typeId: 'TestValueSink',
  label: 'TestValueSink',
  category: 'common',
  sockets: [{ identifier: 'v', name: 'V', type: 'value', inOut: 'input' }],
});

registerNodeType({
  typeId: 'TestMeshSink',
  label: 'TestMeshSink',
  category: 'common',
  sockets: [{ identifier: 'm', name: 'M', type: 'mesh', inOut: 'input' }],
});

// ---- value→value: accepted ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput',  [0, 0],   { id: 'src', storage: { paramId: 'A' } });
  addNodeAtPosition(tree, 'DriverOutput',[200, 0], { id: 'sink', storage: { paramId: 'B' } });
  const v = validateLink(tree, {
    fromNode: 'src', fromSocket: 'value', toNode: 'sink', toSocket: 'value',
  });
  assert(v.ok, 'value→value: validator accepts');
}

// ---- mesh→mesh: accepted ----

{
  const tree = makeNodeTree('t', NodeTreeType.RIG);
  addNodeAtPosition(tree, 'TestMeshSource', [0, 0],   { id: 'src' });
  addNodeAtPosition(tree, 'TestMeshSink',   [200, 0], { id: 'sink' });
  const v = validateLink(tree, {
    fromNode: 'src', fromSocket: 'mesh', toNode: 'sink', toSocket: 'm',
  });
  assert(v.ok, 'mesh→mesh: validator accepts');
}

// ---- mesh→value: REJECTED (audit pin) ----

{
  const tree = makeNodeTree('t', NodeTreeType.RIG);
  addNodeAtPosition(tree, 'TestMeshSource', [0, 0],   { id: 'src' });
  addNodeAtPosition(tree, 'TestValueSink',  [200, 0], { id: 'sink' });
  const v = validateLink(tree, {
    fromNode: 'src', fromSocket: 'mesh', toNode: 'sink', toSocket: 'v',
  });
  assert(!v.ok, 'mesh→value: REJECTED');
  assert(v.reason.startsWith('type mismatch'),
    `mesh→value: reason carries type-mismatch (got "${v.reason}")`);
}

// ---- addValidatedLink rejects mismatched + leaves tree unchanged ----

{
  const tree = makeNodeTree('t', NodeTreeType.RIG);
  addNodeAtPosition(tree, 'TestMeshSource', [0, 0],   { id: 'src' });
  addNodeAtPosition(tree, 'TestValueSink',  [200, 0], { id: 'sink' });
  const result = addValidatedLink(tree, {
    fromNode: 'src', fromSocket: 'mesh', toNode: 'sink', toSocket: 'v',
  });
  assert(!result.ok, 'mesh→value: addValidatedLink rejects');
  assertEq(tree.links.length, 0,
    'mesh→value: rejected → 0 links in tree (no silent insert)');
}

// ---- Output port mistakenly connected to output: rejected ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput', [0, 0],   { id: 'a', storage: { paramId: 'A' } });
  addNodeAtPosition(tree, 'ParamInput', [200, 0], { id: 'b', storage: { paramId: 'B' } });
  // Trying to connect a's output socket to b's output socket.
  const v = validateLink(tree, {
    fromNode: 'a', fromSocket: 'value', toNode: 'b', toSocket: 'value',
  });
  // 'value' on b is an OUTPUT socket — there's no INPUT socket called
  // 'value' on b, so validator rejects.
  assert(!v.ok, 'output→output: REJECTED (no matching input socket)');
}

// ---- Wrong direction (input as source): rejected ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'Math',         [0, 0], { id: 'm', storage: { op: 'add' } });
  addNodeAtPosition(tree, 'DriverOutput', [200, 0], { id: 'o', storage: { paramId: 'X' } });
  // 'a' is an INPUT socket on Math, not output.
  const v = validateLink(tree, {
    fromNode: 'm', fromSocket: 'a', toNode: 'o', toSocket: 'value',
  });
  assert(!v.ok, 'input-as-source: REJECTED');
}

// ---- Result ----

console.log(`nodeTreeEditor_typeValidation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
