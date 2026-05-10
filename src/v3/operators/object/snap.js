// @ts-check

/**
 * Toolset Plan Phase 7.A.1 — Snap menu operators (`Shift+S`).
 *
 * Implements Blender's `VIEW3D_MT_snap_pie` (`reference/blender/scripts/
 * startup/bl_ui/space_view3d.py:6377-6411` for the pie menu definition;
 * the actual operators live in `editors/object/object_transform.cc:760+`
 * for `OBJECT_OT_*` and `editors/space_view3d/view3d_view.cc` for the
 * cursor-side ones). Hotkey: `Shift+S` per `blender_default.py:4527`
 * (Object Mode keymap).
 *
 * Two columns:
 *
 *   Selection to ...        Cursor to ...
 *   ──────────────         ──────────────
 *    Cursor                  World Origin
 *    Cursor (Keep Offset)    Selected
 *    Grid                    Grid
 *    World Origin            Active
 *    Active
 *
 * The 3D cursor in SS is canvas-space (top-left origin). It's persisted
 * on `project.cursor: {x, y}` (schema v33). Every operator that mutates
 * world positions or the cursor goes through `projectStore` mutators so
 * undo/redo Just Work.
 *
 * # World vs local
 *
 * SS object transforms are local (`transform.x/y` is in parent space).
 * For a top-level node the local frame == world. For a child node we
 * convert the cursor (a world point) into the parent's local frame via
 * `inverse(parentWorld)` before writing the child's `transform.x/y`.
 *
 * Bones are excluded from "Selection to *" — bones live in armature
 * data with rest pivots; you don't move bone rest positions through
 * Snap menu (use Edit Mode for armature). Pose moves go through the
 * Pose-Mode operators in §7.C.
 *
 * # Undo
 *
 * Each operator wraps its mutations in `beginBatch`/`endBatch` so a
 * multi-part snap collapses to one undo entry. The `setProjectCursor`
 * mutator already pushes its own snapshot when invoked outside a batch.
 *
 * @module v3/operators/object/snap
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { usePreferencesStore } from '../../../store/preferencesStore.js';
import { computeWorldMatrices, mat3Inverse } from '../../../renderer/transforms.js';
import { isBoneGroup } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';

/**
 * Read the current 3D-cursor (canvas-space). Falls back to canvas
 * centre if the field is missing (pre-v33 saves before migration runs).
 *
 * @param {any} project
 * @returns {{x:number, y:number}}
 */
export function readCursor(project) {
  if (project?.cursor && typeof project.cursor.x === 'number'
      && typeof project.cursor.y === 'number') {
    return { x: project.cursor.x, y: project.cursor.y };
  }
  const cw = project?.canvas?.width ?? 800;
  const ch = project?.canvas?.height ?? 600;
  return { x: cw / 2, y: ch / 2 };
}

/**
 * Map a canvas-space (world) point into a node's parent-local frame.
 * Top-level nodes (no parent) return the point unchanged.
 *
 * @param {any} node
 * @param {Map<string, Float32Array>} worldMatrices
 * @param {any} project
 * @param {number} wx
 * @param {number} wy
 * @returns {{x:number, y:number}}
 */
export function worldToParentLocal(node, worldMatrices, project, wx, wy) {
  const parentId = node?.parent;
  if (!parentId) return { x: wx, y: wy };
  const parent = project?.nodes?.find((n) => n?.id === parentId);
  if (!parent) return { x: wx, y: wy };
  const parentWorld = worldMatrices.get(parentId);
  if (!parentWorld) return { x: wx, y: wy };
  const inv = mat3Inverse(parentWorld);
  if (!inv) return { x: wx, y: wy };
  const lx = inv[0] * wx + inv[3] * wy + inv[6];
  const ly = inv[1] * wx + inv[4] * wy + inv[7];
  return { x: lx, y: ly };
}

/**
 * World position of a node's origin = its `transform.{x, y}` mapped
 * through its world matrix at (0, 0) in local. Equivalent to reading
 * the world-matrix's translation column (`m[6], m[7]`) for the trivial
 * pivot case; we use the full matrix-point multiply so it stays correct
 * after non-trivial pivot/rotation.
 *
 * @param {string} nodeId
 * @param {Map<string, Float32Array>} worldMatrices
 * @returns {{x:number, y:number} | null}
 */
export function nodeWorldOrigin(nodeId, worldMatrices) {
  const m = worldMatrices.get(nodeId);
  if (!m) return null;
  return { x: m[6], y: m[7] };
}

