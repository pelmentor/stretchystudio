// @ts-check

/**
 * Toolset Plan Phase 7.A.3 — Set Parent (`Ctrl+P`).
 *
 * Implements Blender's `OBJECT_OT_parent_set` (`reference/blender/source/
 * blender/editors/object/object_relations.cc:1100` — operator registration;
 * audit fix D-8 corrected a pre-existing wrong cite at `:475+` which is
 * inside the `parent_set()` data helper, not the operator def). Hotkey:
 * `Ctrl+P` per `blender_default.py:4509` (audit fix D-5 corrected a
 * pre-existing wrong cite at `:4546`).
 *
 * Selection semantics:
 *   - Active = LAST entry in `selectionStore.items` (Blender pattern).
 *   - Children = every other selected node (active itself is not
 *     reparented to itself).
 *   - Result: each non-active node's `parent` is set to active's id.
 *
 * Cycle detection + same-scene validation handled by projectStore's
 * `reparentNode` (already enforces no cycles, no bone→part). Bones can
 * be parented to other bones (same armature) — that case is in scope
 * but rare in 2D rigging.
 *
 * Type compatibility (per `reparentNode`):
 *   - bone → part:  blocked
 *   - part → bone:  permitted (the part follows the bone — Cubism's
 *                   "rigid" pattern; matches BVR-006 user expectation)
 *   - group → group: permitted
 *   - any → none (root): permitted
 *
 * # Keep Transform — DEFAULT
 *
 * Blender's default for `OBJECT_OT_parent_set` keeps the visual position
 * (the new child's local transform compensates for the parent's world
 * matrix). Mirroring that here: after reparenting, write the child's
 * `transform.x/y` so its world origin is unchanged.
 *
 * "Without Inverse" (the Blender variant where the child's local
 * transform IS NOT updated → child snaps to wherever the math implies)
 * is exposed via the `keepTransform: false` flag. Default is
 * `keepTransform: true`.
 *
 * @module v3/operators/object/parent
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { computeWorldMatrices } from '../../../renderer/transforms.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import { worldToParentLocal, nodeWorldOrigin } from './snap.js';
import { toast } from '../../../hooks/use-toast.js';

/**
 * Set parent of every non-active selected node to active's id.
 *
 * @param {{ keepTransform?: boolean }} [opts]
 * @returns {{ parented: number, skipped: number, activeId: string|null }}
 */
export function setParent({ keepTransform = true } = {}) {
  const items = useSelectionStore.getState().items ?? [];
  if (items.length < 2) {
    return { parented: 0, skipped: 0, activeId: null };
  }
  const eligible = items.filter((it) => it?.type === 'part' || it?.type === 'group');
  if (eligible.length < 2) {
    return { parented: 0, skipped: 0, activeId: null };
  }
  const activeRef = eligible[eligible.length - 1];
  const activeId = activeRef?.id ?? null;
  if (!activeId) return { parented: 0, skipped: 0, activeId: null };

  const project = useProjectStore.getState().project;
  const reparentNode = useProjectStore.getState().reparentNode;

  // Pre-capture world matrices so per-child compensation reads stable
  // pre-mutation positions (reparent is recursive across multiple
  // children — the second child's world matrix would already shift
  // mid-loop if we recomputed each iteration).
  const worldMatrices = keepTransform
    ? computeWorldMatrices(project.nodes)
    : null;

  // Audit fix G-1 — beginBatch needs `project` for a real snapshot.
  beginBatch(project);
  let parented = 0;
  let skipped = 0;
  try {
    for (const it of eligible) {
      const childId = it.id;
      if (childId === activeId) continue;
      const child = project.nodes.find((n) => n?.id === childId);
      if (!child) { skipped++; continue; }
      // Capture child's world origin BEFORE reparent.
      const preWorld = worldMatrices ? nodeWorldOrigin(childId, worldMatrices) : null;
      // reparentNode validates cycles + type pairings; no-ops on rejection.
      reparentNode(childId, activeId);
      // Did it actually take? Re-read post-mutation.
      const post = useProjectStore.getState().project.nodes.find((n) => n?.id === childId);
      if (!post || post.parent !== activeId) { skipped++; continue; }

      if (keepTransform && preWorld) {
        // Compensate transform.x/y so visual world position is unchanged.
        // We need the NEW parent's world matrix (= active's world from
        // the same pre-mutation snapshot, since parents that aren't
        // reparented stay put — and we only ever set parent to active).
        const local = worldToParentLocal(post, worldMatrices, project, preWorld.x, preWorld.y);
        useProjectStore.getState().updateProject((proj, vc) => {
          const target = proj.nodes.find((n) => n?.id === childId);
          if (!target?.transform) return;
          target.transform.x = local.x;
          target.transform.y = local.y;
          if (vc) vc.transformVersion++;
        });
      }
      parented++;
    }
  } finally {
    endBatch();
  }
  return { parented, skipped, activeId };
}

