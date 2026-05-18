// Tests for migration v42 — Animation Phase 4 Slice 4.A: NLA substrate
// (AnimData backup pointers + NlaTrack/NlaStrip constructors + flag
// enums + predicates). Run: node scripts/test/test_migrationV42.mjs

import {
  migrateNlaSubstrate,
} from '../../src/store/migrations/v42_nla_substrate.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';
import {
  NLA_BLEND_MODES,
  NLA_EXTEND_MODES,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  makeNlaTrack,
  makeNlaStrip,
  isNlaTrack,
  isNlaStrip,
  getNlaTracks,
  isTweakModeOn,
} from '../../src/anim/nla.js';
import { makeSceneNode } from '../../src/store/migrations/v37_scene_anim_data.js';

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
function throws(fn, msgMatch, name) {
  try {
    fn();
    failed++; failures.push(name);
    console.error(`FAIL: ${name} (expected throw, got success)`);
  } catch (err) {
    if (msgMatch && !String(err.message).includes(msgMatch)) {
      failed++; failures.push(name);
      console.error(`FAIL: ${name} (wrong error: ${err.message})`);
    } else {
      passed++;
    }
  }
}

const ANIMDATA_BACKUP_FIELDS = ['tmpActionId', 'tmpSlotHandle', 'tweakTrackId', 'tweakStripId'];

// ── 1. Direct migrator: empty project → safe no-op ─────────────────
{
  const r = migrateNlaSubstrate({});
  eq(r.animDataPatched, 0, '1a: empty project patches 0 slots');
  // null guard
  const r2 = migrateNlaSubstrate(null);
  eq(r2.animDataPatched, 0, '1b: null project safe');
  // non-array nodes
  const r3 = migrateNlaSubstrate({ nodes: 'broken' });
  eq(r3.animDataPatched, 0, '1c: non-array nodes safe');
}

// ── 2. Direct migrator: patches missing backup pointers on every node-with-animData ─
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', animData: { actionId: null, nlaTracks: [] } },
      { id: 'g1', type: 'group', animData: { actionId: 'a', nlaTracks: [] } },
      { id: '__scene__', type: 'scene', animData: { actionId: null, nlaTracks: [] } },
      // Non-animData-carrying types — should be skipped entirely
      { id: 'm1', type: 'meshData' },
      { id: 'd1', type: 'deformer' },
    ],
  };
  const { animDataPatched } = migrateNlaSubstrate(project);
  eq(animDataPatched, 3, '2: patched all 3 animData-carrying nodes (part + group + scene)');
  for (const node of project.nodes) {
    if (node.animData) {
      for (const fld of ANIMDATA_BACKUP_FIELDS) {
        assert(fld in node.animData, `2: node ${node.id} has field ${fld}`);
      }
      eq(node.animData.tmpActionId, null, `2: node ${node.id} tmpActionId defaults null`);
      eq(node.animData.tmpSlotHandle, 0, `2: node ${node.id} tmpSlotHandle defaults 0`);
      eq(node.animData.tweakTrackId, null, `2: node ${node.id} tweakTrackId defaults null`);
      eq(node.animData.tweakStripId, null, `2: node ${node.id} tweakStripId defaults null`);
    }
  }
}

// ── 3. Direct migrator: idempotent ─────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', animData: { actionId: null, nlaTracks: [] } },
    ],
  };
  migrateNlaSubstrate(project);
  // Mutate one of the new fields — re-run must NOT clobber it
  project.nodes[0].animData.tweakStripId = 'preserved-strip-id';
  const { animDataPatched } = migrateNlaSubstrate(project);
  eq(animDataPatched, 0, '3a: re-run on already-patched project patches 0 nodes');
  eq(project.nodes[0].animData.tweakStripId, 'preserved-strip-id',
    '3b: pre-existing tweakStripId value preserved (idempotency, not just shape)');
}

// ── 4. Direct migrator: skips nodes with animData missing or non-object ─
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part' /* no animData */ },
      { id: 'p2', type: 'part', animData: null },
      { id: 'p3', type: 'part', animData: 'corrupt' },
    ],
  };
  const { animDataPatched } = migrateNlaSubstrate(project);
  eq(animDataPatched, 0, '4: nodes with missing/non-object animData skipped');
}

