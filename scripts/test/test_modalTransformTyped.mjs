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

// ── Audit 4 #4 + audit-fix sweep — numericMode + liveDelta ─────────
//
// `=` is one-way enable (FID-B.3 audit-fix sweep — was toggle, now
// enterNumericMode + exitNumericMode pair). With numericMode true and
// the buffer empty, the overlay holds the transform at typed=0.
// Backspace at empty buffer is an SS-specific escape hatch out of
// numericMode (Blender's NUM_EDIT_FULL doesn't have it; users would
// otherwise be stuck holding zero with no exit except Esc-cancel).
// commit / cancel / reset / begin all clear the flag.

{
  // begin seeds numericMode false + liveDelta zeroed
  useModalTransformStore.getState().begin(fakePayload);
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit: begin seeds numericMode false');
  const ld = useModalTransformStore.getState().liveDelta;
  assert(ld.dx === 0 && ld.dy === 0 && ld.dRot === 0 && ld.scale === 1,
    'Audit: begin seeds liveDelta zero');

  // enterNumericMode → true; exitNumericMode → false (FID-B.3 — `=`
  // is one-way enable, Ctrl+= disables; no toggle).
  useModalTransformStore.getState().enterNumericMode();
  assert(useModalTransformStore.getState().numericMode === true,
    'Audit FID-B.3: enterNumericMode → true');
  // Second enter is idempotent (mirrors Blender: `=` again does nothing)
  useModalTransformStore.getState().enterNumericMode();
  assert(useModalTransformStore.getState().numericMode === true,
    'Audit FID-B.3: enterNumericMode is idempotent');
  useModalTransformStore.getState().exitNumericMode();
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit FID-B.3: exitNumericMode → false');
  useModalTransformStore.getState().exitNumericMode();
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit FID-B.3: exitNumericMode is idempotent');

  // setLiveDelta publishes; HUD subscribers re-render off this
  useModalTransformStore.getState().setLiveDelta({ dx: 12, dy: -4, dRot: 0.25, scale: 1.5 });
  const ld2 = useModalTransformStore.getState().liveDelta;
  assert(ld2.dx === 12 && ld2.dy === -4, 'Audit: setLiveDelta records translate values');
  assert(ld2.dRot === 0.25, 'Audit: setLiveDelta records rotation');
  assert(ld2.scale === 1.5, 'Audit: setLiveDelta records scale');

  // Backspace at empty buffer with numericMode true also turns mode off
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().enterNumericMode();
  assert(useModalTransformStore.getState().numericMode === true,
    'Audit: numericMode armed for backspace test');
  useModalTransformStore.getState().popTyped(); // empty buffer → also turns mode off
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit: backspace on empty buffer exits numericMode');

  // commit / cancel / reset clear both flag and liveDelta
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().enterNumericMode();
  useModalTransformStore.getState().setLiveDelta({ dx: 5, dy: 5, dRot: 1, scale: 2 });
  useModalTransformStore.getState().commit();
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit: commit clears numericMode');
  const ld3 = useModalTransformStore.getState().liveDelta;
  assert(ld3.dx === 0 && ld3.scale === 1, 'Audit: commit zeroes liveDelta');

  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().enterNumericMode();
  useModalTransformStore.getState().cancel();
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit: cancel clears numericMode');

  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().enterNumericMode();
  useModalTransformStore.getState().reset();
  assert(useModalTransformStore.getState().numericMode === false,
    'Audit: reset clears numericMode');
}

// ── Slice 5.U — `appendTypedAuto` store action ───────────────────────
// Mirror of the reducer's atomic-action contract: a single dispatch
// both appends the char AND flips numericMode in one tick. Validates
// the store wrapper exposes the same atomicity as the underlying
// reducer (caller's imperative read of state.numericMode immediately
// after dispatch sees `true`, not `false`).
{
  useModalTransformStore.getState().begin(fakePayload);
  assert(useModalTransformStore.getState().numericMode === false,
    '5.U: begin seeds numericMode false');

  // Plain digit + auto → buffer appended AND numericMode flipped
  useModalTransformStore.getState().appendTypedAuto('5');
  const after = useModalTransformStore.getState();
  assert(after.typedBuffer === '5', '5.U: appendTypedAuto digit appended');
  assert(after.numericMode === true, '5.U: appendTypedAuto flipped numericMode atomically');

  // Subsequent appendTypedAuto stays in numericMode (idempotent on flip)
  useModalTransformStore.getState().appendTypedAuto('3');
  const after2 = useModalTransformStore.getState();
  assert(after2.typedBuffer === '53', '5.U: appendTypedAuto chains buffer');
  assert(after2.numericMode === true, '5.U: numericMode stays on after second appendTypedAuto');

  // Invalid char: no flip, no buffer change
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTypedAuto('a');
  const afterBad = useModalTransformStore.getState();
  assert(afterBad.typedBuffer === '', '5.U: appendTypedAuto invalid char no buffer change');
  assert(afterBad.numericMode === false, '5.U: appendTypedAuto invalid char no flip');

  // Rejected sign mid-buffer: no flip
  useModalTransformStore.getState().begin(fakePayload);
  useModalTransformStore.getState().appendTyped('1');
  useModalTransformStore.getState().appendTypedAuto('-');
  const afterReject = useModalTransformStore.getState();
  assert(afterReject.typedBuffer === '1', '5.U: appendTypedAuto rejected sign mid-stream');
  assert(afterReject.numericMode === false, '5.U: appendTypedAuto rejected sign no flip');
}

console.log(`\nmodalTransformTyped: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
