// Animation Phase 5 Slice 5.P — tests for
// src/v3/editors/fcurve/fcurveFooterData.js (FCurve Editor per-editor
// footer formatters).
//
// Coverage:
//   - countFCurveChannelStates: 4 independent dimensions tallied
//     correctly; null / empty / null-rows guards
//   - formatFCurveChannelCounts: pluralisation of "channel/s"; zero-
//     elision for selected/hidden/muted; full 4-segment output when
//     all populated
//   - formatActiveFCurveLabel: null active id → null; unresolvable id
//     → null; resolved → label string; null/empty decoded guards
//
// Run: node scripts/test/test_fcurveFooterData.mjs

import {
  countFCurveChannelStates,
  formatFCurveChannelCounts,
  formatActiveFCurveLabel,
} from '../../src/v3/editors/fcurve/fcurveFooterData.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function deepEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function row(id, label, flags = {}) {
  return {
    fcurve: { id, ...flags },
    label,
  };
}

// ─────────────────────────────────────────────────────────────────────
// countFCurveChannelStates

{
  // Null / empty / no-decoded → all zeros.
  deepEq(countFCurveChannelStates(null),       { total: 0, selected: 0, hidden: 0, muted: 0 }, 'count: null');
  deepEq(countFCurveChannelStates(undefined),  { total: 0, selected: 0, hidden: 0, muted: 0 }, 'count: undefined');
  deepEq(countFCurveChannelStates([]),         { total: 0, selected: 0, hidden: 0, muted: 0 }, 'count: empty');
}

{
  // Single row, no flags.
  const counts = countFCurveChannelStates([row('a', 'A')]);
  deepEq(counts, { total: 1, selected: 0, hidden: 0, muted: 0 }, 'count: single bare');
}

{
  // Each flag in isolation.
  deepEq(countFCurveChannelStates([row('a', 'A', { selected: true })]),
    { total: 1, selected: 1, hidden: 0, muted: 0 }, 'count: selected-only');
  deepEq(countFCurveChannelStates([row('a', 'A', { hide: true })]),
    { total: 1, selected: 0, hidden: 1, muted: 0 }, 'count: hidden-only');
  deepEq(countFCurveChannelStates([row('a', 'A', { mute: true })]),
    { total: 1, selected: 0, hidden: 0, muted: 1 }, 'count: muted-only');
}

{
  // Flags are independent — single row can be all three.
  const counts = countFCurveChannelStates([
    row('a', 'A', { selected: true, hide: true, mute: true }),
  ]);
  deepEq(counts, { total: 1, selected: 1, hidden: 1, muted: 1 }, 'count: all-three-on-one');
}

{
  // Mixed multi-row tally.
  const counts = countFCurveChannelStates([
    row('a', 'A'),
    row('b', 'B', { selected: true }),
    row('c', 'C', { selected: true, hide: true }),
    row('d', 'D', { mute: true }),
    row('e', 'E', { selected: true, mute: true, hide: true }),
  ]);
  deepEq(counts, { total: 5, selected: 3, hidden: 2, muted: 2 }, 'count: mixed 5-row');
}

{
  // Sparse-field tolerance: missing fields = false equivalent.
  const counts = countFCurveChannelStates([
    { fcurve: { id: 'a' }, label: 'A' }, // no selected/hide/mute fields at all
  ]);
  deepEq(counts, { total: 1, selected: 0, hidden: 0, muted: 0 }, 'count: sparse fields');
}

{
  // Strict `=== true` invariant: truthy-but-not-true does NOT count
  // (mirrors isFCurveSelected/Hidden/Muted defensive check).
  const counts = countFCurveChannelStates([
    { fcurve: { id: 'a', selected: 1, hide: 'yes', mute: {} }, label: 'A' },
  ]);
  deepEq(counts, { total: 1, selected: 0, hidden: 0, muted: 0 }, 'count: truthy-not-true → 0');
}

{
  // Null entries in the array tolerated (skipped).
  const counts = countFCurveChannelStates([
    null,
    row('a', 'A', { selected: true }),
    undefined,
    row('b', 'B', { mute: true }),
  ]);
  deepEq(counts, { total: 2, selected: 1, hidden: 0, muted: 1 }, 'count: null entries skipped');
}

{
  // Row with null fcurve skipped (defensive — decodeAllFCurves doesn't
  // produce these but the helper shouldn't crash).
  const counts = countFCurveChannelStates([
    { fcurve: null, label: 'X' },
    row('a', 'A'),
  ]);
  deepEq(counts, { total: 1, selected: 0, hidden: 0, muted: 0 }, 'count: null fcurve skipped');
}

