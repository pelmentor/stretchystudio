// @ts-check
/**
 * Animation Phase 5 Slice 5.E -- shared modal-transform input reducer.
 *
 * Verifies `transformInputReducer` + `parseTyped` + `keyEventToAction`
 * from `src/lib/modal/transformInputReducer.js`. These primitives back
 * BOTH the viewport `modalTransformStore` and the FCurveEditor's
 * `useTransformModalInput` hook -- so a regression here breaks every
 * modal G/R/S handler in the app.
 *
 * The existing `test_modalTransformTyped.mjs` covers store-level
 * observable behavior end-to-end (validates the wrapper); this file
 * exercises the reducer + helper directly so the rules can fail in
 * isolation without the zustand mount complicating the trace.
 */

import {
  INITIAL_STATE,
  transformInputReducer,
  parseTyped,
  keyEventToAction,
} from '../../src/lib/modal/transformInputReducer.js';

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function deepEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── INITIAL_STATE ──────────────────────────────────────────────────────
deepEq(INITIAL_STATE, { axis: null, typedBuffer: '', numericMode: false },
  'INITIAL_STATE shape');
eq(Object.isFrozen(INITIAL_STATE), true, 'INITIAL_STATE is frozen');

// ── parseTyped ─────────────────────────────────────────────────────────
eq(Number.isNaN(parseTyped('')),          true, 'parseTyped("") = NaN');
eq(Number.isNaN(parseTyped(null)),        true, 'parseTyped(null) = NaN');
eq(Number.isNaN(parseTyped(undefined)),   true, 'parseTyped(undefined) = NaN');
eq(Number.isNaN(parseTyped('-')),         true, 'parseTyped("-") = NaN (mid-typing)');
eq(Number.isNaN(parseTyped('.')),         true, 'parseTyped(".") = NaN (mid-typing)');
eq(parseTyped('0'),     0,    'parseTyped("0")');
eq(parseTyped('5'),     5,    'parseTyped("5")');
eq(parseTyped('-12.5'), -12.5,'parseTyped("-12.5")');
eq(parseTyped('0.5'),   0.5,  'parseTyped("0.5")');

// ── reducer: toggleAxis ────────────────────────────────────────────────
{
  const s0 = INITIAL_STATE;
  const s1 = transformInputReducer(s0, { type: 'toggleAxis', axis: 'x' });
  eq(s1.axis, 'x', 'toggleAxis x from null → x');
  const s2 = transformInputReducer(s1, { type: 'toggleAxis', axis: 'x' });
  eq(s2.axis, null, 'toggleAxis x from x → null (toggle)');
  const s3 = transformInputReducer(s1, { type: 'toggleAxis', axis: 'y' });
  eq(s3.axis, 'y', 'toggleAxis y from x → y (axis switch, not toggle)');
  const sBad = transformInputReducer(s0, { type: 'toggleAxis', axis: 'z' });
  eq(sBad, s0, 'toggleAxis z is a noop (returns same identity)');
}

// ── reducer: setAxis (direct setter) ───────────────────────────────────
{
  const s0 = INITIAL_STATE;
  const s1 = transformInputReducer(s0, { type: 'setAxis', axis: 'y' });
  eq(s1.axis, 'y', 'setAxis y');
  const s2 = transformInputReducer(s1, { type: 'setAxis', axis: null });
  eq(s2.axis, null, 'setAxis null clears');
  const s3 = transformInputReducer(s0, { type: 'setAxis', axis: 'z' });
  eq(s3, s0, 'setAxis z normalises to null + same-identity noop');
  const s4 = transformInputReducer(s1, { type: 'setAxis', axis: 'y' });
  eq(s4, s1, 'setAxis same-axis = same identity (no churn)');
}

