// Tests for src/anim/fcurveSolo.js — Animation Phase 6 Slice 6.F.2.
// Run: node scripts/test/test_fcurveSolo.mjs
//
// Coverage:
//   §1  — isFCurveSoloed: null/undefined → false
//   §2  — isFCurveSoloed: strict === true (defensive against truthy)
//   §3  — isAnyFCurveSoloed: null/empty action → false
//   §4  — isAnyFCurveSoloed: no solo'd fcurves → false
//   §5  — isAnyFCurveSoloed: at least one solo'd → true
//   §6  — toggleFCurveSolo: missing action / fcurveId → no-op
//   §7  — toggleFCurveSolo: flips false → true
//   §8  — toggleFCurveSolo: flips true → false
//   §9  — toggleFCurveSolo: returns soloNow value
//   §10 — applyChannelSoloSelected: invalid mode → no-op
//   §11 — applyChannelSoloSelected: no selected → no-op
//   §12 — applyChannelSoloSelected: 'enable' sets all selected to solo
//   §13 — applyChannelSoloSelected: 'disable' clears all selected
//   §14 — applyChannelSoloSelected: 'enable' is idempotent on already-soloed
//   §15 — applyChannelSoloSelected: TOGGLE scan-first — all-off → enable
//   §16 — applyChannelSoloSelected: TOGGLE scan-first — any-on → disable
//   §17 — applyChannelSoloSelected: TOGGLE scan-first — mixed → disable
//   §18 — applyChannelSoloSelected: doesn't touch unselected fcurves
//   §19 — applyChannelSoloSelected: returns {changed, soloedCount, unsoloedCount, resolvedMode}
//   §20 — wouldChannelSoloSelectedChange: invalid mode → false
//   §21 — wouldChannelSoloSelectedChange: no selected → false
//   §22 — wouldChannelSoloSelectedChange: TOGGLE w/ selected → true
//   §23 — wouldChannelSoloSelectedChange: 'enable' idempotent → false
//   §24 — wouldChannelSoloSelectedChange: 'disable' on all-off → false

import {
  isFCurveSoloed,
  isAnyFCurveSoloed,
  toggleFCurveSolo,
  applyChannelSoloSelected,
  wouldChannelSoloSelectedChange,
} from '../../src/anim/fcurveSolo.js';

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

// ── §1 — isFCurveSoloed null/undefined ─────────────────────────────────
eq(isFCurveSoloed(null),      false, '§1.a null → false');
eq(isFCurveSoloed(undefined), false, '§1.b undefined → false');
eq(isFCurveSoloed({}),        false, '§1.c missing solo → false');

// ── §2 — isFCurveSoloed strict === true ────────────────────────────────
eq(isFCurveSoloed({ solo: true }),    true,  '§2.a true → true');
eq(isFCurveSoloed({ solo: false }),   false, '§2.b false → false');
eq(isFCurveSoloed({ solo: 1 }),       false, '§2.c truthy 1 → false (strict)');
eq(isFCurveSoloed({ solo: 'yes' }),   false, '§2.d truthy string → false (strict)');
eq(isFCurveSoloed({ solo: undefined }), false, '§2.e undefined → false');

// ── §3 — isAnyFCurveSoloed null/empty ──────────────────────────────────
eq(isAnyFCurveSoloed(null),      false, '§3.a null action');
eq(isAnyFCurveSoloed(undefined), false, '§3.b undefined action');
eq(isAnyFCurveSoloed({ fcurves: [] }), false, '§3.c empty fcurves');
eq(isAnyFCurveSoloed({ fcurves: null }), false, '§3.d non-array fcurves');

// ── §4 — isAnyFCurveSoloed no solo'd → false ───────────────────────────
eq(isAnyFCurveSoloed(makeAction([makeFc('a'), makeFc('b'), makeFc('c')])),
   false, '§4 no soloed → false');

