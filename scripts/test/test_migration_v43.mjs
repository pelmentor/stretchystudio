// Tests for src/store/migrations/v43_lattice_substrate.js (Slice 1.B flip).
//
// Validates the warp-deformer -> lattice-object conversion in ISOLATION
// (calls migrateLatticeSubstrate directly, not via migrateProject, so it
// doesn't depend on the migration being registered yet). The end-to-end
// "migrate then selectRigSpec stays byte-identical" parity is gated by the
// Phase-0 oracle (test_warpExportOracle) once the readers are flipped.
//
// Run: node scripts/test/test_migration_v43.mjs

import { migrateLatticeSubstrate } from '../../src/store/migrations/v43_lattice_substrate.js';

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

function buildProject() {
  return {
    schemaVersion: 42,
    canvas: { width: 800, height: 600 },
    parameters: [{ id: 'ParamAngleZ', min: -30, max: 30, defaultValue: 0 }],
    nodes: [
      // A warp deformer (body warp).
      {
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
        name: 'Body Warp Z', parent: null, visible: true,
        gridSize: { rows: 2, cols: 3 },
        // (2+1)*(3+1) = 12 points -> 24 floats
        baseGrid: Array.from({ length: 24 }, (_, i) => i * 1.5),
        localFrame: 'canvas-px',
        bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], positions: new Array(24).fill(1), opacity: 1 },
          { keyTuple: [0], positions: new Array(24).fill(0), opacity: 1 },
        ],
        isQuadTransform: false,
        targetPartId: undefined,
      },
      // A per-mesh rigWarp (carries targetPartId + canvasBbox).
      {
        id: 'RigWarp_face', type: 'deformer', deformerKind: 'warp',
        name: 'Face Rig Warp', parent: 'BodyWarpZ', visible: true,
        gridSize: { rows: 2, cols: 2 },
        baseGrid: Array.from({ length: 18 }, (_, i) => i),
        localFrame: 'pivot-relative',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: new Array(18).fill(0), opacity: 1 }],
        targetPartId: 'facePart',
        canvasBbox: { minX: 10, minY: 20, W: 100, H: 120 },
        _userAuthored: true,
      },
      // A rotation deformer — MUST stay untouched.
      {
        id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation',
        name: 'Face Rotation', parent: null, visible: true,
        bindings: [], keyforms: [], baseAngle: 0,
      },
      // A part with a warp modifier (data-folded) + a rotation modifier.
      {
        id: 'facePart', type: 'part', name: 'Face',
        rigParent: 'RigWarp_face',
        mesh: { vertices: [{ x: 0, y: 0 }], uvs: [], triangles: [], edgeIndices: [] },
        modifiers: [
          {
            type: 'warp', deformerId: 'RigWarp_face', enabled: true, mode: 3, showInEditor: true,
            data: { name: 'Face Rig Warp', gridSize: { rows: 2, cols: 2 }, baseGrid: [], keyforms: [] },
          },
          {
            type: 'rotation', deformerId: 'FaceRotation', enabled: true, mode: 3, showInEditor: true,
            data: { name: 'Face Rotation', baseAngle: 0 },
          },
        ],
      },
    ],
  };
}

