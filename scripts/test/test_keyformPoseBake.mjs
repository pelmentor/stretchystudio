// BUG-027 regression — applyPoseAsRest + applyArmatureModifier must
// transform `mesh.runtime.keyforms[*].vertexPositions` so chainEval
// produces the posed geometry without needing the bone pose to still
// be active. Without this, zeroing the pose snaps bone-baked parts
// back to their un-rotated rest (the user's "handwear snaps back"
// observation).
//
// Frame: keyform vertexPositions are stored in rotation-pivot-relative
// canvas-px (per `selectRigSpec.js:600-606`). Transform formula in
// pivot-relative frame: `v_new = M_pose × v_old` where M_pose is the
// pose matrix without the pivot offset (verts are already pivot-rel).
//
// Run: node scripts/test/test_keyformPoseBake.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { applyArmatureModifier } from '../../src/services/ArmatureModifierService.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

function setupBoneBakedHandwear({ poseDeg = 90 } = {}) {
  // leftArm (pivot 0,0) posed by `poseDeg`. handwear-l carries
  // bone-baked keyforms in pivot-relative canvas-px frame. Single
  // rest keyform (the param-zero slot) at vertex (100, 0).
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 29,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          pose:      { rotation: poseDeg, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
          rigParent: null,
          mesh: {
            vertices: [{ x: 100, y: 0 }],
            triangles: [],
            boneWeights: [1],
            jointBoneId: 'leftArm',
            // Bone-baked path: chainEval reads from runtime.keyforms,
            // not from mesh.vertices. Single rest keyform; vert is in
            // pivot-relative frame (= canvas pos 100,0 minus pivot 0,0).
            runtime: {
              bindings: [],
              keyforms: [
                { keyTuple: [0], vertexPositions: new Float32Array([100, 0]) },
              ],
              parent: null,
            },
          },
          modifiers: [
            {
              type: 'armature',
              deformerId: 'leftArm',
              enabled: true,
              mode: 3,
              data: {
                jointBoneId: 'leftArm',
                jointBoneRole: 'leftArm',
                parentBoneId: null,
                parentBoneRole: null,
              },
            },
          ],
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
  });
  useParamValuesStore.setState({ values: {} });
}

// ── Test 1: applyPoseAsRest rebases mesh.vertices + replaces runtime ─
// 2026-05-09 (afternoon) contract: Step 1 rebases `mesh.vertices` by
// the bone's world matrix; Step 1b replaces `mesh.runtime` with a
// minimal canvas-px entry (`parent: root`, single keyform with the
// rebased verts verbatim). Avoids the frame-mismatch the prior
// "delete + let pre-rig fallback rebuild" approach produced — the
// fallback would have normalized rebased canvas-px verts into the
// warp's [0..1] rest bbox and rendered the part off-canvas.

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  const before = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l');
  assert(before.mesh.vertices[0].x === 100 && before.mesh.vertices[0].y === 0,
    'Test 1: pre-bake mesh.vertices[0] at (100, 0)');
  assert(before.mesh.runtime !== undefined, 'Test 1: pre-bake runtime present');
  useProjectStore.getState().applyPoseAsRest();
  const after = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l');
  // Step 1 rebased mesh.vertices to absorb the bone pose.
  assert(approx(after.mesh.vertices[0].x, 0),
    `Test 1: post-bake mesh.vertices[0].x ≈ 0 (got ${after.mesh.vertices[0].x})`);
  assert(approx(after.mesh.vertices[0].y, 100),
    `Test 1: post-bake mesh.vertices[0].y ≈ 100 (got ${after.mesh.vertices[0].y})`);
  // Step 1b replaced runtime with minimal canvas-px entry.
  assert(after.mesh.runtime !== undefined && after.mesh.runtime !== null,
    'Test 1: post-bake runtime present (minimal canvas-px replacement)');
  assert(after.mesh.runtime.parent && after.mesh.runtime.parent.type === 'root',
    `Test 1: runtime.parent.type === 'root' (got ${after.mesh.runtime.parent?.type})`);
  assert(Array.isArray(after.mesh.runtime.keyforms) && after.mesh.runtime.keyforms.length === 1,
    `Test 1: runtime has 1 keyform (got ${after.mesh.runtime.keyforms?.length})`);
  const kf = after.mesh.runtime.keyforms[0];
  assert(approx(kf.vertexPositions[0], 0) && approx(kf.vertexPositions[1], 100),
    `Test 1: runtime keyform[0].vertexPositions = (0, 100) (got (${kf.vertexPositions[0]}, ${kf.vertexPositions[1]}))`);
}

