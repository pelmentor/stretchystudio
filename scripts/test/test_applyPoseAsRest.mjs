// Unit tests for projectStore.applyPoseAsRest — Blender-style "Apply Pose As Rest".
//
// Properties to verify:
//   1. Mesh visual position is preserved across the bake (i.e. rest verts
//      now equal previously-posed canvas positions).
//   2. All bone poses zero out.
//   3. Bone pivots shift to their visually-current canvas positions.
//   4. Rig-driven bones (pose stays at zero by contract — see Phase 3
//      override-merge work) don't change anything.
//   5. Idempotent: running twice with no further pose changes is a no-op.
//
// Run: node scripts/test/test_applyPoseAsRest.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { computeWorldMatrices } from '../../src/renderer/transforms.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

function setupChain() {
  // root → torso(pose R30°) → mesh leaf at canvas (600, 800).
  // torso pivot at (500, 800).
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 17,
      canvas: { width: 1024, height: 1024 },
      textures: [],
      nodes: [
        {
          id: 'b-torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
          pose:      { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'b-head', type: 'group', boneRole: 'head', name: 'head',
          parent: 'b-torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 400 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'p-shirt', type: 'part', parent: 'b-torso',
          mesh: { vertices: [
            { x: 600, y: 800, restX: 600, restY: 800 },
            { x: 600, y: 700, restX: 600, restY: 700 },
          ] },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0 },
    },
    hasUnsavedChanges: false,
  });
}

// ── Test 1: Visual preservation across bake ─────────────────────────
{
  setupChain();
  const projBefore = useProjectStore.getState().project;
  // Compute the world position of (600, 800) under torso's R30° pose.
  // Vector from pivot (500, 800) to vert: (100, 0). Rotate by 30°:
  // (100*cos30°, 100*sin30°) = (86.602, 50). Add pivot: (586.602, 850).
  const worldBefore = computeWorldMatrices(projBefore.nodes);
  const wmShirtBefore = worldBefore.get('p-shirt');
  const v0 = projBefore.nodes.find(n => n.id === 'p-shirt').mesh.vertices[0];
  const visualX = wmShirtBefore[0] * v0.restX + wmShirtBefore[3] * v0.restY + wmShirtBefore[6];
  const visualY = wmShirtBefore[1] * v0.restX + wmShirtBefore[4] * v0.restY + wmShirtBefore[7];
  assert(nearlyEq(visualX, 586.602, 0.01), `Test 1: pre-bake visual x ≈ 586.602 (got ${visualX.toFixed(3)})`);
  assert(nearlyEq(visualY, 850, 0.01),     `Test 1: pre-bake visual y ≈ 850 (got ${visualY.toFixed(3)})`);

  // Bake.
  useProjectStore.getState().applyPoseAsRest();

  const projAfter = useProjectStore.getState().project;
  const v0After = projAfter.nodes.find(n => n.id === 'p-shirt').mesh.vertices[0];
  // Rest verts should now equal the pre-bake canvas position.
  assert(nearlyEq(v0After.restX, 586.602, 0.01), `Test 1: post-bake restX ≈ 586.602 (got ${v0After.restX.toFixed(3)})`);
  assert(nearlyEq(v0After.restY, 850, 0.01),     `Test 1: post-bake restY ≈ 850 (got ${v0After.restY.toFixed(3)})`);
  // Posed (current) verts equal rest verts.
  assert(nearlyEq(v0After.x, v0After.restX), 'Test 1: post-bake x = restX');
  assert(nearlyEq(v0After.y, v0After.restY), 'Test 1: post-bake y = restY');

  // Visual position should be unchanged: world(p-shirt) @ restNew == visualBefore.
  const worldAfter = computeWorldMatrices(projAfter.nodes);
  const wmShirtAfter = worldAfter.get('p-shirt');
  const visualXAfter = wmShirtAfter[0] * v0After.restX + wmShirtAfter[3] * v0After.restY + wmShirtAfter[6];
  const visualYAfter = wmShirtAfter[1] * v0After.restX + wmShirtAfter[4] * v0After.restY + wmShirtAfter[7];
  assert(nearlyEq(visualXAfter, visualX, 0.01), `Test 1: post-bake visual x preserved (${visualXAfter.toFixed(3)} ≈ ${visualX.toFixed(3)})`);
  assert(nearlyEq(visualYAfter, visualY, 0.01), `Test 1: post-bake visual y preserved (${visualYAfter.toFixed(3)} ≈ ${visualY.toFixed(3)})`);
}

