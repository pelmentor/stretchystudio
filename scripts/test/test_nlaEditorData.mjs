// Tests for src/v3/editors/nla/nlaEditorData.js — Animation Phase 4
// Slice 4.D.1. Run: node scripts/test/test_nlaEditorData.mjs
//
// Coverage:
//   §1  — buildNlaEditorRows: empty/null project safe
//   §2  — buildNlaEditorRows: skips nodes without animData
//   §3  — buildNlaEditorRows: surfaces all 3 animData node types
//         (part / group / scene)
//   §4  — Track ordering: bottom-to-top by ascending index
//   §5  — Strip ordering: left-to-right by start
//   §6  — Strip row: action name resolved + actionName fallback to id
//   §7  — Strip row: flag bits surfaced (muted, selected, tweakuser,
//         isTweakStrip)
//   §8  — Track row: flag bits surfaced (muted, solo, protected,
//         disabled, enabled-derived)
//   §9  — Group: tweak-mode state surfaced (tweakModeOn, soloActive,
//         tweakTrackId, tweakStripId)
//   §10 — isTrackEnabled: solo-trumps-mute semantics
//   §11 — Defensive: malformed tracks filtered via isNlaTrack predicate
//   §12 — Defensive: malformed strips filtered via isNlaStrip predicate
//   §13 — computeTimelineSpan: empty / single-strip / multi-strip
//   §14 — computeTimelineSpan snaps minMs to 0 if positive
//   §15 — BLENDMODE_LABELS + BLENDMODE_COLORS frozen + complete

import {
  buildNlaEditorRows,
  computeTimelineSpan,
  BLENDMODE_LABELS,
  BLENDMODE_COLORS,
} from '../../src/v3/editors/nla/nlaEditorData.js';
import {
  makeNlaStrip,
  makeNlaTrack,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
} from '../../src/anim/nla.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

// Helper: minimal project with one action.
function makeProject(extraActions = [], nodes = []) {
  return {
    actions: [
      { id: 'walkAct', name: 'Walk', fcurves: [] },
      { id: 'idleAct', name: 'Idle', fcurves: [] },
      ...extraActions,
    ],
    nodes,
  };
}

// ── 1. buildNlaEditorRows safety ───────────────────────────────────
{
  eq(buildNlaEditorRows(null).length, 0, '1: null project → empty array');
  eq(buildNlaEditorRows({}).length, 0, '1: empty project → empty array');
  eq(buildNlaEditorRows({ nodes: 'broken' }).length, 0, '1: non-array nodes → empty array');
}

// ── 2. Skips nodes without animData ────────────────────────────────
{
  const project = makeProject([], [
    { id: 'mesh1', type: 'meshData', name: 'Mesh' },   // no animData
    { id: 'def1', type: 'deformer', name: 'Def' },     // no animData
    { id: 'corrupt', type: 'part', name: 'Corrupt', animData: null },
  ]);
  eq(buildNlaEditorRows(project).length, 0, '2: nodes without valid animData filtered');
}

// ── 3. Surfaces all 3 animData node types ──────────────────────────
{
  const animData = {
    actionId: null, slotHandle: 0, flag: 0,
    nlaTracks: [],
    tmpActionId: null, tmpSlotHandle: 0,
    tweakTrackId: null, tweakStripId: null,
  };
  const project = makeProject([], [
    { id: 'part1', type: 'part', name: 'Part', animData: { ...animData } },
    { id: 'group1', type: 'group', name: 'Group', animData: { ...animData } },
    { id: '__scene__', type: 'scene', name: 'Scene', animData: { ...animData } },
  ]);
  const groups = buildNlaEditorRows(project);
  eq(groups.length, 3, '3: all 3 animData-bearing node types surfaced');
  eq(groups[0].objectType, 'part', '3: part type preserved');
  eq(groups[1].objectType, 'group', '3: group type preserved');
  eq(groups[2].objectType, 'scene', '3: scene type preserved');
  // Object name fallback to id
  const noName = { id: 'noName', type: 'part', animData: { ...animData } };
  const project2 = makeProject([], [noName]);
  eq(buildNlaEditorRows(project2)[0].objectName, 'noName',
    '3: objectName fallback to id when name missing');
}

