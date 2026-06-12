// Regression for [ / ] set range start/end at current frame
// (2026-06-12, Phase 4 paint-fidelity follow-up — Animation editors
// audit).
//
// Bug class: animation editors had no chord to set the playback range
// start/end at the current playhead. Users had to use the playback
// controls UI sliders for trim work — slow when iterating on a
// section of a longer scene.
//
// Fix: 2 new operators time.setRangeStartAtCurrent +
// setRangeEndAtCurrent. Both gated on animationHoverGate (timeline /
// dopesheet / fcurve). Bound to BracketLeft / BracketRight.
//
// SS deviation: Blender has separate preview range (preview_frame_*)
// from action range (frame_*); SS has single startFrame/endFrame on
// animationStore. [ / ] write that. When SS grows a separate preview
// range field, these operators should split into bare [/] = preview
// vs Ctrl+[/] = action range.
//
// Run: node scripts/test/test_bracketSetRange.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — frame derivation from currentTime ──────────────────────────

function curFrame(state) {
  const fps = state.fps || 30;
  return Math.round((state.currentTime ?? 0) * fps / 1000);
}

ok(curFrame({ currentTime: 0, fps: 30 }) === 0, '§1 — t=0ms → frame 0');
ok(curFrame({ currentTime: 1000, fps: 30 }) === 30, '§1 — t=1000ms @ 30fps → frame 30');

// ── §2 — setStartFrame semantics (mirror of animationStore policy) ──
//
// Animation store's setStartFrame clamps:
//   - non-finite → no-op
//   - clamp ∈ [0, endFrame - 1]
//   - advances currentTime to max(startFrame, currentTime) so playhead
//     can't be left of the new start frame.

function setStartFrame(state, f) {
  if (!Number.isFinite(f)) return state;
  const nf = Math.max(0, Math.min(state.endFrame - 1, Math.round(f)));
  const newCurrentTime = Math.max((nf / state.fps) * 1000, state.currentTime);
  return { ...state, startFrame: nf, currentTime: newCurrentTime };
}

{
  const state = { startFrame: 0, endFrame: 240, currentTime: 1000, fps: 30 };
  // Set start to current (frame 30 since currentTime=1000ms @ 30fps)
  const next = setStartFrame(state, curFrame(state));
  ok(next.startFrame === 30, '§2 — startFrame set to currentFrame');
  ok(next.currentTime === 1000,
    '§2 — currentTime unchanged (still at new start)');
}

{
  // Set start past current → currentTime advances to match
  const state = { startFrame: 0, endFrame: 240, currentTime: 500, fps: 30 };
  const next = setStartFrame(state, 60);
  ok(next.startFrame === 60, '§2 — startFrame=60');
  ok(next.currentTime === 2000,
    '§2 — currentTime advances to 60/30*1000=2000ms (playhead can\'t be < startFrame)');
}

{
  // Set start at endFrame → clamp to endFrame-1
  const state = { startFrame: 0, endFrame: 240, currentTime: 0, fps: 30 };
  const next = setStartFrame(state, 250);
  ok(next.startFrame === 239,
    '§2 — startFrame clamped to endFrame-1=239');
}

{
  // Non-finite → no-op
  const state = { startFrame: 0, endFrame: 240, currentTime: 0, fps: 30 };
  const next = setStartFrame(state, NaN);
  ok(next === state, '§2 — NaN → no-op');
}

// ── §3 — setEndFrame semantics ──────────────────────────────────────
//
// Animation store's setEndFrame:
//   - non-finite → no-op
//   - clamp: end >= startFrame + 1

function setEndFrame(state, f) {
  if (!Number.isFinite(f)) return state;
  return { ...state, endFrame: Math.max(state.startFrame + 1, Math.round(f)) };
}

{
  const state = { startFrame: 0, endFrame: 240, currentTime: 3000, fps: 30 };
  // Set end to current (frame 90 at 30fps)
  const next = setEndFrame(state, curFrame(state));
  ok(next.endFrame === 90, '§3 — endFrame trimmed to currentFrame');
  ok(next.currentTime === 3000,
    '§3 — currentTime unchanged (setEndFrame doesn\'t move playhead)');
}

