// Animation Phase 5 Slice 5.W — tests for
// src/v3/editors/dopesheet/dopesheetRows.js (DopesheetEditor row builder).
//
// Coverage:
//   - empty / null guards (no action, no fcurves, empty fcurves)
//   - param + node target decoding produces correctly-shaped rows
//   - row sorting: params first (alphabetical), then nodes (alphabetical)
//   - undecodeable rnaPath fcurves are skipped
//   - keyforms are sorted by time
//   - per-fcurve mute → isMuted=true; mute=false sparse missing → isMuted=false
//   - group-level mute → isMuted=true via cascade (Slice 5.V parity)
//   - per-fcurve hide → row filtered out
//   - group-level hide → row filtered out via cascade
//   - activeKeyformIndex: missing → -1; in-bounds → that index; OOB → -1
//   - param name + node name lookups (fallback to id when missing)
//
// Run: node scripts/test/test_dopesheetRows.mjs

import { buildDopesheetRows } from '../../src/v3/editors/dopesheet/dopesheetRows.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function deepEq(a, b, name) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A === B) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${A}\n   expected: ${B}`);
}

function paramFc(paramId, keyforms = [], extras = {}) {
  return {
    id: `fc_param_${paramId}`,
    rnaPath: `objects["__params__"].values["${paramId}"]`,
    keyforms,
    ...extras,
  };
}

function nodeFc(nodeId, property, keyforms = [], extras = {}) {
  return {
    id: `fc_${nodeId}_${property}`,
    rnaPath: `objects["${nodeId}"].${property}`,
    keyforms,
    ...extras,
  };
}

function makeAction(fcurves = [], groups = []) {
  return { id: 'act1', fcurves, groups };
}

function makeProject(opts = {}) {
  return {
    nodes: opts.nodes ?? [],
    parameters: opts.parameters ?? [],
  };
}

// ── null + empty guards ─────────────────────────────────────────────
{
  deepEq(buildDopesheetRows(null, null), [], 'null action + null project → []');
  deepEq(buildDopesheetRows(undefined, makeProject()), [], 'undefined action → []');
  deepEq(buildDopesheetRows({}, makeProject()), [], 'action without fcurves → []');
  deepEq(buildDopesheetRows({ fcurves: 'nope' }, makeProject()), [], 'non-array fcurves → []');
  deepEq(buildDopesheetRows({ fcurves: [] }, makeProject()), [], 'empty fcurves → []');
}

// ── decode + sort + name lookup ─────────────────────────────────────
{
  const action = makeAction([
    nodeFc('nodeZ', 'x', [{ time: 0, value: 0 }]),
    paramFc('paramB', [{ time: 100, value: 1 }]),
    nodeFc('nodeA', 'rotation', [{ time: 50, value: 0.5 }]),
    paramFc('paramA', [{ time: 0, value: 0 }]),
  ]);
  const project = makeProject({
    nodes: [
      { id: 'nodeA', name: 'Alice' },
      { id: 'nodeZ', name: 'Zelda' },
    ],
    parameters: [
      { id: 'paramA', name: 'ParamA' },
      { id: 'paramB', name: 'ParamB' },
    ],
  });
  const rows = buildDopesheetRows(action, project);
  eq(rows.length, 4, 'all 4 fcurves produce rows');
  eq(rows[0].key, 'param:paramA', 'param rows come first (alphabetical)');
  eq(rows[1].key, 'param:paramB', 'second param row');
  eq(rows[0].label, 'ParamA', 'param row uses parameter name');
  eq(rows[1].label, 'ParamB', 'second param uses parameter name');
  eq(rows[2].label, 'Alice · rotation', 'node row uses Node name + property');
  eq(rows[3].label, 'Zelda · x', 'node rows alphabetical by label');
  eq(rows[2].kindColor, 'bg-cyan-500', 'node row gets cyan dot');
  eq(rows[0].kindColor, 'bg-purple-500', 'param row gets purple dot');
}

// ── name fallbacks ──────────────────────────────────────────────────
{
  const action = makeAction([
    paramFc('orphanParam', [{ time: 0, value: 0 }]),
    nodeFc('orphanNode', 'opacity', [{ time: 0, value: 1 }]),
  ]);
  const project = makeProject();
  const rows = buildDopesheetRows(action, project);
  eq(rows[0].label, 'orphanParam', 'missing param name falls back to id');
  eq(rows[1].label, 'orphanNode · opacity', 'missing node name falls back to id');
}

