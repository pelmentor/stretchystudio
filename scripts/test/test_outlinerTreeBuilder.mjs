// v3 Phase 1A.1 - tests for src/v3/editors/outliner/treeBuilder.js
//
// treeBuilder is the outliner's pure data-prep step: project nodes
// → recursive tree, sorted PSD-style (higher draw_order on top).
// Lock the contract before TreeNode.jsx starts depending on it.
//
// Run: node scripts/test/test_outlinerTreeBuilder.mjs

import {
  buildOutlinerTree,
  walkOutlinerTree,
  findOutlinerNode,
  ancestorChain,
} from '../../src/v3/editors/outliner/treeBuilder.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// Convenience: tiny project with three parts and one group.
//
//   root
//   ├── part:back  draw_order=0
//   ├── group:body
//   │   ├── part:torso  draw_order=10
//   │   └── part:head   draw_order=20
//   └── part:front draw_order=30
//
// Expected outliner sort (PSD: higher on top):
//   part:front  (30)
//   group:body  (max child = 20)
//   part:back   (0)
function fixtureNodes() {
  return [
    { id: 'back',  type: 'part',  name: 'back',  parent: null,   draw_order: 0 },
    { id: 'body',  type: 'group', name: 'body',  parent: null },
    { id: 'torso', type: 'part',  name: 'torso', parent: 'body', draw_order: 10 },
    { id: 'head',  type: 'part',  name: 'head',  parent: 'body', draw_order: 20 },
    { id: 'front', type: 'part',  name: 'front', parent: null,   draw_order: 30 },
  ];
}

// ── Empty / invalid input ───────────────────────────────────────────

{
  assert(Array.isArray(buildOutlinerTree([])) && buildOutlinerTree([]).length === 0,
    'empty input → empty array');
  assert(buildOutlinerTree(null).length === 0, 'null input → empty array');
  assert(buildOutlinerTree(undefined).length === 0, 'undefined input → empty array');
}

// ── Hierarchy mode (default) ────────────────────────────────────────

{
  const roots = buildOutlinerTree(fixtureNodes());
  assert(roots.length === 3, 'three root entries');
  assert(roots[0].id === 'front', 'first root is highest draw_order (front)');
  assert(roots[1].id === 'body',  'second root is group sorted by max descendant draw_order');
  assert(roots[2].id === 'back',  'third root is lowest draw_order (back)');

  const body = roots[1];
  assert(body.children.length === 2, 'group has two children');
  assert(body.children[0].id === 'head',  'group child sort: head (20) above');
  assert(body.children[1].id === 'torso', 'group child sort: torso (10) below');
  assert(body.parent === null, 'body parent is null at root');
  assert(body.children[0].parent === 'body', 'head parent points to body');
}

// ── Display mode validation ─────────────────────────────────────────

assertThrows(
  () => buildOutlinerTree(fixtureNodes(), { mode: 'rig' }),
  'mode rig throws — not implemented yet',
);

assertThrows(
  () => buildOutlinerTree(fixtureNodes(), { mode: 'param' }),
  'mode param throws — not implemented yet',
);

assertThrows(
  () => buildOutlinerTree(fixtureNodes(), { mode: 'totally-unknown' }),
  'unknown mode throws',
);

// Explicit hierarchy works
{
  const roots = buildOutlinerTree(fixtureNodes(), { mode: 'hierarchy' });
  assert(roots.length === 3, 'explicit hierarchy mode');
}

// ── Visibility flag ─────────────────────────────────────────────────

{
  const nodes = fixtureNodes();
  nodes.find(n => n.id === 'front').visible = false;
  // torso has no `visible` field at all → default true
  const roots = buildOutlinerTree(nodes);
  const front = roots.find(n => n.id === 'front');
  const torso = findOutlinerNode(roots, 'torso');
  assert(front.visible === false, 'visible:false respected');
  assert(torso.visible === true,  'absent visible field defaults to true');
}

// ── Dangling parent ─────────────────────────────────────────────────

{
  const nodes = [
    ...fixtureNodes(),
    { id: 'orphan', type: 'part', name: 'orphan', parent: 'deleted-group-id', draw_order: 5 },
  ];
  const roots = buildOutlinerTree(nodes);
  // Orphan reparents to root — outliner stays navigable.
  assert(roots.some(n => n.id === 'orphan'), 'orphan reparented to root');
  const orphan = roots.find(n => n.id === 'orphan');
  assert(orphan.parent === null, 'orphan parent set to null');
}

// ── Malformed nodes dropped ─────────────────────────────────────────

{
  const nodes = [
    ...fixtureNodes(),
    null,                                                       // null entry
    { type: 'part', name: 'no-id' },                            // missing id
    { id: 'wrong-type', type: 'foobar', name: 'x', parent: null }, // bad type
    { id: '', type: 'part', name: 'empty-id', parent: null },   // empty id
  ];
  const roots = buildOutlinerTree(nodes);
  // None of the malformed entries appear.
  const ids = [];
  walkOutlinerTree(roots, (n) => { ids.push(n.id); });
  assert(!ids.includes('no-id'),       'missing-id node dropped');
  assert(!ids.includes('wrong-type'),  'wrong-type node dropped');
  assert(!ids.includes(''),            'empty-id node dropped');
}

// ── Cycle handling ──────────────────────────────────────────────────

