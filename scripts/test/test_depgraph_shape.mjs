// Phase D-1 — DepGraph shape tests. Verifies the type hierarchy
// (Node / IDNode / ComponentNode / OperationNode / Relation /
// DepGraph) and the basic add/find APIs.
//
// Run: node scripts/test/test_depgraph_shape.mjs

import {
  DepGraph,
  IDNode,
  ComponentNode,
  OperationNode,
  Relation,
  Node,
  NodeType,
  NodeClass,
  OperationCode,
  RelationFlag,
} from '../../src/anim/depgraph/types.js';

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

// ---- enum sanity ----

assertEq(NodeType.OPERATION, 'OPERATION', 'NodeType.OPERATION');
assertEq(NodeClass.OPERATION, 'OPERATION', 'NodeClass.OPERATION');
assertEq(OperationCode.TIME_TICK, 'TIME_TICK', 'OperationCode.TIME_TICK');
assertEq(RelationFlag.CYCLIC, 1, 'RelationFlag.CYCLIC bit 0');
assertEq(RelationFlag.GODMODE, 1 << 4, 'RelationFlag.GODMODE bit 4');

// ---- Node ----

{
  const n = new Node('foo', NodeType.UNDEFINED);
  assertEq(n.name, 'foo', 'Node.name set');
  assertEq(n.type, 'UNDEFINED', 'Node.type set');
  assert(Array.isArray(n.inlinks) && n.inlinks.length === 0, 'Node.inlinks []');
  assert(Array.isArray(n.outlinks) && n.outlinks.length === 0, 'Node.outlinks []');
  assertEq(n.customFlags, 0, 'Node.customFlags 0');
  assertEq(n.getClass(), 'GENERIC', 'Node.getClass GENERIC');
}

// ---- IDNode add/findComponent ----

{
  const id = new IDNode('part-A', 'part');
  assertEq(id.idRef, 'part-A', 'IDNode.idRef');
  assertEq(id.idType, 'part', 'IDNode.idType');
  const c1 = id.addComponent(NodeType.GEOMETRY);
  const c2 = id.addComponent(NodeType.GEOMETRY); // idempotent
  assert(c1 === c2, 'IDNode.addComponent idempotent');
  assert(id.findComponent(NodeType.GEOMETRY) === c1, 'IDNode.findComponent hit');
  assert(id.findComponent(NodeType.PARAMETERS) === null, 'IDNode.findComponent miss');
  // Distinct subname → distinct components.
  const c3 = id.addComponent(NodeType.GEOMETRY, 'sub');
  assert(c3 !== c1, 'addComponent distinct subname → distinct comp');
}

// ---- ComponentNode add/findOperation ----

{
  const id = new IDNode('part-A', 'part');
  const comp = id.addComponent(NodeType.GEOMETRY);
  const op1 = comp.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
  const op2 = comp.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED); // idempotent
  assert(op1 === op2, 'addOperation idempotent');
  assertEq(op1.opcode, 'GEOMETRY_EVAL_DEFORMED', 'op.opcode');
  assertEq(op1.tag, '', 'op.tag default empty');
  assert(op1.evaluate == null, 'op.evaluate null by default');
  assert(op1.isNoop(), 'op.isNoop true when evaluate null');
  // Re-add with a callback should attach it.
  const fn = (_ctx) => 42;
  const op3 = comp.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED, '', fn);
  assert(op3 === op1, 'addOperation with cb returns same op');
  assert(op3.evaluate === fn, 'addOperation with cb attaches it');
  assert(!op3.isNoop(), 'op.isNoop false when evaluate set');
}

// ---- Relation + DepGraph addRelation ----

{
  const g = new DepGraph();
  const a = g.addIdNode('a', 'deformer');
  const b = g.addIdNode('b', 'deformer');
  const ag = a.addComponent(NodeType.GEOMETRY);
  const bg = b.addComponent(NodeType.GEOMETRY);
  const aOp = ag.addOperation(OperationCode.KEYFORM_EVAL);
  const bOp = bg.addOperation(OperationCode.KEYFORM_EVAL);
  const r = g.addRelation(aOp, bOp, 'a -> b');
  assert(r instanceof Relation, 'addRelation returns Relation');
  assert(r.from === aOp && r.to === bOp, 'Relation endpoints');
  assertEq(r.flag, 0, 'Relation.flag default 0');
  assert(aOp.outlinks[0] === r && bOp.inlinks[0] === r,
    'Relation referenced by both endpoints');
  assertEq(g.relations.length, 1, 'graph.relations length');

  // Idempotent: same name+endpoints → same relation.
  const r2 = g.addRelation(aOp, bOp, 'a -> b');
  assert(r2 === r, 'addRelation idempotent on (from,to,name)');
  assertEq(g.relations.length, 1, 'no duplicate relation added');

  // Different name → new relation.
  const r3 = g.addRelation(aOp, bOp, 'a -> b alt');
  assert(r3 !== r, 'addRelation different name → new relation');
  assertEq(g.relations.length, 2, 'two relations now');
}

// ---- DepGraph addIdNode + findIdNode ----

{
  const g = new DepGraph();
  const a = g.addIdNode('shelby', 'part');
  const b = g.addIdNode('shelby', 'part');
  assert(a === b, 'addIdNode idempotent on (idRef, idType)');
  const c = g.addIdNode('shelby', 'deformer');
  assert(c !== a, 'addIdNode distinct idType → distinct node');
  assert(g.findIdNode('shelby', 'part') === a, 'findIdNode hit');
  assert(g.findIdNode('foo', 'part') === null, 'findIdNode miss');
}

// ---- allOperations enumeration ----

{
  const g = new DepGraph();
  const a = g.addIdNode('a', 'deformer');
  const ag = a.addComponent(NodeType.GEOMETRY);
  ag.addOperation(OperationCode.KEYFORM_EVAL);
  ag.addOperation(OperationCode.GRID_LIFT_TO_PARENT);
  const b = g.addIdNode('b', 'part');
  const bg = b.addComponent(NodeType.GEOMETRY);
  bg.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
  const ops = g.allOperations();
  assertEq(ops.length, 3, 'allOperations across IDs + components');
  assert(ops.every((op) => op instanceof OperationNode),
    'allOperations elements are OperationNodes');
}

// ---- Result ----

console.log(`depgraph_shape: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