// ── §5 — isAnyFCurveSoloed at least one solo'd → true ──────────────────
eq(isAnyFCurveSoloed(makeAction([
  makeFc('a'),
  makeFc('b', { solo: true }),
  makeFc('c'),
])), true, '§5.a one soloed → true');
eq(isAnyFCurveSoloed(makeAction([
  makeFc('a', { solo: true }),
  makeFc('b', { solo: true }),
])), true, '§5.b all soloed → true (multi-solo)');

// ── §6 — toggleFCurveSolo no-op on bad input ───────────────────────────
eq(toggleFCurveSolo(null, 'fc1').soloNow, false, '§6.a null action');
eq(toggleFCurveSolo({ fcurves: null }, 'fc1').soloNow, false, '§6.b non-array fcurves');
eq(toggleFCurveSolo(makeAction([makeFc('a')]), 'ghost').soloNow, false, '§6.c missing fcurveId');

// ── §7 — toggleFCurveSolo flips false → true ───────────────────────────
{
  const act = makeAction([makeFc('a'), makeFc('b')]);
  const r = toggleFCurveSolo(act, 'b');
  eq(r.soloNow, true, '§7.a soloNow=true');
  eq(act.fcurves[1].solo, true, '§7.b fc.solo set');
  eq(act.fcurves[0].solo, false, '§7.c sibling untouched');
}

// ── §8 — toggleFCurveSolo flips true → false ───────────────────────────
{
  const act = makeAction([makeFc('a', { solo: true })]);
  const r = toggleFCurveSolo(act, 'a');
  eq(r.soloNow, false, '§8.a soloNow=false');
  eq(act.fcurves[0].solo, false, '§8.b fc.solo cleared');
}

// ── §9 — toggleFCurveSolo returns soloNow ──────────────────────────────
{
  const act = makeAction([makeFc('a')]);
  eq(toggleFCurveSolo(act, 'a').soloNow, true,  '§9.a first toggle → true');
  eq(toggleFCurveSolo(act, 'a').soloNow, false, '§9.b second toggle → false');
}

// ── §10 — applyChannelSoloSelected invalid mode ────────────────────────
{
  const act = makeAction([makeFc('a', { selected: true })]);
  eq(applyChannelSoloSelected(act, /** @type {any} */ ('bogus')).changed, false,
     '§10 invalid mode → no-op');
}

// ── §11 — applyChannelSoloSelected no selected → no-op ─────────────────
{
  const act = makeAction([makeFc('a'), makeFc('b')]);
  const r = applyChannelSoloSelected(act, 'toggle');
  eq(r.changed, false, '§11.a no selected → changed=false');
  eq(r.resolvedMode, null, '§11.b resolvedMode=null');
}

// ── §12 — 'enable' sets all selected ───────────────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true }),
    makeFc('b', { selected: true }),
    makeFc('c'),
  ]);
  const r = applyChannelSoloSelected(act, 'enable');
  eq(r.changed, true, '§12.a changed=true');
  eq(r.resolvedMode, 'enable', '§12.b resolvedMode=enable');
  eq(act.fcurves[0].solo, true,  '§12.c a soloed');
  eq(act.fcurves[1].solo, true,  '§12.d b soloed');
  eq(act.fcurves[2].solo, false, '§12.e c untouched (unselected)');
}

// ── §13 — 'disable' clears all selected ────────────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true, solo: true }),
    makeFc('b', { selected: true, solo: true }),
  ]);
  const r = applyChannelSoloSelected(act, 'disable');
  eq(r.resolvedMode, 'disable', '§13.a mode=disable');
  eq(act.fcurves[0].solo, false, '§13.b a un-soloed');
  eq(act.fcurves[1].solo, false, '§13.c b un-soloed');
}

// ── §14 — 'enable' idempotent on already-soloed ────────────────────────
{
  const act = makeAction([makeFc('a', { selected: true, solo: true })]);
  const r = applyChannelSoloSelected(act, 'enable');
  eq(r.changed, false, '§14.a no flag flips → changed=false');
  eq(act.fcurves[0].solo, true, '§14.b still soloed');
}

