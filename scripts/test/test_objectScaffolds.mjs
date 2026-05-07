// Tests for the Phase 2b / 3 / 4 scaffolding helpers in
// src/store/objectDataAccess.js: getObjectMode / setObjectMode (per-object
// mode), getModifiers / addModifier / removeModifier / reorderModifier
// (modifier stack), getConstraints / addConstraint / removeConstraint
// (constraint stack).
//
// Today's storage is opportunistic — fields are optional on Object nodes
// and helpers default-empty when absent. Tests pin behaviour so future
// schema flips don't silently regress.
//
// Run: node scripts/test/test_objectScaffolds.mjs

import {
  getObjectMode,
  setObjectMode,
  getModifiers,
  addModifier,
  removeModifier,
  reorderModifier,
  getConstraints,
  addConstraint,
  removeConstraint,
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

// ── getObjectMode / setObjectMode ──
{
  // Defaults: missing field → null (= Object Mode).
  assert(getObjectMode(null) === null, 'null node → null mode');
  assert(getObjectMode({}) === null, 'no mode field → null mode');
  assert(getObjectMode({ mode: undefined }) === null, 'undefined mode → null');

  // Setting a mode persists it.
  const node = {};
  setObjectMode(node, 'mesh');
  assertEq(getObjectMode(node), 'mesh', 'setObjectMode(mesh)');
  assert('mode' in node, 'mode field is set');

  // Clearing back to null removes the field (keeps JSON small).
  setObjectMode(node, null);
  assert(!('mode' in node), 'setObjectMode(null) deletes the field');
  assert(getObjectMode(node) === null, 'cleared node reads null');

  // setObjectMode on null is a no-op.
  setObjectMode(null, 'mesh'); // should not throw
  passed++; // got here = no throw

  // setObjectMode(undefined) also clears.
  setObjectMode(node, 'skeleton');
  setObjectMode(node, undefined);
  assert(!('mode' in node), 'setObjectMode(undefined) clears');
}

// ── getModifiers / addModifier ──
{
  // Defaults: missing field → empty array.
  assertEq(getModifiers(null), [], 'null node → empty modifiers');
  assertEq(getModifiers({}), [], 'no modifiers → empty array');
  assertEq(getModifiers({ modifiers: 'not an array' }), [], 'non-array modifiers → empty');

  const node = {};
  const mod1 = { id: 'm1', type: 'WARP_DEFORMER', name: 'Body Warp', payload: {} };
  addModifier(node, mod1);
  assertEq(getModifiers(node).length, 1, 'addModifier creates array');
  assert(node.modifiers[0] === mod1, 'modifier inserted by reference');

  const mod2 = { id: 'm2', type: 'ROTATION_DEFORMER', name: 'Head Rot', payload: {} };
  addModifier(node, mod2);
  assertEq(getModifiers(node).length, 2, 'second modifier appended');
  assertEq(getModifiers(node).map((m) => m.id), ['m1', 'm2'], 'order preserved');
}

// ── removeModifier ──
{
  const node = {
    modifiers: [
      { id: 'a', type: 'WARP_DEFORMER', payload: {} },
      { id: 'b', type: 'ROTATION_DEFORMER', payload: {} },
      { id: 'c', type: 'BLEND_SHAPE', payload: {} },
    ],
  };

  assert(removeModifier(node, 'b') === true, 'remove returns true on hit');
  assertEq(getModifiers(node).map((m) => m.id), ['a', 'c'], 'b removed');

  assert(removeModifier(node, 'nonexistent') === false, 'remove returns false on miss');
  assert(removeModifier(null, 'a') === false, 'remove on null is false');
  assert(removeModifier({}, 'a') === false, 'remove on empty modifiers is false');
}

// ── reorderModifier ──
{
  const node = {
    modifiers: [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ],
  };

  assert(reorderModifier(node, 'd', 0) === true, 'move d to front');
  assertEq(getModifiers(node).map((m) => m.id), ['d', 'a', 'b', 'c'], 'order after move-to-front');

  assert(reorderModifier(node, 'a', 99) === true, 'clamp newIndex past end');
  assertEq(getModifiers(node).map((m) => m.id), ['d', 'b', 'c', 'a'], 'a clamped to last');

  assert(reorderModifier(node, 'b', -5) === true, 'clamp negative newIndex');
  assertEq(getModifiers(node).map((m) => m.id), ['b', 'd', 'c', 'a'], 'b clamped to first');

  // No-op when fromIdx == clampedIdx.
  assert(reorderModifier(node, 'b', 0) === false, 'reorder same position is no-op');

  assert(reorderModifier(node, 'nonexistent', 0) === false, 'reorder unknown id false');
  assert(reorderModifier(null, 'a', 0) === false, 'reorder null node false');
}

// ── getConstraints / addConstraint / removeConstraint ──
{
  assertEq(getConstraints(null), [], 'null node → empty constraints');
  assertEq(getConstraints({}), [], 'no constraints → empty');

  const node = {};
  const c1 = { id: 'c1', type: 'COPY_LOCATION', name: 'Copy Loc', payload: { targetId: 't1' } };
  addConstraint(node, c1);
  assertEq(getConstraints(node).length, 1, 'addConstraint creates array');

  const c2 = { id: 'c2', type: 'TRACK_TO', name: 'Track', payload: {} };
  addConstraint(node, c2);
  assertEq(getConstraints(node).map((c) => c.id), ['c1', 'c2'], 'constraints in append order');

  assert(removeConstraint(node, 'c1') === true, 'remove first constraint');
  assertEq(getConstraints(node).map((c) => c.id), ['c2'], 'c1 removed');
  assert(removeConstraint(node, 'unknown') === false, 'remove miss false');
}

// ── Field-empty when no scaffolds populated ──
{
  // Verify the helpers don't accidentally create the array on a read.
  // A pure read on a fresh node should leave the node untouched.
  const fresh = { id: 'p1', type: 'part' };
  getModifiers(fresh);
  getConstraints(fresh);
  getObjectMode(fresh);
  assert(!('modifiers' in fresh), 'getModifiers does not create field');
  assert(!('constraints' in fresh), 'getConstraints does not create field');
  assert(!('mode' in fresh), 'getObjectMode does not create field');
}

console.log(`objectScaffolds: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