/**
 * Median of selected nodes' world origins. Used as the anchor for
 * "Selection to Cursor (Keep Offset)" and "Cursor to Selected". Median
 * (not centroid) matches Blender — it shrugs off outliers more cleanly
 * for a multi-selection.
 *
 * Returns null when no node has a resolved world matrix.
 *
 * @param {ReadonlyArray<string>} nodeIds
 * @param {Map<string, Float32Array>} worldMatrices
 * @returns {{x:number, y:number} | null}
 */
export function medianOfOrigins(nodeIds, worldMatrices) {
  const xs = [];
  const ys = [];
  for (const id of nodeIds) {
    const o = nodeWorldOrigin(id, worldMatrices);
    if (o) {
      xs.push(o.x);
      ys.push(o.y);
    }
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const px = xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
  const py = ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid];
  return { x: px, y: py };
}

/** Snap a value to the nearest multiple of `step`. */
export function snapToGrid(v, step) {
  if (!(step > 0)) return v;
  return Math.round(v / step) * step;
}

/**
 * Read the configured grid step from the snap-during-transform store.
 * Phase 2 uses `preferencesStore.snap.modes.grid.increment`. Defaults
 * to 16 px (Phase 2 default) if missing.
 *
 * @returns {number}
 */
export function getGridStep() {
  const snap = usePreferencesStore.getState().snap;
  const inc = snap?.modes?.grid?.increment;
  return (typeof inc === 'number' && inc > 0) ? inc : 16;
}

/**
 * Eligible "selected objects" for snap operations: all selection items
 * that resolve to a non-bone node. Bones are excluded — their rest
 * pivots are armature-data, not Object transforms. Returns `{nodeIds,
 * activeId}` where `activeId` is the LAST eligible item (Blender's
 * "active" is the last-selected).
 *
 * @returns {{nodeIds: string[], activeId: string|null}}
 */
export function eligibleSelection() {
  const items = useSelectionStore.getState().items ?? [];
  const project = useProjectStore.getState().project;
  const byId = new Map();
  for (const n of project?.nodes ?? []) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }
  const out = [];
  for (const it of items) {
    if (it?.type !== 'part' && it?.type !== 'group') continue;
    const node = byId.get(it.id);
    if (!node) continue;
    if (isBoneGroup(node)) continue;
    out.push(it.id);
  }
  return {
    nodeIds: out,
    activeId: out.length === 0 ? null : out[out.length - 1],
  };
}

/**
 * Write a node's `transform.x/y` through the canonical `updateProject`
 * mutator (the only public path that snapshots for undo + bumps the
 * version-control counters). Caller MUST be inside a `beginBatch` so a
 * multi-node loop collapses to one undo entry.
 *
 * @param {string} id
 * @param {number} x
 * @param {number} y
 */
function writeNodeOrigin(id, x, y) {
  useProjectStore.getState().updateProject((proj, vc) => {
    const target = proj.nodes.find((n) => n?.id === id);
    if (!target?.transform) return;
    target.transform.x = x;
    target.transform.y = y;
    if (vc) vc.transformVersion++;
  });
}

/**
 * Move every selected node's origin to a world point, individually.
 * Each node ends up with its origin AT `(targetWX, targetWY)` (so they
 * all stack on the same point). Matches Blender's
 * `OBJECT_OT_snap_selected_to_cursor` with `use_offset=False`
 * (`object_transform.cc:1078+`).
 *
 * @param {number} targetWX
 * @param {number} targetWY
 */
export function snapSelectionToWorldPoint(targetWX, targetWY) {
  const { nodeIds } = eligibleSelection();
  if (nodeIds.length === 0) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  beginBatch();
  try {
    for (const id of nodeIds) {
      const node = project.nodes.find((n) => n?.id === id);
      if (!node?.transform) continue;
      const local = worldToParentLocal(node, worldMatrices, project, targetWX, targetWY);
      writeNodeOrigin(id, local.x, local.y);
    }
  } finally {
    endBatch();
  }
}

/**
 * Move every selected node's origin by the SAME offset that takes the
 * selection's median to `(targetWX, targetWY)`. Matches Blender's
 * `OBJECT_OT_snap_selected_to_cursor` with `use_offset=True`
 * (`object_transform.cc:1078+` reading the `use_offset` RNA arg).
 *
 * @param {number} targetWX
 * @param {number} targetWY
 */
