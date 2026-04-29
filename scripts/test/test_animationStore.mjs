// v3 Phase 0F.20 - tests for src/store/animationStore.js
//
// Animation playback state - tick advancement, loop wrap-around,
// draft pose management. tick() in particular has subtle behavior
// (first call captures _lastTimestamp without advancing, loop
// count increments on wrap, non-looping pauses at end). Untested
// until now.
//
// Run: node scripts/test/test_animationStore.mjs

import { useAnimationStore } from '../../src/store/animationStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

function get() { return useAnimationStore.getState(); }

function reset() { get().resetPlayback(); }

// ── Initial state ─────────────────────────────────────────────────

reset();
{
  const s = get();
  assert(s.activeAnimationId === null, 'initial: no active animation');
  assert(s.currentTime === 0, 'initial: time = 0');
  assert(s.isPlaying === false, 'initial: not playing');
  assert(s.fps === 24, 'initial: fps = 24');
  assert(s.draftPose instanceof Map, 'initial: draftPose is Map');
  assert(s.draftPose.size === 0, 'initial: draftPose empty');
  assert(s.restPose instanceof Map, 'initial: restPose is Map');
}

// ── Setters with clamping ─────────────────────────────────────────

{
  reset();
  get().setFps(0);
  assert(get().fps >= 1, 'setFps: clamped to >= 1');
  get().setFps(60);
  assert(get().fps === 60, 'setFps: 60 accepted');
  get().setFps(24.7);
  assert(get().fps === 25, 'setFps: rounds');
}

{
  reset();
  get().setSpeed(-1);
  assert(get().speed === 0, 'setSpeed: negative clamped to 0');
  get().setSpeed(10);
  assert(get().speed === 4, 'setSpeed: clamped to 4');
  get().setSpeed(2);
  assert(get().speed === 2, 'setSpeed: 2 accepted');
}

{
  reset();
  get().setEndFrame(50);
  assert(get().endFrame === 50, 'setEndFrame: 50');
  get().setEndFrame(0);
  // Must stay above startFrame (0) by at least 1
  assert(get().endFrame >= get().startFrame + 1, 'setEndFrame: kept > startFrame');
}

// ── captureRestPose ───────────────────────────────────────────────

{
  reset();
  const nodes = [
    { id: 'a', transform: { x: 5, y: 7, rotation: 30, scaleX: 2, scaleY: 3 }, opacity: 0.8 },
    { id: 'b', transform: { x: 0, y: 0 }, opacity: 1 },
    { id: 'c' /* no transform / opacity */ },
  ];
  get().captureRestPose(nodes);
  const rp = get().restPose;
  assert(rp.size === 3, 'captureRestPose: 3 entries');
  assert(rp.get('a').x === 5, 'captureRestPose: a.x captured');
  assert(rp.get('a').rotation === 30, 'captureRestPose: a.rotation');
  assert(rp.get('a').opacity === 0.8, 'captureRestPose: a.opacity');
  assert(rp.get('b').scaleX === 1, 'captureRestPose: b.scaleX defaults to 1');
  assert(rp.get('c').opacity === 1, 'captureRestPose: c missing transform → all defaults');
  assert(rp.get('c').x === 0 && rp.get('c').rotation === 0, 'captureRestPose: c defaults');
}

// ── Draft pose ────────────────────────────────────────────────────

{
  reset();
  get().setDraftPose('a', { x: 10 });
  assert(get().draftPose.get('a').x === 10, 'draftPose: set x');

  // Merge: setting y preserves x
  get().setDraftPose('a', { y: 20 });
  assert(get().draftPose.get('a').x === 10, 'draftPose: x preserved on second set');
  assert(get().draftPose.get('a').y === 20, 'draftPose: y added');

  // Different node doesn't collide
  get().setDraftPose('b', { rotation: 45 });
  assert(get().draftPose.get('a').x === 10, 'draftPose: a unchanged when b set');
  assert(get().draftPose.get('b').rotation === 45, 'draftPose: b independent');

  // Clear specific node
  get().clearDraftPoseForNode('a');
  assert(!get().draftPose.has('a'), 'clearDraftPoseForNode: a removed');
  assert(get().draftPose.has('b'), 'clearDraftPoseForNode: b survives');

  // Clear all
  get().clearDraftPose();
  assert(get().draftPose.size === 0, 'clearDraftPose: all gone');

  // Each setDraftPose returns a fresh Map (so React sees a change)
  const before = get().draftPose;
  get().setDraftPose('x', { x: 1 });
  assert(get().draftPose !== before, 'setDraftPose: fresh Map ref');
}