// ── 4. Track ordering: bottom-to-top by ascending index ────────────
{
  const tracks = [
    makeNlaTrack('tTop',  'T', { index: 2 }),
    makeNlaTrack('tBot',  'B', { index: 0 }),
    makeNlaTrack('tMid',  'M', { index: 1 }),
  ];
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: tracks },
  }]);
  const groups = buildNlaEditorRows(project);
  const trackIds = groups[0].tracks.map((t) => t.id);
  eq(JSON.stringify(trackIds), JSON.stringify(['tBot', 'tMid', 'tTop']),
    '4: tracks sorted bottom-to-top by ascending index');
}

// ── 5. Strip ordering: left-to-right by start ──────────────────────
{
  const strips = [
    makeNlaStrip('s3', 'walkAct', { start: 3000, end: 4000, actstart: 0, actend: 1000 }),
    makeNlaStrip('s1', 'walkAct', { start: 0,    end: 1000, actstart: 0, actend: 1000 }),
    makeNlaStrip('s2', 'walkAct', { start: 1000, end: 2000, actstart: 0, actend: 1000 }),
  ];
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: [
      makeNlaTrack('t1', 'T', { index: 0, strips }),
    ] },
  }]);
  const groups = buildNlaEditorRows(project);
  const stripIds = groups[0].tracks[0].strips.map((s) => s.id);
  eq(JSON.stringify(stripIds), JSON.stringify(['s1', 's2', 's3']),
    '5: strips sorted left-to-right by ascending start');
}

// ── 6. Strip row: action name resolution + fallback ───────────────
{
  const strips = [
    makeNlaStrip('sKnown', 'walkAct', { start: 0, end: 1000, actstart: 0, actend: 1000 }),
    // Dangling actionId — not in project.actions
    makeNlaStrip('sDangling', 'ghostAct', { start: 1000, end: 2000, actstart: 0, actend: 1000 }),
  ];
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: [
      makeNlaTrack('t1', 'T', { index: 0, strips }),
    ] },
  }]);
  const groups = buildNlaEditorRows(project);
  const stripRows = groups[0].tracks[0].strips;
  eq(stripRows[0].actionName, 'Walk', '6: known action → display name');
  eq(stripRows[1].actionName, 'ghostAct',
    '6: dangling action → fallback to actionId for user diagnostics');
}

// ── 7. Strip row: flag bits surfaced ───────────────────────────────
{
  const strips = [
    makeNlaStrip('sNormal', 'walkAct', { start: 0, end: 1000, actstart: 0, actend: 1000 }),
    makeNlaStrip('sMuted', 'walkAct', {
      start: 1000, end: 2000, actstart: 0, actend: 1000,
      flag: NLASTRIP_FLAG.MUTED,
    }),
    makeNlaStrip('sSelected', 'walkAct', {
      start: 2000, end: 3000, actstart: 0, actend: 1000,
      flag: NLASTRIP_FLAG.SELECT,
    }),
    makeNlaStrip('sTweakuser', 'walkAct', {
      start: 3000, end: 4000, actstart: 0, actend: 1000,
      flag: NLASTRIP_FLAG.TWEAKUSER,
    }),
  ];
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: {
      actionId: null, flag: ADT_FLAG.NLA_EDIT_ON,
      tweakStripId: 'sNormal', tweakTrackId: 't1',
      nlaTracks: [makeNlaTrack('t1', 'T', { index: 0, strips })],
    },
  }]);
  const stripRows = buildNlaEditorRows(project)[0].tracks[0].strips;
  // sNormal is the tweak strip
  assert(stripRows[0].isTweakStrip, '7: tweak strip flagged isTweakStrip');
  assert(!stripRows[1].isTweakStrip, '7: other strip not isTweakStrip');
  // sMuted
  assert(stripRows[1].muted, '7: muted bit surfaced');
  assert(!stripRows[0].muted, '7: non-muted not muted');
  // sSelected
  assert(stripRows[2].selected, '7: select bit surfaced');
  // sTweakuser
  assert(stripRows[3].tweakuser, '7: tweakuser bit surfaced');
}

