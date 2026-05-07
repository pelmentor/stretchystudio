// Tests for the Phase 1C armature scaffolding helpers in
// src/store/objectDataAccess.js: getArmature / getBoneByRole /
// getBoneByName / getBonesIn.
//
// Today these helpers operate on the flat `project.nodes` shape (bones
// are `group + boneRole` entries). Post-Phase-1C-flip they'll resolve
// `Object.dataId → Armature.bones[]`. The helpers are the single
// migration point.
//
// Run: node scripts/test/test_armatureHelpers.mjs

import {
  getArmature,
  getBoneByRole,
  getBoneByName,
  getBonesIn,
  isBoneGroup,
} from '../../src/store/objectDataAccess.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`);
}

function makeProject() {
  return {
    nodes: [
      // Non-bone nodes — should not surface in armature view.
      { id: 'p1', type: 'part', name: 'face', mesh: { vertices: [] } },
      { id: 'g_folder', type: 'group', name: 'folder' },
      { id: 'd1', type: 'deformer', name: 'BodyXWarp' },
      // Bones — flat list under a synthetic armature today.
      {
        id: 'g_head',
        type: 'group',
        name: 'head_bone',
        boneRole: 'head',
        parent: null,
        transform: { pivotX: 100, pivotY: 200, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        pose: { rotation: 5, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'g_neck',
        type: 'group',
        name: 'neck_bone',
        boneRole: 'neck',
        parent: 'g_head',
        transform: { pivotX: 50, pivotY: 100, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'g_left_elbow',
        type: 'group',
        name: 'leftElbowBone',
        boneRole: 'leftElbow',
        parent: null,
        transform: { pivotX: 25, pivotY: 75, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      },
    ],
  };
}

// ── getArmature ──
{
  const project = makeProject();
  const armature = getArmature(project);
  assert(armature !== null, 'armature is non-null with bones present');
  assertEq(armature.id, '__armature__', 'armature has synthetic id today');
  assertEq(armature.bones.length, 3, 'armature has 3 bones');
  const head = armature.bones.find((b) => b.id === 'g_head');
  assertEq(head.role, 'head', 'head bone has role');
  assertEq(head.name, 'head_bone', 'head bone has name');
  assertEq(head.restPivot, { x: 100, y: 200 }, 'head bone restPivot');
  assertEq(head.pose, { rotation: 5, x: 0, y: 0, scaleX: 1, scaleY: 1 }, 'head bone pose');
  assertEq(head.parent, null, 'head bone parent is null at root');
  const neck = armature.bones.find((b) => b.id === 'g_neck');
  assertEq(neck.parent, 'g_head', 'neck bone parent is head id');
  // Bone with no `pose` on the node — defaults to identity.
  const elbow = armature.bones.find((b) => b.id === 'g_left_elbow');
  assertEq(elbow.pose, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, 'identity pose default');
}

// ── getArmature on bone-less project ──
{
  const project = { nodes: [{ id: 'p1', type: 'part', mesh: null }] };
  assert(getArmature(project) === null, 'no-bones → null armature');
  assert(getArmature(null) === null, 'null project → null armature');
  assert(getArmature({}) === null, 'project without nodes → null armature');
}

// ── getBoneByRole ──
{
  const project = makeProject();
  assert(getBoneByRole(project, 'head')?.id === 'g_head', 'find head by role');
  assert(getBoneByRole(project, 'neck')?.id === 'g_neck', 'find neck by role');
  assert(getBoneByRole(project, 'leftElbow')?.id === 'g_left_elbow', 'find leftElbow by role');
  assert(getBoneByRole(project, 'rightElbow') === null, 'unknown role → null');
  assert(getBoneByRole(null, 'head') === null, 'null project → null');
  // Defensive: groups without boneRole shouldn't match even if name matches.
  assert(getBoneByRole(project, 'folder') === null, 'folder name not bone role');
}

// ── getBoneByName ──
{
  const project = makeProject();
  assertEq(getBoneByName(project, 'head_bone')?.id, 'g_head', 'find by name');
  assertEq(getBoneByName(project, 'neck_bone')?.id, 'g_neck', 'find neck by name');
  assert(getBoneByName(project, 'face') === null, 'name=face is a part not bone');
  assert(getBoneByName(project, 'folder') === null, 'plain group not returned');
  assert(getBoneByName(project, 'nonexistent') === null, 'unknown name → null');
}

// ── getBonesIn ──
{
  const project = makeProject();
  const bones = getBonesIn(project);
  assertEq(bones.length, 3, '3 bones found in project');
  for (const b of bones) {
    assert(isBoneGroup(b), 'every returned node is a bone group');
  }
  assertEq(getBonesIn(null), [], 'null project → empty array');
  assertEq(getBonesIn({}), [], 'no-nodes project → empty array');
}

// ── Round-trip: every bone in the armature view round-trips back to the
//    underlying node via id ──
{
  const project = makeProject();
  const armature = getArmature(project);
  for (const bone of armature.bones) {
    const node = project.nodes.find((n) => n.id === bone.id);
    assert(node && isBoneGroup(node), `bone ${bone.id} round-trips to a real bone group`);
  }
}

console.log(`armatureHelpers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
