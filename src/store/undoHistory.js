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
 */
export function beginBatch(project) {
  if (_batchDepth === 0) pushSnapshot(project);
  _batchDepth++;
}

/** Call at the end of a continuous gesture. */
export function endBatch() {
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
