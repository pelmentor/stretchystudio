// Cubism Adapter — render-equivalence proof.
//
// Without a Cubism Viewer or headless browser we can't run the full
// WebGL pipeline. But the post-chainEval composition is pure math
// (matrix * verts), so we can SIMULATE the renderer in Node and
// compare against the deleted overlay-matrix path byte-for-byte.
//
// Three claims proven here:
//
//   1. EQUIVALENCE — for an all-1.0 weight rigid part, the LBS path
//      with weights=[1,1,…,1] produces vertex positions IDENTICAL
//      (within 1e-9) to what the deleted `applyOverlayMatrixObj`
//      path produced. Math: LBS with w=1 collapses to
//      `out = child·v`, which is exactly the overlay matrix when
//      child = nearest-bone-ancestor.
//
//   2. DECOUPLING — after Apply Modifier on a rigid part, subsequent
//      bone-pose changes do NOT move the part. The Phase-2 renderer
//      composition decision is `kind: 'none'` and no matrix is
//      applied to the verts.
//
//   3. MIGRATION ROUND-TRIP — a pre-v31 project (no rigid weights)
//      goes through `migrateProject` → `seedDefaultRigidWeights` runs
//      → previously-unweighted parts now have weights matching the
//      structural-parent bone → render through LBS produces the same
//      output the old overlay path would have.
//
// Together these three prove (without visual inspection) that:
//   - Phase 2's renderer collapse preserved behavior for rigid parts.
//   - Apply Modifier produces the user-visible "decouple from
//     armature" semantic.
//   - v31 migration restores bone-follow on pre-v31 projects post-load.
//
// Run: node scripts/test/test_cubismAdapter_renderEquivalence.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { computeBoneWorldMatrices, computeBoneParentMap } from '../../src/renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinningObj } from '../../src/renderer/boneSkinning.js';
import { pickBonePostChainComposition } from '../../src/renderer/bonePostChainComposition.js';
import { seedDefaultRigidWeights } from '../../src/store/seedDefaultRigidWeights.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
import { applyArmatureModifier } from '../../src/services/ArmatureModifierService.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';
import { isBoneGroup } from '../../src/store/objectDataAccess.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

/**
 * Reference implementation of the DELETED overlay-matrix path. This
 * mirrors the old `computeBoneOverlayMatrices` + `applyOverlayMatrixObj`
 * combo so we can compare against it byte-for-byte. Frozen here as
 * the equivalence-test oracle.
 */
