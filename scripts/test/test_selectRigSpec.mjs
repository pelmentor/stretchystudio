// Tests for src/io/live2d/rig/selectRigSpec.js (BFA-006 Phase 2).
//
// Verifies that the pure derived selector reads `project.nodes` (after
// the Phase 1 deformer-node migration) and produces a `RigSpec` that
// matches what the legacy build paths produce for the warp slice +
// parts + canvas + closures.
//
// Run: node scripts/test/test_selectRigSpec.mjs

import {
  selectRigSpec,
  getRigSpec,
} from '../../src/io/live2d/rig/selectRigSpec.js';
import {
  synthesizeDeformerNodesFromSidetables,
} from '../../src/store/deformerNodeSync.js';

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

// ── Empty / malformed input ───────────────────────────────────────

{
  const spec = selectRigSpec(null);
  assertEq(spec.parts, [], 'empty: null → empty parts');
  assertEq(spec.warpDeformers, [], 'empty: null → empty warps');
  assertEq(spec.rotationDeformers, [], 'empty: null → empty rotations');
  assertEq(spec.canvas, { w: 800, h: 600 }, 'empty: default canvas');
  assert(spec.canvasToInnermostX === null, 'empty: closures null');
}

{
  const project = { nodes: [], parameters: [], canvas: { width: 1024, height: 1024 } };
  const spec = selectRigSpec(project);
  assertEq(spec.canvas, { w: 1024, h: 1024 }, 'canvas: read from project');
  assertEq(spec.warpDeformers, [], 'no deformers → empty warps');
  assertEq(spec.parts, [], 'no groups → empty parts');
}

// ── Warp deformer nodes → RigSpec.warpDeformers ──────────────────

{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [{ id: 'ParamAngleZ', min: -30, max: 30, defaultValue: 0 }],
    nodes: [
      {
        id: 'BodyZWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BZ', parent: null, visible: true,
        gridSize: { rows: 5, cols: 5 },
        baseGrid: new Array(72).fill(0).map((_, i) => i),
        localFrame: 'canvas-px',
        bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], positions: new Array(72).fill(1), opacity: 1 },
          { keyTuple: [0],   positions: new Array(72).fill(0), opacity: 1 },
          { keyTuple: [30],  positions: new Array(72).fill(2), opacity: 1 },
        ],
      },
      {
        id: 'BodyYWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BY', parent: 'BodyZWarp', visible: true,
        gridSize: { rows: 5, cols: 5 },
        baseGrid: new Array(72).fill(0),
        localFrame: 'normalized-0to1',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }],
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.warpDeformers.length, 2, 'warp count');
  assertEq(spec.warpDeformers[0].id, 'BodyZWarp', 'warp 0 id');
  assertEq(spec.warpDeformers[0].parent, { type: 'root', id: null }, 'warp 0: root parent inflated');
  assertEq(spec.warpDeformers[1].parent, { type: 'warp', id: 'BodyZWarp' }, 'warp 1: warp parent inflated');
  assert(spec.warpDeformers[0].baseGrid instanceof Float64Array, 'warp baseGrid → Float64Array');
  assertEq(spec.warpDeformers[0].baseGrid[5], 5, 'warp baseGrid values preserved');
  assert(spec.warpDeformers[0].keyforms[0].positions instanceof Float64Array, 'warp keyform positions → Float64Array');
  assertEq(spec.warpDeformers[0].bindings[0].parameterId, 'ParamAngleZ', 'warp bindings preserved');
}

// ── Parent resolution: warp pointing at rotation/part/dangling ───

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      // A rotation deformer (Phase 3 territory; selector handles when present).
      {
        id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation',
        name: 'FR', parent: null, visible: true,
        bindings: [], keyforms: [],
      },
      // A face-parallax warp pointing at the rotation deformer.
      {
        id: 'FaceParallaxWarp', type: 'deformer', deformerKind: 'warp',
        name: 'FP', parent: 'FaceRotation', visible: true,
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0),
        localFrame: 'pivot-relative',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }],
      },
      // A warp pointing at a part (unusual but legal in cmo3).
      {
        id: 'partA', type: 'part', name: 'partA',
      },
      {
        id: 'WarpUnderPart', type: 'deformer', deformerKind: 'warp',
        name: 'WUP', parent: 'partA', visible: true,
        gridSize: { rows: 2, cols: 2 }, baseGrid: new Array(18).fill(0),
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(18).fill(0), opacity: 1 }],
      },
      // A warp with a dangling parent reference.
      {
        id: 'OrphanWarp', type: 'deformer', deformerKind: 'warp',
        name: 'O', parent: 'doesnt-exist', visible: true,
        gridSize: { rows: 2, cols: 2 }, baseGrid: new Array(18).fill(0),
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(18).fill(0), opacity: 1 }],
      },
    ],
  };
  const spec = selectRigSpec(project);
  const fp = spec.warpDeformers.find((w) => w.id === 'FaceParallaxWarp');
  assertEq(fp.parent, { type: 'rotation', id: 'FaceRotation' }, 'FP: rotation parent inflated');
  const wup = spec.warpDeformers.find((w) => w.id === 'WarpUnderPart');
  assertEq(wup.parent, { type: 'part', id: 'partA' }, 'WUP: part parent inflated');
  const orph = spec.warpDeformers.find((w) => w.id === 'OrphanWarp');
  assertEq(orph.parent, { type: 'root', id: null }, 'orphan: dangling parent → root (defensive)');
  assertEq(spec.rotationDeformers.length, 1, 'rotation node read');
  assertEq(spec.rotationDeformers[0].id, 'FaceRotation', 'rotation id');
}

