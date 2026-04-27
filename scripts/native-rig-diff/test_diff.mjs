// Tests for diff.mjs. Run: node scripts/native-rig-diff/test_diff.mjs

import { diffText, diffJson } from './diff.mjs';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- diffText ----

{
  // Two exports differing only by random UUIDs and timestamps → equal after canonicalization.
  const a = `<x id="aaaaaaaa-1111-2222-3333-444444444444" t="2026-04-27T14:32:11.000Z"/>`;
  const b = `<x id="bbbbbbbb-5555-6666-7777-888888888888" t="2026-04-28T09:15:42.500Z"/>`;
  const res = diffText(a, b);
  assert(res.equal, 'two structurally-equal exports diff equal after canonicalization');
}

{
  // Genuine difference (different attribute value) → not equal, points at line.
  const a = `<x id="aaaaaaaa-1111-2222-3333-444444444444" name="head"/>`;
  const b = `<x id="bbbbbbbb-5555-6666-7777-888888888888" name="torso"/>`;
  const res = diffText(a, b);
  assert(!res.equal, 'genuine diff detected');
  assert(res.firstDiff && res.firstDiff.lineNo === 1, 'firstDiff line correct');
  assert(
    res.firstDiff.aLine.includes('name="head"') && res.firstDiff.bLine.includes('name="torso"'),
    'firstDiff lines contain the divergence'
  );
}

{
  // Multi-line input with diff on line 2.
  const a = `<root>\n  <child>1</child>\n</root>`;
  const b = `<root>\n  <child>2</child>\n</root>`;
  const res = diffText(a, b);
  assert(!res.equal, 'multi-line diff detected');
  assertEq(res.firstDiff.lineNo, 2, 'firstDiff line 2');
}

// ---- diffJson ----

{
  // JSON with structurally-equal UUIDs → equal.
  const a = { partGuid: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'x' };
  const b = { partGuid: 'bbbbbbbb-5555-6666-7777-888888888888', name: 'x' };
  const res = diffJson(a, b);
  assert(res.equal, 'JSON structurally-equal across uuid draws');
}

{
  // JSON with genuine value difference.
  const a = { Curves: [{ Id: 'ParamAngleX', Target: 'Parameter' }] };
  const b = { Curves: [{ Id: 'ParamAngleY', Target: 'Parameter' }] };
  const res = diffJson(a, b);
  assert(!res.equal, 'JSON value diff detected');
  assertEq(res.firstDiff.path, '$.Curves[0].Id', 'JSON diff path correct');
  assertEq(res.firstDiff.aValue, 'ParamAngleX', 'JSON diff aValue');
  assertEq(res.firstDiff.bValue, 'ParamAngleY', 'JSON diff bValue');
}

{
  // Array length difference.
  const a = { items: [1, 2, 3] };
  const b = { items: [1, 2, 3, 4] };
  const res = diffJson(a, b);
  assert(!res.equal, 'JSON array length diff detected');
  assertEq(res.firstDiff.path, '$.items.length', 'array length diff path');
}

{
  // Missing key.
  const a = { a: 1, b: 2 };
  const b = { a: 1 };
  const res = diffJson(a, b);
  assert(!res.equal, 'JSON missing key detected');
}

{
  // Type mismatch.
  const a = { v: 'foo' };
  const b = { v: 42 };
  const res = diffJson(a, b);
  assert(!res.equal, 'JSON type mismatch detected');
  assertEq(res.firstDiff.path, '$.v', 'type mismatch path');
}

// ---- Summary ----

console.log(`diff: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
