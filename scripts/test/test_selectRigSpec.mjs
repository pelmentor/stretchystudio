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
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
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
        id: 'BodyWarpY', type: 'deformer', deformerKind: 'warp',
        name: 'BY', parent: 'BodyWarpZ', visible: true,
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
  assertEq(spec.warpDeformers[0].id, 'BodyWarpZ', 'warp 0 id');
  assertEq(spec.warpDeformers[0].parent, { type: 'root', id: null }, 'warp 0: root parent inflated');
  assertEq(spec.warpDeformers[1].parent, { type: 'warp', id: 'BodyWarpZ' }, 'warp 1: warp parent inflated');
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

// ── canvasToInnermostX/Y from BodyWarpZ baseGrid ─────────────────

{
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
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
  assertEq(spec.innermostBodyWarpId, 'BodyWarpZ', 'innermost: single Body* node detected');
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
        { id: 'BodyWarpZ', name: 'BZ', parent: { type: 'root', id: null },
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
  // Order from synthesize: FaceParallax then BodyWarpZ.
  assertEq(spec.warpDeformers.map((w) => w.id), ['FaceParallaxWarp', 'BodyWarpZ'],
    'e2e: synthesized warps roundtrip into selectRigSpec');
  assertEq(spec.innermostBodyWarpId, 'BodyWarpZ', 'e2e: BodyWarpZ picked as innermost');
  assert(typeof spec.canvasToInnermostX === 'function', 'e2e: closures resolved');
}

// ── Phase 3: rotation deformers + artMeshes ──────────────────────

{
  // Rotation deformer node → RotationDeformerSpec.
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation',
        name: 'Face Rotation', parent: null, visible: true,
        bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], angle: -10, originX: 400, originY: 200, scale: 1, opacity: 1 },
          { keyTuple: [0],   angle:   0, originX: 400, originY: 200, scale: 1, opacity: 1 },
          { keyTuple: [30],  angle:  10, originX: 400, originY: 200, scale: 1, opacity: 1 },
        ],
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.rotationDeformers.length, 1, 'rotation: one node read');
  const r = spec.rotationDeformers[0];
  assertEq(r.id, 'FaceRotation', 'rotation: id');
  assertEq(r.parent, { type: 'root', id: null }, 'rotation: parent inflated');
  assertEq(r.bindings[0].parameterId, 'ParamAngleZ', 'rotation: bindings preserved');
  assertEq(r.keyforms.length, 3, 'rotation: 3 keyforms');
  assertEq(r.keyforms[0].angle, -10, 'rotation: keyform angle preserved');
  assertEq(r.keyforms[1].originX, 400, 'rotation: originX preserved');
}

{
  // artMesh derivation: a part with mesh + a body warp parent.
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BX', parent: null, visible: true,
        gridSize: { rows: 1, cols: 1 },
        // Identity grid covering canvas: corners (0,0)→(800,0)→(0,600)→(800,600)
        baseGrid: [0, 0, 800, 0, 0, 600, 800, 600],
        localFrame: 'canvas-px',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: [0, 0, 800, 0, 0, 600, 800, 600], opacity: 1 }],
      },
      {
        id: 'partA', type: 'part', name: 'face',
        rigParent: 'BodyXWarp',
        mesh: {
          // Single-triangle mesh inside canvas: vertices at (200,150),(600,150),(400,450)
          vertices: [200, 150, 600, 150, 400, 450],
          triangles: [0, 1, 2],
          uvs: [0.25, 0.25, 0.75, 0.25, 0.5, 0.75],
        },
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.artMeshes.length, 1, 'artMeshes: one part with mesh → one entry');
  const am = spec.artMeshes[0];
  assertEq(am.id, 'partA', 'artMesh: id from part');
  assertEq(am.parent, { type: 'warp', id: 'BodyXWarp' }, 'artMesh: parent from rigParent');
  assert(am.verticesCanvas instanceof Float32Array, 'artMesh: verticesCanvas typed');
  assertEq(Array.from(am.verticesCanvas), [200, 150, 600, 150, 400, 450], 'artMesh: canvas verts preserved');
  assertEq(am.keyforms.length, 1, 'artMesh: single rest keyform');
  assertEq(am.bindings, [], 'artMesh: no bindings (rest-only)');
  // verts in parent-deformer-local: BodyXWarp covers canvas (0..800,0..600) so
  // (200,150) → (0.25, 0.25); (600,150) → (0.75, 0.25); (400,450) → (0.5, 0.75)
  const local = Array.from(am.keyforms[0].vertexPositions);
  assert(Math.abs(local[0] - 0.25) < 1e-6, 'artMesh: vert 0 x normalised');
  assert(Math.abs(local[1] - 0.25) < 1e-6, 'artMesh: vert 0 y normalised');
  assert(Math.abs(local[2] - 0.75) < 1e-6, 'artMesh: vert 1 x normalised');
  assert(Math.abs(local[5] - 0.75) < 1e-6, 'artMesh: vert 2 y normalised');
}