// ── reducer: appendTyped ───────────────────────────────────────────────
{
  let s = INITIAL_STATE;
  s = transformInputReducer(s, { type: 'appendTyped', ch: '-' });
  s = transformInputReducer(s, { type: 'appendTyped', ch: '1' });
  s = transformInputReducer(s, { type: 'appendTyped', ch: '2' });
  s = transformInputReducer(s, { type: 'appendTyped', ch: '.' });
  s = transformInputReducer(s, { type: 'appendTyped', ch: '5' });
  eq(s.typedBuffer, '-12.5', 'appendTyped builds "-12.5"');

  // '-' mid-stream rejected
  const s2 = transformInputReducer({ ...INITIAL_STATE, typedBuffer: '1' },
    { type: 'appendTyped', ch: '-' });
  eq(s2.typedBuffer, '1', "appendTyped '-' mid-stream rejected");

  // second '.' rejected
  const s3 = transformInputReducer({ ...INITIAL_STATE, typedBuffer: '1.5' },
    { type: 'appendTyped', ch: '.' });
  eq(s3.typedBuffer, '1.5', "appendTyped second '.' rejected");

  // leading '.' yields '0.'
  const s4 = transformInputReducer(INITIAL_STATE, { type: 'appendTyped', ch: '.' });
  eq(s4.typedBuffer, '0.', "appendTyped leading '.' yields '0.'");

  // invalid char (letter) is a noop with same identity
  const sBad = transformInputReducer(INITIAL_STATE, { type: 'appendTyped', ch: 'a' });
  eq(sBad, INITIAL_STATE, 'appendTyped letter = same identity');

  // multi-char rejected (defends against accidental "10" passed at once)
  const sMulti = transformInputReducer(INITIAL_STATE, { type: 'appendTyped', ch: '10' });
  eq(sMulti, INITIAL_STATE, 'appendTyped multi-char string = same identity');
}

// ── reducer: popTyped ──────────────────────────────────────────────────
{
  const s1 = transformInputReducer({ ...INITIAL_STATE, typedBuffer: '12' }, { type: 'popTyped' });
  eq(s1.typedBuffer, '1', 'popTyped drops last char');
  // pop on empty buffer (numericMode false) -> same identity
  const sNoop = transformInputReducer(INITIAL_STATE, { type: 'popTyped' });
  eq(sNoop, INITIAL_STATE, 'popTyped on empty + !numericMode = same identity');
  // pop on empty buffer (numericMode true) -> exits numericMode (SS-specific
  // escape hatch from `transformInputReducer.js` jsdoc)
  const sExit = transformInputReducer(
    { ...INITIAL_STATE, numericMode: true },
    { type: 'popTyped' },
  );
  eq(sExit.numericMode, false, 'popTyped on empty + numericMode = exits numericMode');
  eq(sExit.typedBuffer, '', 'popTyped on empty + numericMode = buffer stays empty');
}

// ── reducer: clearTyped ────────────────────────────────────────────────
{
  const s1 = transformInputReducer({ ...INITIAL_STATE, typedBuffer: '42' }, { type: 'clearTyped' });
  eq(s1.typedBuffer, '', 'clearTyped wipes');
  const sNoop = transformInputReducer(INITIAL_STATE, { type: 'clearTyped' });
  eq(sNoop, INITIAL_STATE, 'clearTyped on empty = same identity');
}

// ── reducer: enterNumericMode / exitNumericMode (idempotent) ──────────
{
  const s1 = transformInputReducer(INITIAL_STATE, { type: 'enterNumericMode' });
  eq(s1.numericMode, true, 'enterNumericMode → true');
  const sNoop = transformInputReducer(s1, { type: 'enterNumericMode' });
  eq(sNoop, s1, 'enterNumericMode idempotent (same identity)');
  const s2 = transformInputReducer(s1, { type: 'exitNumericMode' });
  eq(s2.numericMode, false, 'exitNumericMode → false');
  const sNoop2 = transformInputReducer(INITIAL_STATE, { type: 'exitNumericMode' });
  eq(sNoop2, INITIAL_STATE, 'exitNumericMode idempotent');
}

// ── reducer: reset ─────────────────────────────────────────────────────
{
  const dirty = { axis: 'x', typedBuffer: '42', numericMode: true };
  const s1 = transformInputReducer(dirty, { type: 'reset' });
  eq(s1, INITIAL_STATE, 'reset returns INITIAL_STATE identity');
  const sNoop = transformInputReducer(INITIAL_STATE, { type: 'reset' });
  eq(sNoop, INITIAL_STATE, 'reset on initial = same identity');
}