{
  // a → b → c → a (cycle), plus a clean d at root
  const nodes = [
    { id: 'a', type: 'group', name: 'a', parent: 'c' },
    { id: 'b', type: 'group', name: 'b', parent: 'a' },
    { id: 'c', type: 'group', name: 'c', parent: 'b' },
    { id: 'd', type: 'part',  name: 'd', parent: null, draw_order: 5 },
  ];
  const roots = buildOutlinerTree(nodes);
  // Tree must terminate (no infinite recursion). Either roots include
  // the cycle entry as a leaf, or all cycle nodes are unreachable.
  // Either way, the call returns without hanging and `d` is present.
  assert(Array.isArray(roots), 'cycle: builder returns');
  const ids = [];
  walkOutlinerTree(roots, (n) => { ids.push(n.id); });
  assert(ids.includes('d'), 'cycle: clean nodes still rendered');
}

// ── Deep nesting ────────────────────────────────────────────────────

{
  // Chain g0 → g1 → g2 → g3 → part p
  const nodes = [
    { id: 'g0', type: 'group', name: 'g0', parent: null },
    { id: 'g1', type: 'group', name: 'g1', parent: 'g0' },
    { id: 'g2', type: 'group', name: 'g2', parent: 'g1' },
    { id: 'g3', type: 'group', name: 'g3', parent: 'g2' },
    { id: 'p',  type: 'part',  name: 'p',  parent: 'g3', draw_order: 7 },
  ];
  const roots = buildOutlinerTree(nodes);
  assert(roots.length === 1 && roots[0].id === 'g0', 'deep chain: single g0 root');
  // walk should find all five
  const ids = [];
  walkOutlinerTree(roots, (n) => { ids.push(n.id); });
  assert(ids.length === 5, 'deep chain: all five nodes walked');
  assert(ids[0] === 'g0' && ids[4] === 'p', 'deep chain: depth-first order');
}

// ── walkOutlinerTree depth + shouldDescend ──────────────────────────

{
  const roots = buildOutlinerTree(fixtureNodes());
  /** @type {Array<{id:string, depth:number}>} */
  const visits = [];
  walkOutlinerTree(roots, (n, d) => visits.push({ id: n.id, depth: d }));
  // Order: front (root, depth 0), body (root, 0), head (1), torso (1), back (root, 0).
  assert(visits[0].id === 'front' && visits[0].depth === 0, 'walk: front root');
  const body = visits.find(v => v.id === 'body');
  const head = visits.find(v => v.id === 'head');
  const back = visits.find(v => v.id === 'back');
  assert(body.depth === 0, 'walk: body depth 0');
  assert(head.depth === 1, 'walk: head depth 1');
  assert(back.depth === 0, 'walk: back depth 0');
}

{
  // Collapse predicate skips body's subtree.
  const roots = buildOutlinerTree(fixtureNodes());
  const ids = [];
  walkOutlinerTree(roots, (n) => ids.push(n.id), (n) => n.id !== 'body');
  assert(ids.includes('body'), 'walk skip: body itself visited');
  assert(!ids.includes('head'), 'walk skip: head not visited');
  assert(!ids.includes('torso'), 'walk skip: torso not visited');
  assert(ids.includes('front'), 'walk skip: front still visited');
}

// ── findOutlinerNode ────────────────────────────────────────────────

{
  const roots = buildOutlinerTree(fixtureNodes());
  assert(findOutlinerNode(roots, 'front').id === 'front',  'find: top-level part');
  assert(findOutlinerNode(roots, 'torso').id === 'torso',  'find: nested part');
  assert(findOutlinerNode(roots, 'nope') === null,         'find: missing returns null');
}

// ── ancestorChain ───────────────────────────────────────────────────

{
  const roots = buildOutlinerTree(fixtureNodes());
  assert(JSON.stringify(ancestorChain(roots, 'front')) === '[]',
    'ancestor: top-level → []');
  assert(JSON.stringify(ancestorChain(roots, 'body')) === '[]',
    'ancestor: top-level group → []');
  assert(JSON.stringify(ancestorChain(roots, 'head')) === '["body"]',
    'ancestor: head → [body]');
  assert(JSON.stringify(ancestorChain(roots, 'missing-id')) === '[]',
    'ancestor: missing → []');
}

{
  // Three-deep ancestor chain
  const nodes = [
    { id: 'g0', type: 'group', name: 'g0', parent: null },
    { id: 'g1', type: 'group', name: 'g1', parent: 'g0' },
    { id: 'g2', type: 'group', name: 'g2', parent: 'g1' },
    { id: 'p',  type: 'part',  name: 'p',  parent: 'g2', draw_order: 0 },
  ];
  const roots = buildOutlinerTree(nodes);
  assert(JSON.stringify(ancestorChain(roots, 'p')) === '["g0","g1","g2"]',
    'ancestor: deep chain root→leaf order');
}

// ── Idempotence: two builds produce equal-shape trees ───────────────

{
  const nodes = fixtureNodes();
  const a = buildOutlinerTree(nodes);
  const b = buildOutlinerTree(nodes);
  // Same structure, different objects.
  assert(JSON.stringify(a) === JSON.stringify(b), 'idempotent: same shape');
  assert(a !== b, 'idempotent: different references');
  assert(a[0] !== b[0], 'idempotent: deep different references');
}

// ── Output ──────────────────────────────────────────────────────────

console.log(`outlinerTreeBuilder: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
