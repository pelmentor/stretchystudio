// Animation Phase 5 Slice 5.W audit-fix — tests for
// src/anim/fcurvePicker.js (`pickActiveFCurve`).
//
// Extracted from FCurveEditor.jsx's local `pickFCurve` to gate
// DopesheetEditor's active-keyform halo on the same fcurve. SS's
// stand-in for Blender's `FCURVE_ACTIVE` per-channel flag until path #11.
//
// Coverage:
//   - null / empty / non-array guards
//   - parameter selection → matching fcurve
//   - part/group selection → matching fcurve (decodeFCurveTarget kind='node')
//   - newest-first walk (last item in selection wins)
//   - no-match → null
//   - selection with non-string id ignored
//
// Run: node scripts/test/test_fcurvePicker.mjs

import { pickActiveFCurve } from '../../src/anim/fcurvePicker.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function paramFc(id, paramId) {
  return { id, rnaPath: `objects["__params__"].values["${paramId}"]`, keyforms: [] };
}
function nodeFc(id, nodeId, property) {
  return { id, rnaPath: `objects["${nodeId}"].${property}`, keyforms: [] };
}

// ── null guards ─────────────────────────────────────────────────────
{
  eq(pickActiveFCurve(null, []), null, 'null action → null');
  eq(pickActiveFCurve(undefined, []), null, 'undefined action → null');
  eq(pickActiveFCurve({}, []), null, 'action without fcurves → null');
  eq(pickActiveFCurve({ fcurves: 'not-array' }, []), null, 'non-array fcurves → null');
  eq(pickActiveFCurve({ fcurves: [paramFc('a', 'p')] }, null), null, 'null selection → null');
  eq(pickActiveFCurve({ fcurves: [paramFc('a', 'p')] }, []), null, 'empty selection → null');
}

// ── parameter match ────────────────────────────────────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA'), paramFc('fcB', 'pB')] };
  const sel = [{ type: 'parameter', id: 'pB' }];
  eq(pickActiveFCurve(action, sel)?.id, 'fcB', 'parameter selection → matching fcurve');
}

// ── node match (part) ──────────────────────────────────────────────
{
  const action = { fcurves: [nodeFc('fc1', 'n1', 'x'), nodeFc('fc2', 'n2', 'y')] };
  const sel = [{ type: 'part', id: 'n2' }];
  eq(pickActiveFCurve(action, sel)?.id, 'fc2', 'part selection → matching node fcurve');
}

// ── node match (group treated as node) ─────────────────────────────
{
  const action = { fcurves: [nodeFc('fc1', 'n1', 'x')] };
  const sel = [{ type: 'group', id: 'n1' }];
  eq(pickActiveFCurve(action, sel)?.id, 'fc1', 'group selection → matches node fcurve');
}

// ── newest-first walk ──────────────────────────────────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA'), paramFc('fcB', 'pB')] };
  const sel = [
    { type: 'parameter', id: 'pA' },
    { type: 'parameter', id: 'pB' }, // last entry wins
  ];
  eq(pickActiveFCurve(action, sel)?.id, 'fcB', 'newest selection entry wins');
}

// ── no-match → null ────────────────────────────────────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA')] };
  const sel = [{ type: 'parameter', id: 'doesNotExist' }];
  eq(pickActiveFCurve(action, sel), null, 'no fcurve matches selection → null');
}

// ── unknown selection type skipped ─────────────────────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA')] };
  const sel = [{ type: 'mesh', id: 'pA' }];
  eq(pickActiveFCurve(action, sel), null, 'unknown selection type → null');
}

// ── selection entry with non-string id skipped ─────────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA')] };
  const sel = [{ type: 'parameter', id: null }];
  eq(pickActiveFCurve(action, sel), null, 'non-string id → entry skipped → null');
}

// ── newest valid entry beats older invalid entry ───────────────────
{
  const action = { fcurves: [paramFc('fcA', 'pA')] };
  const sel = [
    { type: 'parameter', id: 'pA' },
    { type: 'parameter', id: null }, // newer but invalid → falls through
  ];
  eq(pickActiveFCurve(action, sel)?.id, 'fcA', 'newer-invalid entry skipped → older entry matches');
}

// ── final report ────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} fcurve-picker assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
