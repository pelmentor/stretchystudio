// Toolset Plan Phase 2.B/F — snap-to-grid math (Modal G).
//
// Validates that `snapDeltaToGrid` rounds each axis independently to
// the nearest multiple of `increment`, handles axis-locked deltas
// (one axis = 0), and degrades cleanly on bad input.
//
// Run: node scripts/test/test_snap_grid_translate.mjs

import { snapDeltaToGrid } from '../../src/lib/snap/snapMath.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── 1: increment 16 (Phase 2 default) ────────────────────────────────
{
  const r = snapDeltaToGrid({ x: 0, y: 0 }, 16);
  assert(r.x === 0 && r.y === 0, 'origin → origin');
  const r2 = snapDeltaToGrid({ x: 7, y: 9 }, 16);
  assert(r2.x === 0 && r2.y === 16, '(7, 9) → (0, 16) at inc 16');
  const r3 = snapDeltaToGrid({ x: 24, y: -8 }, 16);
  assert(r3.x === 32 && r3.y === 0, '(24, -8) → (32, 0) at inc 16');
  const r4 = snapDeltaToGrid({ x: -25, y: -40 }, 16);
  // -25/16 = -1.5625 → round → -2 → -32. -40/16 = -2.5 → JS Math.round
  // rounds half towards +Inf, so -2.5 → -2 → -32 (not -48).
  assert(r4.x === -32 && r4.y === -32, '(-25, -40) → (-32, -32) at inc 16');
}

// ── 2: increment 10 (legacy fallback) ────────────────────────────────
{
  const r = snapDeltaToGrid({ x: 14, y: 16 }, 10);
  assert(r.x === 10 && r.y === 20, '(14, 16) → (10, 20) at inc 10');
  const r2 = snapDeltaToGrid({ x: 5, y: -5 }, 10);
  // Math.round(0.5)=1 in JS (away from zero for positive); -0.5 → 0.
  assert(r2.x === 10, '(5, _) → 10 at inc 10 (Math.round half-up)');
  assert(r2.y === 0,  '(_, -5) → 0  at inc 10 (Math.round towards zero from negative)');
}

// ── 3: axis-locked (one axis pre-zeroed) ─────────────────────────────
{
  const r = snapDeltaToGrid({ x: 17, y: 0 }, 16);
  assert(r.x === 16 && r.y === 0, 'axis-X locked: y stays 0');
  const r2 = snapDeltaToGrid({ x: 0, y: 33 }, 16);
  assert(r2.x === 0 && r2.y === 32, 'axis-Y locked: x stays 0');
}

// ── 4: large increment (Phase 2 N-panel allows up to 256) ────────────
{
  const r = snapDeltaToGrid({ x: 100, y: 200 }, 64);
  assert(r.x === 128 && r.y === 192, '(100, 200) → (128, 192) at inc 64');
}

// ── 5: bad input degrades to identity ────────────────────────────────
{
  const r = snapDeltaToGrid({ x: 7, y: 9 }, 0);
  assert(r.x === 7 && r.y === 9, 'inc 0 → identity');
  const r2 = snapDeltaToGrid({ x: 7, y: 9 }, -8);
  assert(r2.x === 7 && r2.y === 9, 'inc <0 → identity');
  const r3 = snapDeltaToGrid({ x: NaN, y: 9 }, 16);
  assert(r3.x === 0 && r3.y === 16, 'NaN x → coerced to 0');
  const r4 = snapDeltaToGrid(null, 16);
  assert(r4.x === 0 && r4.y === 0, 'null delta → origin');
}

// ── 6: increment-multiple rounds to same value (idempotent on grid) ──
{
  const r = snapDeltaToGrid({ x: 32, y: 64 }, 16);
  assert(r.x === 32 && r.y === 64, 'on-grid stays on-grid');
  const r2 = snapDeltaToGrid({ x: -48, y: -16 }, 16);
  assert(r2.x === -48 && r2.y === -16, 'on-grid stays on-grid (negative)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