// ── reducer: noop / commit / cancel = same identity ────────────────────
{
  const sNoop1 = transformInputReducer(INITIAL_STATE, { type: 'noop' });
  eq(sNoop1, INITIAL_STATE, "'noop' action = same identity");
  const sNoop2 = transformInputReducer(INITIAL_STATE, { type: 'commit' });
  eq(sNoop2, INITIAL_STATE, "'commit' action is recognised but state-less");
  const sNoop3 = transformInputReducer(INITIAL_STATE, { type: 'cancel' });
  eq(sNoop3, INITIAL_STATE, "'cancel' action is recognised but state-less");
}

// ── reducer: malformed action = same identity ──────────────────────────
{
  // @ts-expect-error
  eq(transformInputReducer(INITIAL_STATE, null), INITIAL_STATE, 'null action = same identity');
  // @ts-expect-error
  eq(transformInputReducer(INITIAL_STATE, undefined), INITIAL_STATE, 'undefined action = same identity');
  // @ts-expect-error
  eq(transformInputReducer(INITIAL_STATE, 'string'), INITIAL_STATE, 'string action = same identity');
  // @ts-expect-error
  eq(transformInputReducer(INITIAL_STATE, { type: 'unknown' }), INITIAL_STATE, 'unknown type = same identity');
}

// ── keyEventToAction ───────────────────────────────────────────────────
function fakeKey(opts) {
  return {
    key: '',
    code: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...opts,
  };
}

// Escape / Enter route to commit/cancel
deepEq(keyEventToAction(fakeKey({ key: 'Escape' })),
  { type: 'cancel' }, 'Escape → cancel');
deepEq(keyEventToAction(fakeKey({ key: 'Enter' })),
  { type: 'commit' }, 'Enter → commit');

// Bare X / Y → toggleAxis
deepEq(keyEventToAction(fakeKey({ key: 'x', code: 'KeyX' })),
  { type: 'toggleAxis', axis: 'x' }, 'KeyX → toggleAxis x');
deepEq(keyEventToAction(fakeKey({ key: 'y', code: 'KeyY' })),
  { type: 'toggleAxis', axis: 'y' }, 'KeyY → toggleAxis y');

// Shift+X / Shift+Y → noop (2D plane-lock blocked per transform.cc:660-662)
deepEq(keyEventToAction(fakeKey({ key: 'x', code: 'KeyX', shiftKey: true })),
  { type: 'noop' }, 'Shift+X → noop (2D plane-lock blocked)');
deepEq(keyEventToAction(fakeKey({ key: 'y', code: 'KeyY', shiftKey: true })),
  { type: 'noop' }, 'Shift+Y → noop');

// axisAllowed:false suppresses bare X/Y (still falls through to digits below
// if those keys ever map to digits, but they don't -- so result is null)
eq(keyEventToAction(fakeKey({ key: 'x', code: 'KeyX' }), { axisAllowed: false }),
  null, 'KeyX with axisAllowed:false → null');

// = / Ctrl+= → numericMode enter/exit
deepEq(keyEventToAction(fakeKey({ key: '=' })),
  { type: 'enterNumericMode' }, '= → enterNumericMode');
deepEq(keyEventToAction(fakeKey({ key: '=', ctrlKey: true })),
  { type: 'exitNumericMode' }, 'Ctrl+= → exitNumericMode');
deepEq(keyEventToAction(fakeKey({ key: '=', metaKey: true })),
  { type: 'exitNumericMode' }, 'Meta+= → exitNumericMode (mac-friendly)');

// Backspace → popTyped
deepEq(keyEventToAction(fakeKey({ key: 'Backspace' })),
  { type: 'popTyped' }, 'Backspace → popTyped');

// Digits / sign / dot
deepEq(keyEventToAction(fakeKey({ key: '0' })),
  { type: 'appendTyped', ch: '0' }, "'0' → appendTyped");
deepEq(keyEventToAction(fakeKey({ key: '9' })),
  { type: 'appendTyped', ch: '9' }, "'9' → appendTyped");
