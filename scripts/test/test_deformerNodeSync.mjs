// Tests for src/store/deformerNodeSync.js (BFA-006 Phase 1) plus the
// dual-write semantics in faceParallaxStore / bodyWarpStore /
// rigWarpsStore that depend on it.
//
// Run: node scripts/test/test_deformerNodeSync.mjs

import {
  parentSpecToNodeId,
  warpSpecToDeformerNode,
  upsertDeformerNode,
  removeDeformerNodesByPredicate,
  removeFaceParallaxNode,
  removeBodyWarpChainNodes,
  removeRigWarpNodes,
  synthesizeDeformerNodesFromSidetables,
} from '../../src/store/deformerNodeSync.js';

import {
  seedFaceParallax,
  clearFaceParallax,
  serializeFaceParallaxSpec,
} from '../../src/io/live2d/rig/faceParallaxStore.js';
import {
  seedBodyWarpChain,
  clearBodyWarp,
} from '../../src/io/live2d/rig/bodyWarpStore.js';
import {
  seedRigWarps,
  clearRigWarps,
} from '../../src/io/live2d/rig/rigWarpsStore.js';

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

// ── parentSpecToNodeId ────────────────────────────────────────────

{
  assertEq(parentSpecToNodeId(null), null, 'parent: null → null');
  assertEq(parentSpecToNodeId(undefined), null, 'parent: undefined → null');
  assertEq(parentSpecToNodeId({ type: 'root', id: null }), null, 'parent: root → null');
  assertEq(parentSpecToNodeId({ type: 'rotation', id: 'FaceRotation' }), 'FaceRotation', 'parent: rotation → id');
  assertEq(parentSpecToNodeId({ type: 'warp', id: 'BodyXWarp' }), 'BodyXWarp', 'parent: warp → id');
  assertEq(parentSpecToNodeId({ type: 'part', id: 'partA' }), 'partA', 'parent: part → id');
  assertEq(parentSpecToNodeId({ type: 'rotation', id: '' }), null, 'parent: empty id → null');
}

// ── warpSpecToDeformerNode ────────────────────────────────────────