// ── Test 2: All bone poses zero after bake ─────────────────────────
{
  setupChain();
  useProjectStore.getState().applyPoseAsRest();
  const proj = useProjectStore.getState().project;
  for (const n of proj.nodes) {
    if (n.type !== 'group' || !n.boneRole) continue;
    assert(n.pose.rotation === 0, `Test 2: ${n.boneRole} pose.rotation == 0 after bake`);
    assert(n.pose.x === 0,        `Test 2: ${n.boneRole} pose.x == 0 after bake`);
    assert(n.pose.y === 0,        `Test 2: ${n.boneRole} pose.y == 0 after bake`);
    assert(n.pose.scaleX === 1,   `Test 2: ${n.boneRole} pose.scaleX == 1 after bake`);
    assert(n.pose.scaleY === 1,   `Test 2: ${n.boneRole} pose.scaleY == 1 after bake`);
  }
}

// ── Test 3: Bone pivots shift to visually-current positions ────────
{
  setupChain();
  // Pre-bake: head's pivot in canvas-space = torso.world @ (500, 400).
  // torso.world is R30° around (500, 800). Vector from (500,800) to
  // (500, 400) is (0, -400). Rotated 30°: (0*cos30 - (-400)*sin30,
  // 0*sin30 + (-400)*cos30) = (200, -346.41). + (500, 800) = (700, 453.59).
  useProjectStore.getState().applyPoseAsRest();
  const proj = useProjectStore.getState().project;
  const torso = proj.nodes.find(n => n.id === 'b-torso');
  const head  = proj.nodes.find(n => n.id === 'b-head');

  // Torso pivot doesn't move (rotation around it leaves it fixed).
  assert(nearlyEq(torso.transform.pivotX, 500, 0.01), `Test 3: torso pivot X stays 500 (got ${torso.transform.pivotX})`);
  assert(nearlyEq(torso.transform.pivotY, 800, 0.01), `Test 3: torso pivot Y stays 800 (got ${torso.transform.pivotY})`);

  // Head pivot shifts to the visually-current location.
  assert(nearlyEq(head.transform.pivotX, 700, 0.01),    `Test 3: head pivot X → 700 (got ${head.transform.pivotX.toFixed(3)})`);
  assert(nearlyEq(head.transform.pivotY, 453.59, 0.01), `Test 3: head pivot Y → 453.59 (got ${head.transform.pivotY.toFixed(3)})`);
}

// ── Test 4: Idempotent (re-baking with all zero poses is a no-op) ─
{
  setupChain();
  useProjectStore.getState().applyPoseAsRest();
  const after1 = JSON.stringify(useProjectStore.getState().project.nodes);
  useProjectStore.getState().applyPoseAsRest();
  const after2 = JSON.stringify(useProjectStore.getState().project.nodes);
  assert(after1 === after2, 'Test 4: applyPoseAsRest idempotent');
}

// ── Test 5: Zero-pose project → no-op (no geometryVersion bump) ───
{
  // No bones with any pose offset. Bake should not bump geometryVersion.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 17,
      canvas: { width: 800, height: 600 },
      textures: [],
      nodes: [
        { id: 'b-root', type: 'group', boneRole: 'root',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'p-leaf', type: 'part', parent: 'b-root',
          mesh: { vertices: [{ x: 100, y: 100, restX: 100, restY: 100 }] },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 5 },
    },
    hasUnsavedChanges: false,
  });
  useProjectStore.getState().applyPoseAsRest();
  const proj = useProjectStore.getState().project;
  assert(proj.versionControl.geometryVersion === 5, 'Test 5: zero-pose bake leaves geometryVersion alone');
  // Mesh untouched.
  const v = proj.nodes.find(n => n.id === 'p-leaf').mesh.vertices[0];
  assert(v.restX === 100 && v.restY === 100, 'Test 5: zero-pose bake leaves mesh restX/restY alone');
}

console.log(`\napplyPoseAsRest: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
