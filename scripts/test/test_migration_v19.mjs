// Tests for the v19 schema migration (Phase 1C bone-as-Armature split).
//
// The migration walks every bone tree (rooted at top-level bone groups)
// and lifts rest data into a sibling `armatureData` node. Pose data on
// the bone group migrates from flat `node.pose` to the Blender
// PoseChannel pattern: `node.pose.channels[boneId]`. Bone-group nodes
// keep `type: 'group', boneRole` for backward-compat through Phase 1C-flip.
//
// Tests verify: lossless rest hoist, pose-channel migration, idempotence,
// helper transparency (getArmature reads v19 path; getBonePose reads
// channelised pose), top-level-bone detection, multi-tree projects.
//
// Run: node scripts/test/test_migration_v19.mjs

import {
  getArmature,
  getBonePose,
  getBoneByRole,
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

// Reimplement the v19 migration for tests so we can run it before the
// CURRENT_SCHEMA_VERSION bump. Mirrors `MIGRATIONS[19]` in the source.
function runV19Direct(project) {
  if (!Array.isArray(project.nodes)) return project;
  const existingIds = new Set();
  for (const n of project.nodes) {
    if (n?.id) existingIds.add(n.id);
  }
  /** @type {Set<string>} */
  const boneIds = new Set();
  for (const n of project.nodes) {
    if (!n || n.type !== 'group' || !n.boneRole) continue;
    boneIds.add(n.id);
  }
  /** @type {Array<object>} */
  const topLevelBones = [];
  for (const n of project.nodes) {
    if (!boneIds.has(n.id)) continue;
    const parentIsBone = n.parent && boneIds.has(n.parent);
    if (!parentIsBone) topLevelBones.push(n);
  }
  if (topLevelBones.length === 0) return project;
  const newDataNodes = [];
  const collectBones = (root) => {
    const out = [];
    const stack = [root];
    while (stack.length > 0) {
      const cur = stack.pop();
      const t = cur.transform ?? null;
      out.push({
        id: cur.id,
        name: cur.name ?? cur.id,
        role: cur.boneRole ?? null,
        parent: (cur.parent && boneIds.has(cur.parent)) ? cur.parent : null,
        restPivot: { x: t?.pivotX ?? 0, y: t?.pivotY ?? 0 },
      });
      for (const child of project.nodes) {
        if (child.parent === cur.id && boneIds.has(child.id)) {
          stack.push(child);
        }
      }
    }
    return out;
  };
  for (const root of topLevelBones) {
    if (typeof root.dataId === 'string' && existingIds.has(root.dataId)) continue;
    let dataId = `${root.id}__armature`;
    if (existingIds.has(dataId)) {
      let i = 2;
      while (existingIds.has(`${root.id}__armature${i}`)) i++;
      dataId = `${root.id}__armature${i}`;
    }
    existingIds.add(dataId);
    const bones = collectBones(root);
    newDataNodes.push({ id: dataId, type: 'armatureData', bones });
    root.dataId = dataId;
  }
  for (const n of project.nodes) {
    if (!boneIds.has(n.id)) continue;
    const flatPose = n.pose;
    if (flatPose && typeof flatPose === 'object' && !flatPose.channels) {
      n.pose = { channels: { [n.id]: flatPose } };
    }
  }
  if (newDataNodes.length > 0) project.nodes.push(...newDataNodes);
  return project;
}

function makeProject() {
  return {
    nodes: [
      // Non-bone nodes — should not surface in armature view.
      { id: 'p1', type: 'part', name: 'face', dataId: 'p1__data' },
      { id: 'p1__data', type: 'meshData', vertices: [] },
      // Folder group (no boneRole).
      { id: 'g_folder', type: 'group', name: 'Costume Folder' },
      // Single armature tree: head -> neck (with neck child of head).
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
        pose: { rotation: 2, x: 1, y: 0, scaleX: 1, scaleY: 1 },
      },
      // Separate armature tree: leftElbow as its own root.
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

// ── Migration: hoists rest data into armatureData nodes ──
{
  const project = makeProject();
  runV19Direct(project);

  const headRoot = project.nodes.find((n) => n.id === 'g_head');
  const elbowRoot = project.nodes.find((n) => n.id === 'g_left_elbow');
  const neck = project.nodes.find((n) => n.id === 'g_neck');
  const headArm = project.nodes.find((n) => n.id === 'g_head__armature');
  const elbowArm = project.nodes.find((n) => n.id === 'g_left_elbow__armature');
  const folder = project.nodes.find((n) => n.id === 'g_folder');

  assertEq(headRoot.dataId, 'g_head__armature', 'head root gains dataId');
  assertEq(elbowRoot.dataId, 'g_left_elbow__armature', 'elbow root gains dataId (separate tree)');
  assert(!('dataId' in neck), 'neck (non-root bone) does NOT get dataId');
  assert(!('dataId' in folder), 'folder (non-bone) does NOT get dataId');

  assert(headArm?.type === 'armatureData', 'head armatureData exists');
  assertEq(headArm.bones.length, 2, 'head tree has head + neck');
  const headBoneRecord = headArm.bones.find((b) => b.id === 'g_head');
  assertEq(headBoneRecord.role, 'head', 'head bone role preserved');
  assertEq(headBoneRecord.restPivot, { x: 100, y: 200 }, 'head rest pivot lifted');
  assertEq(headBoneRecord.parent, null, 'head root parent is null');
  const neckBoneRecord = headArm.bones.find((b) => b.id === 'g_neck');
  assertEq(neckBoneRecord.parent, 'g_head', 'neck parent points to head');

  assert(elbowArm?.type === 'armatureData', 'elbow armatureData exists');
  assertEq(elbowArm.bones.length, 1, 'elbow tree has just elbow');
  assertEq(elbowArm.bones[0].role, 'leftElbow', 'elbow role preserved');
}

// ── Migration: lifts flat node.pose → pose.channels[boneId] ──
{
  const project = makeProject();
  runV19Direct(project);
  const head = project.nodes.find((n) => n.id === 'g_head');
  const neck = project.nodes.find((n) => n.id === 'g_neck');
  const elbow = project.nodes.find((n) => n.id === 'g_left_elbow');

  assert(head.pose.channels !== undefined, 'head pose has channels map');
  assertEq(head.pose.channels['g_head'].rotation, 5, 'head pose channel preserves rotation');

  assertEq(neck.pose.channels['g_neck'].rotation, 2, 'neck pose channel preserves rotation');
  assertEq(neck.pose.channels['g_neck'].x, 1, 'neck pose channel preserves x');

  // Bone with no flat pose pre-migration: leaves node.pose untouched.
  assert(elbow.pose === undefined || !('channels' in (elbow.pose ?? {})),
    'pose-less bone unchanged');
}

// ── Idempotence: re-running migration is a no-op ──
{
  const project = makeProject();
  runV19Direct(project);
  const before = JSON.stringify(project.nodes);
  runV19Direct(project);
  const after = JSON.stringify(project.nodes);
  assertEq(after, before, 'second migration pass is a no-op');
}

// ── No bones project: migration is a no-op ──
{
  const project = { nodes: [{ id: 'p1', type: 'part' }] };
  runV19Direct(project);
  assert(!project.nodes.some((n) => n.type === 'armatureData'), 'no-bones project produces no armatureData');
}

// ── Helper transparency: getArmature picks v19 armatureData when present ──
{
  const project = makeProject();
  runV19Direct(project);
  const armature = getArmature(project);
  // Today's helper picks the FIRST armatureData found. With multiple
  // trees the project will have multiple — verify the picked one has
  // bones populated. (Phase 1C-flip will likely return multi-armature.)
  assert(armature !== null, 'getArmature returns view from v19 shape');
  assert(armature.bones.length >= 1, 'view has bones');
  assert(armature.id.endsWith('__armature') || armature.id.endsWith('__armature2'),
    'returned id is one of the new armatureData node ids');
}

// ── Helper transparency: getBonePose reads channelised v19 pose ──
{
  const project = makeProject();
  runV19Direct(project);
  const head = project.nodes.find((n) => n.id === 'g_head');
  const neck = project.nodes.find((n) => n.id === 'g_neck');
  const elbow = project.nodes.find((n) => n.id === 'g_left_elbow');

  assertEq(getBonePose(head)?.rotation, 5, 'getBonePose reads channelised head pose');
  assertEq(getBonePose(neck)?.rotation, 2, 'getBonePose reads channelised neck pose');
  // Elbow had no pre-existing pose; getBonePose returns identity default.
  assertEq(
    getBonePose(elbow),
    { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    'getBonePose identity for unposed bone',
  );
}

// ── Helper transparency: getBonePose still reads v18 flat pose ──
{
  // Pre-migration project: pose is flat directly on node.
  const project = makeProject();
  const head = project.nodes.find((n) => n.id === 'g_head');
  // Without runV19Direct, head.pose is { rotation: 5, ... } flat.
  assertEq(getBonePose(head)?.rotation, 5, 'getBonePose still reads v18 flat pose');
}

// ── getBoneByRole works on both v18 and v19 ──
{
  const v18Project = makeProject();
  assert(getBoneByRole(v18Project, 'head')?.id === 'g_head', 'v18: find head by role');
  assert(getBoneByRole(v18Project, 'leftElbow')?.id === 'g_left_elbow', 'v18: find elbow by role');

  const v19Project = makeProject();
  runV19Direct(v19Project);
  assert(getBoneByRole(v19Project, 'head')?.id === 'g_head', 'v19: find head by role');
  assert(getBoneByRole(v19Project, 'leftElbow')?.id === 'g_left_elbow', 'v19: find elbow by role');
}

// ── Round-trip: migrate(v18) is structurally equal to migrate(migrate(v18)) ──
{
  const project = makeProject();
  const once = JSON.parse(JSON.stringify(project));
  runV19Direct(once);
  const twice = JSON.parse(JSON.stringify(project));
  runV19Direct(twice);
  runV19Direct(twice);
  assertEq(twice, once, 'round-trip migrate twice == migrate once');
}

console.log(`migration_v19: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
