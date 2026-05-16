// Audit 4 #1 (2026-05-16) — Footer / status-bar formatter integrity.
//
// Verifies the pure formatters backing `Footer.jsx`:
//
//   1. `modeLabel(editMode, dataKind)` — every (editMode × dataKind)
//      combination the SS shell can present returns a non-empty,
//      human-readable string (no falsy slips, no "undefined").
//   2. `formatInputStatus(...)` dispatch priority: vertex modal beats
//      node modal beats mode label; axis lock formats correctly;
//      numeric-mode + typed-buffer override the live delta.
//   3. `formatStats(...)` plurals + per-mode embellishments (vert count
//      only in Edit Mode).
//   4. `countReports(entries)` tallies warn + error, skips debug/info,
//      survives null/empty input.
//
// Run: node scripts/test/test_footerStatus.mjs

import {
  modeLabel,
  formatInputStatus,
  formatStats,
  countReports,
} from '../../src/v3/shell/footerStatusData.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(actual, expected, name) {
  if (actual === expected) { passed++; return; }
  failed++; failures.push(`${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ── 1. modeLabel ──────────────────────────────────────────────────────
eq(modeLabel(null, null),           'Object Mode',            'modeLabel null → Object');
eq(modeLabel(undefined, undefined), 'Object Mode',            'modeLabel undefined → Object');
eq(modeLabel('edit', 'mesh'),       'Edit Mode (Mesh)',       'modeLabel edit+mesh');
eq(modeLabel('edit', 'armature'),   'Edit Mode (Armature)',   'modeLabel edit+armature');
eq(modeLabel('edit', null),         'Edit Mode',              'modeLabel edit+null');
eq(modeLabel('edit', 'empty'),      'Edit Mode',              'modeLabel edit+empty (unknown dataKind → bare label)');
eq(modeLabel('pose', null),         'Pose Mode',              'modeLabel pose');
eq(modeLabel('weightPaint', null),  'Weight Paint',           'modeLabel weightPaint');

// ── 2. formatInputStatus ──────────────────────────────────────────────

// 2.a — no modal, fall through to mode label
eq(
  formatInputStatus({ editMode: null, dataKind: null }),
  'Object Mode',
  'inputStatus no-modal → mode label (Object)',
);
eq(
  formatInputStatus({ editMode: 'pose' }),
  'Pose Mode',
  'inputStatus no-modal → mode label (Pose)',
);

// 2.b — vertex modal beats node modal
eq(
  formatInputStatus({
    modal: { kind: 'rotate', axis: null, typedBuffer: '', numericMode: false,
             liveDelta: { dx: 0, dy: 0, dRot: 0, scale: 1 } },
    vertexModal: { kind: 'translate', axis: 'x', typedBuffer: '12.5' },
  }),
  'G — Move Vertices · [ 12.5 ]',
  'inputStatus vertexModal beats nodeModal',
);

// 2.c — vertex modal with no typed buffer + no axis → axisLabel '' + '…'
eq(
  formatInputStatus({
    vertexModal: { kind: 'translate', axis: null, typedBuffer: '' },
  }),
  'G — Move Vertices · …',
  'inputStatus vertexModal idle (no typed, no axis)',
);

// 2.d — node modal live-delta formats per kind
eq(
  formatInputStatus({
    modal: { kind: 'translate', axis: null, typedBuffer: '', numericMode: false,
             liveDelta: { dx: 12.5, dy: -8.0, dRot: 0, scale: 1 } },
  }),
  'G — Move · 12.5, -8.0 px',
  'inputStatus translate no-axis live delta',
);
eq(
  formatInputStatus({
    modal: { kind: 'translate', axis: 'x', typedBuffer: '', numericMode: false,
             liveDelta: { dx: 12.5, dy: -8.0, dRot: 0, scale: 1 } },
  }),
  'G — Move · X: 12.5 px',
  'inputStatus translate X-locked live delta',
);
eq(
  formatInputStatus({
    modal: { kind: 'translate', axis: 'y', typedBuffer: '', numericMode: false,
             liveDelta: { dx: 12.5, dy: -8.0, dRot: 0, scale: 1 } },
  }),
  'G — Move · Y: -8.0 px',
  'inputStatus translate Y-locked live delta',
);
eq(
  formatInputStatus({
    modal: { kind: 'rotate', axis: null, typedBuffer: '', numericMode: false,
             liveDelta: { dx: 0, dy: 0, dRot: Math.PI / 4, scale: 1 } },
  }),
  'R — Rotate · 45.0°',
  'inputStatus rotate live delta',
);
eq(
  formatInputStatus({
    modal: { kind: 'scale', axis: null, typedBuffer: '', numericMode: false,
             liveDelta: { dx: 0, dy: 0, dRot: 0, scale: 1.25 } },
  }),
  'S — Scale · 1.250×',
  'inputStatus scale live delta',
);
eq(
  formatInputStatus({
    modal: { kind: 'scale', axis: 'x', typedBuffer: '', numericMode: false,
             liveDelta: { dx: 0, dy: 0, dRot: 0, scale: 0.75 } },
  }),
  'S — Scale · X: 0.750×',
  'inputStatus scale X-locked live delta',
);

// 2.e — typed buffer (any kind) overrides live delta
eq(
  formatInputStatus({
    modal: { kind: 'translate', axis: 'x', typedBuffer: '12.5', numericMode: false,
             liveDelta: { dx: 99, dy: 99, dRot: 0, scale: 1 } },
  }),
  'G — Move · X: [ 12.5 ]',
  'inputStatus translate typed buffer overrides delta',
);

// 2.f — numeric mode + empty buffer holds default (0 / 0 / 1)
eq(
  formatInputStatus({
    modal: { kind: 'translate', axis: null, typedBuffer: '', numericMode: true,
             liveDelta: { dx: 99, dy: 99, dRot: 0, scale: 1 } },
  }),
  'G — Move · [ 0 ]',
  'inputStatus translate numericMode empty → [ 0 ]',
);
eq(
  formatInputStatus({
    modal: { kind: 'scale', axis: null, typedBuffer: '', numericMode: true,
             liveDelta: { dx: 0, dy: 0, dRot: 0, scale: 99 } },
  }),
  'S — Scale · [ 1 ]',
  'inputStatus scale numericMode empty → [ 1 ] (scale identity)',
);

// 2.g — empty modal kind falls through to mode label (regression
// guard — earlier dispatch could have returned 'undefined' on no-modal).
eq(
  formatInputStatus({
    modal: { kind: null, axis: null, typedBuffer: '', numericMode: false,
             liveDelta: { dx: 0, dy: 0, dRot: 0, scale: 1 } },
    vertexModal: { kind: null, axis: null, typedBuffer: '' },
    editMode: 'edit', dataKind: 'mesh',
  }),
  'Edit Mode (Mesh)',
  'inputStatus both-modals-null falls through to mode label',
);

// ── 3. formatStats ────────────────────────────────────────────────────

eq(
  formatStats({ selectionCount: 0 }),
  '0 selected',
  'stats empty selection',
);
eq(
  formatStats({ selectionCount: 1, headDataKind: 'mesh' }),
  '1 selected · Mesh',
  'stats single mesh',
);
eq(
  formatStats({ selectionCount: 1, headDataKind: 'armature' }),
  '1 selected · Armature',
  'stats single armature',
);
eq(
  formatStats({ selectionCount: 1, headDataKind: 'empty' }),
  '1 selected · Group',
  'stats single empty/group',
);
eq(
  formatStats({ selectionCount: 1, headDataKind: 'deformer' }),
  '1 selected · Deformer',
  'stats single deformer',
);
eq(
  formatStats({ selectionCount: 1, headDataKind: null }),
  '1 selected · Unknown',
  'stats single null dataKind → Unknown',
);
eq(
  formatStats({ selectionCount: 3 }),
  '3 selected',
  'stats multi selection (no dataKind suffix)',
);

// 3.a — vert count appended only in Edit Mode with non-zero vertex selection
eq(
  formatStats({ selectionCount: 1, editMode: 'edit', headDataKind: 'mesh',
                vertexSelectionCount: 1 }),
  '1 selected · Mesh · 1 vert',
  'stats edit-mesh 1 vert (singular)',
);
eq(
  formatStats({ selectionCount: 1, editMode: 'edit', headDataKind: 'mesh',
                vertexSelectionCount: 142 }),
  '1 selected · Mesh · 142 verts',
  'stats edit-mesh 142 verts (plural)',
);
eq(
  formatStats({ selectionCount: 1, editMode: 'pose', headDataKind: 'armature',
                vertexSelectionCount: 5 }),
  '1 selected · Armature',
  'stats pose mode ignores vertex count',
);
eq(
  formatStats({ selectionCount: 1, editMode: 'edit', headDataKind: 'mesh',
                vertexSelectionCount: 0 }),
  '1 selected · Mesh',
  'stats edit-mesh zero verts suppresses suffix',
);

// ── 4. countReports ───────────────────────────────────────────────────

const sample = [
  { level: 'debug', source: 'x', message: 'm' },
  { level: 'info',  source: 'x', message: 'm' },
  { level: 'warn',  source: 'x', message: 'm' },
  { level: 'warn',  source: 'x', message: 'm' },
  { level: 'error', source: 'x', message: 'm' },
];
{
  const r = countReports(sample);
  assert(r.warn  === 2, `countReports warn (got ${r.warn})`);
  assert(r.error === 1, `countReports error (got ${r.error})`);
}
{
  const r = countReports([]);
  assert(r.warn === 0 && r.error === 0, 'countReports [] → zero');
}
{
  const r = countReports(null);
  assert(r.warn === 0 && r.error === 0, 'countReports null → zero');
}
{
  const r = countReports(undefined);
  assert(r.warn === 0 && r.error === 0, 'countReports undefined → zero');
}
{
  // Unknown levels do not increment either counter.
  const r = countReports([
    { level: 'fatal', message: 'm', source: 'x' },
    { level: 'trace', message: 'm', source: 'x' },
  ]);
  assert(r.warn === 0 && r.error === 0,
         'countReports unknown levels are not counted');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
