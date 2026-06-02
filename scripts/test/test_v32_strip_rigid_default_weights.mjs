// v32 migration — strip rigid all-1.0 vertex weights written by the
// retired v31 `seedDefaultRigidWeights` (Cubism Adapter Pattern). Pre-fix
// the migration shipped with no direct behavior test; only the JSDoc
// referenced it. This test pins the four behaviors documented in the
// migration's docstring:
//
//   1. Rigid all-1.0 weights bound to the structural-parent bone get
//      stripped AND the orphan Armature modifier is removed.
//   2. Meaningful per-vertex weights are preserved.
//   3. Bone-routing intent (jointBoneId ≠ structural parent bone, e.g.
//      hand-only sub-mesh parented to forearm but bound to elbow) is
//      preserved verbatim.
//   4. Idempotent: re-running the migration on already-stripped data
//      makes no further changes.
//
// Run: node scripts/test/test_v32_strip_rigid_default_weights.mjs

import { migrateStripRigidDefaultWeights } from '../../src/store/migrations/v32_strip_rigid_default_weights.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeProject(parts, bones) {
  return {
    nodes: [
      ...bones,
      ...parts,
    ],
  };
}

function makeBone(id, parentId, role) {
  return { id, type: 'group', name: id, parent: parentId, boneRole: role };
}

function makePart(id, parentId, mesh, modifiers) {
  const part = { id, type: 'part', name: id, parent: parentId, mesh };
  if (modifiers) part.modifiers = modifiers;
  return part;
}

// ── 1. Rigid all-1.0 weights bound to structural-parent bone get stripped ──
{
  const bones = [
    makeBone('torso', null, 'torso'),
    makeBone('arm',   'torso', 'arm'),
  ];
  const verts = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ];
  const part = makePart('skin', 'arm', {
    vertices: verts,
    boneWeights: [1, 1, 1],
    jointBoneId: 'arm',     // matches structural parent bone
  }, [{ id: 'mod-arm', type: 'armature', data: { jointBoneId: 'arm' } }]);
  const project = makeProject([part], bones);

  const stats = migrateStripRigidDefaultWeights(project);

  assert(stats.partsStripped === 1, 'rigid all-1.0: one part stripped');
  assert(stats.modifiersRemoved === 1, 'rigid all-1.0: orphan armature modifier removed');
  const after = project.nodes.find((n) => n.id === 'skin');
  assert(after && after.mesh && after.mesh.boneWeights === undefined,
    'rigid all-1.0: mesh.boneWeights deleted');
  assert(after && after.mesh && after.mesh.jointBoneId === undefined,
    'rigid all-1.0: mesh.jointBoneId deleted');
  assert(after && after.modifiers === undefined,
    'rigid all-1.0: now-empty modifiers stack deleted');
}

// ── 2. Meaningful per-vertex weights preserved ──
{
  const bones = [
    makeBone('torso', null, 'torso'),
    makeBone('arm',   'torso', 'arm'),
  ];
  const verts = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ];
  // varying weights: 0.2, 0.5, 0.9 — actual per-vertex skinning data
  const part = makePart('skinned', 'arm', {
    vertices: verts,
    boneWeights: [0.2, 0.5, 0.9],
    jointBoneId: 'arm',
  }, [{ id: 'mod-arm', type: 'armature', data: { jointBoneId: 'arm' } }]);
  const project = makeProject([part], bones);

  const stats = migrateStripRigidDefaultWeights(project);

  assert(stats.partsStripped === 0, 'varying weights: not stripped');
  assert(stats.modifiersRemoved === 0, 'varying weights: armature modifier preserved');
  const after = project.nodes.find((n) => n.id === 'skinned');
  assert(after && Array.isArray(after.mesh.boneWeights) && after.mesh.boneWeights.length === 3,
    'varying weights: boneWeights preserved');
  assert(after && after.mesh.jointBoneId === 'arm',
    'varying weights: jointBoneId preserved');
  assert(after && Array.isArray(after.modifiers) && after.modifiers.length === 1,
    'varying weights: armature modifier preserved');
}

// ── 3. Bone-routing intent preserved (jointBoneId ≠ structural parent) ──
{
  // Hand-only sub-mesh: parented to arm but bound to elbow. Weights are
  // numerically all-1.0 (computeSkinWeights saturated past the blend zone)
  // but encode routing intent — must preserve.
  const bones = [
    makeBone('torso', null, 'torso'),
    makeBone('arm',   'torso', 'arm'),
    makeBone('elbow', 'arm',   'elbow'),
  ];
  const verts = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ];
  const part = makePart('hand', 'arm', {
    vertices: verts,
    boneWeights: [1, 1, 1],
    jointBoneId: 'elbow',    // routing intent — NOT structural parent 'arm'
  }, [{ id: 'mod-elbow', type: 'armature', data: { jointBoneId: 'elbow' } }]);
  const project = makeProject([part], bones);

  const stats = migrateStripRigidDefaultWeights(project);

  assert(stats.partsStripped === 0, 'bone-routing intent: not stripped');
  assert(stats.modifiersRemoved === 0, 'bone-routing intent: armature modifier preserved');
  const after = project.nodes.find((n) => n.id === 'hand');
  assert(after && after.mesh.jointBoneId === 'elbow',
    'bone-routing intent: jointBoneId preserved');
  assert(after && Array.isArray(after.mesh.boneWeights),
    'bone-routing intent: boneWeights preserved');
}

// ── 4. Idempotent: second run is a no-op ──
{
  const bones = [
    makeBone('torso', null, 'torso'),
    makeBone('arm',   'torso', 'arm'),
  ];
  const part = makePart('skin', 'arm', {
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    boneWeights: [1, 1, 1],
    jointBoneId: 'arm',
  }, [{ id: 'mod-arm', type: 'armature', data: { jointBoneId: 'arm' } }]);
  const project = makeProject([part], bones);

  const stats1 = migrateStripRigidDefaultWeights(project);
  const stats2 = migrateStripRigidDefaultWeights(project);

  assert(stats1.partsStripped === 1, 'idempotent: first run strips');
  assert(stats2.partsStripped === 0, 'idempotent: second run is a no-op');
  assert(stats2.modifiersRemoved === 0, 'idempotent: second run touches no modifiers');
}

// ── 5. Defensive: null/empty project shapes degrade safely ──
{
  const stats = migrateStripRigidDefaultWeights(null);
  assert(stats.partsStripped === 0 && stats.modifiersRemoved === 0,
    'null project: returns zero stats, no throw');
  const stats2 = migrateStripRigidDefaultWeights({ nodes: [] });
  assert(stats2.partsStripped === 0 && stats2.modifiersRemoved === 0,
    'empty nodes: returns zero stats');
}

console.log(`\nv32_strip_rigid_default_weights: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
