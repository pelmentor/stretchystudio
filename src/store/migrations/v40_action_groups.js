// @ts-check

/**
 * v40 — Animation Phase 5 Slice 5.V: action.groups[] + fcurve.groupId.
 *
 * Adds the FCurveGroup datablock (Blender's `bActionGroup` at
 * `reference/blender/source/blender/makesdna/DNA_action_types.h:993-1044`)
 * to every action in the project. Auto-populates each action's
 * `groups[]` from existing fcurve targets via
 * [groupFCurvesByTarget](../../anim/fcurveGroups.js), assigning
 * `fcurve.groupId` to every node-targeting curve. Param-targeting and
 * untyped-target fcurves stay ungrouped (no `groupId`) — matching
 * Blender's "ungrouped" tail bucket in the Graph Editor sidebar.
 *
 * # Idempotency
 *
 * Re-running the migration is safe:
 *   - `groupFCurvesByTarget` reuses existing group entries by id
 *     (`g_node_${nodeId}`) rather than creating duplicates.
 *   - User-renamed groups survive because the id is stable across
 *     reloads; only the auto-generated `name` is set on first
 *     creation, not overwritten on subsequent passes.
 *   - Empty groups (whose source fcurves were deleted between passes)
 *     stay in the array; a future "compact groups" op would purge
 *     them. Not in scope for v40.
 *
 * # Per Rule №2 (no migration baggage)
 *
 * No sparse-default writes: groups that need no flag carry no flag
 * fields. `expanded` is treated as default-true by readers; not
 * written explicitly. `mute` / `hide` / `selected` stay absent on
 * fresh groups (default-false at read time).
 *
 * # Node-name resolution
 *
 * The migration needs each node's display name to seed the group's
 * `name` field. Resolved from `project.nodes` by id; falls back to
 * the node id itself when the node is missing (defensive — old projects
 * may have orphaned fcurves pointing at deleted nodes).
 *
 * @module store/migrations/v40_action_groups
 */

import { groupFCurvesByTarget } from '../../anim/fcurveGroups.js';

/**
 * @param {object} project — mutated in place
 * @returns {{ actionsMigrated: number, groupsCreated: number, fcurvesAssigned: number }}
 */
export function migrateActionGroups(project) {
  if (!project || typeof project !== 'object') {
    return { actionsMigrated: 0, groupsCreated: 0, fcurvesAssigned: 0 };
  }
  const actions = Array.isArray(project.actions) ? project.actions : [];
  if (actions.length === 0) {
    return { actionsMigrated: 0, groupsCreated: 0, fcurvesAssigned: 0 };
  }

  // Resolve node display name by id from project.nodes. Falls back to
  // the id when the node is missing (orphaned fcurve scenario).
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const nameById = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string') {
      nameById.set(n.id, typeof n.name === 'string' && n.name.length > 0 ? n.name : n.id);
    }
  }
  /** @param {string} nodeId */
  const nameFromNodeId = (nodeId) => nameById.get(nodeId) ?? nodeId;

  let actionsMigrated = 0;
  let groupsCreated = 0;
  let fcurvesAssigned = 0;
  for (const action of actions) {
    if (!action || !Array.isArray(action.fcurves)) continue;
    const groupsBefore = Array.isArray(action.groups) ? action.groups.length : 0;
    const touched = groupFCurvesByTarget(action, nameFromNodeId);
    const groupsAfter = Array.isArray(action.groups) ? action.groups.length : 0;
    actionsMigrated++;
    groupsCreated += Math.max(0, groupsAfter - groupsBefore);
    fcurvesAssigned += touched;
  }

  return { actionsMigrated, groupsCreated, fcurvesAssigned };
}
