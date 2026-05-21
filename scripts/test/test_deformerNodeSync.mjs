// Tests for src/store/deformerNodeSync.js (BFA-006 Phase 1) plus the
// dual-write semantics in faceParallaxStore / bodyWarpStore /
// rigWarpsStore that depend on it.
//
// Run: node scripts/test/test_deformerNodeSync.mjs

import {
  parentSpecToNodeId,
  warpSpecToDeformerNode,
  rotationSpecToDeformerNode,
  upsertDeformerNode,
  removeDeformerNodesByPredicate,
  removeFaceParallaxNode,
  removeBodyWarpChainNodes,
  removeRigWarpNodes,
  removeAllRotationDeformerNodes,
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
    { id: 'BodyWarpZ',       type: 'deformer', deformerKind: 'warp' },
    { id: 'BodyWarpY',       type: 'deformer', deformerKind: 'warp' },
    { id: 'BreathWarp',      type: 'deformer', deformerKind: 'warp' },
    { id: 'BodyXWarp',       type: 'deformer', deformerKind: 'warp' },
    { id: 'RigWarp_partA',   type: 'deformer', deformerKind: 'warp', targetPartId: 'partA' },
    { id: 'RigWarp_partB',   type: 'deformer', deformerKind: 'warp', targetPartId: 'partB' },
  ];
  removeFaceParallaxNode(nodes);
  assert(!nodes.some((n) => n.id === 'FaceParallaxWarp'), 'removeFP: FP node gone');
  assertEq(nodes.length, 7, 'removeFP: only 1 node removed');

  removeBodyWarpChainNodes(nodes);
  assert(!nodes.some((n) => ['BodyWarpZ','BodyWarpY','BreathWarp','BodyXWarp'].includes(n.id)),
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
  // Phase 5 — seeders EMIT Blender-Lattice objects (+ cage), not legacy
  // `deformer/warp` nodes. The lattice OBJECT reuses the warp id.
  const fpNode = project.nodes.find((n) => n.id === 'FaceParallaxWarp');
  assert(!!fpNode, 'seed FP: lattice object written');
  assertEq(fpNode.type, 'object', 'seed FP: node type');
  assertEq(fpNode.objectKind, 'lattice', 'seed FP: node objectKind');
  // The cage meshData carries the rest control points as vertices.
  const fpCage = project.nodes.find((n) => n.id === 'FaceParallaxWarp__cage');
  assert(!!fpCage && fpCage.type === 'meshData' && fpCage.isLatticeCage === true,
    'seed FP: cage meshData written');
  assertEq(fpNode.dataId, 'FaceParallaxWarp__cage', 'seed FP: object links cage');
  assert(project.faceParallax === undefined, 'seed FP: no legacy sidetable write');

  clearFaceParallax(project);
  assert(!project.nodes.some((n) => n.id === 'FaceParallaxWarp'),
    'clear FP: removes lattice object');
  assert(!project.nodes.some((n) => n.id === 'FaceParallaxWarp__cage'),
    'clear FP: removes orphaned cage meshData');
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
  // No nodes array → seed is a no-op (BFA-006 Phase 6 single-writes
  // to nodes; no legacy sidetable write to fall back on).
  seedFaceParallax(project, spec);
  assert(project.faceParallax === undefined, 'no-nodes-FP: no sidetable write');
  // No throw.
}

// ── Dual-write seedBodyWarpChain / clearBodyWarp ─────────────────

