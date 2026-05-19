// Tests for src/anim/dopesheetClipboard.js — Animation Phase 6 Slice 6.E.
// Run: node scripts/test/test_dopesheetClipboard.mjs
//
// Coverage:
//   §1  — wouldCopyChange false on null/empty/center-less
//   §2  — wouldCopyChange true on real selection
//   §3  — wouldPasteChange false when clipboard empty
//   §4  — wouldPasteChange false when no destination matches
//   §5  — wouldPasteChange true when at least one destination matches
//   §6  — copyKeyformsToClipboard Rule №1 input validation throws
//   §7  — copyKeyformsToClipboard no-op when handles empty (resets clipboard)
//   §8  — copyKeyformsToClipboard skips fcurve with no center bits
//   §9  — copyKeyformsToClipboard captures single selected keyform
//   §10 — copyKeyformsToClipboard captures firstTime/lastTime across fcurves
//   §11 — copyKeyformsToClipboard records originTime verbatim
//   §12 — copyKeyformsToClipboard deep-copies handles (mutation isolation)
//   §13 — copyKeyformsToClipboard skips OOB keyform indices
//   §14 — copyKeyformsToClipboard handles-only selection (no center) → empty
//   §15 — copyKeyformsToClipboard RESETS clipboard pre-fill (no leak from prior copy)
//   §16 — pasteKeyformsFromClipboard Rule №1 input validation throws
//   §17 — pasteKeyformsFromClipboard no-op when clipboard empty
//   §18 — pasteKeyformsFromClipboard no-op when no destination matches
//   §19 — pasteKeyformsFromClipboard inserts at CFRA_START offset (DEV 13)
//   §20 — pasteKeyformsFromClipboard overwrites same-time destination keys
//   §21 — pasteKeyformsFromClipboard preserves other destination keys
//   §22 — pasteKeyformsFromClipboard sorts merged keyforms by time
//   §23 — pasteKeyformsFromClipboard shifts handle times by offset
//   §24 — pasteKeyformsFromClipboard newSelections indexes new positions
//   §25 — pasteKeyformsFromClipboard recalcs handles (auto-handles settled)
//   §26 — pasteKeyformsFromClipboard multi-fcurve cross-action match
//   §27 — Round-trip: copy → paste at different time → originals untouched
//   §28 — Round-trip: copy → resetClipboard → paste no-ops
//   §29 — handlesFromPasteResult: returns all-parts-on selection map
//   §30 — handlesFromPasteResult: empty input → empty output
//   §31 — Audit-fix LOW-1: getClipboard returns frozen wrapper (push throws in strict mode)
//   §32 — Audit-fix LOW-1: frozen-read doesn't break subsequent paste path