// ─────────────────────────────────────────────────────────────────────
// formatFCurveChannelCounts — pluralisation + elision

eq(formatFCurveChannelCounts({ total: 0, selected: 0, hidden: 0, muted: 0 }),
  '0 channels', 'fmt: 0 → "0 channels"');
eq(formatFCurveChannelCounts({ total: 1, selected: 0, hidden: 0, muted: 0 }),
  '1 channel', 'fmt: 1 → "1 channel" (singular)');
eq(formatFCurveChannelCounts({ total: 12, selected: 0, hidden: 0, muted: 0 }),
  '12 channels', 'fmt: 12 → "12 channels"');

// Selection only.
eq(formatFCurveChannelCounts({ total: 12, selected: 3, hidden: 0, muted: 0 }),
  '12 channels · 3 selected', 'fmt: selected only');
eq(formatFCurveChannelCounts({ total: 12, selected: 1, hidden: 0, muted: 0 }),
  '12 channels · 1 selected', 'fmt: selected=1 stays "1 selected"');

// Hidden only (selected zero → elided).
eq(formatFCurveChannelCounts({ total: 12, selected: 0, hidden: 2, muted: 0 }),
  '12 channels · 2 hidden', 'fmt: hidden only, selected elided');

// Muted only.
eq(formatFCurveChannelCounts({ total: 12, selected: 0, hidden: 0, muted: 1 }),
  '12 channels · 1 muted', 'fmt: muted only');

// Selection + hidden.
eq(formatFCurveChannelCounts({ total: 12, selected: 3, hidden: 2, muted: 0 }),
  '12 channels · 3 selected · 2 hidden', 'fmt: selected + hidden');

// All four populated.
eq(formatFCurveChannelCounts({ total: 12, selected: 3, hidden: 2, muted: 1 }),
  '12 channels · 3 selected · 2 hidden · 1 muted', 'fmt: all four');

// Hidden + muted, no selection.
eq(formatFCurveChannelCounts({ total: 12, selected: 0, hidden: 2, muted: 1 }),
  '12 channels · 2 hidden · 1 muted', 'fmt: hidden + muted, selected elided');

// Defensive: null/undefined counts treated as zero.
eq(formatFCurveChannelCounts({}), '0 channels', 'fmt: empty object → 0 channels');
eq(formatFCurveChannelCounts(null), '0 channels', 'fmt: null → 0 channels');
eq(formatFCurveChannelCounts(undefined), '0 channels', 'fmt: undefined → 0 channels');

// ─────────────────────────────────────────────────────────────────────
// formatActiveFCurveLabel

{
  // Null id → null.
  eq(formatActiveFCurveLabel([row('a', 'A')], null),       null, 'active: null id → null');
  eq(formatActiveFCurveLabel([row('a', 'A')], undefined),  null, 'active: undefined id → null');
  eq(formatActiveFCurveLabel([row('a', 'A')], ''),         null, 'active: empty string id → null');
}

{
  // Empty decoded → null.
  eq(formatActiveFCurveLabel(null, 'a'),       null, 'active: null decoded → null');
  eq(formatActiveFCurveLabel(undefined, 'a'),  null, 'active: undefined decoded → null');
  eq(formatActiveFCurveLabel([], 'a'),         null, 'active: empty decoded → null');
}

{
  // Resolvable.
  const decoded = [row('a', 'A'), row('b', 'B'), row('c', 'C · prop')];
  eq(formatActiveFCurveLabel(decoded, 'a'),       'A',         'active: resolves to "A"');
  eq(formatActiveFCurveLabel(decoded, 'b'),       'B',         'active: resolves to "B"');
  eq(formatActiveFCurveLabel(decoded, 'c'),       'C · prop',  'active: resolves to "C · prop" (node-style label)');
}

{
  // Unresolvable id (matches no row) → null.
  const decoded = [row('a', 'A'), row('b', 'B')];
  eq(formatActiveFCurveLabel(decoded, 'nonexistent'), null, 'active: unresolvable id → null');
}

{
  // Row with empty/non-string label → null (defensive).
  const decoded = [{ fcurve: { id: 'x' }, label: '' }];
  eq(formatActiveFCurveLabel(decoded, 'x'), null, 'active: empty label → null');
}

{
  // Row with null fcurve in middle of decoded tolerated.
  const decoded = [
    { fcurve: null, label: 'orphan' },
    row('a', 'A'),
  ];
  eq(formatActiveFCurveLabel(decoded, 'a'), 'A', 'active: skips null-fcurve rows');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
