// Regression: Apply-Armature on a WARP-LEAF + armature + LBS part must write
// the baked keyform in the leaf modifier's LOCAL (normalized) frame — NOT
// canvas-px. Writing canvas-px made selectRigSpec re-read e.g. x=787 as a
// normalized coord and denormalize by the warp rest bbox → ~180k px off-canvas
// ("the arm disappears entirely", 2026-06-18, confirmed via artMeshDisappearDiag).
//
// The fix reprojects the baked canvas-px verts into the leaf's local frame via
// the affine map recovered from the part's own REST correspondence
// (mesh.vertices canvas ↔ rest keyform local). This test drives the REAL
// applyArmatureModifier service and asserts:
//   1. the bake succeeds and removes only the armature (warp leaf survives);
//   2. the written keyform is in NORMALIZED frame (small ~0..1), not canvas-px;
//   3. INVARIANT — lifting the written keyform through the (affine) rest map
//      reproduces the posed canvas (mesh.vertices), i.e. the eval will land the
//      part ON-CANVAS where the old code flew it off.
//   4. a ROOT-leaf part (no warp) still bakes canvas-px verbatim (no regression).
//
// Run: node scripts/test/test_applyArmatureReprojectFrame.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { applyArmatureModifier } from '../../src/services/ArmatureModifierService.js';

let passed = 0, failed = 0;
const fail = [];
const assert = (c, n) => { if (c) passed++; else { failed++; fail.push(n); console.error(`FAIL: ${n}`); } };
const approx = (a, b, e = 1e-2) => Math.abs(a - b) <= e;

// Warp rest bbox: maps normalized [0,1] ↔ canvas rect (360,700)..(560,1060).
const BX = 360, BY = 700, BW = 200, BH = 360;
const l2c = (u, v) => [BX + u * BW, BY + v * BH];          // local → canvas (affine lift)
const c2l = (x, y) => [(x - BX) / BW, (y - BY) / BH];      // canvas → local

// Part rect (canvas) sitting inside the warp bbox, near the elbow pivot.
const PART_CANVAS = [400, 760, 520, 760, 400, 1000, 520, 1000];
const PART_LOCAL = PART_CANVAS.flatMap((_, i) => (i % 2 === 0)
  ? [c2l(PART_CANVAS[i], PART_CANVAS[i + 1])[0]]
  : [c2l(PART_CANVAS[i - 1], PART_CANVAS[i])[1]]);

function setup() {
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 51,
      canvas: { width: 1280, height: 1280 },
      textures: [], parameters: [],
      nodes: [
        { id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 460, pivotY: 760 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
        { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow', parent: 'leftArm',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 460, pivotY: 880 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
        // Root warp leaf — normalized-0to1, rest bbox = the rect above.
        { id: 'W', type: 'deformer', deformerKind: 'warp', parent: null,
          gridSize: { rows: 1, cols: 1 },
          baseGrid: [BX, BY, BX + BW, BY, BX, BY + BH, BX + BW, BY + BH],
          localFrame: 'normalized-0to1', bindings: [],
          keyforms: [{ keyTuple: [], positions: [BX, BY, BX + BW, BY, BX, BY + BH, BX + BW, BY + BH], opacity: 1 }],
          isQuadTransform: false },
        { id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
          mesh: {
            vertices: PART_CANVAS.reduce((a, _, i) => (i % 2 === 0 ? [...a, { x: PART_CANVAS[i], y: PART_CANVAS[i + 1] }] : a), []),
            uvs: [], triangles: [],
            boneWeights: [1, 1, 1, 1], jointBoneId: 'leftElbow',
            runtime: {
              bindings: [],
              keyforms: [{ keyTuple: [], vertexPositions: PART_LOCAL.slice(), opacity: 1 }],
            },
          },
          modifiers: [
            { type: 'warp', deformerId: 'W', enabled: true, mode: 3 },
            { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3,
              data: { jointBoneId: 'leftElbow', parentBoneId: 'leftArm' } },
          ] },
      ],
    },
  });
  useParamValuesStore.setState({ values: {} });
}

// ── Warp-leaf reproject ──────────────────────────────────────────────
{
  setup();
  // Pose the elbow so LBS moves the part off its rest position.
  useProjectStore.getState().updateProject((p) => {
    p.nodes.find((n) => n.id === 'leftElbow').pose.rotation = 22;
  });

  const result = applyArmatureModifier('handwear-l');
  assert(result.baked === true, `warp-leaf: baked=true (got ${JSON.stringify(result)})`);

  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const hasArm = (after.modifiers ?? []).some((m) => m.type === 'armature');
  const hasWarp = (after.modifiers ?? []).some((m) => m.type === 'warp');
  assert(!hasArm, 'warp-leaf: armature removed');
  assert(hasWarp, 'warp-leaf: warp leaf SURVIVES (chain still applies)');

  const kf = after.mesh.runtime.keyforms[0].vertexPositions;
  const verts = after.mesh.vertices;
  // 2: keyform is normalized (|coord| small), NOT canvas-px (~400-1000).
  const kfMax = Math.max(...kf.map(Math.abs));
  assert(kfMax < 5, `warp-leaf: keyform written in NORMALIZED frame (max |coord|=${kfMax.toFixed(3)} < 5, not canvas-px)`);
  assert(verts[0].x > 100, `warp-leaf: mesh.vertices stays canvas-px (v0.x=${verts[0].x.toFixed(1)})`);

  // 3: INVARIANT — affine lift of the keyform reproduces the posed canvas.
  let maxErr = 0;
  for (let i = 0; i < verts.length; i++) {
    const [cx, cy] = l2c(kf[2 * i], kf[2 * i + 1]);
    maxErr = Math.max(maxErr, Math.hypot(cx - verts[i].x, cy - verts[i].y));
  }
  assert(maxErr < 1e-2, `warp-leaf: lift(keyform) == posed mesh.vertices (maxErr=${maxErr.toFixed(5)}px) → ON-CANVAS`);

  // The posed verts moved off rest (sanity: the bake actually captured a pose).
  assert(!approx(verts[0].x, PART_CANVAS[0], 0.5) || !approx(verts[0].y, PART_CANVAS[1], 0.5),
    'warp-leaf: bake captured a real pose (verts moved from rest)');
}

// ── Root-leaf control (no warp) — keyform stays canvas-px ─────────────
{
  setup();
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    // Drop the warp leaf → root-parented bone-baked part.
    part.modifiers = part.modifiers.filter((m) => m.type !== 'warp');
    // Keyform must be canvas-px for a root part.
    part.mesh.runtime.keyforms[0].vertexPositions = PART_CANVAS.slice();
    p.nodes.find((n) => n.id === 'leftElbow').pose.rotation = 22;
  });
  const result = applyArmatureModifier('handwear-l');
  assert(result.baked === true, `root-leaf: baked=true (got ${JSON.stringify(result)})`);
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const kf = after.mesh.runtime.keyforms[0].vertexPositions;
  // keyform == mesh.vertices (both canvas-px, verbatim — no reprojection).
  let same = true;
  for (let i = 0; i < after.mesh.vertices.length; i++) {
    if (!approx(kf[2 * i], after.mesh.vertices[i].x) || !approx(kf[2 * i + 1], after.mesh.vertices[i].y)) same = false;
  }
  assert(same, 'root-leaf: keyform == mesh.vertices (canvas-px verbatim, no regression)');
}

console.log(`\napplyArmatureReprojectFrame: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('FAILURES:'); for (const f of fail) console.log('  - ' + f); process.exit(1); }