export function snapSelectionToWorldPointKeepOffset(targetWX, targetWY) {
  const { nodeIds } = eligibleSelection();
  if (nodeIds.length === 0) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  const median = medianOfOrigins(nodeIds, worldMatrices);
  if (!median) return;
  const dx = targetWX - median.x;
  const dy = targetWY - median.y;
  if (dx === 0 && dy === 0) return;
  beginBatch();
  try {
    for (const id of nodeIds) {
      const node = project.nodes.find((n) => n?.id === id);
      if (!node?.transform) continue;
      const oldOrigin = nodeWorldOrigin(id, worldMatrices);
      if (!oldOrigin) continue;
      const target = { x: oldOrigin.x + dx, y: oldOrigin.y + dy };
      const local = worldToParentLocal(node, worldMatrices, project, target.x, target.y);
      writeNodeOrigin(id, local.x, local.y);
    }
  } finally {
    endBatch();
  }
}

// ── Selection to ___ ─────────────────────────────────────────────────

/** "Selection to Cursor" — every selected node's origin lands on the cursor. */
export function snapSelectionToCursor() {
  const cur = readCursor(useProjectStore.getState().project);
  snapSelectionToWorldPoint(cur.x, cur.y);
}

/** "Selection to Cursor (Keep Offset)" — selection median moves to the cursor;
 *  per-node offsets preserved. */
export function snapSelectionToCursorKeepOffset() {
  const cur = readCursor(useProjectStore.getState().project);
  snapSelectionToWorldPointKeepOffset(cur.x, cur.y);
}

/** "Selection to Grid" — each selected node's origin snaps to the nearest
 *  grid cell independently. */
export function snapSelectionToGrid() {
  const { nodeIds } = eligibleSelection();
  if (nodeIds.length === 0) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  const step = getGridStep();
  beginBatch();
  try {
    for (const id of nodeIds) {
      const node = project.nodes.find((n) => n?.id === id);
      if (!node?.transform) continue;
      const origin = nodeWorldOrigin(id, worldMatrices);
      if (!origin) continue;
      const wx = snapToGrid(origin.x, step);
      const wy = snapToGrid(origin.y, step);
      const local = worldToParentLocal(node, worldMatrices, project, wx, wy);
      writeNodeOrigin(id, local.x, local.y);
    }
  } finally {
    endBatch();
  }
}

/** "Selection to World Origin" — every selected node's origin snaps to (0, 0). */
export function snapSelectionToWorldOrigin() {
  snapSelectionToWorldPoint(0, 0);
}

/** "Selection to Active" — every non-active selected node's origin snaps to
 *  the active node's world origin. The active node itself is left alone
 *  (matches Blender). */
export function snapSelectionToActive() {
  const { nodeIds, activeId } = eligibleSelection();
  if (!activeId || nodeIds.length < 2) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  const target = nodeWorldOrigin(activeId, worldMatrices);
  if (!target) return;
  beginBatch();
  try {
    for (const id of nodeIds) {
      if (id === activeId) continue;
      const node = project.nodes.find((n) => n?.id === id);
      if (!node?.transform) continue;
      const local = worldToParentLocal(node, worldMatrices, project, target.x, target.y);
      writeNodeOrigin(id, local.x, local.y);
    }
  } finally {
    endBatch();
  }
}

// ── Cursor to ___ ────────────────────────────────────────────────────

/** "Cursor to World Origin" — cursor lands at (0, 0). */
export function snapCursorToWorldOrigin() {
  useProjectStore.getState().setProjectCursor(0, 0);
}

/** "Cursor to Selected" — cursor lands on the median of selected origins.
 *  Matches Blender's `VIEW3D_OT_snap_cursor_to_selected`
 *  (`view3d_view.cc` — uses object median). */
export function snapCursorToSelected() {
  const { nodeIds } = eligibleSelection();
  if (nodeIds.length === 0) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  const median = medianOfOrigins(nodeIds, worldMatrices);
  if (!median) return;
  useProjectStore.getState().setProjectCursor(median.x, median.y);
}

/** "Cursor to Grid" — current cursor position snapped to the nearest cell. */
export function snapCursorToGrid() {
  const project = useProjectStore.getState().project;
  const cur = readCursor(project);
  const step = getGridStep();
  useProjectStore.getState().setProjectCursor(
    snapToGrid(cur.x, step),
    snapToGrid(cur.y, step),
  );
}

/** "Cursor to Active" — cursor lands on the active selection's world origin. */
export function snapCursorToActive() {
  const { activeId } = eligibleSelection();
  if (!activeId) return;
  const project = useProjectStore.getState().project;
  const worldMatrices = computeWorldMatrices(project.nodes);
  const target = nodeWorldOrigin(activeId, worldMatrices);
  if (!target) return;
  useProjectStore.getState().setProjectCursor(target.x, target.y);
}
