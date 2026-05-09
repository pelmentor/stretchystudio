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
import { applyArmatureModifier, bindArmatureModifier } from '../../src/services/ArmatureModifierService.js';
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

// ── Test 3: vertex group data PERSISTS on the mesh after Apply ────────

{
  // Mirrors Blender — Apply Modifier doesn't touch `me->dvert`. Vertex
  // groups stay on the Mesh datablock so the next modifier add (or
  // re-init) re-binds automatically. Render-loop skinning is gated on
  // the modifier's presence, NOT on boneWeights, so no double-apply.
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  assert(Array.isArray(after.mesh.boneWeights), 'Test 3: mesh.boneWeights PERSISTS after apply (vertex group data)');
  assert(after.mesh.boneWeights.length === 2, 'Test 3: mesh.boneWeights length unchanged');
  assert(after.mesh.jointBoneId === 'leftElbow', 'Test 3: mesh.jointBoneId PERSISTS (vertex group binding)');
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

// ── Test 7a: re-bind round-trip — apply, then re-synth puts modifier back ─

{
  // Blender-style workflow: Apply removes the modifier but keeps
  // vertex groups; next modifier-add (or our synth-on-Init-Rig)
  // re-emits an Armature against the still-present groups.
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const before = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  assert(!before.modifiers || !before.modifiers.some((m) => m?.type === 'armature'),
    'Test 7a: post-apply has no armature modifier');
  // Re-run the synth (what seedAllRig does on Init Rig).
  const { synthesizeModifierStacks } = await import('../../src/store/deformerNodeSync.js');
  useProjectStore.getState().updateProject((proj) => {
    synthesizeModifierStacks(proj);
  });
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const armature = (after.modifiers ?? []).find((m) => m?.type === 'armature');
  assert(!!armature, 'Test 7a: re-synth re-emits Armature modifier (bind picks up persistent boneWeights)');
  assert(armature?.data?.jointBoneId === 'leftElbow', 'Test 7a: re-bound to the same joint bone');
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

// ── Test 8: bindArmatureModifier — adds modifier from persistent groups ─

{
  setupArmedHandwear();
  // Apply first to get into "vertex groups present, no modifier" state.
  applyArmatureModifier('handwear-l');
  const result = bindArmatureModifier('handwear-l');
  assert(result.bound === true, 'Test 8: bind returns bound=true');
  assert(result.jointBoneId === 'leftElbow', 'Test 8: bind reports jointBoneId');
  assert(result.parentBoneId === 'leftArm', 'Test 8: bind reports parentBoneId');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const armature = (after.modifiers ?? []).find((m) => m?.type === 'armature');
  assert(!!armature, 'Test 8: Armature modifier added to stack');
  assert(armature?.data?.jointBoneId === 'leftElbow', 'Test 8: bound to correct joint');
  assert(armature?.data?.parentBoneRole === 'leftArm', 'Test 8: parent bone role recorded');
  assert(armature?.enabled === true, 'Test 8: bound modifier is enabled');
}

// ── Test 9: bind is idempotent — returns already-bound on second call ─

{
  setupArmedHandwear(); // already has Armature modifier
  const result = bindArmatureModifier('handwear-l');
  assert(result.bound === false, 'Test 9: second bind returns bound=false');
  assert(result.reason === 'already-bound', 'Test 9: reason=already-bound');
}

// ── Test 10: bind on a rigid-follow part adds empty modifier ──────────
// 2026-05-09 (afternoon) — Cubism Adapter revert. Adding an Armature
// modifier to a mesh without vertex groups is legal (mirrors Blender's
// "Add Modifier → Armature" UX). The modifier resolves jointBoneId
// from the part's nearest bone-group ancestor; the mesh continues
// to rigid-follow via the overlay path until the user paints weights.

{
  setupArmedHandwear();
  // Strip the modifier AND vertex groups (simulates a rigid-follow
  // part that's never had per-vertex skinning).
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    delete part.modifiers;
    delete part.mesh.boneWeights;
    delete part.mesh.jointBoneId;
  });
  const result = bindArmatureModifier('handwear-l');
  assert(result.bound === true, 'Test 10: rigid-follow part + bind → bound=true (empty modifier)');
  // handwear-l.parent is leftArm (a bone) — walked via ancestor chain.
  assert(result.jointBoneId === 'leftArm',
    `Test 10: jointBoneId resolved to nearest bone ancestor (got ${result.jointBoneId})`);
  // Modifier is on the stack with the resolved jointBoneId.
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const arm = (after.modifiers ?? []).find((m) => m?.type === 'armature');
  assert(!!arm, 'Test 10: Armature modifier added');
  assert(arm.data.jointBoneId === 'leftArm',
    `Test 10: modifier.data.jointBoneId === 'leftArm' (got ${arm.data.jointBoneId})`);
}