deepEq(keyEventToAction(fakeKey({ key: '-' })),
  { type: 'appendTyped', ch: '-' }, "'-' → appendTyped");
deepEq(keyEventToAction(fakeKey({ key: '.' })),
  { type: 'appendTyped', ch: '.' }, "'.' → appendTyped");

// Non-handled keys → null
eq(keyEventToAction(fakeKey({ key: 'a' })), null, "'a' → null");
eq(keyEventToAction(fakeKey({ key: 'Tab' })), null, "'Tab' → null");
eq(keyEventToAction(fakeKey({ key: 'Shift' })), null, "'Shift' (modifier only) → null");
eq(keyEventToAction(fakeKey({ key: 'ArrowLeft' })), null, "'ArrowLeft' → null");

// Multi-char `key` strings (e.g. 'F1') → null
eq(keyEventToAction(fakeKey({ key: 'F1' })), null, "'F1' → null");

// ── reducer: appendTypedAuto (Slice 5.U) ──────────────────────────────
{
  // Plain digit + auto: appends AND enters numericMode atomically
  const s1 = transformInputReducer(INITIAL_STATE, { type: 'appendTypedAuto', ch: '5' });
  eq(s1.typedBuffer, '5', 'appendTypedAuto: digit appended');
  eq(s1.numericMode, true, 'appendTypedAuto: numericMode flipped on by atomic action');

  // Sign + auto: same buffer rule as appendTyped, also enters numericMode
  const s2 = transformInputReducer(INITIAL_STATE, { type: 'appendTypedAuto', ch: '-' });
  eq(s2.typedBuffer, '-', "appendTypedAuto '-': leading sign accepted");
  eq(s2.numericMode, true, "appendTypedAuto '-': numericMode flipped on");

  // Leading dot + auto: yields '0.'
  const s3 = transformInputReducer(INITIAL_STATE, { type: 'appendTypedAuto', ch: '.' });
  eq(s3.typedBuffer, '0.', "appendTypedAuto leading '.': yields '0.'");
  eq(s3.numericMode, true, "appendTypedAuto leading '.': numericMode flipped on");

  // Invalid char: NO mutation, numericMode stays whatever it was
  const sBad = transformInputReducer(INITIAL_STATE, { type: 'appendTypedAuto', ch: 'a' });
  eq(sBad, INITIAL_STATE, 'appendTypedAuto invalid char: same identity (no flip)');

  // Multi-char: rejected (same as appendTyped)
  const sMulti = transformInputReducer(INITIAL_STATE, { type: 'appendTypedAuto', ch: '10' });
  eq(sMulti, INITIAL_STATE, 'appendTypedAuto multi-char: same identity');

  // Sign mid-buffer: rejected; no flip either (matches appendTyped)
  const s4Pre = transformInputReducer(INITIAL_STATE, { type: 'appendTyped', ch: '1' });
  const s4 = transformInputReducer(s4Pre, { type: 'appendTypedAuto', ch: '-' });
  eq(s4.typedBuffer, '1', "appendTypedAuto '-' mid-stream: rejected");
  eq(s4.numericMode, false, "appendTypedAuto '-' mid-stream: numericMode does NOT flip on rejection");

  // Second dot: rejected; no flip either
  const s5Pre = transformInputReducer(INITIAL_STATE, { type: 'appendTyped', ch: '1' });
  const s5Pre2 = transformInputReducer(s5Pre, { type: 'appendTyped', ch: '.' });
  const s5 = transformInputReducer(s5Pre2, { type: 'appendTypedAuto', ch: '.' });
  eq(s5.typedBuffer, '1.', "appendTypedAuto second '.': rejected");
  eq(s5.numericMode, false, "appendTypedAuto second '.': numericMode does NOT flip on rejection");

  // Atomicity: a single dispatch yields BOTH transitions (caller's
  // imperative read of stateRef sees numericMode=true on first tick)
  let atomic = INITIAL_STATE;
  atomic = transformInputReducer(atomic, { type: 'appendTypedAuto', ch: '7' });
  eq(atomic.typedBuffer, '7', 'atomicity: buffer post-dispatch');
  eq(atomic.numericMode, true, 'atomicity: numericMode post-dispatch (same tick)');

  // Already in numericMode: only the buffer changes
  const sPre = { ...INITIAL_STATE, numericMode: true };
  const sPost = transformInputReducer(sPre, { type: 'appendTypedAuto', ch: '3' });
  eq(sPost.typedBuffer, '3', 'appendTypedAuto in numericMode: buffer appended');
  eq(sPost.numericMode, true, 'appendTypedAuto in numericMode: stays on');
}