function legacyOverlayMatrixPath(part, project, verts) {
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  // Walk to nearest bone-group ancestor (same predicate the old code used).
  let cur = part.parent ? byId.get(part.parent) : null;
  while (cur && !isBoneGroup(cur)) {
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  if (!cur) return verts;  // no bone ancestor → no transformation
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  const m = boneWorld.get(cur.id);
  if (!m) return verts;
  // Apply the bone's world matrix to every vertex (the old overlay rule).
  const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
  return verts.map((v) => ({
    x: m0 * v.x + m3 * v.y + m6,
    y: m1 * v.x + m4 * v.y + m7,
  }));
}

/**
 * Phase-2 LBS path: pickBonePostChainComposition + applyTwoBoneSkinningObj.
 * Same math the live render loop runs (CanvasViewport.jsx).
 */
function phase2LBSPath(part, project, verts) {
  const composition = pickBonePostChainComposition(part, part.mesh);
  if (composition.kind !== 'lbs') return verts.map((v) => ({ x: v.x, y: v.y }));
  const out = verts.map((v) => ({ x: v.x, y: v.y }));
  const boneWorld = computeBoneWorldMatrices(project.nodes);
  const boneParents = computeBoneParentMap(project.nodes);
  const childMatrix = boneWorld.get(composition.jointBoneId);
  const parentBoneId = composition.parentBoneId
    ?? boneParents.get(composition.jointBoneId) ?? null;
  const parentMatrix = parentBoneId ? boneWorld.get(parentBoneId) ?? null : null;
  applyTwoBoneSkinningObj(out, parentMatrix, childMatrix, part.mesh.boneWeights);
  return out;
}

// ── CLAIM 1: EQUIVALENCE — rigid LBS ≡ overlay matrix ─────────────

{
  // Setup: torso bone posed 30°; topwear part under torso, originally
  // unweighted (so the OLD path took the overlay branch). After Phase
  // 1, seedDefaultRigidWeights adds [1,1,…,1] weights and Armature
  // modifier. Phase 2 LBS path replaces the overlay path. They MUST
  // produce identical verts.
  const project = {
    version: '0.1', schemaVersion: 31,
    canvas: { width: 1280, height: 1280 },
    textures: [],
    nodes: [
      {
        id: 'torso', type: 'group', boneRole: 'torso', name: 'torso',
        parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
        pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'topwear', type: 'part', name: 'topwear', parent: 'torso',
        mesh: {
          vertices: [
            { x: 600, y: 700 },
            { x: 800, y: 700 },
            { x: 600, y: 900 },
            { x: 800, y: 900 },
          ],
          triangles: [],
          // No boneWeights yet — pre-v31 shape.
        },
      },
    ],
  };

  // Compute the OLD path output FIRST (before mutating).
  const partBefore = project.nodes.find((n) => n.id === 'topwear');
  const restVerts = partBefore.mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const oldOutput = legacyOverlayMatrixPath(partBefore, project, restVerts);

  // Now run the Phase 1 + 2 pipeline: seed rigid weights + synth modifier.
  seedDefaultRigidWeights(project);
  synthesizeModifierStacks(project);

  // Verify Phase 1 actually filled weights + modifier.
  const partAfter = project.nodes.find((n) => n.id === 'topwear');
  assert(Array.isArray(partAfter.mesh.boneWeights),
    'CLAIM 1: Phase 1 seeded mesh.boneWeights');
  assert(partAfter.mesh.boneWeights.length === 4,
    'CLAIM 1: weights length === verts length');
  assert(partAfter.mesh.boneWeights.every((w) => w === 1.0),
    'CLAIM 1: weights all === 1.0 (rigid intent)');
  assert(partAfter.mesh.jointBoneId === 'torso',
    'CLAIM 1: jointBoneId === structural parent bone');
  assert(Array.isArray(partAfter.modifiers)
    && partAfter.modifiers.some((m) => m?.type === 'armature'),
    'CLAIM 1: synth added Armature modifier');

  // Compute Phase 2 path output.
  const newOutput = phase2LBSPath(partAfter, project, restVerts);

  // EQUIVALENCE PROOF: byte-for-byte identical.
  for (let i = 0; i < oldOutput.length; i++) {
    assert(approx(oldOutput[i].x, newOutput[i].x),
      `CLAIM 1 v${i}.x: old=${oldOutput[i].x.toFixed(6)} ≈ new=${newOutput[i].x.toFixed(6)}`);
    assert(approx(oldOutput[i].y, newOutput[i].y),
      `CLAIM 1 v${i}.y: old=${oldOutput[i].y.toFixed(6)} ≈ new=${newOutput[i].y.toFixed(6)}`);
  }
}

// ── CLAIM 1b: equivalence holds for nested bone chains ────────────

{
  // Two-level bone chain: torso → leftArm. topwear under leftArm (nearest
  // bone is leftArm, not torso). Both bones posed. The legacy walk picked
  // leftArm; Phase 2 LBS picks jointBoneId=leftArm (set by seed).
  const project = {
    version: '0.1', schemaVersion: 31,
    canvas: { width: 1280, height: 1280 },
    textures: [],
    nodes: [
      {
        id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
        pose:      { rotation: 15, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'leftArm', type: 'group', boneRole: 'leftArm', parent: 'torso',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 700 },
        pose:      { rotation: 45, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'sleeve', type: 'part', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 480, y: 680 }, { x: 520, y: 680 }, { x: 500, y: 750 }],
          triangles: [],
        },
      },
    ],
  };
  const partBefore = project.nodes.find((n) => n.id === 'sleeve');
  const restVerts = partBefore.mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const oldOutput = legacyOverlayMatrixPath(partBefore, project, restVerts);
  seedDefaultRigidWeights(project);
  synthesizeModifierStacks(project);
  const partAfter = project.nodes.find((n) => n.id === 'sleeve');
  assert(partAfter.mesh.jointBoneId === 'leftArm',
    'CLAIM 1b: rigid weights routed to leftArm (nearest bone), not torso');
  const newOutput = phase2LBSPath(partAfter, project, restVerts);
  for (let i = 0; i < oldOutput.length; i++) {
    assert(approx(oldOutput[i].x, newOutput[i].x),
      `CLAIM 1b v${i}.x: nested chain old===new`);
    assert(approx(oldOutput[i].y, newOutput[i].y),
      `CLAIM 1b v${i}.y: nested chain old===new`);
  }
}