// ── Transport ─────────────────────────────────────────────────────

{
  reset();
  get().play();
  assert(get().isPlaying === true, 'play: isPlaying true');

  get().pause();
  assert(get().isPlaying === false, 'pause: isPlaying false');

  // Stop resets time + clears draft
  useAnimationStore.setState({ currentTime: 1234, isPlaying: true });
  get().setDraftPose('a', { x: 1 });
  get().stop();
  assert(get().isPlaying === false, 'stop: not playing');
  assert(get().currentTime === 0, 'stop: time = 0 (startFrame=0)');
  assert(get().draftPose.size === 0, 'stop: draftPose cleared');
  assert(get().loopCount === 0, 'stop: loopCount reset');
}

{
  reset();
  // seekFrame translates to time
  get().seekFrame(48);
  assert(get().currentTime === 2000, 'seekFrame: 48 @ 24fps → 2000ms');

  // seekTime is direct
  get().seekTime(500);
  assert(get().currentTime === 500, 'seekTime: 500ms');
}

// ── tick: first call only captures timestamp, doesn't advance ────

{
  reset();
  useAnimationStore.setState({ isPlaying: true, currentTime: 0 });

  // First tick: no _lastTimestamp yet → capture, no advance
  const r1 = get().tick(1000);
  assert(r1 === false, 'tick first: returns false');
  assert(get().currentTime === 0, 'tick first: time unchanged');
}

// ── tick: advances by elapsed * speed ─────────────────────────────

{
  reset();
  useAnimationStore.setState({ isPlaying: true, currentTime: 0, speed: 1, fps: 24, startFrame: 0, endFrame: 48 });
  get().tick(1000);  // captures timestamp
  get().tick(1100);  // 100ms elapsed
  assert(near(get().currentTime, 100), 'tick: advances 100ms at speed 1');
}

// ── tick: speed multiplies elapsed ─────────────────────────────────

{
  reset();
  useAnimationStore.setState({ isPlaying: true, currentTime: 0, speed: 2, fps: 24, startFrame: 0, endFrame: 48 });
  get().tick(1000);
  get().tick(1100);
  assert(near(get().currentTime, 200), 'tick: speed 2 → 200ms in 100ms wall');
}

// ── tick: loop wrap-around ─────────────────────────────────────────

{
  reset();
  useAnimationStore.setState({
    isPlaying: true, currentTime: 1900, speed: 1, fps: 24,
    startFrame: 0, endFrame: 48, loop: true, loopCount: 0,
  });
  // endMs = 2000. tick advance 200ms → past end, wraps.
  get().tick(1000);
  get().tick(1200);  // 200ms elapsed
  // newTime = 1900 + 200 = 2100; rangeMs=2000; modulo → 100
  assert(near(get().currentTime, 100), 'tick: wraps past end');
  assert(get().loopCount === 1, 'tick: loopCount incremented on wrap');
}

// ── tick: no loop pauses at end ────────────────────────────────────

{
  reset();
  useAnimationStore.setState({
    isPlaying: true, currentTime: 1900, speed: 1, fps: 24,
    startFrame: 0, endFrame: 48, loop: false,
  });
  get().tick(1000);
  get().tick(1500);  // big jump past end
  assert(get().currentTime === 2000, 'tick no-loop: clamped at endMs');
  assert(get().isPlaying === false, 'tick no-loop: paused at end');
}

// ── tick: not playing → returns false ─────────────────────────────

{
  reset();
  useAnimationStore.setState({ isPlaying: false });
  assert(get().tick(1000) === false, 'tick: not playing → false');
}

// ── switchAnimation ───────────────────────────────────────────────

{
  reset();
  get().switchAnimation({ id: 'a1', fps: 30, duration: 4000 });
  assert(get().activeAnimationId === 'a1', 'switchAnimation: id set');
  assert(get().fps === 30, 'switchAnimation: fps set');
  assert(get().endFrame === 120, 'switchAnimation: endFrame from duration (4000ms @ 30fps = 120)');
  assert(get().currentTime === 0, 'switchAnimation: time reset');
  assert(get().isPlaying === false, 'switchAnimation: paused');
  assert(get().draftPose.size === 0, 'switchAnimation: draftPose cleared');

  // null/undefined is no-op
  const before = get().activeAnimationId;
  get().switchAnimation(null);
  assert(get().activeAnimationId === before, 'switchAnimation: null is no-op');
}

console.log(`animationStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