import {
  getClipboard,
  resetClipboard,
  copyKeyformsToClipboard,
  pasteKeyformsFromClipboard,
  wouldCopyChange,
  wouldPasteChange,
  handlesFromPasteResult,
} from '../../src/anim/dopesheetClipboard.js';

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
function near(a, b, name, eps = 1e-6) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${a}\n   expected: ${b} (±${eps})`);
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
function makeKf(time, value, opts = {}) {
  return {
    time, value,
    handleLeft:  opts.handleLeft  ?? { time: time - 100, value },
    handleRight: opts.handleRight ?? { time: time + 100, value },
    handleType:  { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  };
}
function makeFc(id, kfs) {
  return { id, keyforms: kfs, fcurveType: 'rna' };
}
function makeAction(fcs) {
  return { id: 'a1', name: 'a1', fcurves: fcs, duration: 5000 };
}
function makeHandles(entries) {
  const m = new Map();
  for (const [fcid, inner] of entries) {
    const sub = new Map();
    for (const [idx, parts] of inner) sub.set(idx, parts);
    m.set(fcid, sub);
  }
  return m;
}
const ALL_ON = { center: true, left: true, right: true };
const CENTER_ONLY = { center: true, left: false, right: false };
const HANDLES_ONLY = { center: false, left: true, right: true };

// Reset between sections so prior fills don't leak.
function freshState() {
  resetClipboard();
}

// ── §1 — wouldCopyChange false on null/empty/center-less ────────────────
freshState();
eq(wouldCopyChange(null),          false, '§1.a wouldCopyChange null');
eq(wouldCopyChange(undefined),     false, '§1.b wouldCopyChange undefined');
eq(wouldCopyChange(new Map()),     false, '§1.c wouldCopyChange empty Map');
eq(wouldCopyChange(makeHandles([['fc', [[0, HANDLES_ONLY]]]])), false,
   '§1.d wouldCopyChange center-less selection');

// ── §2 — wouldCopyChange true on real selection ─────────────────────────
eq(wouldCopyChange(makeHandles([['fc', [[0, ALL_ON]]]])), true,
   '§2.a wouldCopyChange all parts on');
eq(wouldCopyChange(makeHandles([['fc', [[0, CENTER_ONLY]]]])), true,
   '§2.b wouldCopyChange center-only');

// ── §3 — wouldPasteChange false when clipboard empty ────────────────────
freshState();
const act3 = makeAction([makeFc('fc1', [makeKf(1000, 0.5)])]);
eq(wouldPasteChange(act3), false, '§3 wouldPasteChange empty clipboard');

// ── §4 — wouldPasteChange false when no destination matches ─────────────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('srcA', [makeKf(500, 0.1)])]),
  makeHandles([['srcA', [[0, ALL_ON]]]]),
  600,
);
const act4 = makeAction([makeFc('dstB', [makeKf(1000, 0.2)])]);
eq(wouldPasteChange(act4), false, '§4 wouldPasteChange no id match');

// ── §5 — wouldPasteChange true when at least one destination matches ────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('shared', [makeKf(500, 0.1)])]),
  makeHandles([['shared', [[0, ALL_ON]]]]),
  600,
);
const act5 = makeAction([
  makeFc('other',  [makeKf(1000, 0.2)]),
  makeFc('shared', [makeKf(2000, 0.3)]),
]);
eq(wouldPasteChange(act5), true, '§5 wouldPasteChange id match present');

// ── §6 — copyKeyformsToClipboard Rule №1 input validation throws ────────
freshState();
throws(() => copyKeyformsToClipboard(null, new Map(), 100),
       /action must be a non-null object/, '§6.a copy null action throws');
throws(() => copyKeyformsToClipboard({ fcurves: null }, new Map(), 100),
       /action\.fcurves must be an array/, '§6.b copy non-array fcurves throws');
throws(() => copyKeyformsToClipboard(makeAction([]), new Map(), NaN),
       /originTime must be a finite number/, '§6.c copy NaN originTime throws');
throws(() => copyKeyformsToClipboard(makeAction([]), new Map(), Infinity),
       /originTime must be a finite number/, '§6.d copy Infinity originTime throws');

// ── §7 — copyKeyformsToClipboard no-op when handles empty (resets clipboard) ──
freshState();
// First, plant something so we can verify the reset wipes it.
copyKeyformsToClipboard(
  makeAction([makeFc('fcX', [makeKf(100, 1)])]),
  makeHandles([['fcX', [[0, ALL_ON]]]]),
  0,
);
assert(getClipboard() !== null, '§7.a setup: clipboard primed');
const r7 = copyKeyformsToClipboard(makeAction([]), new Map(), 0);
eq(r7.changed, false, '§7.b copy empty handles changed=false');
eq(r7.buffer, null,   '§7.c copy empty handles buffer=null');
eq(getClipboard(), null, '§7.d copy empty handles RESET clipboard');

// ── §8 — copyKeyformsToClipboard skips fcurve with no center bits ───────
freshState();
const act8 = makeAction([
  makeFc('fc1', [makeKf(100, 1), makeKf(200, 2)]),
  makeFc('fc2', [makeKf(300, 3)]),
]);
const h8 = makeHandles([['fc1', [[0, HANDLES_ONLY], [1, HANDLES_ONLY]]]]);
const r8 = copyKeyformsToClipboard(act8, h8, 0);
eq(r8.changed, false, '§8 handles-only-fcurve → changed=false');
eq(getClipboard(), null, '§8 handles-only-fcurve → no clipboard');

// ── §9 — copyKeyformsToClipboard captures single selected keyform ───────
freshState();
const act9 = makeAction([makeFc('fc1', [makeKf(500, 0.5)])]);
const r9 = copyKeyformsToClipboard(act9, makeHandles([['fc1', [[0, ALL_ON]]]]), 999);
eq(r9.changed, true, '§9.a changed=true');
const buf9 = getClipboard();
assert(buf9 !== null, '§9.b clipboard populated');
eq(buf9.fcurves.length, 1, '§9.c single fcurve');
eq(buf9.fcurves[0].fcurveId, 'fc1', '§9.d fcurveId preserved');
eq(buf9.fcurves[0].entries.length, 1, '§9.e single entry');
eq(buf9.fcurves[0].entries[0].time, 500, '§9.f entry time copied');
eq(buf9.fcurves[0].entries[0].value, 0.5, '§9.g entry value copied');

// ── §10 — copyKeyformsToClipboard captures firstTime/lastTime across fcurves ──
freshState();
const act10 = makeAction([
  makeFc('fcA', [makeKf(700, 1), makeKf(900, 2)]),
  makeFc('fcB', [makeKf(100, 3), makeKf(1500, 4)]),
  makeFc('fcC', [makeKf(2000, 5)]),  // unselected — should NOT influence bounds
]);
const h10 = makeHandles([
  ['fcA', [[0, ALL_ON], [1, ALL_ON]]],
  ['fcB', [[0, ALL_ON], [1, ALL_ON]]],
]);
copyKeyformsToClipboard(act10, h10, 0);
const buf10 = getClipboard();
eq(buf10.firstTime, 100,  '§10.a firstTime = min copied (100)');
eq(buf10.lastTime,  1500, '§10.b lastTime  = max copied (1500)');

// ── §11 — copyKeyformsToClipboard records originTime verbatim ───────────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(500, 0.5)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  1234,
);
eq(getClipboard().originTime, 1234, '§11 originTime stored verbatim');

// ── §12 — copyKeyformsToClipboard deep-copies handles (mutation isolation) ──
freshState();
const sourceKf = makeKf(500, 0.5);
const act12 = makeAction([makeFc('fc1', [sourceKf])]);
copyKeyformsToClipboard(act12, makeHandles([['fc1', [[0, ALL_ON]]]]), 0);
const buf12 = getClipboard();
const copy12 = buf12.fcurves[0].entries[0];
// Mutate the SOURCE handle; the CLIPBOARD entry should NOT change.
sourceKf.handleLeft.time = -999;
sourceKf.handleLeft.value = -999;
eq(copy12.handleLeft.time,  400, '§12.a clipboard handleLeft.time isolated');
eq(copy12.handleLeft.value, 0.5, '§12.b clipboard handleLeft.value isolated');
assert(copy12 !== sourceKf, '§12.c clipboard entry is a distinct object');
assert(copy12.handleLeft !== sourceKf.handleLeft,
       '§12.d clipboard handleLeft is a distinct object');

// ── §13 — copyKeyformsToClipboard skips OOB keyform indices ─────────────
freshState();
const act13 = makeAction([makeFc('fc1', [makeKf(500, 0.5)])]);  // 1 keyform
const h13 = makeHandles([['fc1', [
  [0,  ALL_ON],     // in bounds
  [5,  ALL_ON],     // OOB — skip
  [-1, ALL_ON],     // negative — skip
]]]);
const r13 = copyKeyformsToClipboard(act13, h13, 0);
eq(r13.changed, true, '§13.a OOB siblings ignored, in-bounds copied');
eq(getClipboard().fcurves[0].entries.length, 1, '§13.b only in-bounds copied');

// ── §14 — copyKeyformsToClipboard handles-only selection (no center) → empty ──
freshState();
const act14 = makeAction([makeFc('fc1', [makeKf(500, 0.5)])]);
const r14 = copyKeyformsToClipboard(act14, makeHandles([['fc1', [[0, HANDLES_ONLY]]]]), 0);
eq(r14.changed, false, '§14.a handles-only → changed=false');
eq(getClipboard(), null, '§14.b handles-only → no clipboard');

// ── §15 — copyKeyformsToClipboard RESETS clipboard pre-fill ─────────────
freshState();
// First copy: clipboard has fcA only.
copyKeyformsToClipboard(
  makeAction([makeFc('fcA', [makeKf(100, 1)])]),
  makeHandles([['fcA', [[0, ALL_ON]]]]),
  0,
);
eq(getClipboard().fcurves.length, 1, '§15.a setup: clipboard has fcA');
// Second copy: ONLY fcB. fcA should be GONE (not lingering from prior copy).
copyKeyformsToClipboard(
  makeAction([makeFc('fcB', [makeKf(200, 2)])]),
  makeHandles([['fcB', [[0, ALL_ON]]]]),
  0,
);
eq(getClipboard().fcurves.length, 1, '§15.b second copy: only fcB');
eq(getClipboard().fcurves[0].fcurveId, 'fcB', '§15.c second copy: fcA gone');

// ── §16 — pasteKeyformsFromClipboard Rule №1 input validation throws ────
freshState();
throws(() => pasteKeyformsFromClipboard(null, 0),
       /action must be a non-null object/, '§16.a paste null action throws');
throws(() => pasteKeyformsFromClipboard({ fcurves: null }, 0),
       /action\.fcurves must be an array/, '§16.b paste non-array fcurves throws');
throws(() => pasteKeyformsFromClipboard(makeAction([]), NaN),
       /destinationTime must be a finite number/, '§16.c paste NaN destTime throws');
throws(() => pasteKeyformsFromClipboard(makeAction([]), Infinity),
       /destinationTime must be a finite number/, '§16.d paste Infinity destTime throws');

// ── §17 — pasteKeyformsFromClipboard no-op when clipboard empty ─────────
freshState();
const r17 = pasteKeyformsFromClipboard(makeAction([makeFc('fc1', [])]), 0);
eq(r17.changed, false, '§17.a empty clipboard → changed=false');
eq(r17.newSelections.size, 0, '§17.b empty clipboard → no selections');

// ── §18 — pasteKeyformsFromClipboard no-op when no destination matches ──
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('srcOnly', [makeKf(100, 1)])]),
  makeHandles([['srcOnly', [[0, ALL_ON]]]]),
  0,
);
const r18 = pasteKeyformsFromClipboard(makeAction([makeFc('otherId', [])]), 500);
eq(r18.changed, false, '§18.a no id match → changed=false');
eq(r18.newSelections.size, 0, '§18.b no id match → no selections');

// ── §19 — pasteKeyformsFromClipboard inserts at CFRA_START offset (DEV 13) ──
freshState();
// Copy a key at t=200 (firstTime=200).
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(200, 0.7)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
// Paste into an empty destination at t=1000 → expect entry at t=1000.
const dst19 = makeAction([makeFc('fc1', [])]);
const r19 = pasteKeyformsFromClipboard(dst19, 1000);
eq(r19.changed, true, '§19.a paste changed');
eq(dst19.fcurves[0].keyforms.length, 1, '§19.b single entry inserted');
eq(dst19.fcurves[0].keyforms[0].time, 1000, '§19.c entry at destinationTime');
eq(dst19.fcurves[0].keyforms[0].value, 0.7, '§19.d entry value preserved');

// ── §20 — pasteKeyformsFromClipboard overwrites same-time destination keys ──
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 0.9)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
// Destination has a key at t=500 (will collide with paste at offset 500-100=400 → t=500).
const dst20 = makeAction([makeFc('fc1', [makeKf(500, 0.1)])]);
pasteKeyformsFromClipboard(dst20, 500);
eq(dst20.fcurves[0].keyforms.length, 1, '§20.a same-time replaced (not duplicated)');
eq(dst20.fcurves[0].keyforms[0].value, 0.9, '§20.b incoming value wins on collision');

// ── §21 — pasteKeyformsFromClipboard preserves other destination keys ──
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 0.9)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
const dst21 = makeAction([makeFc('fc1', [
  makeKf(50,   0.05),
  makeKf(800,  0.8),
  makeKf(1200, 1.2),
])]);
pasteKeyformsFromClipboard(dst21, 500);  // inserts at t=500
eq(dst21.fcurves[0].keyforms.length, 4, '§21.a paste preserved 3 + added 1');
eq(dst21.fcurves[0].keyforms[0].time, 50,   '§21.b kf[0] preserved');
eq(dst21.fcurves[0].keyforms[1].time, 500,  '§21.c new entry sorted in');
eq(dst21.fcurves[0].keyforms[2].time, 800,  '§21.d kf[2] preserved');
eq(dst21.fcurves[0].keyforms[3].time, 1200, '§21.e kf[3] preserved');

// ── §22 — pasteKeyformsFromClipboard sorts merged keyforms by time ──────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 1), makeKf(200, 2), makeKf(300, 3)])]),
  makeHandles([['fc1', [[0, ALL_ON], [1, ALL_ON], [2, ALL_ON]]]]),
  0,
);
// Destination has keys at 50 + 600 (well outside paste range).
const dst22 = makeAction([makeFc('fc1', [makeKf(50, 0.5), makeKf(600, 6)])]);
// Paste at t=400. Offset = 400 - 100 (firstTime) = 300 → entries at 400/500/600.
// Note: t=600 collides; should overwrite.
pasteKeyformsFromClipboard(dst22, 400);
const sorted22 = dst22.fcurves[0].keyforms;
eq(sorted22.length, 4, '§22.a merged length: 50/400/500/600');
eq(sorted22[0].time, 50,  '§22.b sorted [0]');
eq(sorted22[1].time, 400, '§22.c sorted [1]');
eq(sorted22[2].time, 500, '§22.d sorted [2]');
eq(sorted22[3].time, 600, '§22.e sorted [3]');
// Last entry's value should be from PASTE (3), not original destination (6).
eq(sorted22[3].value, 3, '§22.f same-time replace overwrote dst value');

// ── §23 — pasteKeyformsFromClipboard shifts handle times by offset ──────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 1)])]),  // default handles: L@0, R@200
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
const dst23 = makeAction([makeFc('fc1', [])]);
pasteKeyformsFromClipboard(dst23, 1000);   // offset = 1000-100 = 900
const pasted23 = dst23.fcurves[0].keyforms[0];
eq(pasted23.time, 1000, '§23.a center time = 1000');
eq(pasted23.handleLeft.time,  900,  '§23.b handleLeft.time shifted (0 + 900)');
eq(pasted23.handleRight.time, 1100, '§23.c handleRight.time shifted (200 + 900)');

// ── §24 — pasteKeyformsFromClipboard newSelections indexes new positions ──
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 1), makeKf(200, 2)])]),
  makeHandles([['fc1', [[0, ALL_ON], [1, ALL_ON]]]]),
  0,
);
const dst24 = makeAction([makeFc('fc1', [
  makeKf(50,  0.5),
  makeKf(900, 9),
])]);
const r24 = pasteKeyformsFromClipboard(dst24, 500);  // offset = 400 → entries at 500, 600
const idxs24 = r24.newSelections.get('fc1');
assert(idxs24 !== undefined, '§24.a newSelections has fc1');
eq(idxs24.length, 2, '§24.b 2 new indices');
// Post-merge sorted order: 50, 500, 600, 900 → new entries at idx 1 and 2.
eq(idxs24[0], 1, '§24.c first paste at post-sort idx 1');
eq(idxs24[1], 2, '§24.d second paste at post-sort idx 2');

// ── §25 — pasteKeyformsFromClipboard recalcs handles (auto-handles settled) ──
freshState();
// Source has an AUTO-handle keyform (recalc should produce non-default handles).
const autoKf = { ...makeKf(100, 1.0), handleType: { left: 'auto', right: 'auto' } };
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [autoKf])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
const dst25 = makeAction([makeFc('fc1', [makeKf(0, 0), makeKf(2000, 2)])]);
pasteKeyformsFromClipboard(dst25, 1000);  // entry slots between two flank keyforms
// After recalc, the auto handles on the pasted entry should be neighbour-aware
// (auto-handle ≠ literal initial handleLeft/Right.time copied from source).
const pasted25 = dst25.fcurves[0].keyforms[1];
eq(pasted25.handleType.left,  'auto', '§25.a handleType preserved');
eq(pasted25.handleType.right, 'auto', '§25.b handleType preserved');
// Auto handle should sit between the neighbours, not be the cloned source
// values (cloned source had L@0, R@200; offset 900 → L@900, R@1100, but
// recalc resolves to the auto-handle smoothing solution). The acid test:
// handles are NOT the cloned-then-offset values (which would mean recalc
// silently failed). Allow either: (a) recalc moved them, (b) recalc kept
// them but only if the auto solver returned the same numbers — unlikely
// for a key between 0 and 2000.
const handleMoved = (
  pasted25.handleLeft.time !== 900 ||
  pasted25.handleRight.time !== 1100
);
assert(handleMoved, '§25.c recalcKeyformHandles ran (auto handles ≠ cloned)');

// ── §26 — pasteKeyformsFromClipboard multi-fcurve cross-action match ────
freshState();
copyKeyformsToClipboard(
  makeAction([
    makeFc('fcA', [makeKf(100, 1)]),
    makeFc('fcB', [makeKf(200, 2)]),
    makeFc('fcC', [makeKf(300, 3)]),  // src-only, NOT in destination
  ]),
  makeHandles([
    ['fcA', [[0, ALL_ON]]],
    ['fcB', [[0, ALL_ON]]],
    ['fcC', [[0, ALL_ON]]],
  ]),
  0,
);
// Destination has fcA + fcB but NOT fcC.
const dst26 = makeAction([makeFc('fcA', []), makeFc('fcB', [])]);
const r26 = pasteKeyformsFromClipboard(dst26, 1000);  // offset = 1000-100 = 900
eq(r26.changed, true, '§26.a multi-fcurve paste changed');
eq(r26.newSelections.size, 2, '§26.b only matched fcurves in selections');
eq(dst26.fcurves[0].keyforms[0].time, 1000, '§26.c fcA pasted at 100+900');
eq(dst26.fcurves[1].keyforms[0].time, 1100, '§26.d fcB pasted at 200+900');

// ── §27 — Round-trip: copy → paste at different time → originals untouched ──
freshState();
const srcAct27 = makeAction([makeFc('fc1', [makeKf(100, 0.5)])]);
copyKeyformsToClipboard(srcAct27, makeHandles([['fc1', [[0, ALL_ON]]]]), 0);
const dst27 = makeAction([makeFc('fc1', [])]);
pasteKeyformsFromClipboard(dst27, 2000);
// Original source action should be UNCHANGED (paste is destination-side).
eq(srcAct27.fcurves[0].keyforms[0].time, 100,
   '§27.a source action untouched after paste');
eq(srcAct27.fcurves[0].keyforms[0].value, 0.5,
   '§27.b source value untouched after paste');
// Mutate source AFTER paste — destination should still be the snapshot.
srcAct27.fcurves[0].keyforms[0].time = -999;
eq(dst27.fcurves[0].keyforms[0].time, 2000,
   '§27.c destination snapshot independent of source post-paste mutation');

// ── §28 — Round-trip: copy → resetClipboard → paste no-ops ──────────────
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 1)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
assert(getClipboard() !== null, '§28.a setup: clipboard primed');
resetClipboard();
eq(getClipboard(), null, '§28.b resetClipboard cleared');
const dst28 = makeAction([makeFc('fc1', [])]);
const r28 = pasteKeyformsFromClipboard(dst28, 500);
eq(r28.changed, false, '§28.c paste after reset → no-op');
eq(dst28.fcurves[0].keyforms.length, 0, '§28.d destination untouched');

// ── §29 — handlesFromPasteResult: returns all-parts-on selection map ────
{
  const newSel = new Map();
  newSel.set('fcA', [0, 2]);
  newSel.set('fcB', [5]);
  const handles = handlesFromPasteResult(newSel);
  eq(handles.size, 2, '§29.a 2 fcurves');
  const aSub = handles.get('fcA');
  eq(aSub.size, 2, '§29.b fcA has 2 indices');
  assert(aSub.get(0).center && aSub.get(0).left && aSub.get(0).right,
         '§29.c fcA[0] all parts on');
  assert(aSub.get(2).center && aSub.get(2).left && aSub.get(2).right,
         '§29.d fcA[2] all parts on');
  const bSub = handles.get('fcB');
  assert(bSub.get(5).center && bSub.get(5).left && bSub.get(5).right,
         '§29.e fcB[5] all parts on');
}

// ── §30 — handlesFromPasteResult: empty input → empty output ────────────
{
  eq(handlesFromPasteResult(new Map()).size, 0, '§30.a empty input → empty output');
  eq(handlesFromPasteResult(null).size,      0, '§30.b null input → empty output');
  eq(handlesFromPasteResult(undefined).size, 0, '§30.c undefined input → empty output');
  // Empty indices array should be skipped, not produce an empty sub-map.
  const onlyEmpty = new Map();
  onlyEmpty.set('fcA', []);
  eq(handlesFromPasteResult(onlyEmpty).size, 0,
     '§30.d fcurve with empty idx array → skipped');
}

// ── §31 — Audit-fix LOW-1: getClipboard returns frozen wrapper ──────────
// Pre-fix, getClipboard returned the live `_clipboard` ref; a caller
// could `.fcurves.push(...)` and silently corrupt subsequent pastes.
// Post-fix, the outer object + `fcurves` array + each per-fcurve object
// + each `entries` array are Object.freeze'd. Strict-mode (ESM is
// strict-by-default) makes the mutation attempts throw TypeErrors.
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(100, 1), makeKf(200, 2)])]),
  makeHandles([['fc1', [[0, ALL_ON], [1, ALL_ON]]]]),
  0,
);
{
  const buf31 = getClipboard();
  assert(Object.isFrozen(buf31),               '§31.a outer ClipboardBuffer is frozen');
  assert(Object.isFrozen(buf31.fcurves),       '§31.b fcurves array is frozen');
  assert(Object.isFrozen(buf31.fcurves[0]),    '§31.c per-fcurve obj is frozen');
  assert(Object.isFrozen(buf31.fcurves[0].entries),
                                               '§31.d entries array is frozen');
  // Mutation attempts throw in strict mode (.mjs is strict).
  let threwPush = false;
  try { buf31.fcurves.push({ fcurveId: 'evil', entries: [] }); }
  catch (e) { threwPush = e instanceof TypeError; }
  assert(threwPush, '§31.e fcurves.push throws TypeError in strict mode');
  let threwAssign = false;
  try { buf31.firstTime = -999; }
  catch (e) { threwAssign = e instanceof TypeError; }
  assert(threwAssign, '§31.f firstTime reassign throws TypeError in strict mode');
  let threwEntryPush = false;
  try { buf31.fcurves[0].entries.push(makeKf(999, 9)); }
  catch (e) { threwEntryPush = e instanceof TypeError; }
  assert(threwEntryPush, '§31.g entries.push throws TypeError in strict mode');
}

// ── §32 — Audit-fix LOW-1: frozen-read doesn't break subsequent paste ───
// The freeze only affects the EXTERNAL view (getClipboard result). The
// INTERNAL `_clipboard` is left mutable so `pasteKeyformsFromClipboard`
// can shallow-clone entries per-iteration without needing to unfreeze.
freshState();
copyKeyformsToClipboard(
  makeAction([makeFc('fc1', [makeKf(500, 0.7)])]),
  makeHandles([['fc1', [[0, ALL_ON]]]]),
  0,
);
// Read once (to make sure the frozen-wrapper-build doesn't disturb state).
const frozenView = getClipboard();
assert(Object.isFrozen(frozenView), '§32.a setup: clipboard returns frozen');
// Now paste — should work normally, since paste reads internal _clipboard
// directly (not via getClipboard).
const dst32 = makeAction([makeFc('fc1', [])]);
const r32 = pasteKeyformsFromClipboard(dst32, 1000);
eq(r32.changed, true, '§32.b paste still succeeds after frozen-read');
eq(dst32.fcurves[0].keyforms.length, 1, '§32.c entry inserted');
eq(dst32.fcurves[0].keyforms[0].time, 1000, '§32.d entry at destinationTime');
// And again — paste should be idempotent under repeat (clipboard wasn't
// drained by the read).
const dst32b = makeAction([makeFc('fc1', [])]);
pasteKeyformsFromClipboard(dst32b, 2000);
eq(dst32b.fcurves[0].keyforms[0].time, 2000, '§32.e paste repeatable');

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
