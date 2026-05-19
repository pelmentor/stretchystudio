// Tests for src/anim/dopesheetChannelSolo.js — Animation Phase 6 Slice 6.F.2.
// Run: node scripts/test/test_dopesheetChannelSolo.mjs
//
// Coverage mirrors test_dopesheetChannelMute.mjs structurally (sister
// dispatcher; same decision tree + dispatcher shape) but acts on the
// `solo` flag rather than `mute`. Section count parity is intentional.
//
//   §1-9   — pickSoloTarget (sister to pickMuteTarget): null/empty/stale
//            hover; hover priority over selection; empty-string collapse
//  §10-14 — wouldDopesheetChannelSoloChange: predicate
//  §15-25 — applyDopesheetChannelSolo: none / hovered ON/OFF / stale id /
//            selection scan-first / no-selected / isolation / Rule №1 throw

import {
  pickSoloTarget,
  wouldDopesheetChannelSoloChange,
  applyDopesheetChannelSolo,
} from '../../src/anim/dopesheetChannelSolo.js';

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
function throws(fn, msgRe, name) {
  try { fn(); }
  catch (e) {
    const msg = e?.message ?? String(e);
    if (msgRe.test(msg)) { passed++; return; }
    failed++; failures.push(name);
    console.error(`FAIL: ${name}\n   threw but message didnt match ${msgRe}: ${msg}`);
    return;
  }
  failed++; failures.push(name);
  console.error(`FAIL: ${name} — expected throw, got none`);
}

function makeFc(id, opts = {}) {
  return {
    id,
    solo:     opts.solo     === true,
    selected: opts.selected === true,
  };
}
function makeAction(fcs) {
  return { id: 'a1', fcurves: fcs };
}

// ── §1 — pickSoloTarget null/undefined action → 'none' ────────────────
eq(pickSoloTarget(null, 'fc1').kind,      'none', '§1.a null action');
eq(pickSoloTarget(undefined, 'fc1').kind, 'none', '§1.b undefined action');

// ── §2 — pickSoloTarget non-array fcurves → 'none' ─────────────────────
eq(pickSoloTarget({ fcurves: null }, 'fc1').kind, 'none', '§2 non-array fcurves');

// ── §3 — pickSoloTarget empty hover, no selection → 'none' ─────────────
eq(pickSoloTarget(makeAction([makeFc('fc1')]), null).kind, 'none', '§3.a null hover');
eq(pickSoloTarget(makeAction([makeFc('fc1')]), undefined).kind, 'none', '§3.b undefined hover');

// ── §4 — pickSoloTarget empty hover + selection → 'selection' ──────────
eq(pickSoloTarget(makeAction([makeFc('fc1', { selected: true })]), null).kind,
   'selection', '§4 empty hover + selection');

// ── §5 — pickSoloTarget stale hover → selection fallback ───────────────
eq(pickSoloTarget(
  makeAction([makeFc('fc1', { selected: true })]),
  'ghost-id',
).kind, 'selection', '§5 stale hover → selection');

// ── §6 — pickSoloTarget stale hover + no selection → 'none' ────────────
eq(pickSoloTarget(makeAction([makeFc('fc1')]), 'ghost-id').kind,
   'none', '§6 stale hover + no selection');

// ── §7 — pickSoloTarget empty-string hover collapses ───────────────────
eq(pickSoloTarget(
  makeAction([makeFc('fc1', { selected: true })]),
  '',
).kind, 'selection', '§7 empty-string hover');

// ── §8 — pickSoloTarget real hover takes priority over selection ───────
{
  const t = pickSoloTarget(
    makeAction([makeFc('fcA', { selected: true }), makeFc('fcB', { selected: true }), makeFc('fcC')]),
    'fcC',
  );
  eq(t.kind, 'hovered', '§8.a hover wins — kind');
  eq(t.fcurveId, 'fcC', '§8.b hover wins — id');
}

// ── §9 — pickSoloTarget real hover no selection → 'hovered' ────────────
{
  const t = pickSoloTarget(makeAction([makeFc('fcA'), makeFc('fcB')]), 'fcB');
  eq(t.kind, 'hovered', '§9.a kind');
  eq(t.fcurveId, 'fcB', '§9.b id');
}

// ── §10 — wouldChange 'none' → false ────────────────────────────────────
eq(wouldDopesheetChannelSoloChange(makeAction([]), { kind: 'none' }), false,
   '§10 none → false');

// ── §11 — wouldChange 'hovered' valid → true ────────────────────────────
eq(wouldDopesheetChannelSoloChange(
  makeAction([makeFc('fc1')]),
  { kind: 'hovered', fcurveId: 'fc1' },
), true, '§11 hovered valid → true');

// ── §12 — wouldChange 'hovered' stale → false ───────────────────────────
eq(wouldDopesheetChannelSoloChange(
  makeAction([makeFc('fc1')]),
  { kind: 'hovered', fcurveId: 'ghost' },
), false, '§12 hovered stale → false');

// ── §13 — wouldChange 'selection' with selected → true ──────────────────
eq(wouldDopesheetChannelSoloChange(
  makeAction([makeFc('fc1', { selected: true })]),
  { kind: 'selection' },
), true, '§13 selection has selected → true');

// ── §14 — wouldChange 'selection' no selected → false ───────────────────
eq(wouldDopesheetChannelSoloChange(
  makeAction([makeFc('fc1')]),
  { kind: 'selection' },
), false, '§14 selection no selected → false');

