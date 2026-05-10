/**
 * undoHistory - pure JS module for snapshot-based undo/redo.
 *
 * No React or Zustand imports - stays free of circular dependencies.
 * projectStore imports pushSnapshot/isBatching/clearHistory from here;
 * the v3 operator registry imports undo/redo for the app.undo / app.redo
 * operators (Ctrl+Z / Ctrl+Shift+Z bindings).
 *
 * P1 (2026-05-09) — dropped the structuredClone + JSON.stringify path.
 * The project state is produced by immer and is auto-frozen, so the
 * pushed reference is already an immutable snapshot of the project at
 * that moment. Holding the reference (instead of cloning) is safe AND
 * cheaper — eliminates ~30-50ms structuredClone + ~30-50ms JSON.stringify
 * per push on Hiyori-class projects, and lets snapshots share unmutated
 * subtrees via immer's structural sharing (memory grows by O(diff) per
 * push instead of O(project) per push).
 *
 * Byte budget removed. Without per-snapshot clones, memory growth is
 * dominated by structural-sharing depth — bounded by the actual diff
 * structure of edits, not by raw size. The MAX_HISTORY count cap (50)
 * is the load-bearing limit. Pathological "edit + undo + edit" flows
 * still share unmutated nodes; the tail-risk profile is materially
 * better than with cloned snapshots.
 *
 * `undoStats()` exposes the counters so DevTools / Phase 1
 * status bar / future telemetry can show the user how much memory
 * undo is consuming.
 */

const MAX_HISTORY = 50;

/** @typedef {{project: any}} SnapshotEntry */

/** @type {SnapshotEntry[]} */ let _snapshots = [];
/** @type {SnapshotEntry[]} */ let _redoStack = [];
let _batchDepth = 0;
/** Snapshot of the redo stack as it was when the outermost batch began.
 *  Restored by `discardBatch` so a cancelled batch doesn't accidentally
 *  invalidate the user's redo history (which `pushSnapshot`'s edit-clears
 *  -redo behaviour did at `beginBatch` time). Null when no batch is open. */
/** @type {SnapshotEntry[]|null} */ let _redoStackBeforeBatch = null;

/** Drop the oldest snapshots when count exceeds MAX_HISTORY. */
function _evict() {
  while (_snapshots.length > MAX_HISTORY) {
    _snapshots.shift();
  }
}

/** Push a snapshot of the project before a discrete mutation.
 *
 *  Holds the immer-produced (auto-frozen) reference directly — no clone.
 *  Cloning was historically needed because we feared mutation downstream;
 *  immer makes the project immutable, so the reference IS the snapshot.
 *  Typed arrays (Float32Array mesh.uvs etc.) survive intact since we
 *  never serialize, just hold the reference. */
export function pushSnapshot(project) {
  _snapshots.push({ project });
  _evict();
  // A new edit invalidates the redo stack.
  if (_redoStack.length > 0) {
    _redoStack = [];
  }
}

/**
 * Call at the start of a continuous gesture (drag, slider scrub).
 * Captures one pre-gesture snapshot and suppresses per-frame snapshots.
 *
 * Side-saves the redo stack so a subsequent `discardBatch` (cancel)
 * can restore it — `pushSnapshot` clears redo unconditionally, which
 * is correct on commit (a real edit invalidates redo) but wrong on
 * cancel (no edit happened). Saved only at depth 0; nested begins
 * piggyback on the outer's saved state.
 */
export function beginBatch(project) {
  if (_batchDepth === 0) {
    _redoStackBeforeBatch = _redoStack.slice();
    pushSnapshot(project);
  }
  _batchDepth++;
}

/** Call at the end of a continuous gesture. */
export function endBatch() {
  _batchDepth = Math.max(0, _batchDepth - 1);
  if (_batchDepth === 0) {
    // Commit: the redo-clear performed by `pushSnapshot` at beginBatch
    // is the correct behaviour for a real edit (a new edit invalidates
    // redo). Drop the saved backup.
    _redoStackBeforeBatch = null;
  }
}