// ── Conversion ─────────────────────────────────────────────────────────
{
  const p = buildProject();
  migrateLatticeSubstrate(p);

  const byId = new Map(p.nodes.map((n) => [n.id, n]));

  // No warp deformer nodes left.
  assert(!p.nodes.some((n) => n.type === 'deformer' && n.deformerKind === 'warp'),
    'no deformer/warp nodes remain');
  // Rotation deformer untouched.
  const rot = byId.get('FaceRotation');
  assertEq(rot?.type, 'deformer', 'rotation node type untouched');
  assertEq(rot?.deformerKind, 'rotation', 'rotation node kind untouched');

  // Lattice objects exist with reused ids + metadata.
  const bz = byId.get('BodyWarpZ');
  assertEq(bz?.type, 'object', 'BodyWarpZ -> object');
  assertEq(bz?.objectKind, 'lattice', 'BodyWarpZ -> lattice');
  assertEq(bz?.parent, null, 'BodyWarpZ parent preserved');
  assertEq(bz?.dataId, 'BodyWarpZ__cage', 'BodyWarpZ dataId');
  assertEq(bz?.gridSize, { rows: 2, cols: 3 }, 'BodyWarpZ gridSize preserved');
  assertEq(bz?.localFrame, 'canvas-px', 'BodyWarpZ localFrame preserved');
  assertEq(bz?.keyforms?.length, 2, 'BodyWarpZ keyforms preserved on object');
  assert(!('baseGrid' in bz), 'lattice object carries no baseGrid (cage owns it)');

  const fw = byId.get('RigWarp_face');
  assertEq(fw?.objectKind, 'lattice', 'RigWarp_face -> lattice');
  assertEq(fw?.parent, 'BodyWarpZ', 'RigWarp_face parent chain preserved');
  assertEq(fw?.localFrame, 'pivot-relative', 'RigWarp_face localFrame preserved (hazard #1)');
  assertEq(fw?.targetPartId, 'facePart', 'RigWarp_face targetPartId preserved');
  assertEq(fw?.canvasBbox, { minX: 10, minY: 20, W: 100, H: 120 }, 'RigWarp_face canvasBbox preserved');
  assertEq(fw?._userAuthored, true, 'RigWarp_face _userAuthored preserved');

  // Cage meshData: vertices = baseGrid reshaped to {x,y}[].
  const bzCage = byId.get('BodyWarpZ__cage');
  assertEq(bzCage?.type, 'meshData', 'cage is meshData');
  assertEq(bzCage?.vertices?.length, 12, 'cage has (2+1)*(3+1)=12 verts');
  assertEq(bzCage?.vertices?.[0], { x: 0, y: 1.5 }, 'cage vert 0 = baseGrid[0,1]');
  assertEq(bzCage?.vertices?.[1], { x: 3, y: 4.5 }, 'cage vert 1 = baseGrid[2,3]');
  assertEq(bzCage?.isLatticeCage, true, 'cage flagged isLatticeCage');
  assertEq(bzCage?.gridSize, { rows: 2, cols: 3 }, 'cage carries gridSize');

  // Part modifier: warp -> lattice ref (no data); rotation untouched.
  const part = byId.get('facePart');
  assertEq(part?.modifiers?.[0], {
    type: 'lattice', objectId: 'RigWarp_face', enabled: true, mode: 3, showInEditor: true,
  }, 'warp modifier -> lattice ref, data dropped');
  assertEq(part?.modifiers?.[1]?.type, 'rotation', 'rotation modifier untouched');
  assert(!!part?.modifiers?.[1]?.data, 'rotation modifier keeps its data');
  assertEq(part?.rigParent, 'RigWarp_face', 'rigParent id still valid (points at lattice object)');
}

// ── Idempotency ──────────────────────────────────────────────────────────
{
  const p = buildProject();
  migrateLatticeSubstrate(p);
  const snapshot = JSON.stringify(p.nodes);
  migrateLatticeSubstrate(p);
  assertEq(JSON.stringify(p.nodes), snapshot, 'second run is a no-op (idempotent)');
}

// ── Empty / no-warp project ──────────────────────────────────────────────
{
  const p = { schemaVersion: 42, nodes: [{ id: 'g', type: 'group', name: 'g' }] };
  migrateLatticeSubstrate(p);
  assertEq(p.nodes.length, 1, 'no-warp project unchanged (count)');
  assertEq(p.nodes[0].type, 'group', 'no-warp project unchanged (node)');

  migrateLatticeSubstrate(null);
  migrateLatticeSubstrate({});
  passed++; // didn't throw on null/empty
}

console.log(`\ntest_migration_v43: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
