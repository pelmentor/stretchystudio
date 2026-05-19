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

import { buildDopesheetRows, getKeyformRenderOrder } from '../../src/v3/editors/dopesheet/dopesheetRows.js';

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
  eq(rows[0].key, 'param:fc_param_paramA', 'param rows come first (alphabetical); fcurveId-based key');
  eq(rows[1].key, 'param:fc_param_paramB', 'second param row');
  eq(rows[0].fcurveId, 'fc_param_paramA', 'fcurveId carried for halo-gate match');
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
  eq(rows[0].key, 'param:fc_param_valid', 'valid row survives with fcurveId-based key');
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

// Lookup helper for the post-audit-fix fcurveId-based key format.
function byFcId(rows, id) {
  return rows.find((r) => r.fcurveId === id);
}

// ── isMuted: per-fcurve ─────────────────────────────────────────────
{
  const action = makeAction([
    paramFc('mutedP', [{ time: 0, value: 0 }], { mute: true }),
    paramFc('liveP',  [{ time: 0, value: 0 }]),
    paramFc('falseP', [{ time: 0, value: 0 }], { mute: false }),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(byFcId(rows, 'fc_param_mutedP').isMuted, true, 'per-fcurve mute=true → isMuted=true');
  eq(byFcId(rows, 'fc_param_liveP').isMuted, false, 'missing mute field → isMuted=false');
  eq(byFcId(rows, 'fc_param_falseP').isMuted, false, 'mute=false → isMuted=false');
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
  eq(byFcId(rows, 'fc_n1_x').isMuted, true, 'group-cascade mute via gMute');
  eq(byFcId(rows, 'fc_n1_y').isMuted, false, 'gLive (no mute) leaves child unmuted');
  eq(byFcId(rows, 'fc_n1_z').isMuted, false, 'ungrouped fcurve stays unmuted');
}

// ── isMuted: SOLO cascade (Slice 6.F.2 audit-fix HIGH-A) ────────────
// When anySolo → non-soloed rows greyed, soloed rows NOT greyed.
// When !anySolo → original mute+group cascade applies.
{
  // anySolo case: one fc soloed, two non-soloed siblings (including a
  // muted one) — soloed wins over mute; non-soloed are greyed.
  const action = makeAction([
    paramFc('soloP', [{ time: 0, value: 0 }], { solo: true }),
    paramFc('mutedP', [{ time: 0, value: 0 }], { mute: true }),
    paramFc('liveP',  [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(byFcId(rows, 'fc_param_soloP').isMuted,  false,
     'solo cascade: soloed fc → isMuted=false (solo wins)');
  eq(byFcId(rows, 'fc_param_mutedP').isMuted, true,
     'solo cascade: muted non-soloed → isMuted=true (greyed)');
  eq(byFcId(rows, 'fc_param_liveP').isMuted,  true,
     'solo cascade: live non-soloed → isMuted=true (greyed)');
}
{
  // Solo overrides per-curve mute on the SAME fcurve
  const action = makeAction([
    paramFc('soloMutedP', [{ time: 0, value: 0 }], { solo: true, mute: true }),
    paramFc('otherP',     [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(byFcId(rows, 'fc_param_soloMutedP').isMuted, false,
     'solo cascade: solo overrides per-curve mute on same fc');
  eq(byFcId(rows, 'fc_param_otherP').isMuted, true,
     'solo cascade: non-soloed sibling → muted');
}
{
  // Solo overrides group mute
  const groups = [{ id: 'gMute', name: 'GMute', mute: true }];
  const action = makeAction([
    nodeFc('n1', 'x', [{ time: 0, value: 0 }], { groupId: 'gMute', solo: true }),
    nodeFc('n1', 'y', [{ time: 0, value: 0 }], { groupId: 'gMute' }),
  ], groups);
  const project = makeProject({ nodes: [{ id: 'n1', name: 'N1' }] });
  const rows = buildDopesheetRows(action, project);
  eq(byFcId(rows, 'fc_n1_x').isMuted, false,
     'solo cascade: solo overrides group mute on same fc');
  eq(byFcId(rows, 'fc_n1_y').isMuted, true,
     'solo cascade: non-soloed group sibling → muted (any solo trumps unmuted-state)');
}
{
  // No solo at all → original cascade applies (regression guard)
  const action = makeAction([
    paramFc('mutedP', [{ time: 0, value: 0 }], { mute: true }),
    paramFc('liveP',  [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(byFcId(rows, 'fc_param_mutedP').isMuted, true,
     'no-solo: per-fcurve mute still works (regression guard)');
  eq(byFcId(rows, 'fc_param_liveP').isMuted, false,
     'no-solo: unmuted live fc stays unmuted');
}

// ── hide filter: per-fcurve ─────────────────────────────────────────
{
  const action = makeAction([
    paramFc('hiddenP', [{ time: 0, value: 0 }], { hide: true }),
    paramFc('shownP',  [{ time: 0, value: 0 }]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 1, 'hidden row filtered out');
  eq(rows[0].fcurveId, 'fc_param_shownP', 'only the shown row survives');
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
  eq(rows[0].fcurveId, 'fc_n1_y', 'shown child survives');
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
  eq(byFcId(rows, 'fc_param_noActive').activeKfIdx, -1, 'missing activeKeyformIndex → -1');
  eq(byFcId(rows, 'fc_param_hasActive').activeKfIdx, 1, 'in-bounds activeKeyformIndex preserved');
  eq(byFcId(rows, 'fc_param_oobActive').activeKfIdx, -1, 'out-of-bounds activeKeyformIndex → -1');
  eq(byFcId(rows, 'fc_param_negActive').activeKfIdx, -1, 'negative sentinel → -1');
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

// ── audit-fix L3: React-key collision uses fcurveId ─────────────────
{
  // Two fcurves targeting the same (nodeId, property) with DIFFERENT
  // fcurve ids should now produce two rows (audit-fix L3 — pre-fix the
  // shared key silently deduped via React).
  const action = makeAction([
    { id: 'fcA', rnaPath: 'objects["n1"].x', keyforms: [{ time: 0, value: 0 }] },
    { id: 'fcB', rnaPath: 'objects["n1"].x', keyforms: [{ time: 100, value: 1 }] },
  ]);
  const rows = buildDopesheetRows(action, makeProject({ nodes: [{ id: 'n1', name: 'N1' }] }));
  eq(rows.length, 2, 'duplicate targets but distinct ids → both rows');
  // Keys differ (fcurveId-based)
  assert(rows[0].key !== rows[1].key, 'rows have distinct React keys');
}

{
  // Two fcurves sharing the SAME id are pathological — first wins, second
  // dropped + logger warn. Smoke-test: only one row emerges.
  const action = makeAction([
    { id: 'dup', rnaPath: 'objects["__params__"].values["p"]', keyforms: [] },
    { id: 'dup', rnaPath: 'objects["__params__"].values["q"]', keyforms: [] },
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 1, 'duplicate fcurve id → second dropped');
}

// ── audit-fix M1: non-numeric / non-finite times filtered ───────────
{
  const action = makeAction([
    paramFc('p', [
      { time: 100, value: 1 },
      { time: 'bad', value: 0.5 },    // string time
      { time: NaN, value: 0.3 },      // NaN
      { time: Infinity, value: 0.4 }, // Infinity
      { value: 0.2 },                  // missing time
      { time: 0, value: 0 },           // good
    ]),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows[0].keyforms.length, 2, 'only 2 keyforms survive the finite-time filter');
  deepEq(
    rows[0].keyforms.map((k) => k.time),
    [0, 100],
    'surviving keyforms sorted by time',
  );
}

// ── audit-fix HIGH-1: muted rows survive, not filtered ──────────────
{
  // Confirms mute is a STYLE flag (isMuted), not a filter — sister to
  // hide which IS a filter. SS-original convention; documented Deviation 1.
  const action = makeAction([
    paramFc('m', [{ time: 0, value: 0 }], { mute: true }),
  ]);
  const rows = buildDopesheetRows(action, makeProject());
  eq(rows.length, 1, 'muted row still appears in output');
  eq(rows[0].isMuted, true, '...with isMuted=true so renderer can dim it');
}

// ── audit-fix M2: getKeyformRenderOrder pure function ───────────────
{
  // Identity order when no active
  deepEq(getKeyformRenderOrder(3, -1), [0, 1, 2], 'no active → identity order');
  deepEq(getKeyformRenderOrder(3, 5), [0, 1, 2], 'OOB active → identity order');
  deepEq(getKeyformRenderOrder(3, -2), [0, 1, 2], 'negative active sentinel → identity');

  // Active last when in bounds
  deepEq(getKeyformRenderOrder(3, 0), [1, 2, 0], 'active=0 → 0 moves to end');
  deepEq(getKeyformRenderOrder(3, 1), [0, 2, 1], 'active=1 → 1 moves to end');
  deepEq(getKeyformRenderOrder(3, 2), [0, 1, 2], 'active=last → already at end');
  deepEq(getKeyformRenderOrder(5, 2), [0, 1, 3, 4, 2], '5 keyforms, active=2');

  // Edge cases
  deepEq(getKeyformRenderOrder(0, -1), [], 'empty list → empty');
  deepEq(getKeyformRenderOrder(0, 0), [], 'empty list with active=0 → empty');
  deepEq(getKeyformRenderOrder(1, 0), [0], 'single keyform, active=0');
  deepEq(getKeyformRenderOrder(-1, 0), [], 'negative length → empty');
  deepEq(getKeyformRenderOrder(2.5, 0), [], 'non-integer length → empty');
  deepEq(getKeyformRenderOrder(3, 1.5), [0, 1, 2], 'non-integer active → identity');
}

// ── audit-fix M4: group lookup correctness preserved with inlined cascade ─
// (Already covered by the per-fcurve mute + group-cascade mute + hide blocks
// above; the M4 fix only changes IMPLEMENTATION to use a local Map, not
// semantics. Add one assertion ensuring multi-group cascade still works.)
{
  const groups = [
    { id: 'g1', name: 'G1', mute: true,  hide: false },
    { id: 'g2', name: 'G2', mute: false, hide: true  },
    { id: 'g3', name: 'G3' }, // no flags
  ];
  const action = makeAction([
    nodeFc('n1', 'a', [{ time: 0, value: 0 }], { groupId: 'g1' }),
    nodeFc('n1', 'b', [{ time: 0, value: 0 }], { groupId: 'g2' }),
    nodeFc('n1', 'c', [{ time: 0, value: 0 }], { groupId: 'g3' }),
    nodeFc('n1', 'd', [{ time: 0, value: 0 }], { groupId: 'gMissing' }),
  ], groups);
  const rows = buildDopesheetRows(action, makeProject({ nodes: [{ id: 'n1', name: 'N1' }] }));
  // g2 hides 'b', so 3 rows survive (a, c, d)
  eq(rows.length, 3, '3 rows after hide-filter (g2 hides b)');
  const byProperty = new Map(rows.map((r) => [r.label.split(' · ')[1], r]));
  eq(byProperty.get('a')?.isMuted, true,  'g1 cascade mutes a');
  eq(byProperty.get('c')?.isMuted, false, 'g3 has no flags');
  eq(byProperty.get('d')?.isMuted, false, 'missing-group fcurve treated as ungrouped (not muted)');
}

// ── final report ────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} dopesheet-row assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
