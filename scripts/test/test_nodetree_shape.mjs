// Phase N-1 — NodeTree datablock shape tests.
//
// Pins the type hierarchy (Socket / Node / Link / NodeTree) and the
// helper API (makeNodeTree, addNodeToTree, addLinkToTree, findNode,
// removeNodeFromTree, topoOrderTree).
//
// Run: node scripts/test/test_nodetree_shape.mjs

import {
  SocketType, SocketInOut, NodeTreeType,
  makeNodeTree, addNodeToTree, addLinkToTree,
  findNode, removeNodeFromTree, topoOrderTree,
} from '../../src/anim/nodetree/types.js';
import {
  NODE_TYPES, registerNodeType, getNodeType,
  buildSocketsFromDeclarations,
} from '../../src/anim/nodetree/registry.js';

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

// ---- Enum sanity ----

assertEq(SocketType.VALUE,     'value',     'SocketType.VALUE');
assertEq(SocketType.MESH,      'mesh',      'SocketType.MESH');
assertEq(SocketInOut.INPUT,    'input',     'SocketInOut.INPUT');
assertEq(SocketInOut.OUTPUT,   'output',    'SocketInOut.OUTPUT');
assertEq(NodeTreeType.RIG,     'rig',       'NodeTreeType.RIG');
assertEq(NodeTreeType.DRIVER,  'driver',    'NodeTreeType.DRIVER');

// ---- makeNodeTree ----

{
  const t = makeNodeTree('rig:face', NodeTreeType.RIG, { partId: 'face' });
  assertEq(t.id, 'rig:face', 'tree id');
  assertEq(t.type, 'rig', 'tree type');
  assertEq(t.partId, 'face', 'tree partId');
  assertEq(t.nodes, [], 'tree nodes []');
  assertEq(t.links, [], 'tree links []');
}

// ---- addNodeToTree + findNode ----

{
  const t = makeNodeTree('t1', NodeTreeType.RIG);
  const n1 = { id: 'a', typeId: 'PartInput', inputs: [], outputs: [] };
  addNodeToTree(t, n1);
  assertEq(t.nodes.length, 1, 'addNodeToTree: nodes length 1');
  assert(findNode(t, 'a') === n1, 'findNode: hit');
  assert(findNode(t, 'missing') === null, 'findNode: miss');
}

// ---- addLinkToTree dedups ----

{
  const t = makeNodeTree('t2', NodeTreeType.RIG);
  const link = { fromNode: 'a', fromSocket: 'p', toNode: 'b', toSocket: 'p' };
  assert(addLinkToTree(t, link) === true, 'addLinkToTree: first add returns true');
  assert(addLinkToTree(t, { ...link }) === false, 'addLinkToTree: dedup returns false');
  assertEq(t.links.length, 1, 'addLinkToTree: only 1 link stored');
}

// ---- removeNodeFromTree drops links too ----

{
  const t = makeNodeTree('t3', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'a', typeId: 'PartInput', inputs: [], outputs: [] });
  addNodeToTree(t, { id: 'b', typeId: 'WarpModifier', inputs: [], outputs: [] });
  addNodeToTree(t, { id: 'c', typeId: 'PartOutput', inputs: [], outputs: [] });
  addLinkToTree(t, { fromNode: 'a', fromSocket: 'p', toNode: 'b', toSocket: 'p' });
  addLinkToTree(t, { fromNode: 'b', fromSocket: 'p', toNode: 'c', toSocket: 'p' });
  assert(removeNodeFromTree(t, 'b'), 'removeNodeFromTree: returns true on hit');
  assertEq(t.nodes.length, 2, 'remove: nodes length 2');
  assertEq(t.links.length, 0, 'remove: incident links dropped (a→b, b→c)');
  assert(!removeNodeFromTree(t, 'missing'), 'removeNodeFromTree: miss returns false');
}

// ---- topoOrderTree: linear chain ----

{
  const t = makeNodeTree('t4', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'a', typeId: 'PartInput', inputs: [], outputs: [] });
  addNodeToTree(t, { id: 'b', typeId: 'WarpModifier', inputs: [], outputs: [] });
  addNodeToTree(t, { id: 'c', typeId: 'PartOutput', inputs: [], outputs: [] });
  // Insert links in REVERSE order to confirm topo doesn't rely on insertion order.
  addLinkToTree(t, { fromNode: 'b', fromSocket: 'p', toNode: 'c', toSocket: 'p' });
  addLinkToTree(t, { fromNode: 'a', fromSocket: 'p', toNode: 'b', toSocket: 'p' });
  const order = topoOrderTree(t).map((n) => n.id);
  assertEq(order, ['a', 'b', 'c'], 'topo order: a → b → c (sources first)');
}

// ---- topoOrderTree: cycle tolerance ----

{
  const t = makeNodeTree('t5', NodeTreeType.RIG);
  addNodeToTree(t, { id: 'x', typeId: 'WarpModifier', inputs: [], outputs: [] });
  addNodeToTree(t, { id: 'y', typeId: 'WarpModifier', inputs: [], outputs: [] });
  addLinkToTree(t, { fromNode: 'x', fromSocket: 'p', toNode: 'y', toSocket: 'p' });
  addLinkToTree(t, { fromNode: 'y', fromSocket: 'p', toNode: 'x', toSocket: 'p' });
  const order = topoOrderTree(t).map((n) => n.id);
  assertEq(order.length, 2, 'cycle: still produces all nodes');
  // Both nodes appear; their relative order is implementation-defined.
}

// ---- Registry: PartInput / PartOutput / Warp / Rotation registered ----

assert(getNodeType('PartInput')  != null, 'registry: PartInput registered');
assert(getNodeType('PartOutput') != null, 'registry: PartOutput registered');
assert(getNodeType('WarpModifier')     != null, 'registry: WarpModifier registered');
assert(getNodeType('RotationModifier') != null, 'registry: RotationModifier registered');
assert(getNodeType('Nonexistent') === null, 'registry: miss returns null');

assertEq(getNodeType('WarpModifier').category, 'rig', 'WarpModifier.category=rig');
assertEq(getNodeType('PartInput').sockets.length, 1, 'PartInput has 1 socket');
assertEq(getNodeType('PartInput').sockets[0].inOut, 'output', 'PartInput socket is output');

// ---- Registering custom type ----

{
  registerNodeType({
    typeId: 'TestCustom', label: 'Test', category: 'common',
    sockets: [
      { identifier: 'in1', name: 'In', type: SocketType.VALUE, inOut: SocketInOut.INPUT },
    ],
    execute: () => 42,
  });
  assertEq(getNodeType('TestCustom').execute(), 42, 'custom type: registered + executable');
}

// ---- buildSocketsFromDeclarations ----

{
  const sockets = buildSocketsFromDeclarations([
    { identifier: 's1', name: 'S1', type: SocketType.VALUE, inOut: SocketInOut.INPUT },
    { identifier: 's2', name: 'S2', type: SocketType.MESH,  inOut: SocketInOut.OUTPUT },
  ]);
  assertEq(sockets.length, 2, 'buildSockets: 2 entries');
  assertEq(sockets[0].identifier, 's1', 'buildSockets: identifier preserved');
  assertEq(sockets[1].inOut, 'output', 'buildSockets: inOut preserved');
}

// ---- Result ----

console.log(`nodetree_shape: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
