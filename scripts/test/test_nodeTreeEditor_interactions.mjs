// Phase N-5 — NodeTree edit-op tests (drag-add / drag-link / drag-
// remove / undo).
//
// Tests the pure-JS edit operations the React editor calls on user
// gestures. The visual drag/drop layer is a separate UI concern
// tested manually in-browser; these tests pin the data-layer
// contracts.
//
// Run: node scripts/test/test_nodeTreeEditor_interactions.mjs

import {
  addNodeAtPosition, removeNode, addValidatedLink, snapshotTree,
} from '../../src/anim/nodetree/edits.js';
import {
  makeNodeTree, NodeTreeType, findNode,
} from '../../src/anim/nodetree/types.js';
import '../../src/anim/nodetree/nodes/drivers.js';

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

// ---- addNodeAtPosition: ParamInput inserted with sockets ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  const node = addNodeAtPosition(tree, 'ParamInput', [100, 50], {
    storage: { paramId: 'A' },
  });
  assert(node != null, 'add ParamInput: node returned');
  assertEq(node.typeId, 'ParamInput', 'add: typeId set');
  assertEq(node.position, [100, 50], 'add: position carried');
  assert(node.inputs.length === 0, 'add ParamInput: 0 inputs (source node)');
  assertEq(node.outputs.length, 1, 'add ParamInput: 1 output socket');
  assertEq(node.outputs[0].identifier, 'value', 'add: socket identifier copied from registry');
  assertEq(node.storage.paramId, 'A', 'add: storage carried');
  assert(findNode(tree, node.id) === node, 'add: node findable in tree');
}

// ---- addNodeAtPosition: unknown typeId returns null ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  const node = addNodeAtPosition(tree, 'NonexistentType', [0, 0]);
  assert(node === null, 'unknown type: returns null');
  assertEq(tree.nodes.length, 0, 'unknown type: tree unchanged');
}

// ---- addValidatedLink: same type → ok ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput', [0, 0], { id: 'src', storage: { paramId: 'A' } });
  addNodeAtPosition(tree, 'DriverOutput', [200, 0], { id: 'sink', storage: { paramId: 'B' } });
  const result = addValidatedLink(tree, {
    fromNode: 'src', fromSocket: 'value',
    toNode: 'sink', toSocket: 'value',
  });
  assert(result.ok, 'value→value link: ok');
  assertEq(tree.links.length, 1, 'value→value: link added');
}

// ---- addValidatedLink: missing endpoint → reject ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput', [0, 0], { id: 'src', storage: { paramId: 'A' } });
  const result = addValidatedLink(tree, {
    fromNode: 'src', fromSocket: 'value',
    toNode: 'missing', toSocket: 'value',
  });
  assert(!result.ok, 'missing endpoint: rejected');
  assertEq(tree.links.length, 0, 'rejected link: tree unchanged');
}

// ---- addValidatedLink: self-link → reject ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'Math', [0, 0], { id: 'm', storage: { op: 'add' } });
  const result = addValidatedLink(tree, {
    fromNode: 'm', fromSocket: 'value',
    toNode: 'm', toSocket: 'a',
  });
  assert(!result.ok, 'self-link: rejected');
  assertEq(result.reason, 'self-link', 'self-link: reason matches');
}

// ---- addValidatedLink: input-as-source → reject ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'Math', [0, 0], { id: 'a', storage: { op: 'add' } });
  addNodeAtPosition(tree, 'Math', [200, 0], { id: 'b', storage: { op: 'add' } });
  const result = addValidatedLink(tree, {
    fromNode: 'a', fromSocket: 'a',  // 'a' is an INPUT socket, not output
    toNode: 'b', toSocket: 'a',
  });
  assert(!result.ok, 'input-as-source: rejected');
}

// ---- removeNode drops node + incident links ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput',   [0, 0],   { id: 'a', storage: { paramId: 'A' } });
  addNodeAtPosition(tree, 'Math',         [200, 0], { id: 'm', storage: { op: 'multiply' } });
  addNodeAtPosition(tree, 'DriverOutput', [400, 0], { id: 'o', storage: { paramId: 'B' } });
  addValidatedLink(tree, { fromNode: 'a', fromSocket: 'value', toNode: 'm', toSocket: 'a' });
  addValidatedLink(tree, { fromNode: 'm', fromSocket: 'value', toNode: 'o', toSocket: 'value' });
  assertEq(tree.links.length, 2, 'pre-remove: 2 links');
  assert(removeNode(tree, 'm'), 'remove: returns true on hit');
  assertEq(tree.nodes.length, 2, 'remove: 2 nodes left');
  assertEq(tree.links.length, 0, 'remove: incident links dropped');
}

// ---- snapshotTree → mutate → restore ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput', [0, 0], { id: 'a', storage: { paramId: 'A' } });
  const snap = snapshotTree(tree);
  // Mutate.
  addNodeAtPosition(tree, 'Math', [200, 0], { id: 'm', storage: { op: 'add' } });
  removeNode(tree, 'a');
  // Snapshot still has original a, no m.
  assertEq(snap.nodes.length, 1, 'snapshot: captures pre-mutation length');
  assertEq(snap.nodes[0].id, 'a', 'snapshot: captures pre-mutation node a');
}

// ---- Round-trip: add multiple, remove all, end empty ----

{
  const tree = makeNodeTree('t', NodeTreeType.DRIVER);
  addNodeAtPosition(tree, 'ParamInput',   [0, 0],   { id: 'a' });
  addNodeAtPosition(tree, 'Math',         [200, 0], { id: 'm', storage: { op: 'add' } });
  addNodeAtPosition(tree, 'DriverOutput', [400, 0], { id: 'o' });
  addValidatedLink(tree, { fromNode: 'a', fromSocket: 'value', toNode: 'm', toSocket: 'a' });
  addValidatedLink(tree, { fromNode: 'm', fromSocket: 'value', toNode: 'o', toSocket: 'value' });
  removeNode(tree, 'a');
  removeNode(tree, 'm');
  removeNode(tree, 'o');
  assertEq(tree.nodes.length, 0, 'round-trip: all nodes removed');
  assertEq(tree.links.length, 0, 'round-trip: all links removed');
}

// ---- Result ----

console.log(`nodeTreeEditor_interactions: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