{
  // artMesh fallback: a part WITHOUT rigParent → uses innermostBodyWarpId.
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BX', parent: null, visible: true,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [0, 0, 800, 0, 0, 600, 800, 600],
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: [0, 0, 800, 0, 0, 600, 800, 600], opacity: 1 }],
      },
      {
        id: 'partB', type: 'part', name: 'orphan',
        // No rigParent set
        mesh: {
          vertices: [400, 300],
          triangles: [],
          uvs: [0.5, 0.5],
        },
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.artMeshes[0].parent, { type: 'warp', id: 'BodyXWarp' },
    'artMesh: rigParent-less part falls back to innermost body warp');
}

// (Test removed in M4 RULE-№4, 2026-05-23.) The pre-rig fallback's
// rotation-parent branch was exercised here by setting `partFace.rigParent
// = 'HeadRotation'`. Post-M4 the pre-rig fallback no longer reads
// `rigParent`; the only fallback path is `innermostBodyWarpId`, which
// always points at a body warp (never a rotation deformer). The
// rotation branch in the pre-rig fallback was deleted along with this
// test. Rotation parents still surface for parts via the runtime-cache
// fast path (which reads `modifiers[0]` post-M3.1).

{
  // Chained warp: BodyWarpZ (canvas-px root) → BodyXWarp (normalised under BZ).
  // BX baseGrid is in 0..1 of BZ; BZ's canvas covers (0..800, 0..600).
  // So BX at rest is identity → its lifted canvas-px bbox should match BZ's bbox.
  const project = {
    canvas: { width: 800, height: 600 }, parameters: [],
    nodes: [
      {
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
        name: 'BZ', parent: null, visible: true,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [0, 0, 800, 0, 0, 600, 800, 600],
        localFrame: 'canvas-px',
        bindings: [], keyforms: [{ keyTuple: [], positions: [0, 0, 800, 0, 0, 600, 800, 600], opacity: 1 }],
      },
      {
        id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BX', parent: 'BodyWarpZ', visible: true,
        gridSize: { rows: 1, cols: 1 },
        // Identity in 0..1: corners (0,0)→(1,0)→(0,1)→(1,1)
        baseGrid: [0, 0, 1, 0, 0, 1, 1, 1],
        localFrame: 'normalized-0to1',
        bindings: [], keyforms: [{ keyTuple: [], positions: [0, 0, 1, 0, 0, 1, 1, 1], opacity: 1 }],
      },
    ],
  };
  const spec = selectRigSpec(project);
  assertEq(spec.innermostBodyWarpId, 'BodyXWarp', 'chain: BX detected as innermost');
  // Closures should map canvas → 0..1 in BX's lifted bbox (= canvas).
  assert(typeof spec.canvasToInnermostX === 'function', 'chain: closure X built');
  const x = spec.canvasToInnermostX(400);
  assert(Math.abs(x - 0.5) < 1e-6, 'chain: closure X(400) → 0.5 via lifted bbox');
}

// ── getRigSpec is alias of selectRigSpec ─────────────────────────

{
  const project = { canvas: { width: 800, height: 600 }, parameters: [], nodes: [] };
  const a = selectRigSpec(project);
  const b = getRigSpec(project);
  assert(a === b, 'getRigSpec: same memoized instance as selectRigSpec');
}