// ── Test 2: applyArmatureModifier writes minimal canvas-px runtime ──
// 2026-05-09 (afternoon) contract: applyArmatureModifier writes
// `mesh.runtime` to a minimal canvas-px entry (`parent: root`,
// single keyform with baked verts) instead of deleting it. The
// earlier "delete and let pre-rig fallback rebuild" approach
// triggered a frame mismatch in the fallback path: the fallback
// reads stale `part.rigParent` (still pointing to a body warp from
// pre-Apply synth) and normalizes the just-baked posed-canvas-px
// verts into the warp's REST bbox — posed verts can land outside
// [0..1], producing the user-reported "arm disappeared" symptom.
// Writing parent=root short-circuits the warp normalization.

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l');
  // mesh.vertices baked: (100, 0) rotated 90° around leftArm pivot → (0, 100)
  assert(approx(after.mesh.vertices[0].x, 0),
    `Test 2: post-Apply mesh.vertices[0].x ≈ 0 (got ${after.mesh.vertices[0].x})`);
  assert(approx(after.mesh.vertices[0].y, 100),
    `Test 2: post-Apply mesh.vertices[0].y ≈ 100 (got ${after.mesh.vertices[0].y})`);
  // Minimal runtime present (parent: root, single keyform canvas-px).
  assert(after.mesh.runtime && after.mesh.runtime.parent
    && after.mesh.runtime.parent.type === 'root',
    `Test 2: runtime.parent.type === 'root' (got ${after.mesh.runtime?.parent?.type})`);
  assert(Array.isArray(after.mesh.runtime.keyforms)
    && after.mesh.runtime.keyforms.length === 1,
    `Test 2: 1 keyform in minimal runtime (got ${after.mesh.runtime?.keyforms?.length})`);
  const kf = after.mesh.runtime.keyforms[0];
  assert(approx(kf.vertexPositions[0], 0) && approx(kf.vertexPositions[1], 100),
    `Test 2: keyform.vertexPositions = (0, 100); got (${kf.vertexPositions[0]}, ${kf.vertexPositions[1]})`);
  // Modifier removed.
  assert(!after.modifiers || !after.modifiers.find((m) => m?.type === 'armature'),
    'Test 2: post-Apply Armature modifier removed');
}

// ── Test 3: Apply Modifier → Apply Pose As Rest produces no double-bake ─

{
  // Apply Modifier writes a minimal canvas-px runtime (parent: root).
  // applyPoseAsRest then walks bones, zeroes their pose. The handwear
  // part has no armature modifier anymore (removed by Apply), so
  // applyPoseAsRest's hasArmatureMod gate skips both Step 1 and 1b
  // for it. mesh.vertices stays at the post-Apply baked position;
  // runtime stays at the minimal canvas-px shape.
  setupBoneBakedHandwear({ poseDeg: 90 });
  applyArmatureModifier('handwear-l');
  const midVerts = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.vertices;
  assert(approx(midVerts[0].x, 0) && approx(midVerts[0].y, 100),
    `Test 3: post-Apply mesh.vertices[0] ≈ (0, 100); got (${midVerts[0].x}, ${midVerts[0].y})`);
  useProjectStore.getState().applyPoseAsRest();
  const after = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l');
  assert(approx(after.mesh.vertices[0].x, 0),
    `Test 3: post-Apply+PoseAsRest mesh.vertices[0].x ≈ 0 (got ${after.mesh.vertices[0].x})`);
  assert(approx(after.mesh.vertices[0].y, 100),
    `Test 3: post-Apply+PoseAsRest mesh.vertices[0].y ≈ 100 (got ${after.mesh.vertices[0].y})`);
  assert(after.mesh.runtime && after.mesh.runtime.parent.type === 'root',
    'Test 3: minimal runtime preserved through applyPoseAsRest (modifier already gone)');
  // Bones zeroed.
  const leftArm = useProjectStore.getState().project.nodes.find((n) => n.id === 'leftArm');
  assert(leftArm.pose.rotation === 0, 'Test 3: leftArm.pose.rotation zeroed by applyPoseAsRest');
}

// ── Test 4: parts WITHOUT keyforms are untouched ──────────────────────

{
  // Part with mesh.vertices only, no runtime — applyPoseAsRest must
  // not crash and must not invent a runtime block.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 29,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'torso', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
          pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'topwear', type: 'part', name: 'topwear', parent: 'torso',
          mesh: {
            vertices: [{ x: 600, y: 800 }],
            triangles: [],
          },
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
  });
  useProjectStore.getState().applyPoseAsRest();
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'topwear');
  assert(after.mesh.runtime === undefined, 'Test 4: applyPoseAsRest does not invent runtime block');
}

// ── Test 5: rebase rotates multi-vert mesh.vertices as a rigid block ──

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  // Replace single-vert mesh with a 3-vert one (mesh.vertices, not the
  // runtime cache — that gets dropped by Step 1b regardless).
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    part.mesh.vertices = [
      { x: 100, y: 0 },    // → (0, 100)
      { x: 0, y: 100 },    // → (-100, 0)
      { x: 50, y: 50 },    // → (-50, 50)
    ];
    // Match boneWeights length so seedAllRig-style guards stay sane.
    part.mesh.boneWeights = [1, 1, 1];
  });
  useProjectStore.getState().applyPoseAsRest();
  const verts = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.vertices;
  assert(approx(verts[0].x, 0)    && approx(verts[0].y, 100),
    `Test 5: v0 (100,0) → (${verts[0].x}, ${verts[0].y}); expected (0, 100)`);
  assert(approx(verts[1].x, -100) && approx(verts[1].y, 0),
    `Test 5: v1 (0,100) → (${verts[1].x}, ${verts[1].y}); expected (-100, 0)`);
  assert(approx(verts[2].x, -50)  && approx(verts[2].y, 50),
    `Test 5: v2 (50,50) → (${verts[2].x}, ${verts[2].y}); expected (-50, 50)`);
}

console.log(`\nkeyformPoseBake: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
