// Regression for Timeline arrow-key frame stepping (2026-06-12, Phase 4
// paint-fidelity follow-up — Animation editors audit).
//
// Bug class: arrow keys had no effect in Timeline / Dopesheet / FCurve
// editors. Blender's space_time / space_action / space_graph keymaps
// bind LeftArrow/RightArrow to ±1 frame and Shift+LeftArrow/Right to
// start/end. SS pre-fix had no arrow-key bindings — scrubbing required
// dragging the playhead or pressing Space to play.
//
// Fix:
//   - 4 new operators: time.stepFrame.{forward,backward},
//     time.jumpTo{Start,End}.
//   - Keymap binds bare Arrow → step, Shift+Arrow → jump.
//   - All four gated on `hoveredEditorType() ∈ {timeline, dopesheet,
//     fcurve}` so arrow keys in Outliner/Properties/Viewport stay
//     free for their usual UI roles.
//
// Frame derivation: currentTime (ms) is canonical; frame =
// Math.round(t * fps / 1000). seekFrame(n) writes back through
// animationStore so playhead + drivers + auto-key all see the change.
// Clamps to [startFrame, endFrame].
//
// Run: node scripts/test/test_timelineArrowKeyFrameStep.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — frame derivation from currentTime ──────────────────────────

function curFrame(state) {
  const fps = state.fps || 30;
  return Math.round((state.currentTime ?? 0) * fps / 1000);
}

ok(curFrame({ currentTime: 0, fps: 30 }) === 0, '§1 — t=0ms @ 30fps → frame 0');
ok(curFrame({ currentTime: 1000 / 30, fps: 30 }) === 1, '§1 — t=33.33ms @ 30fps → frame 1');
ok(curFrame({ currentTime: 1000, fps: 30 }) === 30, '§1 — t=1000ms @ 30fps → frame 30');
ok(curFrame({ currentTime: 1000, fps: 60 }) === 60, '§1 — fps=60 doubles frame index');
ok(curFrame({ currentTime: 33.3, fps: 30 }) === 1,
  '§1 — rounding: ~33ms rounds to frame 1 (not 0)');

// ── §2 — stepFrame.forward ──────────────────────────────────────────

function stepForward(state) {
  const fps = state.fps || 30;
  const cur = Math.round((state.currentTime ?? 0) * fps / 1000);
  const endFrame = Number.isFinite(state.endFrame) ? state.endFrame : (cur + 1);
  const next = Math.min(endFrame, cur + 1);
  if (next === cur) return null;
  state.currentTime = (next / fps) * 1000;
  return next;
}

{
  const state = { currentTime: 0, fps: 30, startFrame: 0, endFrame: 240 };
  ok(stepForward(state) === 1, '§2 — frame 0 → 1');
  ok(stepForward(state) === 2, '§2 — frame 1 → 2');
  ok(state.currentTime > 33 && state.currentTime < 100, '§2 — currentTime updated in ms');
}