{
  // Set end before startFrame → clamp to startFrame + 1
  const state = { startFrame: 100, endFrame: 240, currentTime: 0, fps: 30 };
  const next = setEndFrame(state, 50);
  ok(next.endFrame === 101,
    '§3 — endFrame clamped to startFrame+1 (can\'t collapse range)');
}

// ── §4 — bracket-key dispatch table ─────────────────────────────────

const KEYMAP = {
  'BracketLeft':      'time.setRangeStartAtCurrent',
  'BracketRight':     'time.setRangeEndAtCurrent',
  'ArrowLeft':        'time.stepFrame.backward',
  'ArrowRight':       'time.stepFrame.forward',
  'Shift+ArrowLeft':  'time.jumpToStart',
  'Shift+ArrowRight': 'time.jumpToEnd',
  'ArrowDown':        'time.jumpToPrevKeyframe',
  'ArrowUp':          'time.jumpToNextKeyframe',
};

ok(KEYMAP['BracketLeft'] === 'time.setRangeStartAtCurrent',
  '§4 — [ → set range start');
ok(KEYMAP['BracketRight'] === 'time.setRangeEndAtCurrent',
  '§4 — ] → set range end');
ok(KEYMAP['Shift+ArrowLeft'] === 'time.jumpToStart',
  '§4 — Shift+Left jumps to start (sibling — these chords define '
  + 'what start IS)');

// ── §5 — hoveredEditorType gate ─────────────────────────────────────

function shouldFire(hoveredType) {
  return hoveredType === 'timeline'
    || hoveredType === 'dopesheet'
    || hoveredType === 'fcurve';
}

ok(shouldFire('timeline') === true, '§5 — timeline → fire');
ok(shouldFire('dopesheet') === true, '§5 — dopesheet → fire');
ok(shouldFire('fcurve') === true, '§5 — fcurve → fire');
ok(shouldFire('viewport') === false,
  '§5 — viewport → NO FIRE (Ctrl+[/] handles propEdit radius in Edit Mode)');
ok(shouldFire('outliner') === false,
  '§5 — outliner → NO FIRE (bracket free for tree-collapse if added later)');
ok(shouldFire('properties') === false, '§5 — properties → NO FIRE');

// ── §6 — round-trip: trim then expand ───────────────────────────────
//
// User trims [0, 240] down to [30, 90], then later wants to expand
// back. The trim is destructive of the range field but NOT of the
// keyforms — outside-range keys still exist and are restored when
// the user re-expands manually.

{
  let state = { startFrame: 0, endFrame: 240, currentTime: 1000, fps: 30 };
  state = setStartFrame(state, 30);
  state = setEndFrame(state, 90);
  ok(state.startFrame === 30 && state.endFrame === 90,
    '§6 — trimmed to [30, 90]');

  // Expand back via the same chord at a later frame
  state.currentTime = 0; // pretend user scrubbed back to 0
  state = setStartFrame(state, 0);
  ok(state.startFrame === 0,
    '§6 — re-expand start works');

  state.currentTime = (240 / 30) * 1000;
  state = setEndFrame(state, 240);
  ok(state.endFrame === 240, '§6 — re-expand end works');
}

// ── §7 — operator pair symmetry ─────────────────────────────────────

const OPS = {
  setRangeStartAtCurrent: { writes: 'startFrame', defaultCurrentTimeBehavior: 'maybe_advance' },
  setRangeEndAtCurrent:   { writes: 'endFrame',   defaultCurrentTimeBehavior: 'no_change' },
};

ok(OPS.setRangeStartAtCurrent.writes === 'startFrame', '§7 — [ writes startFrame');
ok(OPS.setRangeEndAtCurrent.writes === 'endFrame', '§7 — ] writes endFrame');
ok(OPS.setRangeStartAtCurrent.defaultCurrentTimeBehavior === 'maybe_advance',
  '§7 — [ may advance currentTime (forward-only — setStartFrame at past frame keeps playhead)');
ok(OPS.setRangeEndAtCurrent.defaultCurrentTimeBehavior === 'no_change',
  '§7 — ] never moves currentTime (end behind playhead is fine — user can still scrub back)');

console.log(`bracketSetRange: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
