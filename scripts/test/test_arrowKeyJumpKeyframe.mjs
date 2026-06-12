// Regression for Up/Down arrow → prev/next keyframe jumps
// (2026-06-12, Phase 4 paint-fidelity follow-up — Animation editors
// audit). Sibling to LeftArrow/RightArrow frame-step shipped in
// db1bd15.
//
// Bug class: Blender's space_time / space_action / space_graph bind
// UpArrow/DownArrow to "jump to next/prev keyframe" (content-aware
// navigation across the active action's fcurves). SS had no binding —
// users had to drag the playhead or scrub key-by-key with
// LeftArrow/RightArrow.
//
// Fix: 2 new operators time.jumpToNextKeyframe + time.jumpToPrevKeyframe.
// Both walk the active action's fcurves, collect every keyform's
// .time (ms — matches applyKeyingSet's documented contract), find the
// smallest > currentTime (next) or largest < currentTime (prev).
// At the boundary (no keyforms in target direction) the operator
// silently no-ops — matches Blender.
//
// All four arrow-key operators share the `animationHoverGate()` —
// fire only when hovering timeline / dopesheet / fcurve.
//
// Run: node scripts/test/test_arrowKeyJumpKeyframe.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — collectAllKeyframeTimesMs ──────────────────────────────────

function collectAllKeyframeTimesMs(action) {
  if (!action || !Array.isArray(action.fcurves)) return [];
  const times = [];
  for (const fc of action.fcurves) {
    if (!Array.isArray(fc?.keyforms)) continue;
    for (const k of fc.keyforms) {
      if (typeof k?.time === 'number' && Number.isFinite(k.time)) {
        times.push(k.time);
      }
    }
  }
  return times;
}

{
  const action = {
    fcurves: [
      { keyforms: [{ time: 0 }, { time: 1000 }, { time: 2000 }] },
      { keyforms: [{ time: 500 }, { time: 1500 }] },
    ],
  };
  const times = collectAllKeyframeTimesMs(action);
  ok(times.length === 5, '§1 — collects all keyform times across fcurves');
  ok(times.includes(0) && times.includes(500) && times.includes(1000)
    && times.includes(1500) && times.includes(2000),
    '§1 — every time present');
}

{
  ok(collectAllKeyframeTimesMs(null).length === 0, '§1 — null action → empty');
  ok(collectAllKeyframeTimesMs({}).length === 0, '§1 — no fcurves → empty');
  ok(collectAllKeyframeTimesMs({ fcurves: [] }).length === 0, '§1 — empty fcurves → empty');
}

{
  // Defensive: drop non-finite / wrong-typed times
  const action = {
    fcurves: [
      { keyforms: [{ time: 100 }, { time: NaN }, { time: 'bad' }, { time: undefined }] },
      { keyforms: [{ /* no time */ }] },
    ],
  };
  const times = collectAllKeyframeTimesMs(action);
  ok(times.length === 1 && times[0] === 100,
    '§1 — only finite-number times included (NaN, string, missing dropped)');
}

// ── §2 — jumpToNextKeyframe math ────────────────────────────────────

function jumpNext(curMs, times) {
  let best = Infinity;
  for (const t of times) {
    if (t > curMs && t < best) best = t;
  }
  return Number.isFinite(best) ? best : null;
}

ok(jumpNext(0, [0, 1000, 2000]) === 1000,
  '§2 — currentTime=0 (on first keyframe) → next is 1000ms');
ok(jumpNext(500, [0, 1000, 2000]) === 1000,
  '§2 — currentTime=500 (between keyframes) → next is 1000ms');
ok(jumpNext(1000, [0, 1000, 2000]) === 2000,
  '§2 — currentTime=1000 (ON keyframe) → next is 2000ms (STRICTLY greater)');
ok(jumpNext(2000, [0, 1000, 2000]) === null,
  '§2 — currentTime=2000 (on last keyframe) → null (no-op at boundary)');
ok(jumpNext(3000, [0, 1000, 2000]) === null,
  '§2 — currentTime past last keyframe → null');

// Out-of-order times don't matter — we scan all
ok(jumpNext(0, [2000, 500, 1500, 1000]) === 500,
  '§2 — out-of-order times: still finds smallest > current');

// ── §3 — jumpToPrevKeyframe math ────────────────────────────────────