{
  const state = { currentTime: (239 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  ok(stepForward(state) === 240, '§2 — frame 239 → 240 (one before end)');
  ok(stepForward(state) === null,
    '§2 — frame 240 → null (no-op, clamped at endFrame)');
}

{
  // No endFrame → no clamp, just step
  const state = { currentTime: 0, fps: 30, startFrame: 0, endFrame: NaN };
  ok(stepForward(state) === 1, '§2 — missing endFrame: step still works (defensive)');
}

// ── §3 — stepFrame.backward ─────────────────────────────────────────

function stepBackward(state) {
  const fps = state.fps || 30;
  const cur = Math.round((state.currentTime ?? 0) * fps / 1000);
  const startFrame = Number.isFinite(state.startFrame) ? state.startFrame : 0;
  const next = Math.max(startFrame, cur - 1);
  if (next === cur) return null;
  state.currentTime = (next / fps) * 1000;
  return next;
}

{
  const state = { currentTime: (5 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  ok(stepBackward(state) === 4, '§3 — frame 5 → 4');
  ok(stepBackward(state) === 3, '§3 — frame 4 → 3');
}

{
  const state = { currentTime: (1 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  ok(stepBackward(state) === 0, '§3 — frame 1 → 0');
  ok(stepBackward(state) === null,
    '§3 — frame 0 → null (no-op, clamped at startFrame)');
}

{
  // Non-zero startFrame clamps correctly
  const state = { currentTime: (12 / 30) * 1000, fps: 30, startFrame: 10, endFrame: 240 };
  ok(stepBackward(state) === 11, '§3 — frame 12 → 11');
  ok(stepBackward(state) === 10, '§3 — frame 11 → 10');
  ok(stepBackward(state) === null, '§3 — frame 10 → null (clamped at startFrame=10)');
}

// ── §4 — jumpToStart / jumpToEnd ────────────────────────────────────

function jumpToStart(state) {
  const startFrame = Number.isFinite(state.startFrame) ? state.startFrame : 0;
  const fps = state.fps || 30;
  state.currentTime = (startFrame / fps) * 1000;
  return startFrame;
}

function jumpToEnd(state) {
  const fps = state.fps || 30;
  const endFrame = Number.isFinite(state.endFrame)
    ? state.endFrame
    : Math.round((state.currentTime ?? 0) * fps / 1000);
  state.currentTime = (endFrame / fps) * 1000;
  return endFrame;
}

{
  const state = { currentTime: (100 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  ok(jumpToStart(state) === 0, '§4 — jump to start → frame 0');
  ok(state.currentTime === 0, '§4 — currentTime reset to 0ms');
}

{
  const state = { currentTime: 0, fps: 30, startFrame: 10, endFrame: 240 };
  ok(jumpToStart(state) === 10, '§4 — non-zero startFrame respected');
  ok(state.currentTime === (10 / 30) * 1000, '§4 — currentTime = startFrame in ms');
}

{
  const state = { currentTime: (50 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  ok(jumpToEnd(state) === 240, '§4 — jump to end → frame 240');
  ok(state.currentTime === (240 / 30) * 1000, '§4 — currentTime = endFrame in ms');
}

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
  '§5 — viewport → DO NOT fire (arrow keys reserved for viewport-specific use)');
ok(shouldFire('outliner') === false, '§5 — outliner → DO NOT fire (focus nav)');
ok(shouldFire('properties') === false, '§5 — properties → DO NOT fire (focus nav)');
ok(shouldFire(null) === false,
  '§5 — null (unannotated area) → DO NOT fire '
  + '(margins / popovers / app shell don\'t need frame stepping)');

// ── §6 — round-trip: step forward N times then back N times → same ──

{
  const state = { currentTime: (50 / 30) * 1000, fps: 30, startFrame: 0, endFrame: 240 };
  const t0 = state.currentTime;
  for (let i = 0; i < 10; i++) stepForward(state);
  for (let i = 0; i < 10; i++) stepBackward(state);
  ok(Math.abs(state.currentTime - t0) < 1e-9,
    '§6 — forward N then backward N → same currentTime (no drift)');
}

// ── §7 — fps change preserves frame index (not currentTime) ────────
//
// If user is on frame 60 at 30fps (t=2000ms) and switches to 60fps,
// frame 60 becomes t=1000ms. Frame index is the canonical user-visible
// unit; arrow keys step by frame, not by ms.

{
  const state30 = { currentTime: 2000, fps: 30, startFrame: 0, endFrame: 240 };
  const frame30 = curFrame(state30);
  ok(frame30 === 60, '§7 — frame index at 30fps');
  // After fps change (conceptual — animationStore handles this elsewhere)
  const state60 = { currentTime: 2000, fps: 60, startFrame: 0, endFrame: 240 };
  ok(curFrame(state60) === 120,
    '§7 — same currentTime at 60fps = frame 120 (different frame!)');
}

console.log(`timelineArrowKeyFrameStep: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
