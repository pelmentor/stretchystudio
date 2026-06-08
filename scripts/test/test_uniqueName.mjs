// Tests for src/lib/uniqueName.js — Blender-style .NNN disambiguation.
// Used by IdleMotionDialog so generated motions don't collide on exported
// .motion3.json filenames.
//
// Run: node scripts/test/test_uniqueName.mjs

import { uniqueName } from '../../src/lib/uniqueName.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (actual === expected) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

// ── Empty set → candidate returned verbatim ─────────────────────────

assertEq(uniqueName('idle_m01', new Set()), 'idle_m01', 'empty set → candidate as-is');
assertEq(uniqueName('idle_m01', []),         'idle_m01', 'array form accepted');

// ── Set without candidate → candidate as-is ─────────────────────────

assertEq(uniqueName('idle_m01', new Set(['talking'])), 'idle_m01', 'no collision');
assertEq(uniqueName('idle_m01', ['talking', 'angry']), 'idle_m01', 'no collision, array');

// ── Single collision → .001 ─────────────────────────────────────────

assertEq(uniqueName('idle_m01', new Set(['idle_m01'])), 'idle_m01.001',
  'first collision → .001');

// ── .001 also taken → .002 ──────────────────────────────────────────

assertEq(
  uniqueName('idle_m01', new Set(['idle_m01', 'idle_m01.001'])),
  'idle_m01.002',
  'sequential collisions');

// ── Gaps filled → finds lowest free ─────────────────────────────────
// Pure incrementing loop checks .001, .002, .003 in order; first free wins.

assertEq(
  uniqueName('idle_m01', new Set(['idle_m01', 'idle_m01.001', 'idle_m01.003'])),
  'idle_m01.002',
  'fills lowest gap');

// ── 3-digit zero-padding preserved ──────────────────────────────────

{
  const taken = new Set(['x']);
  for (let i = 1; i <= 9; i++) taken.add(`x.${String(i).padStart(3, '0')}`);
  // Expect x.010 next
  assertEq(uniqueName('x', taken), 'x.010', 'padding: 10 stays 3-digit');
}

// ── Throws when name-space saturated (999 collisions) ───────────────

{
  const taken = new Set(['flood']);
  for (let n = 1; n < 1000; n++) taken.add(`flood.${String(n).padStart(3, '0')}`);
  let threw = false;
  try {
    uniqueName('flood', taken);
  } catch (e) {
    threw = e instanceof Error && /saturated/.test(e.message);
  }
  assert(threw, 'saturated namespace → throws (RULE №1: no silent fallback)');
}

// ── Different candidate → independent of others' collisions ─────────

assertEq(
  uniqueName('blink', new Set(['idle.001', 'idle.002'])),
  'blink',
  'unrelated collisions ignored');

console.log(`uniqueName: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