// ── Clear Parent (Phase 7.A.4) ───────────────────────────────────────

/**
 * Clear parent on every selected node.
 *
 * Three modes mirroring Blender's `OBJECT_OT_parent_clear`
 * (`reference/blender/source/blender/editors/object/object_relations.cc:444`
 * — operator registration; enum starts at `:315`):
 *
 *   - 'clear'              — set parent=null; child world position changes
 *                             (matches Blender's `CLEAR_PARENT_ALL`).
 *   - 'keepTransform'      — set parent=null + write transform.x/y so
 *                             child stays visually in place. Default.
 *                             (Blender's `CLEAR_PARENT_KEEP_TRANSFORM`).
 *   - 'inverse'            — Blender's `CLEAR_PARENT_INVERSE`
 *                             (`object_relations.cc:411-420`): keeps the
 *                             object PARENTED but resets `parentinv` to
 *                             identity. SS does not model `parentinv` as
 *                             a separate field, so we cannot replicate
 *                             this exactly. Audit fix D-1: emit a toast
 *                             and exit WITHOUT touching `node.parent`
 *                             (pre-fix this fell through to plain clear,
 *                             which silently unparented the child — a
 *                             destructive surprise to Blender users).
 *
 * @param {'clear' | 'keepTransform' | 'inverse'} mode
 * @returns {{ cleared: number, skipped: number, mode: string, inverseUnsupported?: boolean }}
 */
export function clearParent(mode = 'keepTransform') {
  // Audit fix D-1 — 'inverse' mode is a no-op with a toast in SS. Blender
  // keeps the parent intact and resets `parentinv`; SS has no parentinv
  // store, so silently falling through to plain clear (pre-fix behaviour)
  // would unparent the child — the OPPOSITE of what the user expects.
  if (mode === 'inverse') {
    toast({
      title: 'Clear Parent Inverse not supported',
      description: 'SS has no parentInv store. Use "Clear Parent" or "Clear and Keep Transform" instead.',
    });
    return { cleared: 0, skipped: 0, mode, inverseUnsupported: true };
  }
  const items = useSelectionStore.getState().items ?? [];
  const eligible = items.filter((it) => it?.type === 'part' || it?.type === 'group');
  if (eligible.length === 0) {
    return { cleared: 0, skipped: 0, mode };
  }
  const project = useProjectStore.getState().project;
  const reparentNode = useProjectStore.getState().reparentNode;
  const worldMatrices = mode === 'keepTransform'
    ? computeWorldMatrices(project.nodes)
    : null;

  // Audit fix G-1 — beginBatch needs `project` for a real snapshot.
  beginBatch(project);
  let cleared = 0;
  let skipped = 0;
  try {
    for (const it of eligible) {
      const childId = it.id;
      const child = project.nodes.find((n) => n?.id === childId);
      if (!child || (child.parent ?? null) === null) { skipped++; continue; }
      const preWorld = worldMatrices ? nodeWorldOrigin(childId, worldMatrices) : null;
      reparentNode(childId, null);
      const post = useProjectStore.getState().project.nodes.find((n) => n?.id === childId);
      if (!post || (post.parent ?? null) !== null) { skipped++; continue; }
      if (mode === 'keepTransform' && preWorld) {
        // No parent now → world == local; just write the captured world
        // origin straight into transform.x/y.
        useProjectStore.getState().updateProject((proj, vc) => {
          const target = proj.nodes.find((n) => n?.id === childId);
          if (!target?.transform) return;
          target.transform.x = preWorld.x;
          target.transform.y = preWorld.y;
          if (vc) vc.transformVersion++;
        });
      }
      cleared++;
    }
  } finally {
    endBatch();
  }
  return { cleared, skipped, mode };
}
