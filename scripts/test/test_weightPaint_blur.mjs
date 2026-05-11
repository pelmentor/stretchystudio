// Toolset Plan Phase 7.B.2 — Blur brush math.
//
// Verifies `computeBlurUpdates`:
//   - lerps each affected vertex toward the mean of its neighbors' weights
//   - falloff * strength controls lerp amount
//   - vertices without neighbors are skipped
//   - clamps output to [0, 1]
//
// Run: node scripts/test/test_weightPaint_blur.mjs

import { computeBlurUpdates, WEIGHT_BRUSHES } from '../../src/lib/weightPaint/index.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

// ── 1. registry shape ───────────────────────────────────────────────
{
  assert(WEIGHT_BRUSHES.length === 2, `2 brushes, got ${WEIGHT_BRUSHES.length}`);
  assert(WEIGHT_BRUSHES[0].id === 'draw', "[0] = 'draw'");
  assert(WEIGHT_BRUSHES[1].id === 'blur', "[1] = 'blur'");
  assert(Object.isFrozen(WEIGHT_BRUSHES), 'WEIGHT_BRUSHES is frozen');
}

// ── 2. blur with full strength + full falloff = exact mean ─────────
{
  // Triangle: v0 weight 0, v1 weight 1, v2 weight 0
  // v0's only neighbor (in adjacency) is v1, v2 → mean = 0.5
  // After blur with t=1: v0 lerps from 0 to 0.5 = 0.5
  const adjacency = [new Set([1, 2]), new Set([0, 2]), new Set([0, 1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 1, `1 update, got ${updates.length}`);
  assert(updates[0].vertexIndex === 0, 'v0');
  assert(nearlyEq(updates[0].weight, 0.5),
    `v0 → 0.5, got ${updates[0].weight}`);
}

// ── 3. partial strength = partial lerp ─────────────────────────────
{
  const adjacency = [new Set([1, 2]), new Set([0, 2]), new Set([0, 1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 0.5,
  });
  // mean = 0.5, t = 1 * 0.5 = 0.5; cur = 0; next = 0 + (0.5 - 0)*0.5 = 0.25
  assert(nearlyEq(updates[0].weight, 0.25),
    `partial blur → 0.25, got ${updates[0].weight}`);
}

// ── 4. falloff scales lerp amount ──────────────────────────────────
{
  const adjacency = [new Set([1, 2]), new Set([0, 2]), new Set([0, 1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 0.4 }],
    strength: 1,
  });
  // t = 0.4 * 1 = 0.4; next = 0 + 0.5 * 0.4 = 0.2
  assert(nearlyEq(updates[0].weight, 0.2),
    `falloff 0.4 → 0.2, got ${updates[0].weight}`);
}

// ── 5. zero strength → no updates ──────────────────────────────────
{
  const adjacency = [new Set([1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 0,
  });
  assert(updates.length === 0, `zero strength → no updates, got ${updates.length}`);
}

// ── 6. orphan vertex (no neighbors) skipped ────────────────────────
{
  const adjacency = [new Set(), new Set([2]), new Set([1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 0.5, 0.7],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }, { vertexIndex: 1, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 1, `orphan v0 skipped, got ${updates.length}`);
  assert(updates[0].vertexIndex === 1, 'only v1 returned');
  assert(nearlyEq(updates[0].weight, 0.7), `v1 → 0.7 (mean of v2)`);
}

// ── 7. self-loop in adjacency excluded ─────────────────────────────
{
  // If v0's adjacency erroneously includes v0, blur should still skip it.
  const adjacency = [new Set([0, 1, 2])];
  const updates = computeBlurUpdates({
    currentWeights: [0.3, 0.7, 0.5],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  // Mean of v1 and v2 only (v0 self-loop excluded) = (0.7 + 0.5) / 2 = 0.6
  assert(nearlyEq(updates[0].weight, 0.6),
    `self-loop excluded, got ${updates[0].weight}`);
}

// ── 8. clamps to [0,1] (defends against accumulation drift) ────────
{
  // mean = 1.5 (out of range), strength = 1, falloff = 1; cur = 0;
  // next = 0 + (1.5 - 0) * 1 = 1.5 → clamped to 1
  const adjacency = [new Set([1])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1.5],   // bad input
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(updates[0].weight <= 1 + 1e-9 && updates[0].weight >= 0,
    `clamped to [0,1], got ${updates[0].weight}`);
}

// ── 9. NaN/Infinity inputs are tolerated ───────────────────────────
{
  const adjacency = [new Set([1, 2])];
  const updates = computeBlurUpdates({
    currentWeights: [0, NaN, 0.4],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  // NaN neighbor skipped → mean of just v2 (0.4); cur 0; next = 0.4
  assert(nearlyEq(updates[0].weight, 0.4),
    `NaN skipped, got ${updates[0].weight}`);
}

// ── 10. zero-falloff entry skipped (edge of brush) ─────────────────
{
  const adjacency = [new Set([1]), new Set([0])];
  const updates = computeBlurUpdates({
    currentWeights: [0, 1],
    adjacency,
    affected: [{ vertexIndex: 0, falloff: 0 }, { vertexIndex: 1, falloff: 0.8 }],
    strength: 1,
  });
  assert(updates.length === 1, `zero-falloff skipped, got ${updates.length}`);
  assert(updates[0].vertexIndex === 1, 'only v1 returned');
}

// ── 11. malformed inputs → empty array ─────────────────────────────
{
  assert(computeBlurUpdates({ currentWeights: null, adjacency: [], affected: [], strength: 1 }).length === 0,
    'null currentWeights');
  assert(computeBlurUpdates({ currentWeights: [], adjacency: null, affected: [], strength: 1 }).length === 0,
    'null adjacency');
  assert(computeBlurUpdates({ currentWeights: [], adjacency: [], affected: 'oops', strength: 1 }).length === 0,
    'non-array affected');
  assert(computeBlurUpdates({ currentWeights: [], adjacency: [], affected: [], strength: -1 }).length === 0,
    'negative strength');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