// ── selectRigSpec is a faithful pass-through of mesh.runtime ──────
//
// Pre-Slice-1C (RULE №4 follow-up Leak #1, 2026-05-23) selectRigSpec
// carried a `_liveSkinBoneBaked` shim that collapsed bone-baked parts'
// per-`ParamRotation_<bone>` keyforms down to a single rest keyform at
// READ time. That collapse now lives at the SOURCE — `artMeshSourceEmit`
// (`pm.hasBakedKeyforms` branch) pushes 1 rest keyform on
// ParamOpacity[1.0] for bone-baked parts; the bone post-chain LBS owns
// the deformation. The v45 migration forces re-Init Rig for legacy
// projects so their `mesh.runtime` ends up in the clean shape too.
//
// This block pins the new contract: selectRigSpec is now a faithful
// passthrough of whatever shape `mesh.runtime` holds — no implicit
// per-part collapse, no special-casing on bone-baked-ness, no binding-
// kind filter. Any prior collapse logic in selectRigSpec would be
// migration baggage (RULE №2) now that the emitter is the source of
// truth for the bone-baked shape.
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [{ id: 'ParamRotation_rightElbow', default: 0 }],
    nodes: [
      { id: 'rightElbow', type: 'group', boneRole: 'rightElbow', parent: null },
      {
        id: 'handwear', type: 'part', name: 'handwear',
        mesh: {
          vertices: [10, 0, 20, 0], triangles: [], uvs: [0, 0, 1, 1],
          jointBoneId: 'rightElbow', boneWeights: [1, 0.5],
          runtime: {
            parent: { type: 'root', id: null },
            // Simulate a v45-migrated project's mesh.runtime — the
            // emitter's new bone-baked shape (1 rest kf on
            // ParamOpacity[1.0]).
            bindings: [{ parameterId: 'ParamOpacity', keys: [1.0], interpolation: 'LINEAR' }],
            keyforms: [
              { keyTuple: [1.0], vertexPositions: [10, 0, 20, 0], opacity: 1 },
            ],
          },
        },
      },
    ],
  };
  const spec = selectRigSpec(project);
  const am = spec.artMeshes.find((m) => m.id === 'handwear');
  assert(!!am, 'bone-baked passthrough: artMesh produced');
  assertEq(am.bindings.length, 1, 'bone-baked passthrough: 1 binding from runtime preserved');
  assertEq(am.bindings[0].parameterId, 'ParamOpacity',
    'bone-baked passthrough: ParamOpacity binding from runtime preserved');
  assertEq(am.keyforms.length, 1, 'bone-baked passthrough: single rest keyform preserved');
  assertEq(Array.from(am.keyforms[0].vertexPositions), [10, 0, 20, 0],
    'bone-baked passthrough: rest verts preserved verbatim');
}

// Pre-v45 shape passthrough — if a project's mesh.runtime still carries
// the old N-keyform ParamRotation_<bone> bake (e.g. test scaffolding that
// hand-builds the runtime instead of running through generateCmo3),
// selectRigSpec returns it verbatim. The v45 migration is the contract
// that ensures live projects don't sit in this shape post-load; if
// something else feeds selectRigSpec stale data, the depgraph will
// double-apply (rotate via blendKeyforms AND via post-chain LBS) — that's
// a bug in the caller, not in selectRigSpec. Pinned here so a future
// "defensive shim" re-grow is caught immediately.
{
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [{ id: 'ParamRotation_rightElbow', default: 0 }, { id: 'ParamEyeLOpen', default: 1 }],
    nodes: [
      { id: 'rightElbow', type: 'group', boneRole: 'rightElbow', parent: null },
      {
        id: 'mixed', type: 'part', name: 'mixed',
        mesh: {
          vertices: [10, 0, 20, 0], triangles: [], uvs: [0, 0, 1, 1],
          jointBoneId: 'rightElbow', boneWeights: [1, 1],
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [
              { parameterId: 'ParamRotation_rightElbow', keys: [0, 90] },
              { parameterId: 'ParamEyeLOpen', keys: [0, 1] },
            ],
            keyforms: [
              { keyTuple: [0, 0], vertexPositions: [10, 0, 20, 0], opacity: 1 },
              { keyTuple: [90, 1], vertexPositions: [5, 5, 12, 8], opacity: 1 },
            ],
          },
        },
      },
    ],
  };
  const spec = selectRigSpec(project);
  const am = spec.artMeshes.find((m) => m.id === 'mixed');
  assertEq(am.bindings.length, 2,
    'multi-binding passthrough: bindings preserved verbatim from mesh.runtime');
  assertEq(am.keyforms.length, 2,
    'multi-binding passthrough: keyforms preserved verbatim from mesh.runtime');
}

