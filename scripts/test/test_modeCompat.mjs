// Tests for src/modes/modeCompat.js — Blender-style mode compatibility
// table — and the `getDataKind` classifier in objectDataAccess.js.
//
// Centralising mode→data-kind compatibility means dispatchers (ModePill,
// Tab keybind, operator registry) don't drift apart over time. These
// tests pin the table so any silent change shows up in CI.
//
// Run: node scripts/test/test_modeCompat.mjs

import {
  modeCompatTest,
  modesForDataKind,
  MODE_OBJECT,
  MODE_EDIT_MESH,
  MODE_POSE,
  MODE_WEIGHT_PAINT,
  MODE_BLEND_SHAPE,
  MODE_SCULPT,
  MODE_VERTEX_PAINT,
  MODE_TEXTURE_PAINT,
} from '../../src/modes/modeCompat.js';
import { getDataKind } from '../../src/store/objectDataAccess.js';

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

// ── Constants ──
{
  assert(MODE_OBJECT === null, 'MODE_OBJECT is null (the "no edit mode" sentinel)');
  assert(MODE_EDIT_MESH === 'mesh', 'MODE_EDIT_MESH legacy slot value preserved');
  assert(MODE_POSE === 'skeleton', 'MODE_POSE legacy slot value preserved');
  assert(MODE_WEIGHT_PAINT === 'weightPaint', 'MODE_WEIGHT_PAINT slot value');
  assert(MODE_BLEND_SHAPE === 'blendShape', 'MODE_BLEND_SHAPE slot value');
}

// ── modeCompatTest: Object Mode is universal ──
{
  for (const k of ['mesh', 'armature', 'empty', 'deformer', 'unknown', null, undefined]) {
    assert(modeCompatTest(k, MODE_OBJECT), `MODE_OBJECT legal for dataKind=${k}`);
    assert(modeCompatTest(k, null), `null mode legal for dataKind=${k}`);
    assert(modeCompatTest(k, undefined), `undefined mode legal for dataKind=${k}`);
  }
}

// ── Mesh data-kind allows mesh-edit + paint modes ──
{
  assert(modeCompatTest('mesh', MODE_EDIT_MESH), 'mesh: Edit Mode legal');
  assert(modeCompatTest('mesh', MODE_WEIGHT_PAINT), 'mesh: Weight Paint legal');
  assert(modeCompatTest('mesh', MODE_BLEND_SHAPE), 'mesh: Blend Shape legal');
  assert(modeCompatTest('mesh', MODE_SCULPT), 'mesh: Sculpt legal (table-only, unimpl)');
  assert(modeCompatTest('mesh', MODE_VERTEX_PAINT), 'mesh: Vertex Paint legal (table-only)');
  assert(modeCompatTest('mesh', MODE_TEXTURE_PAINT), 'mesh: Texture Paint legal (table-only)');
  assert(!modeCompatTest('mesh', MODE_POSE), 'mesh: Pose Mode REJECTED');
}

// ── Armature data-kind allows pose only (Edit collapsed into Pose 9df561f) ──
{
  assert(modeCompatTest('armature', MODE_POSE), 'armature: Pose Mode legal');
  assert(!modeCompatTest('armature', MODE_EDIT_MESH), 'armature: mesh Edit Mode REJECTED');
  assert(!modeCompatTest('armature', MODE_WEIGHT_PAINT), 'armature: Weight Paint REJECTED');
  assert(!modeCompatTest('armature', MODE_BLEND_SHAPE), 'armature: Blend Shape REJECTED');
  assert(!modeCompatTest('armature', MODE_SCULPT), 'armature: Sculpt REJECTED');
}

// ── Empty data-kind allows Object Mode only ──
{
  assert(modeCompatTest('empty', MODE_OBJECT), 'empty: Object Mode legal');
  for (const m of [MODE_EDIT_MESH, MODE_POSE, MODE_WEIGHT_PAINT, MODE_BLEND_SHAPE]) {
    assert(!modeCompatTest('empty', m), `empty: ${m} REJECTED`);
  }
}

// ── Deformer data-kind allows Object Mode only ──
{
  assert(modeCompatTest('deformer', MODE_OBJECT), 'deformer: Object Mode legal');
  for (const m of [MODE_EDIT_MESH, MODE_POSE, MODE_WEIGHT_PAINT, MODE_BLEND_SHAPE]) {
    assert(!modeCompatTest('deformer', m), `deformer: ${m} REJECTED`);
  }
}