// ── CLAIM 2: DECOUPLING — Apply Modifier breaks bone-follow ────────

{
  // Setup the same kind of part. Apply the Armature modifier. Verify
  // that subsequent bone-pose changes do NOT move the rendered verts.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 31,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'torso', type: 'group', boneRole: 'torso', name: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
          pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'topwear', type: 'part', name: 'topwear', parent: 'torso',
          mesh: {
            vertices: [{ x: 700, y: 800 }],
            triangles: [],
            boneWeights: [1.0],
            jointBoneId: 'torso',
            // BUG-027 keyform bake assumes mesh.runtime.keyforms exists; provide it.
            runtime: {
              bindings: [],
              keyforms: [
                { keyTuple: [0], vertexPositions: new Float32Array([60, 0]) },  // pivot-rel
              ],
              parent: null,
            },
          },
          modifiers: [{
            type: 'armature',
            deformerId: 'torso',
            enabled: true,
            mode: 3,
            data: { jointBoneId: 'torso', parentBoneId: null },
          }],
        },
      ],
    },
  });

  // Snapshot the verts BEFORE Apply (rendered through LBS at torso=30°).
  let project = useProjectStore.getState().project;
  let part = project.nodes.find((n) => n.id === 'topwear');
  const renderBeforeApply = phase2LBSPath(part, project, part.mesh.vertices.map((v) => ({ x: v.x, y: v.y })));

  // Apply the modifier — bakes the LBS-deformed verts into mesh.vertices
  // and removes the modifier.
  const result = applyArmatureModifier('topwear');
  assert(result.baked === true, 'CLAIM 2: applyArmatureModifier returned baked=true');

  project = useProjectStore.getState().project;
  part = project.nodes.find((n) => n.id === 'topwear');

  // Composition decision must be 'none' / 'applied' now (modifier gone).
  const decision = pickBonePostChainComposition(part, part.mesh);
  assert(decision.kind === 'none', `CLAIM 2: post-Apply decision === 'none' (got ${decision.kind})`);
  assert(decision.reason === 'applied', `CLAIM 2: reason === 'applied'`);

  // Now CHANGE the bone pose to something else (60° from 30°).
  useProjectStore.getState().updateProject((p) => {
    const torso = p.nodes.find((n) => n.id === 'torso');
    torso.pose.rotation = 60;
  });
  project = useProjectStore.getState().project;
  part = project.nodes.find((n) => n.id === 'topwear');

  // Render again. Composition is still 'none' → no matrix applied.
  const renderAfterPoseChange = phase2LBSPath(part, project, part.mesh.vertices.map((v) => ({ x: v.x, y: v.y })));

  // The verts MUST equal the baked mesh.vertices (no further bone influence).
  // I.e., changing the bone pose post-Apply produces no change in render.
  assert(approx(renderAfterPoseChange[0].x, part.mesh.vertices[0].x),
    `CLAIM 2: post-Apply pose change does NOT move part (x: ${renderAfterPoseChange[0].x.toFixed(3)} === ${part.mesh.vertices[0].x.toFixed(3)})`);
  assert(approx(renderAfterPoseChange[0].y, part.mesh.vertices[0].y),
    `CLAIM 2: post-Apply pose change does NOT move part (y)`);

  // And the baked verts should match what was rendered before Apply
  // (Apply baked the deformation into rest geometry).
  assert(approx(part.mesh.vertices[0].x, renderBeforeApply[0].x),
    `CLAIM 2: bake captured the pre-Apply render position (x)`);
  assert(approx(part.mesh.vertices[0].y, renderBeforeApply[0].y),
    `CLAIM 2: bake captured the pre-Apply render position (y)`);
}

// ── CLAIM 3: MIGRATION ROUND-TRIP — pre-v31 → v31 → render works ──

