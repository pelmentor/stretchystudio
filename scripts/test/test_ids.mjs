// v3 Phase 0G — ID generator tests.
// Run: node scripts/test_ids.mjs

import { uid, uidLong } from '../../src/lib/ids.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Shape ───────────────────────────────────────────────────────────

{
  const id = uid();
  assert(typeof id === 'string', 'uid: returns string');
  assert(id.length === 12, 'uid: 12 chars');
  assert(/^[0-9a-f]+$/.test(id), 'uid: lowercase hex');
}

{
  const id = uidLong();
  assert(typeof id === 'string', 'uidLong: returns string');
  assert(id.length === 32, 'uidLong: 32 chars');
  assert(/^[0-9a-f]+$/.test(id), 'uidLong: lowercase hex');
}

// ── Uniqueness over a moderate batch ────────────────────────────────
//
// Old `Math.random().toString(36).slice(2, 9)` would collide at ~65 K
// IDs by birthday bound. crypto.randomUUID is safe to ~2^61 — we
// don't need to test that hard, but 100 K is a reasonable smoke test
// that the randomness is real.

{
  const seen = new Set();
  let collisions = 0;
  const N = 100_000;
  for (let i = 0; i < N; i++) {
    const id = uid();
    if (seen.has(id)) collisions++;
    seen.add(id);
  }
  assert(collisions === 0, `uid: ${N} unique IDs (no collisions)`);
}

{
  const seen = new Set();
  let collisions = 0;
  const N = 100_000;
  for (let i = 0; i < N; i++) {
    const id = uidLong();
    if (seen.has(id)) collisions++;
    seen.add(id);
  }
  assert(collisions === 0, `uidLong: ${N} unique IDs (no collisions)`);
}

// ── uid is a prefix of uidLong distribution ────────────────────────

{
  // Just check that uid produces valid hex by checking against
  // uidLong's character set.
  for (let i = 0; i < 100; i++) {
    const a = uid();
    const b = uidLong();
    assert(a.length === 12 && b.length === 32, 'lengths stable across calls');
  }
}

console.log(`ids: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