// ── Test 10b: bind fails when there's no bone-group ancestor ──────────

{
  // Part with no bone in its ancestry → bind has no target. Fails
  // cleanly with `no-bone-ancestor` reason.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 29,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        { id: 'plain-folder', type: 'group', name: 'folder', parent: null,
          transform: { pivotX: 0, pivotY: 0 } },
        { id: 'orphan-mesh', type: 'part', name: 'orphan', parent: 'plain-folder',
          mesh: { vertices: [{ x: 0, y: 0 }], triangles: [] } },
      ],
    },
  });
  const result = bindArmatureModifier('orphan-mesh');
  assert(result.bound === false, 'Test 10b: no bone ancestor → bound=false');
  assert(result.reason === 'no-bone-ancestor',
    `Test 10b: reason='no-bone-ancestor' (got ${result.reason})`);
}

// ── Test 11: Apply → Bind round-trip — bake survives, modifier returns ─

{
  setupArmedHandwear();
  // Capture the rest verts (visible deformation will be baked into them).
  const rest0 = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  applyArmatureModifier('handwear-l');
  const baked = useProjectStore.getState().project.nodes
    .find((n) => n.id === 'handwear-l').mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  // Bake should differ from rest under a 90° pose.
  assert(!approx(baked[0].x, rest0[0].x) || !approx(baked[0].y, rest0[0].y),
    'Test 11: bake actually modified verts (rest 90° pose → non-zero delta)');
  bindArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');
  const armature = (after.modifiers ?? []).find((m) => m?.type === 'armature');
  assert(!!armature, 'Test 11: Armature modifier re-bound after Apply');
  // Mesh.vertices is still the BAKED state — bind doesn't unbake anything.
  assert(approx(after.mesh.vertices[0].x, baked[0].x), 'Test 11: mesh.vertices stays baked');
  assert(approx(after.mesh.vertices[0].y, baked[0].y), 'Test 11: mesh.vertices stays baked (y)');
  // Vertex groups are still present.
  assert(Array.isArray(after.mesh.boneWeights), 'Test 11: vertex groups still on the mesh');
  assert(after.mesh.jointBoneId === 'leftElbow', 'Test 11: jointBoneId still on the mesh');
}

// ── Cubism Adapter Phase 2 — post-Apply composition decision ─────────
// After Apply on a rigid part (all-1.0 weights), the renderer's
// `pickBonePostChainComposition` MUST return kind:'none' so the part
// is decoupled from the armature. Pre-Phase-2 the renderer would have
// fallen through to the rigid overlay-matrix path and double-applied
// the bone pose (BUG-028). Phase 2 deletes that branch.

{
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');

  // Use the same composition helper the renderer uses.
  const { pickBonePostChainComposition } = await import('../../src/renderer/bonePostChainComposition.js');
  const decision = pickBonePostChainComposition(after, after.mesh);
  assert(decision.kind === 'none',
    `Phase 2: post-Apply rigid part → kind 'none' (got ${decision.kind})`);
  assert(decision.reason === 'applied',
    `Phase 2: reason 'applied' (got ${decision.reason})`);
}

// ── Cubism Adapter Phase 2 — bind on rigid part restores 'lbs' decision ─

{
  setupArmedHandwear();
  applyArmatureModifier('handwear-l');
  bindArmatureModifier('handwear-l');
  const after = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l');

  const { pickBonePostChainComposition } = await import('../../src/renderer/bonePostChainComposition.js');
  const decision = pickBonePostChainComposition(after, after.mesh);
  assert(decision.kind === 'lbs',
    `Phase 2: re-bind on rigid part → kind 'lbs' (got ${decision.kind})`);
  assert(decision.jointBoneId === 'leftElbow',
    `Phase 2: re-bind preserves jointBoneId='leftElbow' (got ${decision.jointBoneId})`);
}

console.log(`\napplyArmatureModifier: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