// ── Groups → RigSpec.parts ────────────────────────────────────────

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      { id: 'g1', type: 'group', name: 'Body', parent: null, visible: true, opacity: 1 },
      { id: 'g2', type: 'group', name: 'Head', parent: 'g1', visible: true, opacity: 1 },
      { id: 'p1', type: 'part', name: 'face' },
      { id: 'd1', type: 'deformer', deformerKind: 'warp', name: 'd', parent: null, visible: true,
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0), localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }] },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.parts.length, 2, 'parts: only groups counted');
  assertEq(spec.parts[0].id, 'g1', 'parts[0].id');
  assertEq(spec.parts[0].parentPartId, null, 'parts[0].parentPartId null');
  assertEq(spec.parts[1].parentPartId, 'g1', 'parts[1].parentPartId points to g1');
}

// ── canvasToInnermostX/Y from BodyZWarp baseGrid ─────────────────

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'BodyZWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BZ', parent: null, visible: true,
        gridSize: { rows: 1, cols: 1 },
        // 2x2 grid covering canvas: corners at (0,0), (800,0), (0,600), (800,600).
        baseGrid: [0, 0, 800, 0, 0, 600, 800, 600],
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: [0,0,800,0,0,600,800,600], opacity: 1 }],
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.innermostBodyWarpId, 'BodyZWarp', 'innermost: single Body* node detected');
  assert(typeof spec.canvasToInnermostX === 'function', 'innermost: closure X is function');
  assertEq(spec.canvasToInnermostX(0), 0, 'closure X: (0) → 0');
  assertEq(spec.canvasToInnermostX(800), 1, 'closure X: (800) → 1');
  assertEq(spec.canvasToInnermostX(400), 0.5, 'closure X: (400) → 0.5');
  assertEq(spec.canvasToInnermostY(300), 0.5, 'closure Y: (300) → 0.5');
}

{
  // No body warp → null closures.
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'OtherWarp', type: 'deformer', deformerKind: 'warp',
        name: 'O', parent: null, visible: true,
        gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0),
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: new Array(72).fill(0), opacity: 1 }],
      },
    ],
  };
  const spec = selectRigSpec(project);
  assert(spec.innermostBodyWarpId === null, 'no body warp: innermostBodyWarpId null');
  assert(spec.canvasToInnermostX === null, 'no body warp: closures null');
}

// ── Memoization on project identity ──────────────────────────────

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      { id: 'g1', type: 'group', name: 'Body', parent: null, visible: true, opacity: 1 },
    ],
  };
  const a = selectRigSpec(project);
  const b = selectRigSpec(project);
  assert(a === b, 'memoize: same project → same instance');
  // Different project identity → different instance.
  const projectClone = { ...project };
  const c = selectRigSpec(projectClone);
  assert(a !== c, 'memoize: different project identity → fresh instance');
  assertEq(a.parts, c.parts, 'memoize: cloned project produces structurally equal output');
}

// ── End-to-end: synthesize-from-sidetables → selector matches ────

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [], nodes: [],
    faceParallax: {
      id: 'FaceParallaxWarp', name: 'FP',
      parent: { type: 'rotation', id: 'FaceRotation' },
      gridSize: { rows: 5, cols: 5 }, baseGrid: new Array(72).fill(0),
      localFrame: 'pivot-relative',
      bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
      keyforms: [{ keyTuple: [0], positions: new Array(72).fill(0), opacity: 1 }],
      isVisible: true, isLocked: false, isQuadTransform: false,
    },
    bodyWarp: {
      specs: [
        { id: 'BodyZWarp', name: 'BZ', parent: { type: 'root', id: null },
          gridSize: { rows: 1, cols: 1 },
          baseGrid: [0,0,800,0,0,600,800,600],
          localFrame: 'canvas-px',
          bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-10, 0, 10], interpolation: 'LINEAR' }],
          keyforms: [{ keyTuple: [-10], positions: [0,0,800,0,0,600,800,600], opacity: 1 }],
          isVisible: true, isLocked: false, isQuadTransform: false },
      ],
      layout: {}, hasParamBodyAngleX: false, debug: {},
    },
    rigWarps: {},
  };
  synthesizeDeformerNodesFromSidetables(project);
  const spec = selectRigSpec(project);
  // Order from synthesize: FaceParallax then BodyZWarp.
  assertEq(spec.warpDeformers.map((w) => w.id), ['FaceParallaxWarp', 'BodyZWarp'],
    'e2e: synthesized warps roundtrip into selectRigSpec');
  assertEq(spec.innermostBodyWarpId, 'BodyZWarp', 'e2e: BodyZWarp picked as innermost');
  assert(typeof spec.canvasToInnermostX === 'function', 'e2e: closures resolved');
}

// ── getRigSpec is alias of selectRigSpec ─────────────────────────

{
  const project = { canvas: { width: 800, height: 600 }, parameters: [], nodes: [] };
  const a = selectRigSpec(project);
  const b = getRigSpec(project);
  assert(a === b, 'getRigSpec: same memoized instance as selectRigSpec');
}

// ── Summary ──────────────────────────────────────────────────────

console.log(`selectRigSpec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