// ── §15 — TOGGLE scan-first all-off → enable ───────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true }),
    makeFc('b', { selected: true }),
  ]);
  const r = applyChannelSoloSelected(act, 'toggle');
  eq(r.resolvedMode, 'enable', '§15.a all-off → enable');
  eq(act.fcurves[0].solo, true, '§15.b a soloed');
  eq(act.fcurves[1].solo, true, '§15.c b soloed');
}

// ── §16 — TOGGLE scan-first any-on → disable ───────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true, solo: true }),
    makeFc('b', { selected: true, solo: true }),
  ]);
  const r = applyChannelSoloSelected(act, 'toggle');
  eq(r.resolvedMode, 'disable', '§16.a all-on → disable');
  eq(act.fcurves[0].solo, false, '§16.b a un-soloed');
  eq(act.fcurves[1].solo, false, '§16.c b un-soloed');
}

// ── §17 — TOGGLE scan-first mixed → disable ────────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true, solo: true }),
    makeFc('b', { selected: true, solo: false }),
  ]);
  const r = applyChannelSoloSelected(act, 'toggle');
  eq(r.resolvedMode, 'disable', '§17.a mixed → disable (any-on triggers all-off)');
  eq(act.fcurves[0].solo, false, '§17.b a flipped on→off');
  eq(act.fcurves[1].solo, false, '§17.c b stayed off');
}

// ── §18 — doesn't touch unselected ─────────────────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true }),
    makeFc('b', { solo: true }),         // unselected, solo'd
    makeFc('c'),                          // unselected, unsoloed
  ]);
  applyChannelSoloSelected(act, 'enable');
  eq(act.fcurves[0].solo, true,  '§18.a selected → soloed');
  eq(act.fcurves[1].solo, true,  '§18.b unselected soloed → untouched (still solo)');
  eq(act.fcurves[2].solo, false, '§18.c unselected unsoloed → untouched');
}

// ── §19 — return shape ─────────────────────────────────────────────────
{
  const act = makeAction([
    makeFc('a', { selected: true }),
    makeFc('b', { selected: true, solo: true }),
    makeFc('c', { selected: true, solo: false }),
  ]);
  // Mixed → resolveToggleDirection returns 'disable' (b is on).
  // After: a=false, b=false, c=false. Only b flips on→off = 1 unsoloedCount.
  const r = applyChannelSoloSelected(act, 'toggle');
  eq(r.changed, true,         '§19.a changed=true');
  eq(r.resolvedMode, 'disable','§19.b mode=disable');
  eq(r.soloedCount, 0,        '§19.c no fcurves flipped off→on');
  eq(r.unsoloedCount, 1,      '§19.d one fcurve flipped on→off');
}

// ── §20 — wouldChange invalid mode ─────────────────────────────────────
eq(wouldChannelSoloSelectedChange(makeAction([]), /** @type {any} */ ('foo')), false,
   '§20 invalid mode → false');

// ── §21 — wouldChange no selected ──────────────────────────────────────
eq(wouldChannelSoloSelectedChange(makeAction([makeFc('a')]), 'toggle'), false,
   '§21 no selected → false');

// ── §22 — wouldChange TOGGLE w/ selected → true ────────────────────────
eq(wouldChannelSoloSelectedChange(
  makeAction([makeFc('a', { selected: true })]),
  'toggle',
), true, '§22 TOGGLE invariant: any selected → true');

// ── §23 — wouldChange 'enable' idempotent → false ──────────────────────
eq(wouldChannelSoloSelectedChange(
  makeAction([makeFc('a', { selected: true, solo: true })]),
  'enable',
), false, '§23 enable on already-on → false');

// ── §24 — wouldChange 'disable' on all-off → false ─────────────────────
eq(wouldChannelSoloSelectedChange(
  makeAction([makeFc('a', { selected: true })]),
  'disable',
), false, '§24 disable on already-off → false');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