// ── §15 — applyDopesheetChannelSolo 'none' no-op ────────────────────────
{
  const act = makeAction([makeFc('fc1')]);
  const r = applyDopesheetChannelSolo(act, { kind: 'none' });
  eq(r.changed, false, '§15.a changed=false');
  eq(r.mode, null,     '§15.b mode=null');
  eq(act.fcurves[0].solo, false, '§15.c untouched');
}

// ── §16 — applyDopesheetChannelSolo 'hovered' flips OFF→ON ──────────────
{
  const act = makeAction([makeFc('fcA'), makeFc('fcB')]);
  const r = applyDopesheetChannelSolo(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(r.changed, true,   '§16.a changed=true');
  eq(r.kind, 'hovered', '§16.b kind');
  eq(r.mode, 'enable',  '§16.c mode=enable');
  eq(act.fcurves[0].solo, false, '§16.d fcA untouched');
  eq(act.fcurves[1].solo, true,  '§16.e fcB soloed');
}

// ── §17 — applyDopesheetChannelSolo 'hovered' flips ON→OFF ──────────────
{
  const act = makeAction([makeFc('fcA'), makeFc('fcB', { solo: true })]);
  const r = applyDopesheetChannelSolo(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(r.mode, 'disable', '§17.a mode=disable');
  eq(act.fcurves[1].solo, false, '§17.b fcB un-soloed');
}

// ── §18 — applyDopesheetChannelSolo 'hovered' stale → no-op ─────────────
{
  const act = makeAction([makeFc('fcA')]);
  const r = applyDopesheetChannelSolo(act, { kind: 'hovered', fcurveId: 'ghost' });
  eq(r.changed, false, '§18.a stale → no-op');
  eq(r.mode, null,     '§18.b mode=null');
}

// ── §19 — applyDopesheetChannelSolo 'selection' scan-first all-off ──────
{
  const act = makeAction([
    makeFc('fcA', { selected: true }),
    makeFc('fcB', { selected: true }),
    makeFc('fcC'),  // unselected
  ]);
  const r = applyDopesheetChannelSolo(act, { kind: 'selection' });
  eq(r.mode, 'enable', '§19.a none soloed → enable');
  eq(act.fcurves[0].solo, true,  '§19.b fcA soloed');
  eq(act.fcurves[1].solo, true,  '§19.c fcB soloed');
  eq(act.fcurves[2].solo, false, '§19.d fcC unselected untouched');
}

// ── §20 — applyDopesheetChannelSolo 'selection' uniform → flips all ─────
{
  const act = makeAction([
    makeFc('fcA', { selected: true, solo: true }),
    makeFc('fcB', { selected: true, solo: true }),
  ]);
  const r = applyDopesheetChannelSolo(act, { kind: 'selection' });
  eq(r.mode, 'disable', '§20.a all soloed → disable');
  eq(act.fcurves[0].solo, false, '§20.b fcA un-soloed');
  eq(act.fcurves[1].solo, false, '§20.c fcB un-soloed');
}

// ── §21 — applyDopesheetChannelSolo 'selection' mixed → all off ─────────
{
  const act = makeAction([
    makeFc('fcA', { selected: true, solo: true }),
    makeFc('fcB', { selected: true, solo: false }),
  ]);
  const r = applyDopesheetChannelSolo(act, { kind: 'selection' });
  eq(r.mode, 'disable', '§21.a mixed → disable');
  eq(act.fcurves[0].solo, false, '§21.b fcA flipped');
  eq(act.fcurves[1].solo, false, '§21.c fcB stayed off');
}

// ── §22 — applyDopesheetChannelSolo 'selection' no selected → no-op ─────
{
  const act = makeAction([makeFc('fcA')]);
  const r = applyDopesheetChannelSolo(act, { kind: 'selection' });
  eq(r.changed, false, '§22 no-op');
}

// ── §23 — applyDopesheetChannelSolo 'hovered' isolation ─────────────────
{
  const act = makeAction([
    makeFc('fcA', { solo: true }),
    makeFc('fcB'),
    makeFc('fcC', { solo: true }),
  ]);
  applyDopesheetChannelSolo(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(act.fcurves[0].solo, true,  '§23.a fcA untouched');
  eq(act.fcurves[1].solo, true,  '§23.b fcB now solo');
  eq(act.fcurves[2].solo, true,  '§23.c fcC untouched');
}

// ── §24 — applyDopesheetChannelSolo 'selection' doesnt touch unselected ─
{
  const act = makeAction([
    makeFc('fcSel', { selected: true }),
    makeFc('fcUnselA'),
    makeFc('fcUnselB', { solo: true }),
  ]);
  applyDopesheetChannelSolo(act, { kind: 'selection' });
  eq(act.fcurves[0].solo, true,  '§24.a fcSel soloed');
  eq(act.fcurves[1].solo, false, '§24.b fcUnselA untouched');
  eq(act.fcurves[2].solo, true,  '§24.c fcUnselB still soloed');
}

// ── §25 — Rule №1 throws on non-array fcurves ───────────────────────────
throws(
  () => applyDopesheetChannelSolo({ fcurves: null }, { kind: 'hovered', fcurveId: 'fc1' }),
  /action\.fcurves must be an array/,
  '§25 non-array fcurves throws',
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