// ── M3.1 (RULE-№4, 2026-05-23): cachedParent derives from modifiers[0],
//   not mesh.runtime.parent. The runtime.parent field is no longer
//   consulted by selectRigSpec; the field stays persisted (no schema
//   bump) but selectRigSpec ignores it entirely. ──────────────────
{
  // Warp-rigged part: modifiers[0] = lattice WarpA. runtime.parent set
  // to a DIFFERENT but valid lattice (WarpB). If selectRigSpec were
  // still reading runtime.parent, cachedParent would be WarpB and
  // effectiveParent (from modifiers[0]) would be WarpA → reproject
  // would fire from WarpB-frame to WarpA-frame, producing non-passthrough
  // verts. Post-M3.1 derivation gives cachedParent = WarpA (= effective),
  // no reproject fires, verts pass through unchanged. This fixture
  // produces distinguishable output for the M3.1-honored vs M3.1-reverted
  // paths (vs the earlier stale-nonexistent-id variant which both paths
  // collapsed to defensive passthrough).
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      // Lattice WarpA — the actual leaf for the part.
      { id: 'WarpA_obj', type: 'object', objectKind: 'lattice', parent: null,
        dataId: 'WarpA_obj__cage', visible: true, name: 'WarpA',
        bindings: [], keyforms: [{ keyTuple: [], positions: [], opacity: 1 }],
        canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 } },
      { id: 'WarpA_obj__cage', type: 'meshData', isLatticeCage: true,
        vertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 },
        ],
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [0, 0, 100, 0, 0, 100, 100, 100] },
      // Lattice WarpB — exists for the stale runtime.parent to point at.
      { id: 'WarpB_obj', type: 'object', objectKind: 'lattice', parent: null,
        dataId: 'WarpB_obj__cage', visible: true, name: 'WarpB',
        bindings: [], keyforms: [{ keyTuple: [], positions: [], opacity: 1 }],
        canvasBbox: { minX: 200, minY: 200, W: 100, H: 100 } },
      { id: 'WarpB_obj__cage', type: 'meshData', isLatticeCage: true,
        vertices: [
          { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 200, y: 300 }, { x: 300, y: 300 },
        ],
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [200, 200, 300, 200, 200, 300, 300, 300] },
      // Part: modifiers[0] = WarpA. runtime.parent = STALE WarpB.
      { id: 'face', type: 'part', visible: true,
        modifiers: [
          { type: 'lattice', objectId: 'WarpA_obj', enabled: true, mode: 3,
            showInEditor: true },
        ],
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
          uvs: [], triangles: [],
          runtime: {
            parent: { type: 'warp', id: 'WarpB_obj' }, // STALE — different from modifiers[0]
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [10, 20, 30, 40], opacity: 1 }],
          },
        } },
    ],
  };
  const spec = selectRigSpec(project);
  const am = spec.artMeshes.find((m) => m.id === 'face');
  assert(!!am, 'M3.1: artMesh built with stale runtime.parent');
  // Lattice modifier maps to 'warp' type in the chain (mirrors
  // _resolveModifierChain's normalization).
  assert(am.parent?.type === 'warp' && am.parent?.id === 'WarpA_obj',
    'M3.1: parent derives from modifiers[0].objectId (WarpA), not runtime.parent (WarpB)');
  // Critical regression-pin: if runtime.parent were still read, cachedParent
  // = WarpB and effectiveParent = WarpA would differ → reproject would fire
  // through both warps' valid rest frames, producing transformed
  // (non-passthrough) verts. Verts MUST equal the keyform input unchanged.
  assertEq(Array.from(am.keyforms[0].vertexPositions), [10, 20, 30, 40],
    'M3.1: verts pass through unchanged (proves runtime.parent NOT read — reproject would have fired with valid WarpB→WarpA frames)');
}

{
  // Armature-only stack (bone-baked part): modifiers[0] is armature,
  // the armature-skip in cachedParent derivation falls through to root.
  const project = {
    canvas: { width: 800, height: 600 },
    parameters: [],
    nodes: [
      { id: 'leftKnee', type: 'group', boneRole: 'leftKnee',
        transform: { x: 0, y: 0, rotation: 0, scale: 1, pivotX: 0, pivotY: 0 },
        pose: { rotation: 0 } },
      { id: 'legwear', type: 'part', visible: true, parent: 'leftKnee',
        modifiers: [
          { type: 'armature', deformerId: 'leftKnee', enabled: true, mode: 3,
            showInEditor: true,
            data: { jointBoneId: 'leftKnee', parentBoneId: null } },
        ],
        mesh: {
          vertices: [{ x: 5, y: 5 }],
          uvs: [], triangles: [],
          jointBoneId: 'leftKnee', boneWeights: [[1, 0]],
          runtime: {
            // STALE: pretend runtime.parent was never updated.
            parent: { type: 'rotation', id: 'STALE_ROTATION' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [5, 5], opacity: 1 }],
          },
        } },
    ],
  };
  const spec = selectRigSpec(project);
  const am = spec.artMeshes.find((m) => m.id === 'legwear');
  assert(!!am, 'M3.1: bone-baked artMesh built with stale runtime.parent');
  // Armature is filtered → cachedParent skip → root; effectiveParent also
  // root (armature-only stack → empty chain). Match → no reproject.
  assert(am.parent?.type === 'root' && am.parent?.id === null,
    'M3.1: armature-only stack → parent=root (cachedParent derivation skips armature)');
  // modifierChain is [] because Armature filters out of warp/rotation chain.
  assert(Array.isArray(am.modifierChain) && am.modifierChain.length === 0,
    'M3.1: armature-only emits modifierChain=[] (M2.2 contract preserved)');
}

// ── Summary ──────────────────────────────────────────────────────

console.log(`selectRigSpec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