// ── 8. Track row: flag bits surfaced ───────────────────────────────
{
  const tracks = [
    makeNlaTrack('tNormal',    'A', { index: 0 }),
    makeNlaTrack('tMuted',     'B', { index: 1, flag: NLATRACK_FLAG.MUTED }),
    makeNlaTrack('tSolo',      'C', { index: 2, flag: NLATRACK_FLAG.SOLO }),
    makeNlaTrack('tProtected', 'D', { index: 3, flag: NLATRACK_FLAG.PROTECTED }),
    makeNlaTrack('tDisabled',  'E', { index: 4, flag: NLATRACK_FLAG.DISABLED }),
  ];
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: tracks },
  }]);
  const trackRows = buildNlaEditorRows(project)[0].tracks;
  assert(!trackRows[0].muted && !trackRows[0].solo, '8: tNormal: no flags');
  assert(trackRows[1].muted, '8: tMuted bit surfaced');
  assert(trackRows[2].solo, '8: tSolo bit surfaced');
  assert(trackRows[3].protected_, '8: tProtected bit surfaced');
  assert(trackRows[4].disabled, '8: tDisabled bit surfaced');
}

// ── 9. Group: tweak-mode state surfaced ────────────────────────────
{
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: {
      actionId: 'walkAct', slotHandle: 0,
      flag: ADT_FLAG.NLA_EDIT_ON | ADT_FLAG.NLA_SOLO_TRACK,
      nlaTracks: [],
      tweakTrackId: 'tX',
      tweakStripId: 'sY',
    },
  }]);
  const g = buildNlaEditorRows(project)[0];
  assert(g.tweakModeOn, '9: tweakModeOn surfaced');
  assert(g.soloActive, '9: soloActive surfaced');
  eq(g.tweakTrackId, 'tX', '9: tweakTrackId surfaced');
  eq(g.tweakStripId, 'sY', '9: tweakStripId surfaced');
}

// ── 10. isTrackEnabled solo-trumps-mute semantics ──────────────────
{
  // With NLA_SOLO_TRACK on adt:
  //   - SOLO track → enabled
  //   - non-SOLO track (even unmuted) → NOT enabled
  // Without NLA_SOLO_TRACK on adt:
  //   - MUTED → NOT enabled
  //   - non-MUTED → enabled
  const tracks = [
    makeNlaTrack('t1', 'A', { index: 0 }),                           // neither
    makeNlaTrack('t2', 'B', { index: 1, flag: NLATRACK_FLAG.MUTED }),
    makeNlaTrack('t3', 'C', { index: 2, flag: NLATRACK_FLAG.SOLO }),
  ];
  // Without ADT solo flag:
  const project1 = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: tracks },
  }]);
  const rows1 = buildNlaEditorRows(project1)[0].tracks;
  assert(rows1[0].enabled, '10: no-flags + adt-not-solo → enabled');
  assert(!rows1[1].enabled, '10: muted + adt-not-solo → disabled');
  assert(rows1[2].enabled, '10: solo + adt-not-solo (SOLO is just a flag here) → enabled');

  // With ADT solo flag:
  const project2 = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: ADT_FLAG.NLA_SOLO_TRACK, nlaTracks: tracks },
  }]);
  const rows2 = buildNlaEditorRows(project2)[0].tracks;
  assert(!rows2[0].enabled, '10: adt-solo + no-solo-flag → NOT enabled');
  assert(!rows2[1].enabled, '10: adt-solo + muted (no SOLO) → NOT enabled');
  assert(rows2[2].enabled, '10: adt-solo + SOLO → enabled (solo trumps mute)');
}

// ── 11. Malformed tracks filtered ──────────────────────────────────
{
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: {
      actionId: null, flag: 0,
      nlaTracks: [
        makeNlaTrack('tGood', 'Good', { index: 0 }),
        null,                                       // null
        { id: 'noName', strips: [], flag: 0, index: 1 }, // missing name
        { id: 'noStrips', name: 'X', flag: 0, index: 2 }, // missing strips
      ],
    },
  }]);
  const rows = buildNlaEditorRows(project)[0].tracks;
  eq(rows.length, 1, '11: only 1 well-formed track surfaced (3 malformed filtered)');
  eq(rows[0].id, 'tGood', '11: surviving track is the well-formed one');
}