// ── undecodeable rnaPath skipped ────────────────────────────────────
{
  const action = makeAction([
    { id: 'bad1', rnaPath: 'not a valid rna path', keyforms: [] },
    { id: 'bad2', rnaPath: null, keyforms: [] },
    paramFc('valid', [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 1, 'only the decodeable fcurve produces a row');
  eq(rows[0].key, 'param:valid', 'valid row survives');
}

// ── keyforms sorted by time ─────────────────────────────────────────
{
  const action = makeAction([
    paramFc('p', [
      { time: 200, value: 2 },
      { time: 100, value: 1 },
      { time: 0,   value: 0 },
      { time: 50,  value: 0.5 },
    ]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  deepEq(
    rows[0].keyforms.map((k) => k.time),
    [0, 50, 100, 200],
    'keyforms sorted ascending by time',
  );
  // Values follow times
  deepEq(
    rows[0].keyforms.map((k) => k.value),
    [0, 0.5, 1, 2],
    'keyform values track the sort',
  );
}

// ── isMuted: per-fcurve ─────────────────────────────────────────────
{
  const action = makeAction([
    paramFc('mutedP', [{ time: 0, value: 0 }], { mute: true }),
    paramFc('liveP',  [{ time: 0, value: 0 }]),
    paramFc('falseP', [{ time: 0, value: 0 }], { mute: false }),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  const byKey = new Map(rows.map((r) => [r.key, r]));
  eq(byKey.get('param:mutedP').isMuted, true, 'per-fcurve mute=true → isMuted=true');
  eq(byKey.get('param:liveP').isMuted, false, 'missing mute field → isMuted=false');
  eq(byKey.get('param:falseP').isMuted, false, 'mute=false → isMuted=false');
}

// ── isMuted: group cascade (Slice 5.V parity) ───────────────────────
{
  const groups = [
    { id: 'gMute', name: 'GroupMuted', mute: true },
    { id: 'gLive', name: 'GroupLive' },
  ];
  const action = makeAction([
    nodeFc('n1', 'x', [{ time: 0, value: 0 }], { groupId: 'gMute' }),
    nodeFc('n1', 'y', [{ time: 0, value: 0 }], { groupId: 'gLive' }),
    nodeFc('n1', 'z', [{ time: 0, value: 0 }]),
  ], groups);
  const project = makeProject({ nodes: [{ id: 'n1', name: 'N1' }] });
  const rows = buildDopesheetRows(action, project);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  eq(byKey.get('node:n1:x').isMuted, true, 'group-cascade mute via gMute');
  eq(byKey.get('node:n1:y').isMuted, false, 'gLive (no mute) leaves child unmuted');
  eq(byKey.get('node:n1:z').isMuted, false, 'ungrouped fcurve stays unmuted');
}

// ── hide filter: per-fcurve ─────────────────────────────────────────
{
  const action = makeAction([
    paramFc('hiddenP', [{ time: 0, value: 0 }], { hide: true }),
    paramFc('shownP',  [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 1, 'hidden row filtered out');
  eq(rows[0].key, 'param:shownP', 'only the shown row survives');
}

// ── hide filter: group cascade (Slice 5.V parity) ───────────────────
{
  const groups = [
    { id: 'gHide', name: 'GroupHidden', hide: true },
    { id: 'gShow', name: 'GroupShown' },
  ];
  const action = makeAction([
    nodeFc('n1', 'x', [{ time: 0, value: 0 }], { groupId: 'gHide' }),
    nodeFc('n1', 'y', [{ time: 0, value: 0 }], { groupId: 'gShow' }),
  ], groups);
  const project = makeProject({ nodes: [{ id: 'n1', name: 'N1' }] });
  const rows = buildDopesheetRows(action, project);
  eq(rows.length, 1, 'group-hidden child filtered out');
  eq(rows[0].key, 'node:n1:y', 'shown child survives');
}

// ── activeKfIdx ─────────────────────────────────────────────────────
{
  const action = makeAction([
    paramFc('noActive', [{ time: 0, value: 0 }, { time: 100, value: 1 }]),
    paramFc('hasActive', [{ time: 0, value: 0 }, { time: 100, value: 1 }], { activeKeyformIndex: 1 }),
    paramFc('oobActive', [{ time: 0, value: 0 }], { activeKeyformIndex: 5 }),
    paramFc('negActive', [{ time: 0, value: 0 }], { activeKeyformIndex: -1 }),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  const byKey = new Map(rows.map((r) => [r.key, r]));
  eq(byKey.get('param:noActive').activeKfIdx, -1, 'missing activeKeyformIndex → -1');
  eq(byKey.get('param:hasActive').activeKfIdx, 1, 'in-bounds activeKeyformIndex preserved');
  eq(byKey.get('param:oobActive').activeKfIdx, -1, 'out-of-bounds activeKeyformIndex → -1');
  eq(byKey.get('param:negActive').activeKfIdx, -1, 'negative sentinel → -1');
}

// ── activeKfIdx tracks sort order ───────────────────────────────────
//
// `getActiveKeyformIndex` is read directly from `fcurve.activeKeyformIndex`
// against `fcurve.keyforms` (Blender semantics: index is into the BezTriple
// array, which is itself time-sorted at write time). Our row builder
// independently sorts the row's keyform list by time. If the upstream
// fcurve's keyforms aren't already sorted, the active index points to a
// DIFFERENT row in the sorted view. This is a known Blender-parity issue
// the renderer should be aware of — Blender keeps fcurve.bezt sorted at
// write time, so the indices line up. SS's row builder doesn't enforce
// fcurve.keyforms sort. Document the behaviour by pinning it: when the
// upstream is sorted, the index lines up; when it isn't, the index may
// be wrong. The fix lives upstream (write-time sort), not here.
{
  const sorted = makeAction([
    paramFc('p', [
      { time: 0,   value: 0 },
      { time: 50,  value: 0.5 },
      { time: 100, value: 1 },
    ], { activeKeyformIndex: 1 }),
  ]);
  const rows = buildDopesheetRows(sorted, makeProject());
  eq(rows[0].activeKfIdx, 1, 'sorted upstream: index 1 → middle keyform');
  eq(rows[0].keyforms[1].time, 50, 'sort preserves the expected keyform at index 1');
}

// ── all empty + no project nodes/parameters ─────────────────────────
{
  const action = makeAction([
    paramFc('p', []),
    nodeFc('n', 'x', []),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 2, 'rows produced even with empty keyforms');
  deepEq(rows[0].keyforms, [], 'empty keyforms preserved');
  deepEq(rows[1].keyforms, [], 'second row also empty');
}

// ── tooltip strings ─────────────────────────────────────────────────
{
  const action = makeAction([
    paramFc('p1'),
    nodeFc('n1', 'rotation'),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows[0].tooltip, 'Parameter p1', 'param tooltip format');
  eq(rows[1].tooltip, 'Node n1 · rotation', 'node tooltip format');
}

// ── final report ────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} dopesheet-row assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
