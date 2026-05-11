// @ts-check

/**
 * Toolset Plan Phase 7.B.5 — Normalize All Vertex Groups.
 *
 * For each vertex on the active part, sums the weights across all
 * weight groups and divides each group's weight by the sum so the new
 * sum is 1.0. Vertices with all-zero weights are left at zero (no
 * normalization possible — Blender's `vgroup_normalize_all` does the
 * same per `object_vgroup.cc:3173`-ish).
 *
 * Mirrors Blender's `OBJECT_OT_vertex_group_normalize_all`
 * (`reference/blender/source/blender/editors/object/object_vgroup.cc:3219`
 * — operator registration; exec at `:3173-3217` `vertex_group_normalize_all_exec`).
 *
 * # Locked groups
 *
 * Blender's `vgroup_normalize_all` accepts a `lock_active` flag which
 * subtracts the active group's weight from the per-vertex budget BEFORE
 * normalising the unlocked groups, so the active stays put. SS does
 * not yet model per-group locks (no `mesh.lockedWeightGroups` field;
 * adding one would be a future schema bump). Per Phase 7.B.5 plan,
 * v1 normalises ALL groups equally — documented as
 * DOCUMENT-AS-DEVIATION pending lock infrastructure.
 *
 * # Why no chord
 *
 * Per `TOOLSET_BLENDER_PARITY_PLAN.md` §"Phase 7 — Weight Paint" audit-
 * fixed bindings table: Blender's `Ctrl+N` for `vertex_group_normalize_all`
 * collides with SS's `file.new` (`Ctrl+N`). Phase 7.B ships menu-only
 * (no chord); the operator is reachable via N-panel button + command
 * palette.
 *
 * @module v3/operators/weightPaint/normalize
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { getMesh } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';

/**
 * Normalize all weight groups on the active part. Returns a count of
 * how many vertices were rebalanced (zero-sum verts skipped).
 *
 * @returns {{ normalized: number, skipped: boolean, vertexCount?: number,
 *             groupCount?: number, zeroSumVerts?: number }}
 */
export function normalizeAllWeights() {
  const editor = useEditorStore.getState();
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') {
    return { normalized: 0, skipped: true };
  }
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') {
    return { normalized: 0, skipped: true };
  }
  const mesh = getMesh(node, project);
  if (!mesh || !mesh.weightGroups) {
    return { normalized: 0, skipped: true };
  }
  const groupNames = Object.keys(mesh.weightGroups);
  if (groupNames.length === 0) {
    return { normalized: 0, skipped: true };
  }
  // All groups must share the same vertex count; pick first as canonical.
  const first = mesh.weightGroups[groupNames[0]];
  if (!Array.isArray(first) || first.length === 0) {
    return { normalized: 0, skipped: true };
  }
  const vertexCount = first.length;
  for (const name of groupNames) {
    const g = mesh.weightGroups[name];
    if (!Array.isArray(g) || g.length !== vertexCount) {
      return { normalized: 0, skipped: true,
               vertexCount, groupCount: groupNames.length };
    }
  }

  // Build the per-vertex sums + per-group next arrays.
  /** @type {number[]} */
  const sums = new Array(vertexCount).fill(0);
  for (const name of groupNames) {
    const g = mesh.weightGroups[name];
    for (let i = 0; i < vertexCount; i++) {
      const w = Number(g[i]);
      if (Number.isFinite(w) && w > 0) sums[i] += w;
    }
  }

  /** @type {Record<string, number[]>} */
  const next = {};
  for (const name of groupNames) {
    next[name] = mesh.weightGroups[name].slice();
  }

  let normalized = 0;
  let zeroSumVerts = 0;
  for (let i = 0; i < vertexCount; i++) {
    const s = sums[i];
    if (!Number.isFinite(s) || s <= 0) {
      zeroSumVerts++;
      continue;
    }
    if (Math.abs(s - 1) < 1e-6) continue;  // already normalised
    for (const name of groupNames) {
      const w = Number(next[name][i]) || 0;
      next[name][i] = w / s;
    }
    normalized++;
  }

  if (normalized === 0) {
    return { normalized: 0, skipped: false,
             vertexCount, groupCount: groupNames.length, zeroSumVerts };
  }

  // One snapshot for the entire normalize op (multi-group write).
  const setWeightGroup = useProjectStore.getState().setWeightGroup;
  beginBatch(project);
  try {
    for (const name of groupNames) {
      setWeightGroup(partId, name, next[name]);
    }
  } finally {
    endBatch();
  }
  return {
    normalized, skipped: false,
    vertexCount, groupCount: groupNames.length, zeroSumVerts,
  };
}

/** Selection-side gate used by the operator-registry `available()` hook. */
export function eligibleForNormalize() {
  const editor = useEditorStore.getState();
  if (editor.editMode !== 'weightPaint') return false;
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') return false;
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') return false;
  const mesh = getMesh(node, project);
  if (!mesh || !mesh.weightGroups) return false;
  // At least one group must have at least one non-zero weight, else
  // there's nothing to normalize.
  for (const name of Object.keys(mesh.weightGroups)) {
    const g = mesh.weightGroups[name];
    if (Array.isArray(g) && g.some((w) => Number(w) > 0)) return true;
  }
  return false;
}
