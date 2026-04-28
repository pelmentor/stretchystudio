// v3 Phase 0F.11 - rigGroupCleanup tests
// Run: node scripts/test/test_rigGroupCleanup.mjs

import { findAncestorGroupsForCleanup } from '../../src/components/canvas/viewport/rigGroupCleanup.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// Helper to express test fixtures concisely
const part  = (id, parent) => ({ id, type: 'part',  parent });
const group = (id, parent) => ({ id, type: 'group', parent });

// ── Empty cases ────────────────────────────────────────────────────

assert(findAncestorGroupsForCleanup([], []).size === 0, 'empty inputs → empty set');
assert(findAncestorGroupsForCleanup([part('p1', null)], []).size === 0, 'no partIds → empty');
assert(findAncestorGroupsForCleanup([], ['p1']).size === 0, 'no nodes → empty');

// ── Flat (no parents) ──────────────────────────────────────────────

{
  const nodes = [part('p1', null), part('p2', null)];
  const result = findAncestorGroupsForCleanup(nodes, ['p1', 'p2']);
  assertEq([...result], [], 'flat parts (parent=null) → no groups to delete');
}

// ── Single parent group ────────────────────────────────────────────

{
  // g1 -> [p1, p2]
  const nodes = [
    group('g1', null),
    part('p1', 'g1'),
    part('p2', 'g1'),
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1', 'p2']);
  assertEq([...result], ['g1'], 'one parent group: only g1');
}

// ── Multi-level (group -> group -> part) ───────────────────────────

{
  // root_grp -> mid_grp -> [p1, p2]
  const nodes = [
    group('root_grp', null),
    group('mid_grp', 'root_grp'),
    part('p1', 'mid_grp'),
    part('p2', 'mid_grp'),
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1', 'p2']);
  assert(result.has('mid_grp'), 'multi-level: mid_grp deleted');
  assert(result.has('root_grp'), 'multi-level: root_grp deleted');
  assert(result.size === 2, 'multi-level: exactly 2 groups deleted');
}

// ── Mixed parts in different subtrees ──────────────────────────────

{
  // g1 -> p1; g2 -> p2; g3 -> p3 (only p1 & p2 in partIds)
  const nodes = [
    group('g1', null), part('p1', 'g1'),
    group('g2', null), part('p2', 'g2'),
    group('g3', null), part('p3', 'g3'),  // not in partIds
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1', 'p2']);
  assert(result.has('g1'), 'mixed subtrees: g1 deleted (its part is in set)');
  assert(result.has('g2'), 'mixed subtrees: g2 deleted (its part is in set)');
  assert(!result.has('g3'), 'mixed subtrees: g3 untouched (its part NOT in set)');
}

// ── Diamond: two parts share an ancestor ───────────────────────────

{
  //          common_anc
  //          /        \
  //        gA          gB
  //       /             \
  //      p1              p2
  const nodes = [
    group('common_anc', null),
    group('gA', 'common_anc'),
    group('gB', 'common_anc'),
    part('p1', 'gA'),
    part('p2', 'gB'),
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1', 'p2']);
  assertEq(
    [...result].sort(),
    ['common_anc', 'gA', 'gB'].sort(),
    'diamond: shared ancestor counted once',
  );
}

// ── Walking stops at non-group parents ─────────────────────────────

// (Defensive case - in practice, parts always live under groups,
// but if a part is wrongly parented to another part, we shouldn't
// keep climbing.)
{
  const nodes = [
    part('weird_parent', null),
    part('p1', 'weird_parent'),
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1']);
  // weird_parent gets added to toDelete (its set entry was added
  // before we discovered it's not a group), but the walk stops
  // there - we don't recurse further.
  assert(result.has('weird_parent'),
    "wrong-parented part: 'weird_parent' is added to delete set");
}

// ── Walking through a missing parent stops gracefully ─────────────

{
  const nodes = [
    part('p1', 'orphan_parent_id'),  // parent doesn't exist
  ];
  const result = findAncestorGroupsForCleanup(nodes, ['p1']);
  assert(result.has('orphan_parent_id'),
    'orphan parent id added to set even when node missing');
  assert(result.size === 1, 'orphan parent: walk terminates');
}

// ── Idempotence ────────────────────────────────────────────────────

{
  const nodes = [
    group('g', null),
    part('p1', 'g'),
  ];
  const a = findAncestorGroupsForCleanup(nodes, ['p1']);
  const b = findAncestorGroupsForCleanup(nodes, ['p1']);
  assertEq([...a], [...b], 'idempotent: same inputs → same set');
}

console.log(`rigGroupCleanup: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
