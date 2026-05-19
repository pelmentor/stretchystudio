// Tests for src/anim/dopesheetChannelMute.js — Animation Phase 6 Slice 6.F.1.
// Run: node scripts/test/test_dopesheetChannelMute.mjs
//
// Coverage:
//   §1  — pickMuteTarget: null/undefined action → 'none'
//   §2  — pickMuteTarget: non-array fcurves → 'none'
//   §3  — pickMuteTarget: empty hover, no selection → 'none'
//   §4  — pickMuteTarget: empty hover, with selection → 'selection'
//   §5  — pickMuteTarget: stale hover (id not in action) → falls back to selection
//   §6  — pickMuteTarget: stale hover + no selection → 'none'
//   §7  — pickMuteTarget: empty-string hover → falls through to selection
//   §8  — pickMuteTarget: real hover takes priority over selection (DEV 17)
//   §9  — pickMuteTarget: real hover, no selection → 'hovered'
//  §10 — wouldDopesheetChannelMuteChange: 'none' → false
//  §11 — wouldDopesheetChannelMuteChange: 'hovered' with valid id → true
//  §12 — wouldDopesheetChannelMuteChange: 'hovered' with stale id → false
//  §13 — wouldDopesheetChannelMuteChange: 'selection' with selected → true
//  §14 — wouldDopesheetChannelMuteChange: 'selection' but no selected → false
//  §15 — applyDopesheetChannelMute: 'none' → no-op
//  §16 — applyDopesheetChannelMute: 'hovered' flips an unmuted fc to muted
//  §17 — applyDopesheetChannelMute: 'hovered' flips a muted fc to unmuted
//  §18 — applyDopesheetChannelMute: 'hovered' with stale id → no-op (defensive)
//  §19 — applyDopesheetChannelMute: 'selection' bulk-toggles via scan-first
//  §20 — applyDopesheetChannelMute: 'selection' uniform → flips all
//  §21 — applyDopesheetChannelMute: 'selection' mixed → flips to majority off
//  §22 — applyDopesheetChannelMute: 'selection' no selected → no-op
//  §23 — applyDopesheetChannelMute: 'hovered' doesn't touch other fcurves
//  §24 — applyDopesheetChannelMute: 'selection' doesn't touch unselected
//  §25 — applyDopesheetChannelMute: throws Rule №1 on non-array fcurves

import {
  pickMuteTarget,
  wouldDopesheetChannelMuteChange,
  applyDopesheetChannelMute,
} from '../../src/anim/dopesheetChannelMute.js';

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
    console.error(`FAIL: ${name}\n   threw but message didn't match ${msgRe}: ${msg}`);
    return;
  }
  failed++; failures.push(name);
  console.error(`FAIL: ${name} — expected throw, got none`);
}

// ── helpers ─────────────────────────────────────────────────────────────
function makeFc(id, opts = {}) {
  return {
    id,
    mute:     opts.mute     === true,
    selected: opts.selected === true,
  };
}
function makeAction(fcs) {
  return { id: 'a1', name: 'a1', fcurves: fcs, duration: 5000 };
}

// ── §1 — pickMuteTarget: null/undefined action → 'none' ─────────────────
eq(pickMuteTarget(null, 'fc1').kind,      'none', '§1.a null action');
eq(pickMuteTarget(undefined, 'fc1').kind, 'none', '§1.b undefined action');

// ── §2 — pickMuteTarget: non-array fcurves → 'none' ─────────────────────
eq(pickMuteTarget({ fcurves: null }, 'fc1').kind, 'none', '§2.a null fcurves');
eq(pickMuteTarget({ fcurves: 5 }, 'fc1').kind,    'none', '§2.b number fcurves');

// ── §3 — pickMuteTarget: empty hover, no selection → 'none' ─────────────
eq(pickMuteTarget(makeAction([makeFc('fc1')]), null).kind,      'none', '§3.a null hover');
eq(pickMuteTarget(makeAction([makeFc('fc1')]), undefined).kind, 'none', '§3.b undefined hover');

// ── §4 — pickMuteTarget: empty hover, with selection → 'selection' ──────
eq(pickMuteTarget(makeAction([makeFc('fc1', { selected: true })]), null).kind,
   'selection', '§4 empty hover + selection');

// ── §5 — pickMuteTarget: stale hover (id not in action) → selection ─────
eq(pickMuteTarget(
  makeAction([makeFc('fc1', { selected: true })]),
  'ghost-id',
).kind, 'selection', '§5 stale hover → selection fallback');

