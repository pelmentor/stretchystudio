// v3 Phase 0F.12 - applySplits tests
// Run: node scripts/test/test_applySplits.mjs

import { applySplits } from '../../src/components/canvas/viewport/applySplits.js';

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

// Deterministic uid factory for tests
function counter(start = 0) {
  let n = start;
  return () => `id-${++n}`;
}

// ── No splits ──────────────────────────────────────────────────────

{
  const layers = [{ name: 'a' }, { name: 'b' }];
  const partIds = ['p1', 'p2'];
  const result = applySplits(layers, partIds, [], counter());
  assertEq(result.layers, layers, 'no splits: layers unchanged');
  assertEq(result.partIds, partIds, 'no splits: partIds unchanged');
  assert(result.layers !== layers, 'no splits: returns new array reference');
}

// ── Single split: both halves kept ─────────────────────────────────

{
  const layers = [{ n: 'L0' }, { n: 'L1-merged' }, { n: 'L2' }];
  const partIds = ['p0', 'p1', 'p2'];
  const result = applySplits(
    layers,
    partIds,
    [{ mergedIdx: 1, rightLayer: { n: 'L1-right' }, leftLayer: { n: 'L1-left' } }],
    counter(),
  );
  assertEq(
    result.layers.map(l => l.n),
    ['L0', 'L1-right', 'L1-left', 'L2'],
    'split: right then left replaces merged',
  );
  assertEq(result.partIds, ['p0', 'id-1', 'id-2', 'p2'], 'split: fresh ids for new parts');
}

// ── Single split: only right kept ─────────────────────────────────

{
  const result = applySplits(
    [{ n: 'A' }, { n: 'merged' }, { n: 'B' }],
    ['pA', 'pM', 'pB'],
    [{ mergedIdx: 1, rightLayer: { n: 'right' }, leftLayer: null }],
    counter(100),
  );
  assertEq(result.layers.map(l => l.n), ['A', 'right', 'B'], 'right only');
  assertEq(result.partIds, ['pA', 'id-101', 'pB'], 'right only: one new id');
}

// ── Single split: only left kept ───────────────────────────────────

{
  const result = applySplits(
    [{ n: 'A' }, { n: 'merged' }, { n: 'B' }],
    ['pA', 'pM', 'pB'],
    [{ mergedIdx: 1, rightLayer: null, leftLayer: { n: 'left' } }],
    counter(),
  );
  assertEq(result.layers.map(l => l.n), ['A', 'left', 'B'], 'left only');
  assertEq(result.partIds.length, 3, 'left only: still 3 partIds');
}

// ── Single split: both null (effectively a delete) ─────────────────

{
  const result = applySplits(
    [{ n: 'A' }, { n: 'merged' }, { n: 'B' }],
    ['pA', 'pM', 'pB'],
    [{ mergedIdx: 1, rightLayer: null, leftLayer: null }],
    counter(),
  );
  assertEq(result.layers.map(l => l.n), ['A', 'B'], 'both null: layer removed');
  assertEq(result.partIds, ['pA', 'pB'], 'both null: partId removed');
}

// ── Multiple splits at different indices ───────────────────────────

{
  const layers = [
    { n: 'L0' },
    { n: 'L1' },
    { n: 'L2' },
    { n: 'L3' },
  ];
  const partIds = ['p0', 'p1', 'p2', 'p3'];
  const result = applySplits(
    layers,
    partIds,
    [
      { mergedIdx: 1, rightLayer: { n: 'L1-r' }, leftLayer: { n: 'L1-l' } },
      { mergedIdx: 3, rightLayer: { n: 'L3-r' }, leftLayer: { n: 'L3-l' } },
    ],
    counter(),
  );
  assertEq(
    result.layers.map(l => l.n),
    ['L0', 'L1-r', 'L1-l', 'L2', 'L3-r', 'L3-l'],
    'multi: high-to-low order keeps indices stable',
  );
}

// ── Splits passed in any order are sorted internally ───────────────

{
  const layers = [{ n: 'L0' }, { n: 'L1' }, { n: 'L2' }];
  const partIds = ['p0', 'p1', 'p2'];
  // Pass in low-to-high: applySplits should still get the right output.
  const result = applySplits(
    layers,
    partIds,
    [
      { mergedIdx: 1, rightLayer: { n: '1r' }, leftLayer: { n: '1l' } },
      { mergedIdx: 2, rightLayer: { n: '2r' }, leftLayer: { n: '2l' } },
    ],
    counter(),
  );
  assertEq(
    result.layers.map(l => l.n),
    ['L0', '1r', '1l', '2r', '2l'],
    'splits are sorted internally - input order doesn\'t matter',
  );
}

// ── Inputs not mutated ─────────────────────────────────────────────

{
  const layers = [{ n: 'a' }, { n: 'b' }];
  const partIds = ['pa', 'pb'];
  const layersBefore = JSON.stringify(layers);
  const partIdsBefore = JSON.stringify(partIds);
  applySplits(layers, partIds, [
    { mergedIdx: 1, rightLayer: { n: 'r' }, leftLayer: { n: 'l' } },
  ], counter());
  assert(JSON.stringify(layers) === layersBefore, 'inputs: layers unchanged');
  assert(JSON.stringify(partIds) === partIdsBefore, 'inputs: partIds unchanged');
}

console.log(`applySplits: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