function jumpPrev(curMs, times) {
  let best = -Infinity;
  for (const t of times) {
    if (t < curMs && t > best) best = t;
  }
  return Number.isFinite(best) ? best : null;
}

ok(jumpPrev(2000, [0, 1000, 2000]) === 1000,
  '§3 — currentTime=2000 (on last) → prev is 1000ms');
ok(jumpPrev(1500, [0, 1000, 2000]) === 1000,
  '§3 — currentTime=1500 (between) → prev is 1000ms');
ok(jumpPrev(1000, [0, 1000, 2000]) === 0,
  '§3 — currentTime=1000 (ON keyframe) → prev is 0ms (STRICTLY less)');
ok(jumpPrev(0, [0, 1000, 2000]) === null,
  '§3 — currentTime=0 (on first) → null (no-op at boundary)');
ok(jumpPrev(-500, [0, 1000, 2000]) === null,
  '§3 — currentTime before first → null');

ok(jumpPrev(2000, [1500, 500, 1000, 2000]) === 1500,
  '§3 — out-of-order times: finds largest < current');

// ── §4 — boundary conditions ────────────────────────────────────────

ok(jumpNext(500, []) === null, '§4 — empty action: jumpNext → null');
ok(jumpPrev(500, []) === null, '§4 — empty action: jumpPrev → null');
ok(jumpNext(500, [500]) === null,
  '§4 — single keyframe at current → next null');
ok(jumpPrev(500, [500]) === null,
  '§4 — single keyframe at current → prev null');
ok(jumpNext(0, [500]) === 500, '§4 — single keyframe after current → next');
ok(jumpPrev(1000, [500]) === 500, '§4 — single keyframe before current → prev');

// ── §5 — dedup not required: 2 fcurves can share a keyframe time ───
//
// E.g. user inserts keys on ParamAngleX and ParamAngleY at the same
// frame — both fcurves have .time=1000. The jump-walker should still
// find 1000 once (because we're tracking "smallest > current", not
// counting occurrences).

{
  // ParamX has keys at [0, 1000, 2000]; ParamY has keys at [500, 1000, 1500]
  const times = [0, 1000, 2000, 500, 1000, 1500];
  ok(jumpNext(750, times) === 1000,
    '§5 — duplicate 1000 across fcurves still resolves to 1000');
  ok(jumpPrev(1250, times) === 1000,
    '§5 — duplicate 1000 reverse direction');
}

// ── §6 — full bidirectional walk parity ─────────────────────────────
//
// If you go to position X, jumpNext gives time T, then jumpPrev from
// T gives back time ≤ X (the largest time < T). Lock the invariant.

{
  const times = [0, 1000, 2000, 3000];
  const start = 500;
  const t1 = jumpNext(start, times);
  ok(t1 === 1000, '§6 — jumpNext(500) = 1000');
  const t2 = jumpPrev(t1, times);
  ok(t2 === 0, '§6 — jumpPrev(1000) = 0 (largest < 1000)');
  // NOT 500 — 500 wasn't a keyframe, so jumpPrev can't return it.
  // This is correct: arrow-key navigation lands ON keyframes, doesn't
  // round-trip to interpolated times.
}

// ── §7 — keymap dispatch table ──────────────────────────────────────
//
// All four arrow chords share the animationHoverGate. UpArrow/DownArrow
// are sister chords to LeftArrow/RightArrow (frame step), Shift+
// modifies them all consistently.

const KEYMAP = {
  'ArrowLeft':        'time.stepFrame.backward',
  'ArrowRight':       'time.stepFrame.forward',
  'Shift+ArrowLeft':  'time.jumpToStart',
  'Shift+ArrowRight': 'time.jumpToEnd',
  'ArrowDown':        'time.jumpToPrevKeyframe',  // NEW
  'ArrowUp':          'time.jumpToNextKeyframe',  // NEW
};

ok(KEYMAP['ArrowDown'] === 'time.jumpToPrevKeyframe', '§7 — Down → prev keyframe');
ok(KEYMAP['ArrowUp'] === 'time.jumpToNextKeyframe', '§7 — Up → next keyframe');
ok(Object.keys(KEYMAP).filter((k) => k.startsWith('Arrow')).length === 4,
  '§7 — all 4 bare arrow chords bound (Left/Right step + Up/Down jump)');

console.log(`arrowKeyJumpKeyframe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