// ── 12. Malformed strips filtered ──────────────────────────────────
{
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: {
      actionId: null, flag: 0,
      nlaTracks: [makeNlaTrack('t1', 'T', { index: 0, strips: [
        makeNlaStrip('sGood', 'walkAct', { start: 0, end: 1000, actstart: 0, actend: 1000 }),
        null,                                                          // null
        { id: 'noAct', actionId: null, start: 0, end: 0, blendmode: 'replace', extendmode: 'hold', flag: 0 }, // bad
        { id: 'badMode', actionId: 'walkAct', start: 0, end: 0, blendmode: 'combine', extendmode: 'hold', flag: 0 }, // combine rejected by isNlaStrip
      ] })],
    },
  }]);
  const stripRows = buildNlaEditorRows(project)[0].tracks[0].strips;
  eq(stripRows.length, 1, '12: only 1 well-formed strip surfaced');
  eq(stripRows[0].id, 'sGood', '12: surviving strip is the well-formed one');
}

// ── 13. computeTimelineSpan ────────────────────────────────────────
{
  eq(computeTimelineSpan([]).maxMs, 0, '13: empty groups → maxMs=0');
  eq(computeTimelineSpan(null).maxMs, 0, '13: null → maxMs=0');

  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: [
      makeNlaTrack('t1', 'T', { index: 0, strips: [
        makeNlaStrip('s1', 'walkAct', { start: 100, end: 1500, actstart: 0, actend: 1000 }),
        makeNlaStrip('s2', 'walkAct', { start: 2000, end: 3500, actstart: 0, actend: 1000 }),
      ] }),
    ] },
  }]);
  const span = computeTimelineSpan(buildNlaEditorRows(project));
  eq(span.minMs, 0, '13: positive minMs snapped to 0');
  eq(span.maxMs, 3500, '13: maxMs = max(strip.end) = 3500');
}

// ── 14. computeTimelineSpan: snap positive minMs to 0 ──────────────
{
  const project = makeProject([], [{
    id: 'p1', type: 'part', name: 'P',
    animData: { actionId: null, flag: 0, nlaTracks: [
      makeNlaTrack('t1', 'T', { index: 0, strips: [
        // negative-time strip — shouldn't happen in practice but guard
        makeNlaStrip('sNeg', 'walkAct', { start: -500, end: 500, actstart: 0, actend: 1000 }),
      ] }),
    ] },
  }]);
  const span = computeTimelineSpan(buildNlaEditorRows(project));
  eq(span.minMs, -500, '14: negative minMs preserved (no snap-to-0)');
  eq(span.maxMs, 500, '14: maxMs=500');
}

// ── 15. BLENDMODE_LABELS + COLORS ──────────────────────────────────
{
  assert(Object.isFrozen(BLENDMODE_LABELS), '15: BLENDMODE_LABELS frozen');
  assert(Object.isFrozen(BLENDMODE_COLORS), '15: BLENDMODE_COLORS frozen');
  // All 4 ship-modes have labels + colors
  for (const mode of ['replace', 'add', 'subtract', 'multiply']) {
    assert(typeof BLENDMODE_LABELS[mode] === 'string'
      && BLENDMODE_LABELS[mode].length > 0,
      `15: BLENDMODE_LABELS.${mode} non-empty`);
    assert(typeof BLENDMODE_COLORS[mode] === 'string'
      && BLENDMODE_COLORS[mode].length > 0,
      `15: BLENDMODE_COLORS.${mode} non-empty`);
  }
  // combine intentionally absent
  eq(BLENDMODE_LABELS.combine, undefined,
    '15: combine intentionally absent from BLENDMODE_LABELS');
  eq(BLENDMODE_COLORS.combine, undefined,
    '15: combine intentionally absent from BLENDMODE_COLORS');
}

console.log(`\nnlaEditorData: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