/**
 * Cancel the outermost batch — pop the snapshot pushed by `beginBatch`
 * and restore it via `applyFn`, WITHOUT pushing the discarded current
 * state to the redo stack. Used by modal flows that decide to revert
 * (Phase 5 — Esc-cancel of an extrude + modal-G session: the topology
 * change AND the partial drag both vanish; redo stack stays clean).
 *
 * At depth > 1 (nested batches), the inner cancel is a no-op
 * decrement; the outer caller decides the final outcome. Mirrors the
 * fact that nested `beginBatch` calls don't push additional snapshots.
 *
 * @param {function(any): void} applyFn  - receives the popped snapshot
 *                                          (== pre-batch state); should
 *                                          restore project state.
 */
export function discardBatch(applyFn) {
  if (_batchDepth === 0) return;
  if (_batchDepth === 1) {
    // Pop + restore project snapshot ONLY if one is on the stack —
    // `clearHistory()` mid-batch (via `resetProject` / project load)
    // wipes `_snapshots` but leaves `_batchDepth` intact, so the
    // snapshot may be missing here without it being a bug.
    if (_snapshots.length > 0) {
      const snap = _snapshots.pop();
      if (typeof applyFn === 'function') applyFn(snap?.project);
    }
    // Audit fix G-8 — restore + null `_redoStackBeforeBatch`
    // UNCONDITIONALLY when depth → 0, so the backup doesn't leak
    // across the snapshots-empty edge (clearHistory mid-batch).
    // Pre-fix the backup persisted past depth 0 and would re-emerge
    // on the next discardBatch, restoring a stale post-clearHistory
    // redo stack that no longer matched the project.
    if (_redoStackBeforeBatch !== null) {
      _redoStack = _redoStackBeforeBatch;
      _redoStackBeforeBatch = null;
    }
  }
  _batchDepth = Math.max(0, _batchDepth - 1);
}

/** Returns true while inside a batch — updateProject should skip auto-snapshot. */
export function isBatching() {
  return _batchDepth > 0;
}

/** Clear history — call on project load/reset so stale history doesn't leak. */
export function clearHistory() {
  _snapshots  = [];
  _redoStack  = [];
  _batchDepth = 0;
  _redoStackBeforeBatch = null;
}

/**
 * Apply undo. `currentProject` is the immer-frozen current state; we
 * push it onto the redo stack by reference (no clone — same reasoning
 * as pushSnapshot).
 *
 * @param {object} currentProject - current project state (for redo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function undo(currentProject, applyFn) {
  if (_snapshots.length === 0) return;
  const prev = _snapshots.pop();
  _redoStack.push({ project: currentProject });
  applyFn(prev?.project);
}

/**
 * Apply redo. `currentProject` is the immer-frozen current state; we
 * push it onto the undo stack by reference (no clone).
 *
 * @param {object} currentProject - current project state (for undo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function redo(currentProject, applyFn) {
  if (_redoStack.length === 0) return;
  const next = _redoStack.pop();
  _snapshots.push({ project: currentProject });
  _evict();
  applyFn(next?.project);
}

/** How many undo steps are available. */
export function undoCount() {
  return _snapshots.length;
}

/** How many redo steps are available. */
export function redoCount() {
  return _redoStack.length;
}

/**
 * Diagnostic snapshot of the undo system. Useful for DevTools, the
 * Phase 1 status bar, and "why is the tab using 800 MB" investigations.
 *
 * `approxBytes` removed — P1 dropped the JSON.stringify size accounting.
 * Memory consumption is now bounded by the count cap + immer's structural
 * sharing depth; raw-byte estimates were a coarse proxy that turned out
 * to drive nothing actionable.
 *
 * @returns {{
 *   undoCount: number,
 *   redoCount: number,
 *   maxEntries: number,
 *   batchDepth: number,
 * }}
 */
export function undoStats() {
  return {
    undoCount: _snapshots.length,
    redoCount: _redoStack.length,
    maxEntries: MAX_HISTORY,
    batchDepth: _batchDepth,
  };
}
