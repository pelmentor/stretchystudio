// Tests for the R7 mask stencil allocator.
//
// Pure allocation logic — no GL. Verifies stable IDs, dedup, multi-mask
// support, and overflow handling.

import { strict as assert } from 'node:assert';
import { allocateMaskStencils, MAX_STENCIL_ID } from '../src/renderer/maskStencil.js';

let pass = 0;
let fail = 0;
const expect = (label, fn) => {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`  ✗ ${label}: ${err.message}`);
  }
};

// ── Empty / malformed input ─────────────────────────────────────────────
expect('empty array → empty maps', () => {
  const r = allocateMaskStencils([]);
  assert.equal(r.stencilByMaskMeshId.size, 0);
  assert.equal(r.stencilsByMaskedMeshId.size, 0);
  assert.equal(r.overflow, 0);
});

expect('null input → empty maps', () => {
  const r = allocateMaskStencils(null);
  assert.equal(r.stencilByMaskMeshId.size, 0);
  assert.equal(r.stencilsByMaskedMeshId.size, 0);
});

expect('undefined input → empty maps', () => {
  const r = allocateMaskStencils(undefined);
  assert.equal(r.stencilByMaskMeshId.size, 0);
});

expect('non-array input → empty maps', () => {
  const r = allocateMaskStencils({ not: 'an array' });
  assert.equal(r.stencilByMaskMeshId.size, 0);
});

// ── Single pair ─────────────────────────────────────────────────────────
expect('single pair → single mask gets stencil 1', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris', maskMeshIds: ['eyewhite'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite'), 1);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris'), [1]);
});

// ── Iris/eyewhite (today's two-side heuristic) ──────────────────────────
expect('iris-l/iris-r pair gets stencils 1, 2 in input order', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris-l', maskMeshIds: ['eyewhite-l'] },
    { maskedMeshId: 'iris-r', maskMeshIds: ['eyewhite-r'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite-l'), 1);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite-r'), 2);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris-l'), [1]);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris-r'), [2]);
});

expect('reversed input order produces reversed stencil layout', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris-r', maskMeshIds: ['eyewhite-r'] },
    { maskedMeshId: 'iris-l', maskMeshIds: ['eyewhite-l'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite-r'), 1);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite-l'), 2);
});

// ── Dedup ───────────────────────────────────────────────────────────────
expect('same mask mesh referenced twice → single stencil ID', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris-l', maskMeshIds: ['eyewhite'] },
    { maskedMeshId: 'iris-r', maskMeshIds: ['eyewhite'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.size, 1);
  assert.equal(r.stencilByMaskMeshId.get('eyewhite'), 1);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris-l'), [1]);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris-r'), [1]);
});

expect('duplicate maskMeshIds in one pair collapse to one stencil', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris', maskMeshIds: ['eyewhite', 'eyewhite', 'eyewhite'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.size, 1);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris'), [1]);
});

// ── Multi-mask ──────────────────────────────────────────────────────────
expect('multi-mask pair stores all stencils sorted', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'special', maskMeshIds: ['m_a', 'm_b', 'm_c'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.get('m_a'), 1);
  assert.equal(r.stencilByMaskMeshId.get('m_b'), 2);
  assert.equal(r.stencilByMaskMeshId.get('m_c'), 3);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('special'), [1, 2, 3]);
});

expect('multi-mask: sorted output regardless of input order', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'maskedA', maskMeshIds: ['m_a', 'm_b'] },
    { maskedMeshId: 'maskedB', maskMeshIds: ['m_c', 'm_a'] },
  ]);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('maskedA'), [1, 2]);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('maskedB'), [1, 3]);
});

expect('repeated maskedMeshId merges stencil sets', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris', maskMeshIds: ['eyewhite-l'] },
    { maskedMeshId: 'iris', maskMeshIds: ['eyewhite-r'] },
  ]);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris'), [1, 2]);
});

// ── Bad input within a pair ─────────────────────────────────────────────
expect('skip pair with non-string maskedMeshId', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 123, maskMeshIds: ['x'] },
    { maskedMeshId: 'real', maskMeshIds: ['y'] },
  ]);
  assert.equal(r.stencilsByMaskedMeshId.size, 1);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('real'), [2]);
});