{
  // Build a project at schemaVersion < 31 with no rigid weights.
  // migrateProject runs all migrations including v31. Result: weights
  // populated; render through LBS works.
  const project = {
    version: '0.1', schemaVersion: 29,  // pre-v31
    canvas: { width: 1280, height: 1280 },
    textures: [],
    nodes: [
      {
        id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
        pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'topwear', type: 'part', parent: 'torso',
        mesh: {
          vertices: [{ x: 700, y: 800 }],
          triangles: [],
          // no boneWeights, no jointBoneId — pre-v31 unbound state
        },
      },
    ],
  };

  // Pre-migration: render via legacy overlay path produces the
  // expected position (this is what the user saw before Phase 2).
  const partPre = project.nodes.find((n) => n.id === 'topwear');
  const restVerts = partPre.mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const expectedPositions = legacyOverlayMatrixPath(partPre, project, restVerts);

  // Run migration to current.
  migrateProject(project);
  assert(project.schemaVersion === CURRENT_SCHEMA_VERSION,
    `CLAIM 3: schema bumped to ${CURRENT_SCHEMA_VERSION}`);

  const partPost = project.nodes.find((n) => n.id === 'topwear');
  assert(Array.isArray(partPost.mesh.boneWeights),
    'CLAIM 3: v31 migration filled mesh.boneWeights');
  assert(partPost.mesh.jointBoneId === 'torso',
    'CLAIM 3: v31 migration set jointBoneId to nearest bone ancestor');

  // Run the synth so the Armature modifier surfaces (the seedAllRig
  // pipeline does this; v31 alone is just data-shape).
  synthesizeModifierStacks(project);
  const partWithModifier = project.nodes.find((n) => n.id === 'topwear');
  assert(Array.isArray(partWithModifier.modifiers)
    && partWithModifier.modifiers.some((m) => m?.type === 'armature'),
    'CLAIM 3: synthesizeModifierStacks added Armature modifier post-v31');

  // Now the Phase 2 LBS path must produce the SAME positions as the
  // pre-migration legacy overlay path. That's the round-trip proof:
  // pre-v31 projects loaded post-Phase-2 render IDENTICALLY to how
  // they rendered pre-Phase-2.
  const newPositions = phase2LBSPath(partWithModifier, project, restVerts);
  for (let i = 0; i < expectedPositions.length; i++) {
    assert(approx(expectedPositions[i].x, newPositions[i].x),
      `CLAIM 3 v${i}.x: pre-migration overlay === post-migration LBS`);
    assert(approx(expectedPositions[i].y, newPositions[i].y),
      `CLAIM 3 v${i}.y: pre-migration overlay === post-migration LBS`);
  }
}

// ── BONUS CLAIM: idempotent migration — re-running v31 is a no-op ──

{
  const project = {
    version: '0.1', schemaVersion: 29,
    canvas: { width: 1280, height: 1280 },
    nodes: [
      {
        id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
        pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'p', type: 'part', parent: 'torso',
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], triangles: [] },
      },
    ],
  };
  migrateProject(project);
  const after1 = JSON.stringify(project);
  // Force re-migrate by resetting schemaVersion.
  project.schemaVersion = 29;
  migrateProject(project);
  const after2 = JSON.stringify(project);
  assert(after1 === after2,
    'BONUS: v31 idempotent — second run produces identical state');
}

// ── BONUS: bone-routing-intent preserved across migration ──────────

{
  // Hand-only sub-mesh under leftArm with jointBoneId='leftElbow'.
  // computeSkinWeights would have produced these weights at PSD import.
  // The migration must NOT overwrite them.
  const project = {
    version: '0.1', schemaVersion: 29,
    canvas: { width: 1280, height: 1280 },
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', parent: 'torso',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 600 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 500 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'hand', type: 'part', parent: 'leftArm',  // STRUCTURAL parent = leftArm
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          boneWeights: [1.0, 1.0, 1.0],   // all-1.0 from clamp
          jointBoneId: 'leftElbow',        // BUT routed to leftElbow
          triangles: [],
        } },
    ],
  };
  migrateProject(project);
  const part = project.nodes.find((n) => n.id === 'hand');
  // Migration must NOT have overwritten hand.mesh.jointBoneId to leftArm.
  assert(part.mesh.jointBoneId === 'leftElbow',
    'BONUS: hand-only-mesh routing intent preserved (jointBoneId still leftElbow)');
  assert(part.mesh.boneWeights.length === 3 && part.mesh.boneWeights.every((w) => w === 1.0),
    'BONUS: weights preserved');
}

console.log(`\ncubismAdapter_renderEquivalence: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