// ── 5. Full migrateProject: pre-v42 save bumps to current ──────────
{
  const project = {
    schemaVersion: 41,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [
      { id: 'p1', type: 'part', animData: {
        actionId: null, actionInfluence: 1, actionBlendmode: 'replace',
        actionExtendmode: 'hold', slotHandle: 0, nlaTracks: [], drivers: [], flag: 0,
      } },
    ], animations: [], parameters: [], physics_groups: [],
    actions: [], scene: { fps: 30 },
  };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `5: bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(CURRENT_SCHEMA_VERSION >= 42, '5: CURRENT_SCHEMA_VERSION advanced to at least 42');
  for (const fld of ANIMDATA_BACKUP_FIELDS) {
    assert(fld in project.nodes[0].animData,
      `5: full-walker added ${fld} to v41→v42 migrated animData`);
  }
}

// ── 6. CURRENT_SCHEMA_VERSION sanity ───────────────────────────────
{
  const project = { schemaVersion: 1 };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `6: walker reaches CURRENT_SCHEMA_VERSION=${CURRENT_SCHEMA_VERSION}`);
}

// ── 7. makeSceneNode() default carries the 4 new fields ────────────
{
  // v37 was updated this slice to include the backup pointers in its
  // defaultAnimData() so freshly-created __scene__ nodes match v42-
  // migrated ones. Catches regressions where the v37 + v36 + v42 trio
  // ever drift apart.
  const node = makeSceneNode();
  for (const fld of ANIMDATA_BACKUP_FIELDS) {
    assert(fld in node.animData,
      `7: fresh __scene__ animData carries ${fld}`);
  }
  eq(node.animData.tmpActionId, null, '7: scene tmpActionId default null');
  eq(node.animData.tmpSlotHandle, 0, '7: scene tmpSlotHandle default 0');
  eq(node.animData.tweakTrackId, null, '7: scene tweakTrackId default null');
  eq(node.animData.tweakStripId, null, '7: scene tweakStripId default null');
}

// ── 8. NLA_BLEND_MODES — 4 modes in Blender enum order, frozen ─────
{
  assert(Array.isArray(NLA_BLEND_MODES), '8: NLA_BLEND_MODES is an array');
  eq(NLA_BLEND_MODES.length, 4, '8: exactly 4 modes ship in Phase 4 (combine deferred)');
  // Blender DNA_anim_enums.h:374-379:
  //   NLASTRIP_MODE_REPLACE  = 0
  //   NLASTRIP_MODE_ADD      = 1
  //   NLASTRIP_MODE_SUBTRACT = 2
  //   NLASTRIP_MODE_MULTIPLY = 3
  //   NLASTRIP_MODE_COMBINE  = 4  (DEFERRED)
  eq(NLA_BLEND_MODES[0], 'replace', '8: order matches Blender — replace first (=0)');
  eq(NLA_BLEND_MODES[1], 'add', '8: order matches Blender — add second (=1)');
  eq(NLA_BLEND_MODES[2], 'subtract', '8: order matches Blender — subtract third (=2)');
  eq(NLA_BLEND_MODES[3], 'multiply', '8: order matches Blender — multiply fourth (=3)');
  // 'combine' explicitly NOT in the list (Phase 4 audit Rule №1)
  eq(NLA_BLEND_MODES.includes('combine'), false,
    '8: combine NOT shipped in Phase 4 (deferred — Rule №1)');
  assert(Object.isFrozen(NLA_BLEND_MODES), '8: NLA_BLEND_MODES frozen');
}

// ── 9. NLA_EXTEND_MODES — 3 modes in Blender enum order, frozen ────
{
  eq(NLA_EXTEND_MODES.length, 3, '9: 3 extend modes (full Blender parity)');
  // Blender DNA_anim_enums.h:383-391:
  //   NLASTRIP_EXTEND_HOLD         = 0  (Blender default)
  //   NLASTRIP_EXTEND_HOLD_FORWARD = 1
  //   NLASTRIP_EXTEND_NOTHING      = 2
  eq(NLA_EXTEND_MODES[0], 'hold', '9: order matches Blender — hold first (=0)');
  eq(NLA_EXTEND_MODES[1], 'hold_forward', '9: order matches Blender — hold_forward (=1)');
  eq(NLA_EXTEND_MODES[2], 'nothing', '9: order matches Blender — nothing (=2)');
  assert(Object.isFrozen(NLA_EXTEND_MODES), '9: NLA_EXTEND_MODES frozen');
}

// ── 10. NLASTRIP_FLAG bits match Blender ───────────────────────────
{
  // DNA_anim_enums.h:394-441
  eq(NLASTRIP_FLAG.ACTIVE,          1 << 0,  '10: ACTIVE          = (1 << 0)');
  eq(NLASTRIP_FLAG.SELECT,          1 << 1,  '10: SELECT          = (1 << 1)');
  eq(NLASTRIP_FLAG.TWEAKUSER,       1 << 4,  '10: TWEAKUSER       = (1 << 4)');
  eq(NLASTRIP_FLAG.USR_INFLUENCE,   1 << 5,  '10: USR_INFLUENCE   = (1 << 5)');
  eq(NLASTRIP_FLAG.USR_TIME,        1 << 6,  '10: USR_TIME        = (1 << 6)');
  eq(NLASTRIP_FLAG.USR_TIME_CYCLIC, 1 << 7,  '10: USR_TIME_CYCLIC = (1 << 7)');
  eq(NLASTRIP_FLAG.SYNC_LENGTH,     1 << 9,  '10: SYNC_LENGTH     = (1 << 9)');
  eq(NLASTRIP_FLAG.AUTO_BLENDS,     1 << 10, '10: AUTO_BLENDS     = (1 << 10)');
  eq(NLASTRIP_FLAG.REVERSE,         1 << 11, '10: REVERSE         = (1 << 11)');
  eq(NLASTRIP_FLAG.MUTED,           1 << 12, '10: MUTED           = (1 << 12)');
  assert(Object.isFrozen(NLASTRIP_FLAG), '10: NLASTRIP_FLAG frozen');
}

// ── 11. NLATRACK_FLAG bits match Blender ───────────────────────────
{
  // DNA_anim_enums.h:460-485
  eq(NLATRACK_FLAG.ACTIVE,    1 << 0,  '11: ACTIVE    = (1 << 0)');
  eq(NLATRACK_FLAG.SELECTED,  1 << 1,  '11: SELECTED  = (1 << 1)');
  eq(NLATRACK_FLAG.MUTED,     1 << 2,  '11: MUTED     = (1 << 2)');
  eq(NLATRACK_FLAG.SOLO,      1 << 3,  '11: SOLO      = (1 << 3)');
  eq(NLATRACK_FLAG.PROTECTED, 1 << 4,  '11: PROTECTED = (1 << 4)');
  eq(NLATRACK_FLAG.DISABLED,  1 << 10, '11: DISABLED  = (1 << 10)');
  assert(Object.isFrozen(NLATRACK_FLAG), '11: NLATRACK_FLAG frozen');
}

// ── 12. ADT_FLAG bits match Blender ────────────────────────────────
{
  // DNA_anim_enums.h:553-587 — the NLA-relevant subset
  eq(ADT_FLAG.NLA_SOLO_TRACK,        1 << 0, '12: NLA_SOLO_TRACK        = (1 << 0)');
  eq(ADT_FLAG.NLA_EVAL_OFF,          1 << 1, '12: NLA_EVAL_OFF          = (1 << 1)');
  eq(ADT_FLAG.NLA_EDIT_ON,           1 << 2,
    '12: NLA_EDIT_ON           = (1 << 2)  (Blender ADT_NLA_EDIT_ON, line 559 — the tweak flag)');
  eq(ADT_FLAG.NLA_EDIT_NOMAP,        1 << 3, '12: NLA_EDIT_NOMAP        = (1 << 3)');
  eq(ADT_FLAG.NLA_EVAL_UPPER_TRACKS, 1 << 5, '12: NLA_EVAL_UPPER_TRACKS = (1 << 5)');
  assert(Object.isFrozen(ADT_FLAG), '12: ADT_FLAG frozen');
}

// ── 13. makeNlaStrip — defaults match Blender NlaStrip ─────────────
{
  const s = makeNlaStrip('strip1', 'action_a');
  eq(s.id, 'strip1', '13: id passed through');
  eq(s.name, 'strip1', '13: name defaults to id when not overridden');
  eq(s.actionId, 'action_a', '13: actionId passed through');
  eq(s.slotHandle, 0, '13: slotHandle defaults 0 (Slot::unassigned)');
  eq(s.blendmode, 'replace', '13: blendmode defaults replace (Blender MODE_REPLACE=0)');
  eq(s.extendmode, 'hold', '13: extendmode defaults hold (Blender EXTEND_HOLD=0)');
  eq(s.influence, 1, '13: influence defaults 1');
  eq(s.repeat, 1, '13: repeat defaults 1 (no repeat)');
  eq(s.scale, 1, '13: scale defaults 1 (no time scale)');
  eq(s.start, 0, '13: start ms defaults 0');
  eq(s.end, 0, '13: end ms defaults 0');
  eq(s.actstart, 0, '13: actstart ms defaults 0');
  eq(s.actend, 0, '13: actend ms defaults 0');
  eq(s.blendin, 0, '13: blendin defaults 0');
  eq(s.blendout, 0, '13: blendout defaults 0');
  eq(s.flag, 0, '13: flag defaults 0');
  assert(Array.isArray(s.fcurves) && s.fcurves.length === 0,
    '13: fcurves defaults to empty array (no per-strip overrides)');
}

// ── 14. makeNlaStrip — overrides applied, validation enforced ──────
{
  const s = makeNlaStrip('s2', 'act_b', {
    name: 'Walk',
    start: 100, end: 2000,
    actstart: 0, actend: 1900,
    blendmode: 'add',
    extendmode: 'nothing',
    influence: 0.5,
    repeat: 2,
    scale: 0.75,
    blendin: 50, blendout: 100,
    flag: NLASTRIP_FLAG.MUTED | NLASTRIP_FLAG.SELECT,
  });
  eq(s.name, 'Walk', '14: name override applied');
  eq(s.blendmode, 'add', '14: blendmode override applied');
  eq(s.extendmode, 'nothing', '14: extendmode override applied');
  eq(s.influence, 0.5, '14: influence override applied');
  eq(s.repeat, 2, '14: repeat override applied');
  eq(s.scale, 0.75, '14: scale override applied');
  eq(s.flag & NLASTRIP_FLAG.MUTED, NLASTRIP_FLAG.MUTED, '14: flag MUTED bit set');
  eq(s.flag & NLASTRIP_FLAG.SELECT, NLASTRIP_FLAG.SELECT, '14: flag SELECT bit set');

  // combine deferred — must throw
  throws(
    () => makeNlaStrip('bad', 'act', { blendmode: /** @type any */ ('combine') }),
    'combine',
    '14: combine blendmode rejected (deferred per plan §4.B)'
  );
  // Garbage extendmode rejected
  throws(
    () => makeNlaStrip('bad', 'act', { extendmode: /** @type any */ ('looped') }),
    'extendmode',
    '14: unknown extendmode rejected'
  );
  // Missing id/actionId rejected loud
  throws(() => makeNlaStrip('', 'act'), 'id', '14: empty id rejected');
  throws(() => makeNlaStrip('x', ''), 'actionId', '14: empty actionId rejected');
  throws(() => makeNlaStrip(/** @type any */ (null), 'act'), 'id', '14: null id rejected');
  throws(() => makeNlaStrip('x', /** @type any */ (null)), 'actionId', '14: null actionId rejected');
}

// ── 15. makeNlaTrack — defaults + override validation ──────────────
{
  const t = makeNlaTrack('t1', 'Upper Body');
  eq(t.id, 't1', '15: id passed through');
  eq(t.name, 'Upper Body', '15: name passed through');
  assert(Array.isArray(t.strips) && t.strips.length === 0,
    '15: strips defaults to empty array');
  eq(t.flag, 0, '15: flag defaults 0');
  eq(t.index, 0, '15: index defaults 0');

  const t2 = makeNlaTrack('t2', 'Face', { index: 2, flag: NLATRACK_FLAG.SOLO });
  eq(t2.index, 2, '15: index override applied');
  eq(t2.flag, NLATRACK_FLAG.SOLO, '15: flag override applied (SOLO)');

  // Required-field validation
  throws(() => makeNlaTrack('', 'Body'), 'id', '15: empty id rejected');
  throws(() => makeNlaTrack('t3', ''), 'name', '15: empty name rejected');
}

// ── 16. isNlaTrack / isNlaStrip predicates ─────────────────────────
{
  // Positive cases
  const okTrack = makeNlaTrack('t1', 'Body');
  const okStrip = makeNlaStrip('s1', 'act_a');
  assert(isNlaTrack(okTrack), '16: well-formed track passes isNlaTrack');
  assert(isNlaStrip(okStrip), '16: well-formed strip passes isNlaStrip');

  // Negative cases — track
  assert(!isNlaTrack(null), '16: null fails isNlaTrack');
  assert(!isNlaTrack(undefined), '16: undefined fails isNlaTrack');
  assert(!isNlaTrack({}), '16: empty object fails isNlaTrack');
  assert(!isNlaTrack({ id: 't1', name: 'B', strips: [], flag: 0 /* index missing */ }),
    '16: missing index field fails isNlaTrack');
  assert(!isNlaTrack({ id: 't1', name: 'B', strips: 'not-array', flag: 0, index: 0 }),
    '16: non-array strips fails isNlaTrack');

  // Negative cases — strip
  assert(!isNlaStrip(null), '16: null fails isNlaStrip');
  assert(!isNlaStrip({}), '16: empty object fails isNlaStrip');
  assert(!isNlaStrip({ ...okStrip, blendmode: 'combine' }),
    '16: strip with combine blendmode fails isNlaStrip (validation enforced)');
  assert(!isNlaStrip({ ...okStrip, extendmode: 'wrap' }),
    '16: strip with unknown extendmode fails isNlaStrip');
}

// ── 17. getNlaTracks reader — sparse defaults to empty array ───────
{
  eq(getNlaTracks(null).length, 0, '17: null animData → []');
  eq(getNlaTracks(undefined).length, 0, '17: undefined animData → []');
  eq(getNlaTracks({}).length, 0, '17: empty animData → []');
  eq(getNlaTracks({ nlaTracks: undefined }).length, 0, '17: nlaTracks=undefined → []');
  eq(getNlaTracks({ nlaTracks: null }).length, 0, '17: nlaTracks=null → []');
  eq(getNlaTracks({ nlaTracks: 'broken' }).length, 0, '17: nlaTracks=string → []');

  const tracks = [makeNlaTrack('t1', 'Body')];
  eq(getNlaTracks({ nlaTracks: tracks }), tracks, '17: returns the actual array by reference');

  // Stable EMPTY_NLA_TRACKS sentinel (avoids filter-in-selector trap)
  const e1 = getNlaTracks(null);
  const e2 = getNlaTracks({});
  const e3 = getNlaTracks({ nlaTracks: null });
  assert(e1 === e2 && e2 === e3,
    '17: all "empty" returns share a single stable reference (selector-friendly)');
}

// ── 18. isTweakModeOn — reads ADT_FLAG.NLA_EDIT_ON ─────────────────
{
  eq(isTweakModeOn(null), false, '18: null animData → not in tweak mode');
  eq(isTweakModeOn({}), false, '18: empty animData → not in tweak mode');
  eq(isTweakModeOn({ flag: 0 }), false, '18: flag=0 → not in tweak mode');
  eq(isTweakModeOn({ flag: ADT_FLAG.NLA_EDIT_ON }), true,
    '18: flag=NLA_EDIT_ON → in tweak mode');
  // Other bits set, NLA_EDIT_ON clear → false
  eq(isTweakModeOn({ flag: ADT_FLAG.NLA_SOLO_TRACK | ADT_FLAG.NLA_EVAL_OFF }), false,
    '18: other bits set, NLA_EDIT_ON clear → not in tweak mode');
  // Multiple bits including NLA_EDIT_ON → true
  eq(isTweakModeOn({
    flag: ADT_FLAG.NLA_EDIT_ON | ADT_FLAG.NLA_SOLO_TRACK,
  }), true, '18: NLA_EDIT_ON | NLA_SOLO_TRACK → in tweak mode');
}

// ── 19. JSON round-trip preserves NLA shape ────────────────────────
{
  // Substrate must survive project save/load. The project-store layer
  // serialises with JSON.stringify and re-imports via JSON.parse; the
  // backup pointers + nlaTracks must come back identical.
  const node = {
    id: 'p1', type: 'part',
    animData: {
      actionId: 'a1',
      actionInfluence: 1,
      actionBlendmode: 'replace',
      actionExtendmode: 'hold',
      slotHandle: 0,
      nlaTracks: [
        makeNlaTrack('t1', 'Body', { index: 0, strips: [
          makeNlaStrip('s1', 'a1', {
            name: 'Walk', start: 0, end: 1000, actstart: 0, actend: 1000,
            blendmode: 'add', extendmode: 'hold_forward', influence: 0.8,
            flag: NLASTRIP_FLAG.SELECT,
          }),
        ] }),
      ],
      drivers: [],
      flag: ADT_FLAG.NLA_EDIT_ON,
      tmpActionId: 'a2',
      tmpSlotHandle: 7,
      tweakTrackId: 't1',
      tweakStripId: 's1',
    },
  };
  const roundtrip = JSON.parse(JSON.stringify(node));
  eq(JSON.stringify(roundtrip), JSON.stringify(node),
    '19a: NLA-laden node round-trips byte-identical');
  assert(isNlaTrack(roundtrip.animData.nlaTracks[0]),
    '19b: round-tripped track still passes isNlaTrack');
  assert(isNlaStrip(roundtrip.animData.nlaTracks[0].strips[0]),
    '19c: round-tripped strip still passes isNlaStrip');
  assert(isTweakModeOn(roundtrip.animData),
    '19d: round-tripped tweak-mode flag still reads as on');
  eq(roundtrip.animData.tmpActionId, 'a2',
    '19e: tmpActionId preserved across round-trip');
  eq(roundtrip.animData.tweakStripId, 's1',
    '19f: tweakStripId preserved across round-trip');
}

console.log(`\nmigrationV42: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