expect('skip empty maskMeshIds', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'lonely', maskMeshIds: [] },
    { maskedMeshId: 'normal', maskMeshIds: ['x'] },
  ]);
  assert.equal(r.stencilsByMaskedMeshId.has('lonely'), false);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('normal'), [1]);
});

expect('skip non-string entries inside maskMeshIds', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris', maskMeshIds: ['', null, undefined, 0, 'eyewhite'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.size, 1);
  assert.deepEqual(r.stencilsByMaskedMeshId.get('iris'), [1]);
});

expect('skip null pairs in array', () => {
  const r = allocateMaskStencils([
    null,
    { maskedMeshId: 'a', maskMeshIds: ['b'] },
    undefined,
  ]);
  assert.equal(r.stencilsByMaskedMeshId.size, 1);
});

// ── Overflow ────────────────────────────────────────────────────────────
expect('exact-MAX boundary fits without overflow', () => {
  const pairs = [];
  for (let i = 0; i < MAX_STENCIL_ID; i++) {
    pairs.push({ maskedMeshId: `m${i}`, maskMeshIds: [`mask${i}`] });
  }
  const r = allocateMaskStencils(pairs);
  assert.equal(r.stencilByMaskMeshId.size, MAX_STENCIL_ID);
  assert.equal(r.overflow, 0);
  assert.equal(r.stencilByMaskMeshId.get(`mask${MAX_STENCIL_ID - 1}`), MAX_STENCIL_ID);
});

expect('overflow counted when more than MAX unique masks', () => {
  const pairs = [];
  for (let i = 0; i < MAX_STENCIL_ID + 5; i++) {
    pairs.push({ maskedMeshId: `m${i}`, maskMeshIds: [`mask${i}`] });
  }
  const r = allocateMaskStencils(pairs);
  assert.equal(r.stencilByMaskMeshId.size, MAX_STENCIL_ID);
  assert.equal(r.overflow, 5);
});

// ── Determinism ─────────────────────────────────────────────────────────
expect('two calls with same input produce identical layout', () => {
  const input = [
    { maskedMeshId: 'iris-l', maskMeshIds: ['eyewhite-l'] },
    { maskedMeshId: 'iris-r', maskMeshIds: ['eyewhite-r'] },
    { maskedMeshId: 'iris-c', maskMeshIds: ['eyewhite-l', 'eyewhite-r'] },
  ];
  const a = allocateMaskStencils(input);
  const b = allocateMaskStencils(input);
  assert.deepEqual(
    [...a.stencilByMaskMeshId.entries()],
    [...b.stencilByMaskMeshId.entries()],
  );
  assert.deepEqual(
    [...a.stencilsByMaskedMeshId.entries()],
    [...b.stencilsByMaskedMeshId.entries()],
  );
});

// ── Result shape ────────────────────────────────────────────────────────
expect('result maps are Map instances', () => {
  const r = allocateMaskStencils([{ maskedMeshId: 'a', maskMeshIds: ['b'] }]);
  assert.ok(r.stencilByMaskMeshId instanceof Map);
  assert.ok(r.stencilsByMaskedMeshId instanceof Map);
});

expect('stencil values lie in [1, MAX_STENCIL_ID]', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'a', maskMeshIds: ['x', 'y', 'z'] },
  ]);
  for (const v of r.stencilByMaskMeshId.values()) {
    assert.ok(v >= 1 && v <= MAX_STENCIL_ID, `stencil value ${v} out of range`);
  }
});

// ── Realistic Hiyori-style configs ──────────────────────────────────────
expect('Hiyori-style 2-side config + variant produces 4 stencils', () => {
  const r = allocateMaskStencils([
    { maskedMeshId: 'iris-l-base', maskMeshIds: ['eyewhite-l-base'] },
    { maskedMeshId: 'iris-r-base', maskMeshIds: ['eyewhite-r-base'] },
    { maskedMeshId: 'iris-l-smile', maskMeshIds: ['eyewhite-l-smile'] },
    { maskedMeshId: 'iris-r-smile', maskMeshIds: ['eyewhite-r-smile'] },
  ]);
  assert.equal(r.stencilByMaskMeshId.size, 4);
  assert.equal(r.stencilsByMaskedMeshId.size, 4);
  assert.equal(r.overflow, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