// ── keyEventToAction with `numericInputAdvanced` (Slice 5.U) ──────────
{
  // OFF (default) -> appendTyped
  deepEq(keyEventToAction(fakeKey({ key: '5' })),
    { type: 'appendTyped', ch: '5' }, 'pref OFF: digit → appendTyped');
  deepEq(keyEventToAction(fakeKey({ key: '5' }), { numericInputAdvanced: false }),
    { type: 'appendTyped', ch: '5' }, 'pref OFF (explicit): digit → appendTyped');

  // ON -> appendTypedAuto for digit / sign / dot
  deepEq(keyEventToAction(fakeKey({ key: '5' }), { numericInputAdvanced: true }),
    { type: 'appendTypedAuto', ch: '5' }, 'pref ON: digit → appendTypedAuto');
  deepEq(keyEventToAction(fakeKey({ key: '-' }), { numericInputAdvanced: true }),
    { type: 'appendTypedAuto', ch: '-' }, 'pref ON: sign → appendTypedAuto');
  deepEq(keyEventToAction(fakeKey({ key: '.' }), { numericInputAdvanced: true }),
    { type: 'appendTypedAuto', ch: '.' }, 'pref ON: dot → appendTypedAuto');

  // ON does NOT change non-digit routings (X/Y/=/Backspace stay normal)
  deepEq(keyEventToAction(fakeKey({ key: 'x', code: 'KeyX' }), { numericInputAdvanced: true }),
    { type: 'toggleAxis', axis: 'x' }, 'pref ON: X still toggles axis');
  deepEq(keyEventToAction(fakeKey({ key: '=' }), { numericInputAdvanced: true }),
    { type: 'enterNumericMode' }, 'pref ON: = still enters numericMode (idempotent with auto)');
  deepEq(keyEventToAction(fakeKey({ key: 'Backspace' }), { numericInputAdvanced: true }),
    { type: 'popTyped' }, 'pref ON: Backspace still pops');
  eq(keyEventToAction(fakeKey({ key: 'a' }), { numericInputAdvanced: true }),
    null, 'pref ON: non-handled key still null');
}

// ── End-to-end: simulate a typed "12.5" then commit ──────────────────
{
  let state = INITIAL_STATE;
  const sequence = ['1', '2', '.', '5'];
  for (const ch of sequence) {
    const action = keyEventToAction(fakeKey({ key: ch }));
    if (action) state = transformInputReducer(state, action);
  }
  eq(state.typedBuffer, '12.5', 'E2E: keystroke sequence builds "12.5"');
  eq(parseTyped(state.typedBuffer), 12.5, 'E2E: parseTyped(buffer) = 12.5');

  // Press = → enter numeric mode
  const aEq = keyEventToAction(fakeKey({ key: '=' }));
  state = transformInputReducer(state, aEq);
  eq(state.numericMode, true, 'E2E: = enters numeric mode (buffer preserved)');
  eq(state.typedBuffer, '12.5', 'E2E: numericMode does not clear buffer');

  // Press X → axis lock x
  const aX = keyEventToAction(fakeKey({ key: 'x', code: 'KeyX' }));
  state = transformInputReducer(state, aX);
  eq(state.axis, 'x', 'E2E: X locks axis');

  // Press Enter → commit (no state change)
  const aEnter = keyEventToAction(fakeKey({ key: 'Enter' }));
  eq(aEnter.type, 'commit', 'E2E: Enter → commit action');
  const sAfter = transformInputReducer(state, aEnter);
  eq(sAfter, state, "E2E: 'commit' action does not mutate input state");
}

console.log(`\ntransformInputReducer: ${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);
