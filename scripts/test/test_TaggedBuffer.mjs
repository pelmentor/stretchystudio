// v3 Phase 0C - tests for src/io/live2d/runtime/coords/TaggedBuffer.js
//
// TaggedBuffer is the explicit-frame wrapper around chain-eval vertex
// buffers. Phase 0C foundation; Phase 1C debugger overlay reads these
// tags to colour-tint each mesh by frame.
//
// Run: node scripts/test/test_TaggedBuffer.mjs

import {
  taggedBuffer,
  assertFrame,
  isTaggedBuffer,
} from '../../src/io/live2d/runtime/coords/TaggedBuffer.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// ── Construction: canvas-px ────────────────────────────────────────

{
  const verts = new Float32Array([0, 0, 100, 100]);
  const buf = taggedBuffer(verts, 'canvas-px');
  assert(buf.verts === verts, 'canvas-px: verts wired (no copy)');
  assert(buf.frame === 'canvas-px', 'canvas-px: frame tag set');
  assert(buf.ctx === null, 'canvas-px: ctx defaults null');
  assert(Object.isFrozen(buf), 'canvas-px: result is frozen');
}

{
  // Explicit null ctx is allowed
  const buf = taggedBuffer(new Float32Array([1, 2]), 'canvas-px', null);
  assert(buf.frame === 'canvas-px', 'canvas-px: explicit null ctx accepted');
}

assertThrows(
  () => taggedBuffer(new Float32Array([1, 2]), 'canvas-px', { something: 1 }),
  'canvas-px: rejects non-null ctx',
);

// ── Construction: normalized-0to1 ──────────────────────────────────

{
  const verts = new Float32Array([0.5, 0.5]);
  const ctx = { gridBox: { minX: 10, minY: 20, W: 100, H: 60 } };
  const buf = taggedBuffer(verts, 'normalized-0to1', ctx);
  assert(buf.frame === 'normalized-0to1', 'normalized-0to1: frame tag set');
  assert(buf.ctx === ctx, 'normalized-0to1: ctx wired');
}

assertThrows(
  () => taggedBuffer(new Float32Array([0.5]), 'normalized-0to1'),
  'normalized-0to1: rejects null ctx',
);

assertThrows(
  () => taggedBuffer(new Float32Array([0.5]), 'normalized-0to1', { gridBox: null }),
  'normalized-0to1: rejects falsy gridBox',
);

assertThrows(
  () => taggedBuffer(new Float32Array([0.5]), 'normalized-0to1', { gridBox: { minX: 'a', minY: 0, W: 1, H: 1 } }),
  'normalized-0to1: rejects non-numeric minX',
);

assertThrows(
  () => taggedBuffer(new Float32Array([0.5]), 'normalized-0to1', { gridBox: { minX: 0, minY: 0, W: 1 } }),
  'normalized-0to1: rejects partial gridBox (missing H)',
);

// ── Construction: pivot-relative ───────────────────────────────────

{
  const verts = new Float32Array([10, 20]);
  const ctx = { pivotX: 100, pivotY: 200, angleDeg: 30 };
  const buf = taggedBuffer(verts, 'pivot-relative', ctx);
  assert(buf.frame === 'pivot-relative', 'pivot-relative: frame tag set');
  assert(buf.ctx === ctx, 'pivot-relative: ctx wired');
}

assertThrows(
  () => taggedBuffer(new Float32Array([1]), 'pivot-relative'),
  'pivot-relative: rejects null ctx',
);

assertThrows(
  () => taggedBuffer(new Float32Array([1]), 'pivot-relative', { pivotX: 1, pivotY: 2 }),
  'pivot-relative: rejects ctx missing angleDeg',
);

assertThrows(
  () => taggedBuffer(new Float32Array([1]), 'pivot-relative', { pivotX: 'a', pivotY: 2, angleDeg: 0 }),
  'pivot-relative: rejects non-numeric pivotX',
);

// ── Construction: type guards ──────────────────────────────────────

assertThrows(
  () => taggedBuffer([0, 0, 1, 1], 'canvas-px'),
  'rejects plain array (must be Float32Array)',
);

assertThrows(
  () => taggedBuffer(new Float64Array([0, 0]), 'canvas-px'),
  'rejects Float64Array (must be Float32Array)',
);

assertThrows(
  () => taggedBuffer(new Float32Array([0]), 'unknown-frame'),
  'rejects unknown frame string',
);

// ── Frozen → cannot mutate ─────────────────────────────────────────

{
  const buf = taggedBuffer(new Float32Array([1, 2]), 'canvas-px');
  let threw = false;
  try {
    /** @type {any} */ (buf).frame = 'pivot-relative';
  } catch { threw = true; }
  // In strict mode the assignment throws. In sloppy mode it's a silent no-op.
  // Either way the value must be unchanged.
  assert(buf.frame === 'canvas-px', 'frozen: frame mutation does not stick');
  // Allow either behavior, just confirm no observable change.
  void threw;
}

// ── assertFrame ────────────────────────────────────────────────────

{
  const buf = taggedBuffer(new Float32Array([0]), 'canvas-px');
  assertFrame(buf, 'canvas-px'); // no throw
  passed++; // counted manually since assertFrame returns void on success
}

assertThrows(
  () => assertFrame(taggedBuffer(new Float32Array([0]), 'canvas-px'), 'pivot-relative'),
  'assertFrame: throws on frame mismatch',
);

assertThrows(
  () => assertFrame(null, 'canvas-px'),
  'assertFrame: throws on null buffer',
);

{
  // Error message includes 'where' label
  let msg = '';
  try {
    assertFrame(taggedBuffer(new Float32Array([0]), 'canvas-px'), 'pivot-relative', 'chainEval:warpStep');
  } catch (e) {
    msg = e.message;
  }
  assert(msg.includes('chainEval:warpStep'), 'assertFrame: error message includes where label');
  assert(msg.includes("'canvas-px'") && msg.includes("'pivot-relative'"),
    'assertFrame: error message includes both expected and got frames');
}

// ── isTaggedBuffer ─────────────────────────────────────────────────

{
  assert(isTaggedBuffer(taggedBuffer(new Float32Array([0]), 'canvas-px')) === true,
    'isTaggedBuffer: true on real wrapper');
  assert(isTaggedBuffer(null) === false, 'isTaggedBuffer: false on null');
  assert(isTaggedBuffer(undefined) === false, 'isTaggedBuffer: false on undefined');
  assert(isTaggedBuffer({}) === false, 'isTaggedBuffer: false on plain {}');
  assert(isTaggedBuffer({ verts: [], frame: 'canvas-px' }) === false,
    'isTaggedBuffer: false on plain array verts');
  assert(isTaggedBuffer({ verts: new Float32Array([0]) }) === false,
    'isTaggedBuffer: false on missing frame');
  assert(isTaggedBuffer({ verts: new Float32Array([0]), frame: 42 }) === false,
    'isTaggedBuffer: false on non-string frame');
  // Untagged plain object with both fields - shape match returns true.
  // This is intentional: assertFrame catches misuse, isTaggedBuffer
  // is just a cheap probe.
  assert(isTaggedBuffer({ verts: new Float32Array([0]), frame: 'canvas-px' }) === true,
    'isTaggedBuffer: true on duck-typed shape');
}

// ── Output ─────────────────────────────────────────────────────────

console.log(`TaggedBuffer: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
