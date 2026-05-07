// Phase N-4 — NodeTree visual layout (read-only) tests.
//
// We can't render JSX in Node without a React renderer, so we test
// the pure-JS layout module that drives the visual editor. The
// editor renders SVG over the same `nodes` + `links` shapes, so if
// the layout is correct + bounds are sensible, render correctness
// follows.
//
// Run: node scripts/test/test_nodeTreeEditor_renderRead.mjs

import { layoutTree, layoutBounds } from '../../src/v3/editors/nodetree/nodeLayout.js';
import { buildRigTreeForPart } from '../../src/anim/nodetree/build.js';
import { compileDriverTree } from '../../src/anim/nodetree/driverCompile.js';
import { compileAnimationTree } from '../../src/anim/nodetree/animationCompile.js';
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

// ---- Empty tree → empty layout ----

{
  const layout = layoutTree(null);
  assertEq(layout.nodes.length, 0, 'null tree → 0 nodes');
  assertEq(layout.links.length, 0, 'null tree → 0 links');
}

// ---- RigTree linear chain layout ----

{
  const part = {
    id: 'face', type: 'part',
    modifiers: [
      { type: 'warp', deformerId: 'BodyXWarp', enabled: true },
      { type: 'warp', deformerId: 'BodyWarpZ', enabled: true },
    ],
  };
  const tree = buildRigTreeForPart(part);
  const layout = layoutTree(tree);
  assertEq(layout.nodes.length, 4,
    'RigTree 2-mod: 4 layout rects (input + 2 mods + output)');
  assertEq(layout.links.length, 3,
    'RigTree 2-mod: 3 links (input→mod0→mod1→output)');
  // Every node has a position.
  for (const n of layout.nodes) {
    assert(typeof n.x === 'number' && typeof n.y === 'number',
      `${n.id}: x/y are numbers`);
    assert(n.w > 0 && n.h > 0, `${n.id}: positive width/height`);
  }
  // Every link has a Bézier path.
  for (const l of layout.links) {
    assert(typeof l.d === 'string' && l.d.startsWith('M '),
      `link ${l.fromNode}→${l.toNode}: d= path emitted`);
  }
  // Bounds reasonable.
  const bounds = layoutBounds(layout);
  assert(bounds.maxX > bounds.minX,
    'bounds: width > 0');
  assert(bounds.maxY >= bounds.minY,
    'bounds: height ≥ 0');
}

// ---- DriverTree compile → renderable layout ----

{
  const driver = {
    type: 'scripted', expression: '(a + b) / 2',
    variables: [
      { name: 'a', target: { rnaPath: "objects['__params__'].values['A']" } },
      { name: 'b', target: { rnaPath: "objects['__params__'].values['B']" } },
    ],
  };
  const tree = compileDriverTree('Avg', driver);
  const layout = layoutTree(tree);
  assert(layout.nodes.length >= 4,
    'DriverTree (a+b)/2: ≥4 nodes (a, b, +, /, /2-const, output)');
  // Sources (zero-input nodes) start at column 0.
  const sources = tree.nodes.filter((n) => (n.inputs?.length ?? 0) === 0);
  for (const src of sources) {
    const rect = layout.nodes.find((r) => r.id === src.id);
    // Sources get the lowest x positions (or equal to their stored
    // position if any). At minimum they are valid layout entries.
    assert(rect != null, `source ${src.id} placed in layout`);
  }
}

// ---- AnimationTree compile → layout ----

{
  const anim = {
    id: 'idle',
    tracks: [
      { paramId: 'P1', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 1 }] },
      { paramId: 'P2', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 1 }] },
    ],
  };
  const tree = compileAnimationTree(anim);
  const layout = layoutTree(tree);
  assertEq(layout.nodes.length, 3,
    'AnimationTree 2-track: 3 layout rects (2 strips + output)');
}

// ---- Empty modifier stack still renders (PartInput → PartOutput) ----

{
  const part = { id: 'rogue', type: 'part', modifiers: [] };
  const tree = buildRigTreeForPart(part);
  const layout = layoutTree(tree);
  assertEq(layout.nodes.length, 2,
    'empty stack: 2 layout rects (PartInput + PartOutput)');
  assertEq(layout.links.length, 1,
    'empty stack: 1 link directly bridging input → output');
}

// ---- Result ----

console.log(`nodeTreeEditor_renderRead: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