// ── §6 — pickMuteTarget: stale hover + no selection → 'none' ────────────
eq(pickMuteTarget(makeAction([makeFc('fc1')]), 'ghost-id').kind,
   'none', '§6 stale hover + no selection');

// ── §7 — pickMuteTarget: empty-string hover → falls through to selection ─
eq(pickMuteTarget(
  makeAction([makeFc('fc1', { selected: true })]),
  '',
).kind, 'selection', '§7 empty-string hover collapses to no-hover');

// ── §8 — pickMuteTarget: real hover takes priority over selection (DEV 17) ──
{
  const t = pickMuteTarget(
    makeAction([makeFc('fcA', { selected: true }), makeFc('fcB', { selected: true }), makeFc('fcC')]),
    'fcC',
  );
  eq(t.kind, 'hovered', '§8.a hover wins over selection — kind');
  eq(t.fcurveId, 'fcC', '§8.b hover wins over selection — id');
}

// ── §9 — pickMuteTarget: real hover, no selection → 'hovered' ───────────
{
  const t = pickMuteTarget(makeAction([makeFc('fcA'), makeFc('fcB')]), 'fcB');
  eq(t.kind, 'hovered', '§9.a no-selection hover — kind');
  eq(t.fcurveId, 'fcB', '§9.b no-selection hover — id');
}

// ── §10 — wouldDopesheetChannelMuteChange: 'none' → false ───────────────
eq(wouldDopesheetChannelMuteChange(makeAction([]), { kind: 'none' }), false,
   '§10 none → false');

// ── §11 — wouldDopesheetChannelMuteChange: 'hovered' valid → true ───────
eq(wouldDopesheetChannelMuteChange(
  makeAction([makeFc('fc1')]),
  { kind: 'hovered', fcurveId: 'fc1' },
), true, '§11 hovered valid → true');

// ── §12 — wouldDopesheetChannelMuteChange: 'hovered' stale → false ──────
eq(wouldDopesheetChannelMuteChange(
  makeAction([makeFc('fc1')]),
  { kind: 'hovered', fcurveId: 'ghost' },
), false, '§12 hovered stale → false');

// ── §13 — wouldDopesheetChannelMuteChange: 'selection' with selected → true ──
eq(wouldDopesheetChannelMuteChange(
  makeAction([makeFc('fc1', { selected: true })]),
  { kind: 'selection' },
), true, '§13 selection has selected → true');

// ── §14 — wouldDopesheetChannelMuteChange: 'selection' but no selected → false ──
eq(wouldDopesheetChannelMuteChange(
  makeAction([makeFc('fc1')]),
  { kind: 'selection' },
), false, '§14 selection no selected → false');

// ── §15 — applyDopesheetChannelMute: 'none' → no-op ─────────────────────
{
  const act = makeAction([makeFc('fc1')]);
  const r = applyDopesheetChannelMute(act, { kind: 'none' });
  eq(r.changed, false, '§15.a changed=false');
  eq(r.kind, 'none',   '§15.b kind=none');
  eq(r.mode, null,     '§15.c mode=null');
  eq(act.fcurves[0].mute, false, '§15.d fc untouched');
}

