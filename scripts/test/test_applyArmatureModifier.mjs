// BONE_ARMATURE_INDEPENDENCE Phase B — applyArmatureModifier operator.
//
// Mirrors Blender's `modifier_apply_obdata` for the Armature modifier
// (`reference/blender/source/blender/editors/object/object_modifier.cc:1050`):
// bake the current visible deformation into mesh.vertices and remove
// the modifier from node.modifiers[]. After Apply, the part is no
// longer skinned to the armature.
//
// Properties to verify:
//   1. mesh.vertices is mutated to the LBS-deformed positions.
//   2. Armature modifier is removed from node.modifiers[].
//   3. mesh.boneWeights and mesh.jointBoneId are dropped (so the
//      render-loop skinning doesn't double-apply on the now-baked rest).
//   4. No-op when there is no Armature modifier on the part.
//   5. Bake result == two-bone LBS output (byte-comparable to viewport).
//
// Run: node scripts/test/test_applyArmatureModifier.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { applyArmatureModifier } from '../../src/services/ArmatureModifierService.js';
import {
  computeBoneWorldMatrices,
} from '../../src/renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinningObj } from '../../src/renderer/boneSkinning.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

function setupArmedHandwear() {
  // leftArm@(0,0) posed 90°; leftElbow@(100,0) at rest.
  // handwear-l rest verts at (200, 0) and (1, 0). Both weighted to leftElbow.
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
          pose:      { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow',
          parent: 'leftArm',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 0 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
          rigParent: null,
          mesh: {
            vertices: [{ x: 200, y: 0 }, { x: 1, y: 0 }],
            triangles: [],
            boneWeights: [1, 1],
            jointBoneId: 'leftElbow',
          },
          modifiers: [
            {
              type: 'armature',
              deformerId: 'leftElbow',
              enabled: true,
              mode: 3,
              data: {
                jointBoneId: 'leftElbow',
                jointBoneRole: 'leftElbow',
                parentBoneId: 'leftArm',
                parentBoneRole: 'leftArm',
                deformFlag: 1,
                vertexGroupName: '',
              },
            },
          ],
        },
      ],
    },
  });
  // Empty paramValues (slider at 0) — chainEval should produce rest geometry.
  useParamValuesStore.setState({ values: {} });
}

// ── Test 1: bake matches two-bone LBS output ──────────────────────────

{
  setupArmedHandwear();
  const project = useProjectStore.getState().project;
  // Compute the EXPECTED post-bake verts independently.
  const restVerts = project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices;
  const expected = restVerts.map((v) => ({ x: v.x, y: v.y }));
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  applyTwoBoneSkinningObj(expected, boneWorld.get('leftArm'), boneWorld.get('leftElbow'), [1, 1]);

  const result = applyArmatureModifier('handwear-l');
  assert(result.baked === true, 'Test 1: applyArmatureModifier returns baked=true');
  assert(result.vertCount === 2, 'Test 1: bake reports 2 verts');

  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  assert(approx(after.mesh.vertices[0].x, expected[0].x), `Test 1: v0.x baked (${after.mesh.vertices[0].x.toFixed(3)} ≈ ${expected[0].x.toFixed(3)})`);
  assert(approx(after.mesh.vertices[0].y, expected[0].y), 'Test 1: v0.y baked');
  assert(approx(after.mesh.vertices[1].x, expected[1].x), 'Test 1: v1.x baked');
  assert(approx(after.mesh.vertices[1].y, expected[1].y), 'Test 1: v1.y baked');
}

// ── Test 2: Armature modifier is removed after Apply ─────────────────

{
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const hasArmature = Array.isArray(after.modifiers)
    && after.modifiers.some((m) => m?.type === 'armature');
  assert(!hasArmature, 'Test 2: Armature modifier removed after Apply');
}

// ── Test 3: boneWeights + jointBoneId dropped (no double-LBS at render) ─

{
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  assert(after.mesh.boneWeights === undefined, 'Test 3: mesh.boneWeights dropped');
  assert(after.mesh.jointBoneId === undefined, 'Test 3: mesh.jointBoneId dropped');
}

// ── Test 4: no-op when part has no Armature modifier ─────────────────

{
  setupArmedHandwear();
  // Strip the Armature modifier first.
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    delete part.modifiers;
  });
  const before = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices.map((v) => ({ ...v }));
  const result = applyArmatureModifier('handwear-l');
  assert(result.baked === false, 'Test 4: baked=false when no armature modifier');
  assert(result.reason === 'no-armature-modifier', 'Test 4: reason field set');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices;
  assert(after[0].x === before[0].x && after[0].y === before[0].y, 'Test 4: vertices unchanged');
}

// ── Test 5: idempotent — applying again is a no-op ────────────────────

{
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const afterFirst = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices.map((v) => ({ ...v }));
  const result = applyArmatureModifier('handwear-l');
  assert(result.baked === false, 'Test 5: second call returns baked=false');
  const afterSecond = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices;
  assert(approx(afterFirst[0].x, afterSecond[0].x) && approx(afterFirst[0].y, afterSecond[0].y),
    'Test 5: vertices unchanged on second call');
}

// ── Test 6: missing partId ────────────────────────────────────────────

{
  setupArmedHandwear();
  const result = applyArmatureModifier('does-not-exist');
  assert(result.baked === false, 'Test 6: missing partId → baked=false');
  assert(result.reason === 'not-a-part', 'Test 6: reason=not-a-part');
}

// ── Test 7: bake preserves visual position (LBS-equivalence) ─────────

{
  setupArmedHandwear();
  // Capture the visual position via direct LBS (what viewport renders).
  const project = useProjectStore.getState().project;
  const partBefore = project.nodes.find((n) => n.id === 'handwear-l');
  const visualVerts = partBefore.mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  applyTwoBoneSkinningObj(
    visualVerts,
    boneWorld.get('leftArm'),
    boneWorld.get('leftElbow'),
    partBefore.mesh.boneWeights,
  );
  // Bake.
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  // The baked rest now equals the previously-visual position. With the
  // modifier removed, no further skinning is applied — what the
  // viewport renders is exactly mesh.vertices.
  for (let i = 0; i < visualVerts.length; i++) {
    assert(
      approx(after.mesh.vertices[i].x, visualVerts[i].x) &&
        approx(after.mesh.vertices[i].y, visualVerts[i].y),
      `Test 7: v${i} baked rest == previous visual`,
    );
  }
}

console.log(`\napplyArmatureModifier: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
