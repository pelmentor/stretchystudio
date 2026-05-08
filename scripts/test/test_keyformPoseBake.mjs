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

// ── Test 1: applyPoseAsRest bakes keyforms — chainEval would emit posed ─

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  // Snapshot the keyform's pre-bake vertex.
  const beforeKf = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  assert(beforeKf[0] === 100 && beforeKf[1] === 0, 'Test 1: pre-bake keyform at (100,0)');
  // Before bake, we render via the Armature modifier (or worldMatrix
  // overlay) which rotates (100,0) by 90° around (0,0) → (0, 100).
  useProjectStore.getState().applyPoseAsRest();
  // Post-bake: bone pose zeroed; keyform must now encode the posed
  // position so chainEval reproduces (0, 100) at param=0 +
  // T(pivot=0,0).
  const afterKf = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  assert(approx(afterKf[0], 0), `Test 1: post-bake keyform.x ≈ 0 (got ${afterKf[0]})`);
  assert(approx(afterKf[1], 100), `Test 1: post-bake keyform.y ≈ 100 (got ${afterKf[1]})`);
}

// ── Test 2: applyArmatureModifier ALSO bakes the keyforms ─────────────

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  applyArmatureModifier('handwear-l');
  const afterKf = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  assert(approx(afterKf[0], 0), `Test 2: keyform.x ≈ 0 (got ${afterKf[0]})`);
  assert(approx(afterKf[1], 100), `Test 2: keyform.y ≈ 100 (got ${afterKf[1]})`);
}

// ── Test 3: Apply Modifier → Apply Pose As Rest produces no double-bake ─

{
  // Apply Modifier removes the armature entry from node.modifiers and
  // bakes the keyform. applyPoseAsRest must NOT re-bake the keyform on
  // this part — it gates on the modifier's presence. Discriminator: a
  // bone-rigged part without an active armature modifier has been
  // Applied (or is unrigged); either way, keyforms are already final.
  setupBoneBakedHandwear({ poseDeg: 90 });
  applyArmatureModifier('handwear-l');
  // Pre-applyPoseAsRest snapshot: keyform should now be (0, 100).
  const midKf = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  assert(approx(midKf[0], 0) && approx(midKf[1], 100),
    `Test 3: post-Apply keyform = (${midKf[0]}, ${midKf[1]}); expected (0, 100)`);
  useProjectStore.getState().applyPoseAsRest();
  const afterKf = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  // After Apply→Apply Pose As Rest, keyform must still be (0, 100) —
  // applyPoseAsRest skipped the bake because no armature modifier.
  assert(approx(afterKf[0], 0), `Test 3: post-Apply+PoseAsRest keyform.x ≈ 0 (got ${afterKf[0]})`);
  assert(approx(afterKf[1], 100), `Test 3: post-Apply+PoseAsRest keyform.y ≈ 100 (got ${afterKf[1]})`);
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

// ── Test 5: keyform with multiple verts is rotated as a rigid block ──

{
  setupBoneBakedHandwear({ poseDeg: 90 });
  // Replace single-vert keyform with a 3-vert one.
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    part.mesh.runtime.keyforms[0].vertexPositions = new Float32Array([
      100, 0,    // (100, 0) → (0, 100)
      0, 100,    // (0, 100) → (-100, 0)
      50, 50,    // (50, 50) → (-50, 50)
    ]);
  });
  useProjectStore.getState().applyPoseAsRest();
  const vp = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.runtime.keyforms[0].vertexPositions;
  assert(approx(vp[0], 0)   && approx(vp[1], 100), `Test 5: v0 (100,0) → (0,100)`);
  assert(approx(vp[2], -100) && approx(vp[3], 0),  `Test 5: v1 (0,100) → (-100,0)`);
  assert(approx(vp[4], -50) && approx(vp[5], 50),  `Test 5: v2 (50,50) → (-50,50)`);
}

console.log(`\nkeyformPoseBake: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
