// BufferPool acquire/grow correctness + the rigSpec-keyed get-or-create
// behaviour that R3 relies on for cross-evalRig buffer reuse.

import {
  BufferPool,
  getPoolForRigSpec,
} from '../../src/io/live2d/runtime/evaluator/typedArrayPool.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL:', msg); }
}

// --- 1: acquire returns a buffer of at least the requested length
{
  const p = new BufferPool();
  const a = p.acquireFloat32('a', 10);
  assert(a instanceof Float32Array, 'acquireFloat32 returns Float32Array');
  assert(a.length >= 10, 'returned buffer length >= requested');

  const b = p.acquireFloat64('b', 20);
  assert(b instanceof Float64Array, 'acquireFloat64 returns Float64Array');
  assert(b.length >= 20, 'returned buffer length >= requested');
}

// --- 2: same key returns the same buffer
{
  const p = new BufferPool();
  const a1 = p.acquireFloat32('shared', 5);
  const a2 = p.acquireFloat32('shared', 5);
  assert(a1 === a2, 'same key, same length → same buffer instance');
}

// --- 3: different keys return different buffers
{
  const p = new BufferPool();
  const a = p.acquireFloat32('one', 5);
  const b = p.acquireFloat32('two', 5);
  assert(a !== b, 'different keys → different buffers');
}

// --- 4: length growth allocates a new buffer
{
  const p = new BufferPool();
  const small = p.acquireFloat32('grow', 5);
  const big = p.acquireFloat32('grow', 100);
  assert(big !== small, 'grow → new buffer');
  assert(big.length >= 100, 'grow buffer fits new length');
  // Subsequent acquire at the smaller length re-returns the bigger buffer
  const reAcquire = p.acquireFloat32('grow', 5);
  assert(reAcquire === big, 'after grow, smaller acquire reuses the larger buffer');
}

// --- 5: clear() drops everything
{
  const p = new BufferPool();
  const a = p.acquireFloat32('x', 5);
  p.clear();
  const b = p.acquireFloat32('x', 5);
  assert(a !== b, 'clear → fresh buffer on next acquire');
}

// --- 6: Float32 / Float64 are independent buckets (same key OK)
{
  const p = new BufferPool();
  const f32 = p.acquireFloat32('same', 5);
  const f64 = p.acquireFloat64('same', 5);
  // Different types — they can coexist under the same key string.
  assert(f32 instanceof Float32Array, 'f32 typed correctly');
  assert(f64 instanceof Float64Array, 'f64 typed correctly');
}

// --- 7: getPoolForRigSpec — same rigSpec → same pool
{
  const rig = {};
  const p1 = getPoolForRigSpec(rig);
  const p2 = getPoolForRigSpec(rig);
  assert(p1 === p2, 'same rigSpec → same pool');
}

// --- 8: getPoolForRigSpec — different rigSpec → different pool
{
  const r1 = {};
  const r2 = {};
  const p1 = getPoolForRigSpec(r1);
  const p2 = getPoolForRigSpec(r2);
  assert(p1 !== p2, 'different rigSpec → different pool');
  // And buffers are isolated:
  const b1 = p1.acquireFloat32('shared', 5);
  const b2 = p2.acquireFloat32('shared', 5);
  assert(b1 !== b2, 'pools are isolated');
}

console.log(`typedArrayPool: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
