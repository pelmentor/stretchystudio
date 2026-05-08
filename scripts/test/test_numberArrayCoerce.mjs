// Tests for src/lib/numberArrayCoerce.js — closes BUG-NECK_NULL_BBOX
// (silent Array.isArray fallback dropping Float64Array inputs).
//
// Run: node scripts/test/test_numberArrayCoerce.mjs

import {
  coerceNumberArray,
  coerceFloat64Array,
  coerceFloat32Array,
  coerceUint16Array,
  coerceUint8Array,
  coerceInt32Array,
} from '../../src/lib/numberArrayCoerce.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(a, b, name) {
  const eq = Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    : a instanceof Float64Array && b instanceof Float64Array
      ? a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
      : Object.is(a, b);
  if (eq) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
}

function assertThrows(fn, expectedMsgFragment, name) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${name} — expected throw, got nothing`);
  } catch (err) {
    if (typeof expectedMsgFragment === 'string'
        && !String(err.message).includes(expectedMsgFragment)) {
      failed++;
      console.error(
        `FAIL: ${name} — error message missing "${expectedMsgFragment}"\n  got: ${err.message}`,
      );
      return;
    }
    passed++;
  }
}

// ── coerceNumberArray ────────────────────────────────────────────────

// Optional defaults
assertEq(coerceNumberArray(undefined, 'foo'), [], 'undefined → []');
assertEq(coerceNumberArray(null, 'foo'), [], 'null → []');

// Plain array — copy, not alias
{
  const src = [1, 2, 3];
  const out = coerceNumberArray(src, 'foo');
  assertEq(out, [1, 2, 3], 'plain Array preserved');
  assert(out !== src, 'plain Array copied (not aliased)');
}

// Empty array stays empty
assertEq(coerceNumberArray([], 'foo'), [], 'empty Array → []');

// Float64Array — THE bug-class case
{
  const src = new Float64Array([1.5, 2.5, 3.5]);
  const out = coerceNumberArray(src, 'foo');
  assertEq(out, [1.5, 2.5, 3.5], 'Float64Array coerced (BUG-NECK_NULL_BBOX)');
  assert(Array.isArray(out), 'Float64Array → plain Array');
}

// Float32Array — sibling typed-array
{
  const src = new Float32Array([1, 2]);
  const out = coerceNumberArray(src, 'foo');
  assert(Array.isArray(out) && out.length === 2, 'Float32Array coerced');
}

// Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array
for (const TA of [Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array]) {
  const src = new TA([1, 2, 3]);
  const out = coerceNumberArray(src, `${TA.name}.field`);
  assertEq(out, [1, 2, 3], `${TA.name} coerced`);
}

// BigInt64Array / BigUint64Array — these contain BigInt elements; coerce to plain Array (the bigints survive)
for (const TA of [BigInt64Array, BigUint64Array]) {
  const src = new TA([1n, 2n]);
  const out = coerceNumberArray(src, `${TA.name}.field`);
  assert(Array.isArray(out) && out.length === 2, `${TA.name} coerced (BigInt elements survive)`);
}

// DataView — NOT a number array; must throw
{
  const buf = new ArrayBuffer(8);
  assertThrows(
    () => coerceNumberArray(new DataView(buf), 'frob'),
    'frob',
    'DataView throws',
  );
}

// Garbage inputs throw
assertThrows(() => coerceNumberArray('not an array', 'foo'), 'foo', 'string throws');
assertThrows(() => coerceNumberArray(42, 'foo'), 'foo', 'number throws');
assertThrows(() => coerceNumberArray({}, 'foo'), 'foo', 'object throws');
assertThrows(() => coerceNumberArray({ length: 3 }, 'foo'), 'foo',
  'object with length prop throws (no array-like blanket pass)');
assertThrows(() => coerceNumberArray(true, 'foo'), 'foo', 'boolean throws');

// Required mode — null/undefined throw
assertThrows(
  () => coerceNumberArray(undefined, 'kf.positions', { optional: false }),
  'kf.positions',
  'undefined + {optional:false} throws',
);
assertThrows(
  () => coerceNumberArray(null, 'kf.positions', { optional: false }),
  'kf.positions',
  'null + {optional:false} throws',
);

// Required mode — valid input still passes through
assertEq(
  coerceNumberArray([1, 2], 'kf.positions', { optional: false }),
  [1, 2],
  'required mode + valid Array passes',
);
assertEq(
  coerceNumberArray(new Float64Array([7, 8]), 'kf.positions', { optional: false }),
  [7, 8],
  'required mode + Float64Array coerces',
);

// Error message includes fieldPath
{
  let msg = '';
  try { coerceNumberArray('bad', 'deformer.keyforms[5].positions'); }
  catch (e) { msg = e.message; }
  assert(
    msg.includes('deformer.keyforms[5].positions'),
    'error message includes nested fieldPath',
  );
  assert(msg.includes('string'), 'error message includes input typeName');
}

// ── coerceFloat64Array ───────────────────────────────────────────────

// Optional defaults
{
  const out = coerceFloat64Array(undefined, 'foo');
  assert(out instanceof Float64Array && out.length === 0, 'undefined → Float64Array(0)');
}
{
  const out = coerceFloat64Array(null, 'foo');
  assert(out instanceof Float64Array && out.length === 0, 'null → Float64Array(0)');
}

// Float64Array — same reference (no copy)
{
  const src = new Float64Array([1, 2, 3]);
  const out = coerceFloat64Array(src, 'foo');
  assert(out === src, 'Float64Array fast-path: same reference');
}

// Plain Array
{
  const out = coerceFloat64Array([1.5, 2.5], 'foo');
  assert(out instanceof Float64Array, 'Array → Float64Array');
  assert(out.length === 2 && out[0] === 1.5 && out[1] === 2.5, 'Array values copied');
}

// Float32Array → Float64Array (copy)
{
  const src = new Float32Array([1, 2]);
  const out = coerceFloat64Array(src, 'foo');
  assert(out instanceof Float64Array, 'Float32Array → Float64Array');
  assert(out !== src, 'Float32Array → fresh Float64Array (copy)');
  assert(out[0] === 1 && out[1] === 2, 'Float32Array values copied');
}

// Int32Array → Float64Array
{
  const src = new Int32Array([1, 2, 3]);
  const out = coerceFloat64Array(src, 'foo');
  assert(out instanceof Float64Array && out.length === 3, 'Int32Array → Float64Array');
}

// DataView throws
{
  const buf = new ArrayBuffer(8);
  assertThrows(
    () => coerceFloat64Array(new DataView(buf), 'foo'),
    'foo',
    'DataView throws (Float64Array variant)',
  );
}

// Garbage throws
assertThrows(() => coerceFloat64Array('bad', 'foo'), 'foo',
  'Float64Array variant: string throws');
assertThrows(() => coerceFloat64Array({}, 'foo'), 'foo',
  'Float64Array variant: object throws');

// Required mode
assertThrows(
  () => coerceFloat64Array(undefined, 'foo', { optional: false }),
  'foo',
  'Float64Array required mode: undefined throws',
);

// ── Sibling typed-array coercers ─────────────────────────────────────

// coerceFloat32Array — basic shape
{
  const out = coerceFloat32Array([1, 2, 3], 'foo');
  assert(out instanceof Float32Array && out.length === 3, 'Float32Array variant: Array → Float32Array');
}
{
  const src = new Float32Array([1, 2]);
  const out = coerceFloat32Array(src, 'foo');
  assert(out === src, 'Float32Array variant: same-type fast path');
}
{
  const out = coerceFloat32Array(new Float64Array([1, 2]), 'foo');
  assert(out instanceof Float32Array && out !== undefined, 'Float32Array variant: Float64Array → Float32Array');
}
{
  const out = coerceFloat32Array(undefined, 'foo');
  assert(out instanceof Float32Array && out.length === 0, 'Float32Array variant: undefined → Float32Array(0)');
}
assertThrows(() => coerceFloat32Array('bad', 'foo'), 'foo', 'Float32Array variant: string throws');

// coerceUint16Array — used for triangle indices
{
  const out = coerceUint16Array([0, 1, 2], 'foo');
  assert(out instanceof Uint16Array && out.length === 3, 'Uint16Array variant: Array → Uint16Array');
}
{
  const src = new Uint16Array([10, 20]);
  const out = coerceUint16Array(src, 'foo');
  assert(out === src, 'Uint16Array variant: same-type fast path');
}
{
  const out = coerceUint16Array(undefined, 'foo');
  assert(out instanceof Uint16Array && out.length === 0, 'Uint16Array variant: undefined → Uint16Array(0)');
}
assertThrows(() => coerceUint16Array({}, 'foo'), 'foo', 'Uint16Array variant: object throws');

// coerceUint8Array
{
  const out = coerceUint8Array([0, 255], 'foo');
  assert(out instanceof Uint8Array && out[0] === 0 && out[1] === 255, 'Uint8Array variant');
}

// coerceInt32Array
{
  const out = coerceInt32Array([-1, 0, 1], 'foo');
  assert(out instanceof Int32Array && out[0] === -1, 'Int32Array variant');
}

// All variants reject DataView
{
  const buf = new ArrayBuffer(8);
  for (const fn of [coerceFloat32Array, coerceUint16Array, coerceUint8Array, coerceInt32Array]) {
    assertThrows(() => fn(new DataView(buf), 'foo'), 'foo', `${fn.name || 'variant'}: DataView throws`);
  }
}

console.log(`numberArrayCoerce: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
