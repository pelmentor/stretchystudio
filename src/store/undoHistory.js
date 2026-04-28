/**
 * undoHistory - pure JS module for snapshot-based undo/redo.
 *
 * No React or Zustand imports - stays free of circular dependencies.
 * projectStore imports pushSnapshot/isBatching/clearHistory from here.
 * useUndoRedo imports undo/redo from here.
 *
 * v3 Phase 0F.8 (Pillar M): added byte-budget cap on top of the
 * count cap. The full Immer-patches rewrite is still future work
 * (it needs a coordinated change in projectStore and every action
 * that calls pushSnapshot); this is the observability + soft cap
 * that ratchets the codebase toward it.
 *
 * Each snapshot's approximate size is computed once at push time
 * via JSON.stringify().length (a coarse proxy - typed arrays
 * serialize to {} and undercount, but the dominant size in
 * practice comes from node trees and keyform Maps which JSON
 * captures correctly). When total > MAX_BYTES, the oldest entries
 * are dropped first - same FIFO eviction policy the count cap
 * uses, just bounded by memory instead of entry count.
 *
 * `undoStats()` exposes the counters so DevTools / Phase 1
 * status bar / future telemetry can show the user how much memory
 * undo is consuming.
 */

const MAX_HISTORY = 50;
const MAX_BYTES   = 50 * 1024 * 1024; // 50 MB — generous, will tighten with Immer-patches

/** @typedef {{project: any, bytes: number}} SnapshotEntry */

/** @type {SnapshotEntry[]} */ let _snapshots = [];
/** @type {SnapshotEntry[]} */ let _redoStack = [];
let _totalBytes = 0;
let _batchDepth = 0;

/**
 * Approximate size of a snapshot in bytes. JSON.stringify().length
 * is char-count not byte-count, but for our typically ASCII-heavy
 * project payloads the two are within ~1%. Crucially, it's O(n)
 * over the project so it's cheap enough to call once per push.
 * @param {any} obj
 * @returns {number}
 */
function approxSize(obj) {
  try {
    return JSON.stringify(obj)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Drop the oldest snapshots while total > MAX_BYTES OR count >
 * MAX_HISTORY. Both caps run simultaneously: whichever bites first
 * triggers eviction.
 */
function _evict() {
  while (
    _snapshots.length > 0 &&
    (_snapshots.length > MAX_HISTORY || _totalBytes > MAX_BYTES)
  ) {
    const dropped = _snapshots.shift();
    _totalBytes -= dropped?.bytes ?? 0;
  }
  if (_totalBytes < 0) _totalBytes = 0;
}

/** Push a snapshot of the project before a discrete mutation.
 *  Uses structuredClone to correctly preserve typed arrays (Float32Array for
 *  mesh.uvs, etc.) that JSON.parse/stringify would corrupt to plain objects. */
export function pushSnapshot(project) {
  const cloned = structuredClone(project);
  const bytes = approxSize(cloned);
  _snapshots.push({ project: cloned, bytes });
  _totalBytes += bytes;
  _evict();
  // A new edit invalidates the redo stack; reclaim those bytes too.
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
  _totalBytes = 0;
  _batchDepth = 0;
}

/**
 * Apply undo.
 * @param {object} currentProject - current project state (for redo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function undo(currentProject, applyFn) {
  if (_snapshots.length === 0) return;
  const prev = _snapshots.pop();
  if (prev) _totalBytes -= prev.bytes;
  if (_totalBytes < 0) _totalBytes = 0;
  const cloned = structuredClone(currentProject);
  _redoStack.push({ project: cloned, bytes: approxSize(cloned) });
  applyFn(prev?.project);
}

/**
 * Apply redo.
 * @param {object} currentProject - current project state (for undo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function redo(currentProject, applyFn) {
  if (_redoStack.length === 0) return;
  const next = _redoStack.pop();
  const cloned = structuredClone(currentProject);
  const bytes = approxSize(cloned);
  _snapshots.push({ project: cloned, bytes });
  _totalBytes += bytes;
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
 * @returns {{
 *   undoCount: number,
 *   redoCount: number,
 *   approxBytes: number,
 *   maxBytes: number,
 *   maxEntries: number,
 *   batchDepth: number,
 * }}
 */
export function undoStats() {
  return {
    undoCount: _snapshots.length,
    redoCount: _redoStack.length,
    approxBytes: _totalBytes,
    maxBytes: MAX_BYTES,
    maxEntries: MAX_HISTORY,
    batchDepth: _batchDepth,
  };
}