// ── §16 — applyDopesheetChannelMute: 'hovered' flips unmuted → muted ────
{
  const act = makeAction([makeFc('fcA'), makeFc('fcB')]);
  const r = applyDopesheetChannelMute(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(r.changed, true,    '§16.a changed=true');
  eq(r.kind, 'hovered',  '§16.b kind=hovered');
  eq(r.mode, 'enable',   '§16.c mode=enable (was off, now on)');
  eq(act.fcurves[0].mute, false, '§16.d fcA untouched');
  eq(act.fcurves[1].mute, true,  '§16.e fcB muted');
}

// ── §17 — applyDopesheetChannelMute: 'hovered' flips muted → unmuted ────
{
  const act = makeAction([makeFc('fcA'), makeFc('fcB', { mute: true })]);
  const r = applyDopesheetChannelMute(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(r.changed, true,  '§17.a changed=true');
  eq(r.mode, 'disable','§17.b mode=disable (was on, now off)');
  eq(act.fcurves[1].mute, false, '§17.c fcB unmuted');
}

// ── §18 — applyDopesheetChannelMute: 'hovered' stale → no-op ────────────
{
  const act = makeAction([makeFc('fcA')]);
  const r = applyDopesheetChannelMute(act, { kind: 'hovered', fcurveId: 'ghost' });
  eq(r.changed, false, '§18.a stale hover changed=false');
  eq(r.kind, 'hovered','§18.b kind preserved');
  eq(r.mode, null,     '§18.c mode=null');
  eq(act.fcurves[0].mute, false, '§18.d untouched');
}

// ── §19 — applyDopesheetChannelMute: 'selection' bulk-toggles via scan-first ──
// Mirror the Blender setflag_anim_channels TOGGLE branch: scan first
// for any-currently-on; if found, ALL go off; else ALL go on.
{
  const act = makeAction([
    makeFc('fcA', { selected: true }),
    makeFc('fcB', { selected: true }),
    makeFc('fcC'),  // unselected
  ]);
  const r = applyDopesheetChannelMute(act, { kind: 'selection' });
  eq(r.changed, true,        '§19.a changed=true');
  eq(r.kind, 'selection',    '§19.b kind=selection');
  // Both selected were unmuted → enable (set all to muted).
  eq(r.mode, 'enable',       '§19.c mode=enable (none were on)');
  eq(act.fcurves[0].mute, true,  '§19.d fcA muted');
  eq(act.fcurves[1].mute, true,  '§19.e fcB muted');
  eq(act.fcurves[2].mute, false, '§19.f fcC untouched (unselected)');
}

// ── §20 — applyDopesheetChannelMute: 'selection' uniform → flips all ────
{
  const act = makeAction([
    makeFc('fcA', { selected: true, mute: true }),
    makeFc('fcB', { selected: true, mute: true }),
  ]);
  const r = applyDopesheetChannelMute(act, { kind: 'selection' });
  eq(r.mode, 'disable', '§20.a uniform-on → disable (all turn off)');
  eq(act.fcurves[0].mute, false, '§20.b fcA unmuted');
  eq(act.fcurves[1].mute, false, '§20.c fcB unmuted');
}

// ── §21 — applyDopesheetChannelMute: 'selection' mixed → all off ────────
// Mixed input: at least one ON → resolveToggleDirection returns 'disable'
// (ALL go off — including the ones already off).
{
  const act = makeAction([
    makeFc('fcA', { selected: true, mute: true }),
    makeFc('fcB', { selected: true, mute: false }),
  ]);
  const r = applyDopesheetChannelMute(act, { kind: 'selection' });
  eq(r.mode, 'disable', '§21.a mixed → disable (any-on triggers all-off)');
  eq(act.fcurves[0].mute, false, '§21.b fcA flipped on→off');
  eq(act.fcurves[1].mute, false, '§21.c fcB stayed off (already off)');
}

// ── §22 — applyDopesheetChannelMute: 'selection' no selected → no-op ────
{
  const act = makeAction([makeFc('fcA'), makeFc('fcB')]);
  const r = applyDopesheetChannelMute(act, { kind: 'selection' });
  eq(r.changed, false, '§22.a no selected → no-op');
  eq(r.mode, null,     '§22.b mode=null');
}

// ── §23 — applyDopesheetChannelMute: 'hovered' doesn't touch other fcurves ──
{
  const act = makeAction([
    makeFc('fcA', { mute: true }),
    makeFc('fcB'),
    makeFc('fcC', { mute: true }),
  ]);
  applyDopesheetChannelMute(act, { kind: 'hovered', fcurveId: 'fcB' });
  eq(act.fcurves[0].mute, true,  '§23.a fcA still muted (not target)');
  eq(act.fcurves[1].mute, true,  '§23.b fcB now muted');
  eq(act.fcurves[2].mute, true,  '§23.c fcC still muted (not target)');
}

// ── §24 — applyDopesheetChannelMute: 'selection' doesn't touch unselected ──
{
  const act = makeAction([
    makeFc('fcSel', { selected: true }),
    makeFc('fcUnsel-A'),
    makeFc('fcUnsel-B', { mute: true }),
  ]);
  applyDopesheetChannelMute(act, { kind: 'selection' });
  eq(act.fcurves[0].mute, true,  '§24.a fcSel muted');
  eq(act.fcurves[1].mute, false, '§24.b fcUnsel-A untouched');
  eq(act.fcurves[2].mute, true,  '§24.c fcUnsel-B still muted (untouched)');
}

// ── §25 — applyDopesheetChannelMute: throws Rule №1 on non-array fcurves ──
throws(
  () => applyDopesheetChannelMute({ fcurves: null }, { kind: 'hovered', fcurveId: 'fc1' }),
  /action\.fcurves must be an array/,
  '§25 non-array fcurves throws',
);

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