// ── Unknown / null dataKind: only Object Mode passes (defensive) ──
{
  assert(modeCompatTest(null, MODE_OBJECT), 'null dataKind: Object Mode legal');
  assert(modeCompatTest('xyzzy', MODE_OBJECT), 'unknown dataKind: Object Mode legal');
  assert(!modeCompatTest('xyzzy', MODE_EDIT_MESH), 'unknown dataKind: edit modes rejected');
  assert(!modeCompatTest(null, MODE_EDIT_MESH), 'null dataKind: edit modes rejected');
}

// ── modesForDataKind ──
{
  const meshModes = modesForDataKind('mesh');
  assert(meshModes.includes(MODE_EDIT_MESH), 'modesForDataKind(mesh) includes Edit Mode');
  assert(meshModes.includes(MODE_WEIGHT_PAINT), 'modesForDataKind(mesh) includes Weight Paint');
  assert(!meshModes.includes(MODE_POSE), 'modesForDataKind(mesh) excludes Pose');

  const armModes = modesForDataKind('armature');
  assertEq(armModes, [MODE_POSE], 'modesForDataKind(armature) is [Pose] today');

  assertEq(modesForDataKind('empty'), [], 'modesForDataKind(empty) is empty');
  assertEq(modesForDataKind(null), [], 'modesForDataKind(null) is empty');
  assertEq(modesForDataKind('unknown'), [], 'modesForDataKind(unknown) is empty');
}

// ── getDataKind classifier ──
{
  assert(getDataKind(null) === null, 'getDataKind(null) === null');
  assert(getDataKind(undefined) === null, 'getDataKind(undefined) === null');
  assertEq(getDataKind({ type: 'part', id: 'p1' }), 'mesh', 'part → mesh (even unmeshed)');
  assertEq(getDataKind({ type: 'part', id: 'p1', mesh: { vertices: [] } }), 'mesh', 'meshed part → mesh');
  assertEq(getDataKind({ type: 'group', id: 'g1', boneRole: 'head' }), 'armature', 'bone group → armature');
  assertEq(getDataKind({ type: 'group', id: 'g2' }), 'empty', 'plain group → empty');
  assertEq(getDataKind({ type: 'group', id: 'g3', boneRole: null }), 'empty', 'group with null boneRole → empty');
  assertEq(getDataKind({ type: 'deformer', id: 'd1' }), 'deformer', 'deformer → deformer');
  assertEq(getDataKind({ type: 'meshData', id: 'm1' }), 'mesh', 'meshData (v18) → mesh');
  assertEq(getDataKind({ type: 'unknown' }), 'empty', 'unknown type → empty (defensive)');
}

// ── End-to-end: getDataKind + modeCompatTest pipeline ──
{
  const part = { type: 'part', id: 'p1', mesh: { vertices: [{ x: 0, y: 0 }] } };
  const bone = { type: 'group', id: 'g1', boneRole: 'head' };
  const folder = { type: 'group', id: 'g2', name: 'Costume Folder' };

  // Bone selected → Pose Mode legal, Edit Mode disabled (the original
  // bug that triggered the Blender Parity Refactor).
  assert(modeCompatTest(getDataKind(bone), MODE_POSE), 'bone selected → Pose enters');
  assert(!modeCompatTest(getDataKind(bone), MODE_EDIT_MESH), 'bone selected → Edit greys out');

  // Mesh selected → Edit Mode legal, Pose disabled.
  assert(modeCompatTest(getDataKind(part), MODE_EDIT_MESH), 'part selected → Edit enters');
  assert(!modeCompatTest(getDataKind(part), MODE_POSE), 'part selected → Pose greys out');

  // Folder selected → only Object Mode.
  assert(modeCompatTest(getDataKind(folder), MODE_OBJECT), 'folder → Object Mode only');
  assert(!modeCompatTest(getDataKind(folder), MODE_EDIT_MESH), 'folder → Edit greys out');
  assert(!modeCompatTest(getDataKind(folder), MODE_POSE), 'folder → Pose greys out');
}

console.log(`modeCompat: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
