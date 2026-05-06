// BVR-005 — modalTransformStore typed buffer.
//
// Properties verified:
//   1. begin() seeds typedBuffer to ''.
//   2. appendTyped accepts digits, '.', and a leading '-'.
//   3. appendTyped rejects '-' anywhere except as a leading character.
//   4. appendTyped rejects a second '.'.
//   5. appendTyped on empty buffer with '.' yields '0.' (so "0.5" not ".5").
//   6. popTyped removes the last char; idempotent at empty.
//   7. clearTyped resets to ''.
//   8. commit / cancel / reset clear the buffer.
//
// Run: node scripts/test/test_modalTransformTyped.mjs

import { useModalTransformStore } from '../../src/store/modalTransformStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

const fakePayload = {
  kind: 'translate',
  startMouse: { x: 0, y: 0 },
  pivotCanvas: { x: 0, y: 0 },
  original: new Map([['n1', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]]),
};

// ── Test 1: begin seeds buffer to '' ──
{
  useModalTransformStore.getState().begin(fakePayload);
  assert(useModalTransformStore.getState().typedBuffer === '', 'Test 1: begin → typedBuffer = ""');
}

// ── Test 2: appendTyped accepts digits / dot / leading sign ──
{
  useModalTransformStore.getState().begin(fakePayload);
  const s = useModalTransformStore.getState();
  s.appendTyped('-');
  s.appendTyped('1');
  s.appendTyped('2');
  s.appendTyped('.');
  s.appendTyped('5');
  assert(useModalTransformStore.getState().typedBuffer === '-12.5',
    `Test 2: typed buffer is "-12.5" (got "${useModalTransformStore.getState().typedBuffer}")`);
}

// ── Test 3: '-' mid-stream rejected ──
{
  useModalTransformStore.getState().begin(fakePayload);
  const s = useModalTransformStore.getState();
  s.appendTyped('1');
  s.appendTyped('-');
  assert(useModalTransformStore.getState().typedBuffer === '1',
    `Test 3: '-' mid-stream rejected (got "${useModalTransformStore.getState().typedBuffer}")`);
}

// ── Test 4: second '.' rejected ──
{
  useModalTransformStore.getState().begin(fakePayload);
  const s = useModalTransformStore.getState();
  s.appendTyped('1');
  s.appendTyped('.');
  s.appendTyped('5');
  s.appendTyped('.');
  s.appendTyped('2');
  assert(useModalTransformStore.getState().typedBuffer === '1.52',
    `Test 4: second '.' rejected (got "${useModalTransformStore.getState().typedBuffer}")`);
}

// ── Test 5: leading '.' yields "0." ──
{
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTyped('.');
  useModalTransformStore.getState().appendTyped('5');
  assert(useModalTransformStore.getState().typedBuffer === '0.5',
    `Test 5: leading '.' yields "0." (got "${useModalTransformStore.getState().typedBuffer}")`);
}

// ── Test 6: popTyped removes last char; idempotent at empty ──
{
  useModalTransformStore.getState().begin(fakePayload);
  const s = useModalTransformStore.getState();
  s.appendTyped('1');
  s.appendTyped('2');
  s.popTyped();
  assert(useModalTransformStore.getState().typedBuffer === '1',
    'Test 6: popTyped drops last char');
  s.popTyped();
  s.popTyped(); // idempotent
  assert(useModalTransformStore.getState().typedBuffer === '',
    'Test 6: popTyped idempotent at empty');
}

// ── Test 7: clearTyped resets to '' ──
{
  useModalTransformStore.getState().begin(fakePayload);
  const s = useModalTransformStore.getState();
  s.appendTyped('1');
  s.appendTyped('2');
  s.clearTyped();
  assert(useModalTransformStore.getState().typedBuffer === '',
    'Test 7: clearTyped resets buffer');
}

// ── Test 8: commit / cancel / reset all clear the buffer ──
{
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTyped('1');
  useModalTransformStore.getState().commit();
  assert(useModalTransformStore.getState().typedBuffer === '',
    'Test 8: commit clears typedBuffer');

  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTyped('2');
  useModalTransformStore.getState().cancel();
  assert(useModalTransformStore.getState().typedBuffer === '',
    'Test 8: cancel clears typedBuffer');

  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTyped('3');
  useModalTransformStore.getState().reset();
  assert(useModalTransformStore.getState().typedBuffer === '',
    'Test 8: reset clears typedBuffer');
}

console.log(`\nmodalTransformTyped: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
