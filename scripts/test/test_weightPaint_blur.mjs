// Toolset Plan Phase 7.B.2 — Blur brush math (audit-fix D-1: face-loop accumulation).
//
// Verifies `computeBlurUpdates`:
//   - Blender face-loop algorithm: sum face-weight per incident face,
//     denominator = 3 × valence (per `paint_weight.cc:1214-1249`)
//   - falloff * strength controls lerp amount
//   - vertices on no triangles are skipped
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

// ── 2. face-loop blur on single triangle ────────────────────────────
{
  // Single triangle [0,1,2]. v0 weight=0, v1=1, v2=0; full strength + falloff.
  // Per face-loop: valence(v0) = 1, total_loops = 3.
  // sum at v0 = 0 + 1 + 0 = 1. target = 1/3. cur = 0.
  // next = 0 + (1/3 - 0) * 1 * 1 = 1/3.
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 1, `1 update, got ${updates.length}`);
  assert(updates[0].vertexIndex === 0, 'v0');
  assert(nearlyEq(updates[0].weight, 1/3),
    `face-loop: v0 → 1/3, got ${updates[0].weight}`);
}

// ── 3. v1 (the high-weight vertex) self-preservation ──────────────
{
  // Same triangle. v1 has weight 1. valence(v1) = 1, total_loops = 3.
  // sum at v1 = 0 + 1 + 0 = 1 (face's total). target = 1/3. cur = 1.
  // next = 1 + (1/3 - 1) * 1 = 1 - 2/3 = 1/3.
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 1, falloff: 1 }],
    strength: 1,
  });
  assert(nearlyEq(updates[0].weight, 1/3),
    `face-loop: v1 → 1/3 (target=face mean), got ${updates[0].weight}`);
}

// ── 4. valence-2 vertex (two triangles share v0) ──────────────────
{
  // Two triangles sharing vertex 0: [0,1,2] and [0,2,3].
  // v0: valence = 2, total_loops = 6.
  // sum at v0 = (w0+w1+w2) + (w0+w2+w3)
  //          = (0+1+0) + (0+0+0)
  //          = 1.
  // target = 1/6. cur = 0. next = 1/6.
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0, 0],
    triangles: [0, 1, 2, 0, 2, 3],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(nearlyEq(updates[0].weight, 1/6),
    `valence-2 face-loop: 1/6, got ${updates[0].weight}`);
}

// ── 5. partial strength scales lerp ────────────────────────────────
{
  // Same single triangle as test 2. target = 1/3, cur = 0.
  // strength 0.5 → t = 0.5 → next = 0 + (1/3) * 0.5 = 1/6.
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 0.5,
  });
  assert(nearlyEq(updates[0].weight, 1/6),
    `strength 0.5 → 1/6, got ${updates[0].weight}`);
}

// ── 6. partial falloff scales lerp ────────────────────────────────
{
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 0.4 }],
    strength: 1,
  });
  // t = 0.4 * 1 = 0.4; next = 0 + 1/3 * 0.4 = 2/15
  assert(nearlyEq(updates[0].weight, 2/15),
    `falloff 0.4 → 2/15, got ${updates[0].weight}`);
}

// ── 7. zero strength → no updates ──────────────────────────────────
{
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 0,
  });
  assert(updates.length === 0, `zero strength → no updates, got ${updates.length}`);
}

// ── 8. orphan vertex (no incident triangle) skipped ──────────────
{
  // v0 has no incident triangle (the triangle is [1,2,3]).
  const updates = computeBlurUpdates({
    currentWeights: [0.5, 0, 0, 0],
    triangles: [1, 2, 3],
    affected: [{ vertexIndex: 0, falloff: 1 }, { vertexIndex: 1, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 1, `orphan v0 skipped, got ${updates.length}`);
  assert(updates[0].vertexIndex === 1, 'only v1 returned');
}

// ── 9. clamps to [0,1] ─────────────────────────────────────────────
{
  // bad data: all-1.5 face + cur 0; target = (1.5*3)/3 = 1.5 → clamped 1.
  const updates = computeBlurUpdates({
    currentWeights: [0, 1.5, 1.5],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(updates[0].weight <= 1 + 1e-9 && updates[0].weight >= 0,
    `clamped to [0,1], got ${updates[0].weight}`);
}

// ── 10. NaN/Infinity face vertex weights tolerated (treated as 0) ─
{
  const updates = computeBlurUpdates({
    currentWeights: [0, NaN, 0.6],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  // NaN → 0 in face sum: face = 0 + 0 + 0.6 = 0.6; target = 0.2; cur 0 → 0.2.
  assert(nearlyEq(updates[0].weight, 0.2),
    `NaN treated as 0, got ${updates[0].weight}`);
}

// ── 11. zero-falloff entry skipped (edge of brush) ─────────────────
{
  const updates = computeBlurUpdates({
    currentWeights: [0, 1, 0],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 0 }, { vertexIndex: 1, falloff: 0.8 }],
    strength: 1,
  });
  assert(updates.length === 1, `zero-falloff skipped, got ${updates.length}`);
  assert(updates[0].vertexIndex === 1, 'only v1 returned');
}

// ── 12. malformed inputs → empty array ─────────────────────────────
{
  assert(computeBlurUpdates({ currentWeights: null, triangles: [0,1,2], affected: [], strength: 1 }).length === 0,
    'null currentWeights');
  assert(computeBlurUpdates({ currentWeights: [], triangles: null, affected: [], strength: 1 }).length === 0,
    'null triangles');
  assert(computeBlurUpdates({ currentWeights: [], triangles: [], affected: 'oops', strength: 1 }).length === 0,
    'non-array affected');
  assert(computeBlurUpdates({ currentWeights: [], triangles: [], affected: [], strength: -1 }).length === 0,
    'negative strength');
}

// ── 13. flat region — already balanced — no-op ────────────────────
{
  // All weights equal; face sum = 3 * w; target = w; lerp delta = 0.
  const updates = computeBlurUpdates({
    currentWeights: [0.5, 0.5, 0.5],
    triangles: [0, 1, 2],
    affected: [{ vertexIndex: 0, falloff: 1 }, { vertexIndex: 1, falloff: 1 }, { vertexIndex: 2, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 3, '3 updates emitted');
  for (const u of updates) {
    assert(nearlyEq(u.weight, 0.5), `flat region: v${u.vertexIndex} stays 0.5, got ${u.weight}`);
  }
}

// ── 14. degenerate triangle indices skipped ────────────────────────
{
  // Triangle [0, 99, 1] — index 99 is out of range; whole face skipped.
  // v0 has no other incident triangle; should be a no-op (orphan-ish).
  const updates = computeBlurUpdates({
    currentWeights: [0, 1],
    triangles: [0, 99, 1],
    affected: [{ vertexIndex: 0, falloff: 1 }],
    strength: 1,
  });
  assert(updates.length === 0,
    `out-of-range index → face skipped, got ${updates.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
