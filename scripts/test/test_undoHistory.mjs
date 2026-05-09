// v3 Phase 0F.8 (Pillar M) - undoHistory tests
// Run: node scripts/test/test_undoHistory.mjs

import {
  pushSnapshot,
  undo,
  redo,
  clearHistory,
  beginBatch,
  endBatch,
  isBatching,
  undoCount,
  redoCount,
  undoStats,
} from '../../src/store/undoHistory.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function reset() {
  clearHistory();
}

// ── Push / undo / redo round-trip ──────────────────────────────────

{
  reset();
  const v0 = { name: 'v0', value: 1 };
  const v1 = { name: 'v1', value: 2 };
  const v2 = { name: 'v2', value: 3 };

  // Push v0, v1 (each is the pre-mutation state)
  pushSnapshot(v0);
  pushSnapshot(v1);
  assert(undoCount() === 2, 'count: 2 snapshots after 2 pushes');

  // Undo from v2 → applyFn receives v1
  let received = null;
  undo(v2, (snap) => { received = snap; });
  assert(received?.name === 'v1', 'undo: receives v1 (most recent push)');
  assert(undoCount() === 1, 'count: 1 snapshot after undo');
  assert(redoCount() === 1, 'redo count: 1 after undo');

  // Redo → applyFn receives v2
  received = null;
  redo(v1, (snap) => { received = snap; });
  assert(received?.name === 'v2', 'redo: receives v2');
  assert(undoCount() === 2, 'count: 2 snapshots after redo');
  assert(redoCount() === 0, 'redo count: 0 after redo');
}

// ── Pushing a new edit invalidates redo stack ──────────────────────

{
  reset();
  pushSnapshot({ v: 0 });
  pushSnapshot({ v: 1 });
  undo({ v: 2 }, () => {});
  assert(redoCount() === 1, 'redo: 1 after undo');

  pushSnapshot({ v: 'new' });
  assert(redoCount() === 0, 'new edit clears redo stack');
}

// ── Batch suppresses per-frame snapshots ───────────────────────────

{
  reset();
  beginBatch({ v: 'pre-drag' });
  assert(isBatching(), 'isBatching: true inside batch');
  // Calls inside the batch shouldn't add their own pre-mutation
  // snapshots (caller convention: gate pushSnapshot on !isBatching()).
  // But the begin already pushed once.
  assert(undoCount() === 1, 'batch: only the begin pushed once');
  endBatch();
  assert(!isBatching(), 'isBatching: false after end');
}

// ── clearHistory wipes everything ──────────────────────────────────

{
  reset();
  pushSnapshot({ v: 0 });
  pushSnapshot({ v: 1 });
  clearHistory();
  assert(undoCount() === 0, 'clearHistory: undoCount = 0');
  assert(redoCount() === 0, 'clearHistory: redoCount = 0');
}

// ── undoStats returns sane values ──────────────────────────────────

{
  reset();
  const s0 = undoStats();
  assert(s0.undoCount === 0, 'stats: empty undoCount');
  assert(s0.redoCount === 0, 'stats: empty redoCount');
  assert(s0.maxEntries > 0, 'stats: maxEntries set');

  // After a push, undoCount should grow
  pushSnapshot({ x: 'a'.repeat(1000) });
  const s1 = undoStats();
  assert(s1.undoCount === 1, 'stats: undoCount tracks pushes');
}

// ── Count cap (MAX_HISTORY = 50) ───────────────────────────────────

{
  reset();
  // Push 60 tiny snapshots — should be count-capped at 50.
  for (let i = 0; i < 60; i++) pushSnapshot({ i });
  assert(undoCount() <= 50, 'count cap: <= MAX_HISTORY');
}

// ── Snapshot reference contract (P1 — immer-frozen states) ─────────

// P1 contract: pushSnapshot holds the immer-frozen reference; production
// code always passes an auto-frozen `state.project`. With a frozen
// snapshot, downstream mutation cannot leak (it throws or silently
// fails). Test fixtures emulate that by passing plain objects we
// promise not to mutate after push.

{
  reset();
  const proj = Object.freeze({ v: 0, nested: Object.freeze({ count: 1 }) });
  pushSnapshot(proj);

  let captured = null;
  undo({ v: 'new' }, (snap) => { captured = snap; });
  // The snapshot is the same reference we pushed.
  assert(captured === proj, 'snapshot held by reference (P1)');
  // The frozen guarantees no leak from outside; the reference still
  // shows the values we expect.
  assert(captured.v === 0, 'snapshot value: top-level');
  assert(captured.nested.count === 1, 'snapshot value: nested');
}

console.log(`undoHistory: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