{
  const project = { nodes: [] };
  const chain = {
    specs: [
      { id: 'BodyWarpZ', name: 'BZ', parent: { type: 'root', id: null },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
      { id: 'BodyWarpY', name: 'BY', parent: { type: 'warp', id: 'BodyWarpZ' },
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Float64Array(72),
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Float64Array(72), opacity: 1 }],
        isVisible: true, isLocked: false, isQuadTransform: false },
      { id: 'BreathWarp', name: 'Breath', parent: { type: 'warp', id: 'BodyWarpY' },
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
  // Phase 5 — body warp chain seeds as lattice OBJECTS (+ cages).
  const isLattice = (n) => n.type === 'object' && n.objectKind === 'lattice';
  const ids = project.nodes.filter(isLattice).map((n) => n.id);
  assertEq(ids, ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp'],
    'seed BW: all 4 chain nodes written');
  assertEq(project.nodes.filter((n) => n.type === 'meshData' && n.isLatticeCage).length, 4,
    'seed BW: 4 cage meshData written');
  assert(project.bodyWarpLayout != null, 'seed BW: layout sidetable populated');

  // Re-seed with a 3-spec chain (no BX). Stale BX node + cage should be dropped.
  const shorter = {
    specs: chain.specs.slice(0, 3),
    layout: chain.layout,
    debug: chain.debug,
  };
  seedBodyWarpChain(project, shorter);
  const ids2 = project.nodes.filter(isLattice).map((n) => n.id);
  assertEq(ids2, ['BodyWarpZ', 'BodyWarpY', 'BreathWarp'],
    'seed BW: shorter chain replaces longer; stale BX dropped');
  assert(!project.nodes.some((n) => n.id === 'BodyXWarp__cage'),
    'seed BW: stale BX cage meshData dropped');

  clearBodyWarp(project);
  assert(project.bodyWarpLayout === null, 'clear BW: layout sidetable nulled');
  assertEq(project.nodes.filter(isLattice).length, 0,
    'clear BW: drops all chain nodes');
  assertEq(project.nodes.filter((n) => n.type === 'meshData' && n.isLatticeCage).length, 0,
    'clear BW: drops all chain cages');
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
  // Phase 5 — per-mesh rig warps seed as lattice OBJECTS (+ cages).
  const isLattice = (n) => n.type === 'object' && n.objectKind === 'lattice';
  const deformers = project.nodes.filter(isLattice).map((n) => n.id).sort();
  assertEq(deformers, ['RigWarp_partA', 'RigWarp_partB'],
    'dual-write RW: both rigWarp nodes written');
  assertEq(partA.rigParent, 'RigWarp_partA', 'dual-write RW: partA.rigParent set');
  assertEq(partB.rigParent, 'RigWarp_partB', 'dual-write RW: partB.rigParent set');
  assertEq(project.nodes.filter((n) => n.type === 'meshData' && n.isLatticeCage).length, 2,
    'dual-write RW: 2 cage meshData written');

  // Re-seed with only partA → partB node + cage and partB.rigParent dropped.
  const partAOnly = new Map([['partA', map.get('partA')]]);
  seedRigWarps(project, partAOnly);
  const after = project.nodes.filter(isLattice).map((n) => n.id);
  assertEq(after, ['RigWarp_partA'], 'dual-write RW: replace mode drops partB node');
  assert(!project.nodes.some((n) => n.id === 'RigWarp_partB__cage'),
    'dual-write RW: replace mode drops partB cage meshData');

  clearRigWarps(project);
  assertEq(project.nodes.filter(isLattice).length, 0,
    'clear RW: drops all rigWarp nodes');
  assertEq(project.nodes.filter((n) => n.type === 'meshData' && n.isLatticeCage).length, 0,
    'clear RW: drops all rigWarp cages');
  assertEq(partA.rigParent, null, 'clear RW: nulls partA.rigParent');
  assertEq(partB.rigParent, null, 'clear RW: nulls partB.rigParent');
}

// ── rotationSpecToDeformerNode + removeAllRotationDeformerNodes ───

{
  const spec = {
    id: 'FaceRotation',
    name: 'Face Rotation',
    parent: { type: 'warp', id: 'BodyXWarp' },
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
    keyforms: [
      { keyTuple: [-30], angle: -10, originX: 100, originY: 200, scale: 1, opacity: 1 },
      { keyTuple: [0],   angle: 0,   originX: 100, originY: 200, scale: 1, opacity: 1 },
      { keyTuple: [30],  angle: 10,  originX: 100, originY: 200, scale: 1, opacity: 1 },
    ],
    baseAngle: 0,
    handleLengthOnCanvas: 200,
    circleRadiusOnCanvas: 100,
    isVisible: true, isLocked: false,
    useBoneUiTestImpl: true,
  };
  const node = rotationSpecToDeformerNode(spec);
  assertEq(node.type, 'deformer', 'rotation node: type');
  assertEq(node.deformerKind, 'rotation', 'rotation node: deformerKind');
  assertEq(node.id, 'FaceRotation', 'rotation node: id');
  assertEq(node.parent, 'BodyXWarp', 'rotation node: parent flattened');
  assertEq(node.keyforms.length, 3, 'rotation node: keyforms count');
  assertEq(node.keyforms[0].angle, -10, 'rotation node: keyform angle');
  assertEq(node.keyforms[0].originX, 100, 'rotation node: keyform originX');
  assertEq(node.bindings[0].parameterId, 'ParamAngleZ', 'rotation node: bindings preserved');
  assertEq(node.handleLengthOnCanvas, 200, 'rotation node: handleLength preserved');
  assertEq(node.useBoneUiTestImpl, true, 'rotation node: useBoneUi default-on');
}

{
  // removeAllRotationDeformerNodes drops only rotations; warps + parts survive.
  const nodes = [
    { id: 'P1', type: 'part' },
    { id: 'BX', type: 'deformer', deformerKind: 'warp' },
    { id: 'R1', type: 'deformer', deformerKind: 'rotation' },
    { id: 'R2', type: 'deformer', deformerKind: 'rotation' },
    { id: 'BZ', type: 'deformer', deformerKind: 'warp' },
  ];
  removeAllRotationDeformerNodes(nodes);
  assertEq(nodes.map((n) => n.id), ['P1', 'BX', 'BZ'], 'removeRotations: only rotations removed');
}

// ── BUG-NECK_NULL_BBOX regression: Float64Array positions survive ────
// Live harvest specs (buildNeckWarpSpec / perPartRigWarps) hand
// Float64Array directly to warpSpecToDeformerNode without going through
// a serializer first. Pre-fix this dropped to []. Post-fix the helper
// `coerceNumberArray` preserves the values.

{
  const stored = {
    id: 'NeckWarp',
    name: 'NeckWarp',
    parent: { type: 'warp', id: 'BodyXWarp' },
    gridSize: { rows: 5, cols: 5 },
    baseGrid: new Float64Array([10, 20, 30, 40]),
    localFrame: 'canvas-px',
    bindings: [{ parameterId: 'ParamAngleZ', keys: new Float64Array([-30, 0, 30]), interpolation: 'LINEAR' }],
    keyforms: [
      { keyTuple: new Float64Array([-30]), positions: new Float64Array([1.5, 2.5, 3.5, 4.5]), opacity: 1 },
      { keyTuple: new Float64Array([0]),   positions: new Float64Array([5, 6, 7, 8]),         opacity: 1 },
      { keyTuple: new Float64Array([30]),  positions: new Float64Array([9, 10, 11, 12]),      opacity: 1 },
    ],
    isVisible: true, isLocked: false, isQuadTransform: false,
  };
  const node = warpSpecToDeformerNode(stored);
  assertEq(node.baseGrid, [10, 20, 30, 40],
    'BUG-NECK_NULL_BBOX: Float64Array baseGrid coerced to plain Array (not silently dropped)');
  assert(Array.isArray(node.baseGrid), 'baseGrid is plain Array post-coerce');
  assertEq(node.bindings[0].keys, [-30, 0, 30],
    'BUG-NECK_NULL_BBOX: Float64Array binding.keys coerced');
  assertEq(node.keyforms[0].keyTuple, [-30],
    'BUG-NECK_NULL_BBOX: Float64Array keyform.keyTuple coerced');
  assertEq(node.keyforms[0].positions, [1.5, 2.5, 3.5, 4.5],
    'BUG-NECK_NULL_BBOX: Float64Array keyform.positions coerced (the actual neck-gone bug)');
  assertEq(node.keyforms[2].positions, [9, 10, 11, 12],
    'BUG-NECK_NULL_BBOX: third keyform positions coerced');
  // JSON round-trip: typed-array-derived values survive serialisation
  const jsonNode = JSON.parse(JSON.stringify(node));
  assertEq(jsonNode.keyforms[0].positions, [1.5, 2.5, 3.5, 4.5],
    'BUG-NECK_NULL_BBOX: positions survive JSON round-trip');
  assertEq(jsonNode.baseGrid, [10, 20, 30, 40],
    'BUG-NECK_NULL_BBOX: baseGrid survives JSON round-trip');
}

// Defensive: garbage in throws (rule №1 — no silent bad-input fallback)
{
  let threw = false;
  try {
    warpSpecToDeformerNode({
      id: 'BadWarp',
      name: 'BadWarp',
      parent: null,
      gridSize: { rows: 5, cols: 5 },
      baseGrid: 'not an array',
      localFrame: 'canvas-px',
      bindings: [],
      keyforms: [],
      isVisible: true, isLocked: false, isQuadTransform: false,
    });
  } catch (e) {
    threw = String(e.message).includes('BadWarp')
      && String(e.message).includes('baseGrid');
  }
  assert(threw, 'warpSpecToDeformerNode throws on garbage baseGrid (no silent [] fallback)');
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

// ── v43 audit-fix: lattice-aware remove/upsert (cage cleanup) ───────
{
  // removeDeformerNodesByPredicate must drop a lattice cage OBJECT AND its
  // linked cage meshData (else the cage leaks as an orphan on re-seed/clear).
  const nodes = [
    { id: 'BodyWarpZ', type: 'object', objectKind: 'lattice', dataId: 'BodyWarpZ__cage' },
    { id: 'BodyWarpZ__cage', type: 'meshData', vertices: [{ x: 0, y: 0 }] },
    { id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation' },
    { id: 'keepPart', type: 'part' },
  ];
  removeDeformerNodesByPredicate(nodes, (n) => n.id === 'BodyWarpZ');
  assertEq(nodes.map((n) => n.id), ['FaceRotation', 'keepPart'],
    'v43: removing a lattice object also removes its cage meshData');
}
{
  // Legacy deformer/warp nodes are still matched (transitional coexistence).
  const nodes = [
    { id: 'W', type: 'deformer', deformerKind: 'warp' },
    { id: 'R', type: 'deformer', deformerKind: 'rotation' },
  ];
  removeDeformerNodesByPredicate(nodes, (n) => n.deformerKind === 'rotation');
  assertEq(nodes.map((n) => n.id), ['W'], 'v43: legacy deformer predicate still works');
}
{
  // upsertDeformerNode replacing a lattice object with a legacy warp node
  // (a re-seed at the same id) must remove the now-orphaned cage meshData.
  const nodes = [
    { id: 'RigWarp_face', type: 'object', objectKind: 'lattice', dataId: 'RigWarp_face__cage' },
    { id: 'RigWarp_face__cage', type: 'meshData', vertices: [{ x: 1, y: 2 }] },
  ];
  upsertDeformerNode(nodes, warpSpecToDeformerNode({
    id: 'RigWarp_face', name: 'F', parent: { type: 'root', id: null },
    gridSize: { rows: 5, cols: 5 }, baseGrid: [], bindings: [], keyforms: [],
  }));
  const ids = nodes.map((n) => n.id);
  assert(!ids.includes('RigWarp_face__cage'), 'v43: re-seed over a lattice object removes the orphaned cage');
  const rw = nodes.find((n) => n.id === 'RigWarp_face');
  assertEq(rw.type, 'deformer', 'v43: re-seeded node is the fresh deformer/warp node');
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`deformerNodeSync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
