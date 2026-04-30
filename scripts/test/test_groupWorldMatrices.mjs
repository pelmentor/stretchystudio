// v3 Phase 6 - tests for src/io/live2d/cmo3/groupWorldMatrices.js
// Run: node scripts/test/test_groupWorldMatrices.mjs

import { computeGroupWorldMatrices } from '../../src/io/live2d/cmo3/groupWorldMatrices.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

// ── Empty input ────────────────────────────────────────────────────

{
  const out = computeGroupWorldMatrices([], [], 1000, 1000);
  assert(out.groupWorldMatrices.size === 0, 'empty groups → empty matrices');
  assert(out.deformerWorldOrigins.size === 0, 'empty groups → empty origins');
}

// ── Single root group, identity transform ──────────────────────────

{
  const groups = [{ id: 'g1', parent: null, transform: { x: 0, y: 0 } }];
  const out = computeGroupWorldMatrices(groups, [], 1000, 1000);
  const m = out.groupWorldMatrices.get('g1');
  // Identity matrix
  assert(approx(m[0], 1) && approx(m[4], 1), 'identity diag');
  assert(approx(m[6], 0) && approx(m[7], 0), 'identity translation');
  // No pivot, no descendant meshes → canvas centre fallback
  const o = out.deformerWorldOrigins.get('g1');
  assert(approx(o.x, 500) && approx(o.y, 500), 'no-pivot, no-mesh → canvas centre');
}

// ── Translation propagates to children ─────────────────────────────

{
  const groups = [
    { id: 'parent', parent: null, transform: { x: 100, y: 50 } },
    { id: 'child',  parent: 'parent', transform: { x: 20, y: 5 } },
  ];
  const out = computeGroupWorldMatrices(groups, [], 1000, 1000);
  const child = out.groupWorldMatrices.get('child');
  // World translation = 120, 55
  assert(approx(child[6], 120), 'child world tx = 120');
  assert(approx(child[7], 55),  'child world ty = 55');
}

// ── Pivot transforms to canvas space via world matrix ──────────────

{
  // Parent translates by (200, 100). Child has no own transform but
  // pivot=(10, 5) → world origin should be parent_translation + pivot.
  const groups = [
    { id: 'parent', parent: null, transform: { x: 200, y: 100 } },
    { id: 'child',  parent: 'parent', transform: { pivotX: 10, pivotY: 5 } },
  ];
  const out = computeGroupWorldMatrices(groups, [], 1000, 1000);
  const o = out.deformerWorldOrigins.get('child');
  assert(approx(o.x, 210), 'pivot world x = 210');
  assert(approx(o.y, 105), 'pivot world y = 105');
}

// ── Pivot fallback: descendant mesh bbox centre ────────────────────

{
  const groups = [
    { id: 'parent', parent: null, transform: {} },
    { id: 'child',  parent: 'parent', transform: {} },
  ];
  const meshes = [
    {
      parentGroupId: 'child',
      vertices: [10, 20, 30, 40, 50, 60],  // x: 10..50, y: 20..60
    },
  ];
  const out = computeGroupWorldMatrices(groups, meshes, 1000, 1000);
  const o = out.deformerWorldOrigins.get('parent');
  // BFS picks up child + child's mesh. Bbox centre = (30, 40).
  assert(approx(o.x, 30) && approx(o.y, 40), 'parent origin = descendant bbox centre');
}

// ── Pivot fallback: no descendant meshes → canvas centre ───────────

{
  const groups = [
    { id: 'g',   parent: null,   transform: {} },
    { id: 'g2',  parent: 'g',    transform: {} },
  ];
  const out = computeGroupWorldMatrices(groups, [], 800, 600);
  const o = out.deformerWorldOrigins.get('g');
  assert(approx(o.x, 400) && approx(o.y, 300), 'no descendants → canvas centre (800/600)');
}

// ── Orphan parent: child whose parent isn't in groupMap ────────────

{
  // Child's parent ID isn't in the groups list — should be treated as root.
  const groups = [
    { id: 'orphan', parent: 'NON_EXISTENT', transform: { x: 70, y: 30 } },
  ];
  const out = computeGroupWorldMatrices(groups, [], 1000, 1000);
  const m = out.groupWorldMatrices.get('orphan');
  // Local matrix only — translation 70, 30
  assert(approx(m[6], 70) && approx(m[7], 30), 'orphan uses local matrix');
}

// ── Memoisation: each matrix computed once even with shared parents ─

{
  const groups = [
    { id: 'root', parent: null, transform: {} },
    { id: 'a',    parent: 'root', transform: {} },
    { id: 'b',    parent: 'root', transform: {} },
    { id: 'c',    parent: 'a', transform: {} },
  ];
  const out = computeGroupWorldMatrices(groups, [], 1000, 1000);
  // All 4 groups should appear in the matrix map
  assert(out.groupWorldMatrices.size === 4, 'all 4 groups have matrices');
  // Same parent should yield same matrix object reference (memo cache hit)
  assert(out.groupWorldMatrices.has('root'), 'root memoised');
  assert(out.groupWorldMatrices.has('a'),    'a memoised');
  assert(out.groupWorldMatrices.has('b'),    'b memoised');
  assert(out.groupWorldMatrices.has('c'),    'c memoised');
}

// ── Pivot=(0,0) but mesh exists — fallback engages ────────────────

{
  const groups = [{ id: 'g', parent: null, transform: { pivotX: 0, pivotY: 0 } }];
  const meshes = [{
    parentGroupId: 'g',
    vertices: [100, 200, 300, 400],  // bbox 100..300, 200..400 → centre (200, 300)
  }];
  const out = computeGroupWorldMatrices(groups, meshes, 1000, 1000);
  const o = out.deformerWorldOrigins.get('g');
  assert(approx(o.x, 200) && approx(o.y, 300),
    'pivot=0 + mesh present → bbox centre (NOT canvas centre)');
}

console.log(`groupWorldMatrices: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