{
  const stored = {
    id: 'FaceParallaxWarp',
    name: 'Face Parallax',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: [0, 1, 2],
    localFrame: 'pivot-relative',
    bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
    keyforms: [{ keyTuple: [-30], positions: [9, 8], opacity: 0.5 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
    _userAuthored: true,
  };
  const node = warpSpecToDeformerNode(stored);
  assertEq(node.type, 'deformer', 'node: type');
  assertEq(node.deformerKind, 'warp', 'node: deformerKind');
  assertEq(node.id, 'FaceParallaxWarp', 'node: id preserved');
  assertEq(node.parent, 'FaceRotation', 'node: parent flattened');
  assertEq(node.gridSize, { rows: 5, cols: 5 }, 'node: gridSize');
  assertEq(node.baseGrid, [0, 1, 2], 'node: baseGrid copied');
  assert(node.baseGrid !== stored.baseGrid, 'node: baseGrid is a copy (not aliased)');
  assertEq(node.bindings.length, 1, 'node: bindings count');
  assert(node.bindings[0].keys !== stored.bindings[0].keys, 'node: bindings.keys is a copy');
  assertEq(node.keyforms[0].positions, [9, 8], 'node: keyform positions');
  assertEq(node._userAuthored, true, 'node: _userAuthored carried');
  assertEq(node.visible, true, 'node: visible derived from isVisible');
}

{
  const rigWarpStored = {
    id: 'RigWarp_partA', name: 'partA Warp',
    parent: { type: 'warp', id: 'BodyXWarp' },
    targetPartId: 'partA',
    canvasBbox: { minX: 1, minY: 2, W: 100, H: 200 },
    gridSize: { rows: 2, cols: 2 }, baseGrid: [],
    localFrame: 'normalized-0to1',
    bindings: [], keyforms: [{ keyTuple: [], positions: [], opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  const node = warpSpecToDeformerNode(rigWarpStored);
  assertEq(node.targetPartId, 'partA', 'rigWarp node: targetPartId preserved');
  assertEq(node.canvasBbox, { minX: 1, minY: 2, W: 100, H: 200 }, 'rigWarp node: canvasBbox preserved');
  assertEq(node.parent, 'BodyXWarp', 'rigWarp node: parent flattened');
  assert(node._userAuthored === undefined, 'rigWarp node: no _userAuthored when not set');
}

// ── upsertDeformerNode ────────────────────────────────────────────

{
  const nodes = [];
  upsertDeformerNode(nodes, { id: 'A', type: 'deformer', name: 'first' });
  assertEq(nodes.length, 1, 'upsert: appends new node');
  upsertDeformerNode(nodes, { id: 'A', type: 'deformer', name: 'second' });
  assertEq(nodes.length, 1, 'upsert: same id → replaces');
  assertEq(nodes[0].name, 'second', 'upsert: replaced node has new fields');
  upsertDeformerNode(nodes, { id: 'B', type: 'deformer', name: 'two' });
  assertEq(nodes.length, 2, 'upsert: new id → appends');
}

// ── removeDeformerNodesByPredicate ────────────────────────────────

{
  const nodes = [
    { id: 'P1', type: 'part', name: 'part1' },
    { id: 'A',  type: 'deformer', name: 'a' },
    { id: 'P2', type: 'part', name: 'part2' },
    { id: 'B',  type: 'deformer', name: 'b' },
    { id: 'C',  type: 'deformer', name: 'c' },
  ];
  removeDeformerNodesByPredicate(nodes, (n) => n.id === 'B');
  assertEq(nodes.map((n) => n.id), ['P1', 'A', 'P2', 'C'], 'remove: only matching deformer removed');
  // Predicate that never matches non-deformers
  removeDeformerNodesByPredicate(nodes, (n) => n.id === 'P1');
  assertEq(nodes.map((n) => n.id), ['P1', 'A', 'P2', 'C'], 'remove: predicate skipped on non-deformer types');
  // Remove all deformers
  removeDeformerNodesByPredicate(nodes, () => true);
  assertEq(nodes.map((n) => n.id), ['P1', 'P2'], 'remove: drops all deformer nodes');
}

// ── removeFaceParallaxNode / removeBodyWarpChainNodes / removeRigWarpNodes ──

{
  const nodes = [
    { id: 'PartA',           type: 'part' },
    { id: 'FaceParallaxWarp', type: 'deformer', deformerKind: 'warp' },
    { id: 'BodyZWarp',       type: 'deformer', deformerKind: 'warp' },
    { id: 'BodyYWarp',       type: 'deformer', deformerKind: 'warp' },
    { id: 'BreathWarp',      type: 'deformer', deformerKind: 'warp' },
    { id: 'BodyXWarp',       type: 'deformer', deformerKind: 'warp' },
    { id: 'RigWarp_partA',   type: 'deformer', deformerKind: 'warp', targetPartId: 'partA' },
    { id: 'RigWarp_partB',   type: 'deformer', deformerKind: 'warp', targetPartId: 'partB' },
  ];
  removeFaceParallaxNode(nodes);
  assert(!nodes.some((n) => n.id === 'FaceParallaxWarp'), 'removeFP: FP node gone');
  assertEq(nodes.length, 7, 'removeFP: only 1 node removed');

  removeBodyWarpChainNodes(nodes);
  assert(!nodes.some((n) => ['BodyZWarp','BodyYWarp','BreathWarp','BodyXWarp'].includes(n.id)),
    'removeBW: chain nodes all gone');
  assertEq(nodes.length, 3, 'removeBW: 4 nodes removed');

  removeRigWarpNodes(nodes);
  assert(!nodes.some((n) => n.targetPartId), 'removeRW: rigWarp nodes all gone');
  assertEq(nodes.length, 1, 'removeRW: 2 nodes removed');
  assertEq(nodes[0].id, 'PartA', 'removeRW: part untouched');
}

// ── synthesizeDeformerNodesFromSidetables — top-level ─────────────

{
  const project = {
    nodes: [
      { id: 'partA', type: 'part', name: 'hairFront' },
    ],
    faceParallax: {
      id: 'FaceParallaxWarp', name: 'FP',
      parent: { type: 'rotation', id: 'FaceRotation' },
      gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0),
      localFrame: 'pivot-relative',
      bindings: [], keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    },
    bodyWarp: {
      specs: [
        { id: 'BodyZWarp', name: 'BZ', parent: { type: 'root', id: null },
          gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0),
          localFrame: 'canvas-px',
          bindings: [], keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }],
          isVisible: true, isLocked: false, isQuadTransform: false },
      ],
      layout: {}, hasParamBodyAngleX: false, debug: {},
    },
    rigWarps: {
      partA: {
        id: 'RigWarp_partA', name: 'partA Warp',
        parent: { type: 'warp', id: 'BodyXWarp' },
        targetPartId: 'partA',
        canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
        gridSize: { rows: 2, cols: 2 }, baseGrid: new Array(18).fill(0),
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(18).fill(0), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false,
      },
    },
  };
  synthesizeDeformerNodesFromSidetables(project);
  const deformers = project.nodes.filter((n) => n.type === 'deformer').map((n) => n.id);
  assertEq(deformers, ['FaceParallaxWarp', 'BodyZWarp', 'RigWarp_partA'],
    'synthesize: all three sidetables produce deformer nodes');
  const partA = project.nodes.find((n) => n.id === 'partA');
  assertEq(partA.rigParent, 'RigWarp_partA', 'synthesize: parts[partA].rigParent set');
}

// ── Dual-write seedFaceParallax / clearFaceParallax ───────────────

{
  const project = { nodes: [] };
  const spec = {
    id: 'FaceParallaxWarp',
    name: 'FP',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array(72),
    localFrame: 'pivot-relative',
    bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
    keyforms: [{ keyTuple: [0], positions: new Float64Array(72), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  seedFaceParallax(project, spec);
  assert(project.faceParallax !== null, 'dual-write FP: sidetable written');
  const fpNode = project.nodes.find((n) => n.id === 'FaceParallaxWarp');
  assert(!!fpNode, 'dual-write FP: deformer node written');
  assertEq(fpNode.type, 'deformer', 'dual-write FP: node type');
  assertEq(fpNode.deformerKind, 'warp', 'dual-write FP: node deformerKind');

  clearFaceParallax(project);
  assert(project.faceParallax === null, 'dual-write FP: clear nullifies sidetable');
  assert(!project.nodes.some((n) => n.id === 'FaceParallaxWarp'),
    'dual-write FP: clear removes deformer node');
}

{
  // Re-seeding overwrites; doesn't accumulate duplicates.
  const project = { nodes: [] };
  const spec = {
    id: 'FaceParallaxWarp', name: 'FP',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
    localFrame: 'pivot-relative',
    bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  seedFaceParallax(project, spec);
  seedFaceParallax(project, spec);
  const count = project.nodes.filter((n) => n.id === 'FaceParallaxWarp').length;
  assertEq(count, 1, 'dual-write FP: re-seed does not duplicate node');
}

{
  // No nodes array → seed falls through silently (skip dual-write).
  const project = {};
  const spec = {
    id: 'FaceParallaxWarp', name: 'FP',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
    localFrame: 'pivot-relative',
    bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  seedFaceParallax(project, spec);
  assert(project.faceParallax !== null, 'no-nodes-FP: sidetable still written');
  // No throw, no nodes mutation.
}

// ── Dual-write seedBodyWarpChain / clearBodyWarp ─────────────────

{
  const project = { nodes: [] };
  const chain = {
    specs: [
      { id: 'BodyZWarp', name: 'BZ', parent: { type: 'root', id: null },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
      { id: 'BodyYWarp', name: 'BY', parent: { type: 'warp', id: 'BodyZWarp' },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
      { id: 'BreathWarp', name: 'Breath', parent: { type: 'warp', id: 'BodyYWarp' },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
      { id: 'BodyXWarp', name: 'BX', parent: { type: 'warp', id: 'BreathWarp' },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
    ],
    layout: {
      BZ_MIN_X: 0, BZ_MIN_Y: 0, BZ_W: 800, BZ_H: 600,
      BY_MIN: 0, BY_MAX: 1, BR_MIN: 0, BR_MAX: 1, BX_MIN: 0, BX_MAX: 1,
    },
    debug: { HIP_FRAC: 0.45, FEET_FRAC: 0.75, bodyFracSource: 'defaults', spineCfShifts: [] },
  };
  seedBodyWarpChain(project, chain);
  const ids = project.nodes.filter((n) => n.type === 'deformer').map((n) => n.id);
  assertEq(ids, ['BodyZWarp', 'BodyYWarp', 'BreathWarp', 'BodyXWarp'],
    'dual-write BW: all 4 chain nodes written');

  // Re-seed with a 3-spec chain (no BX). Stale BX node should be dropped.
  const shorter = {
    specs: chain.specs.slice(0, 3),
    layout: chain.layout,
    debug: chain.debug,
  };
  seedBodyWarpChain(project, shorter);
  const ids2 = project.nodes.filter((n) => n.type === 'deformer').map((n) => n.id);
  assertEq(ids2, ['BodyZWarp', 'BodyYWarp', 'BreathWarp'],
    'dual-write BW: shorter chain replaces longer; stale BX dropped');

  clearBodyWarp(project);
  assert(project.bodyWarp === null, 'dual-write BW: clear nullifies sidetable');
  assertEq(project.nodes.filter((n) => n.type === 'deformer').length, 0,
    'dual-write BW: clear drops all chain nodes');
}

// ── Dual-write seedRigWarps / clearRigWarps ──────────────────────

{
  const partA = { id: 'partA', type: 'part', name: 'hairFront' };
  const partB = { id: 'partB', type: 'part', name: 'hairBack' };
  const project = { nodes: [partA, partB] };
  const map = new Map([
    ['partA', {
      id: 'RigWarp_partA', name: 'partA Warp',
      parent: { type: 'warp', id: 'BodyXWarp' },
      targetPartId: 'partA',
      canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
      gridSize: { rows: 2, cols: 2 }, baseGrid: new Float64Array(18),
      localFrame: 'normalized-0to1',
      bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(18), opacity: 1 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    }],
    ['partB', {
      id: 'RigWarp_partB', name: 'partB Warp',
      parent: { type: 'warp', id: 'BodyXWarp' },
      targetPartId: 'partB',
      canvasBbox: { minX: 0, minY: 0, W: 50, H: 50 },
      gridSize: { rows: 2, cols: 2 }, baseGrid: new Float64Array(18),
      localFrame: 'normalized-0to1',
      bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(18), opacity: 1 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    }],
  ]);
  seedRigWarps(project, map);
  const deformers = project.nodes.filter((n) => n.type === 'deformer').map((n) => n.id).sort();
  assertEq(deformers, ['RigWarp_partA', 'RigWarp_partB'],
    'dual-write RW: both rigWarp nodes written');
  assertEq(partA.rigParent, 'RigWarp_partA', 'dual-write RW: partA.rigParent set');
  assertEq(partB.rigParent, 'RigWarp_partB', 'dual-write RW: partB.rigParent set');

  // Re-seed with only partA → partB node and partB.rigParent dropped.
  const partAOnly = new Map([['partA', map.get('partA')]]);
  seedRigWarps(project, partAOnly);
  const after = project.nodes.filter((n) => n.type === 'deformer').map((n) => n.id);
  assertEq(after, ['RigWarp_partA'], 'dual-write RW: replace mode drops partB node');

  clearRigWarps(project);
  assertEq(project.rigWarps, {}, 'dual-write RW: clear nullifies sidetable');
  assertEq(project.nodes.filter((n) => n.type === 'deformer').length, 0,
    'dual-write RW: clear drops all rigWarp nodes');
  assertEq(partA.rigParent, null, 'dual-write RW: clear nulls partA.rigParent');
  assertEq(partB.rigParent, null, 'dual-write RW: clear nulls partB.rigParent');
}

// ── Round-trip: synthesize → JSON → parse → identical deformer nodes ──

{
  const project = {
    nodes: [{ id: 'partA', type: 'part', name: 'hair' }],
    faceParallax: serializeFaceParallaxSpec({
      id: 'FaceParallaxWarp', name: 'FP',
      parent: { type: 'rotation', id: 'FaceRotation' },
      gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array([1.5, 2.5, 3.5]),
      localFrame: 'pivot-relative',
      bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
      keyforms: [{ keyTuple: [0], positions: new Float64Array([4, 5, 6]), opacity: 0.7 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    }),
  };
  synthesizeDeformerNodesFromSidetables(project);
  const before = JSON.stringify(project.nodes);
  const after = JSON.stringify(JSON.parse(JSON.stringify(project.nodes)));
  assertEq(before, after, 'round-trip: deformer node JSON.stringify is stable');
  // Specifically: keyform.positions stays a plain array, not coerced
  // through some typed-array.
  const fpNode = JSON.parse(JSON.stringify(project.nodes)).find((n) => n.id === 'FaceParallaxWarp');
  assertEq(fpNode.keyforms[0].positions, [4, 5, 6], 'round-trip: positions preserved as numbers');
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`deformerNodeSync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
