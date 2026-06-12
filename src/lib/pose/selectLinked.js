// @ts-check

/**
 * Pose Mode linked-bone selection — shared algorithm used by:
 *   - `select.linked.cursor` operator (L keymap chord) when in Pose Mode
 *   - SkeletonOverlay's Ctrl+LMB bone-click handler
 *
 * Mirrors Blender's `pose.select_linked` / `pose.select_linked_pick`:
 * walks parent chain from each seed bone to find the armature root
 * (first non-bone ancestor), then collects every visible bone in the
 * project whose chain reaches one of those roots.
 *
 * Pure function — receives the project + seed bone ids, returns the
 * linked bone ids. Side-effect-free; callers handle the actual
 * selection-store mutation.
 *
 * @module lib/pose/selectLinked
 */

/**
 * @param {any} node
 * @returns {boolean}
 */
function isBone(node) {
  return !!node && node.type === 'group'
    && typeof node.boneRole === 'string' && node.boneRole.length > 0;
}

/**
 * Compute the set of bones linked to the given seed bones via armature
 * containment. Multi-armature seeds produce the union of all hit
 * armatures' bones.
 *
 * @param {{ nodes?: Array<any> } | null | undefined} project
 * @param {ReadonlyArray<string>} seedBoneIds
 * @returns {Set<string>}
 */
export function computeLinkedBoneIds(project, seedBoneIds) {
  const result = new Set();
  if (!project?.nodes || seedBoneIds.length === 0) return result;
  const byId = new Map();
  for (const n of project.nodes) if (n?.id) byId.set(n.id, n);

  // Reject any seed that isn't a bone — defensive against stale ids
  // or accidental non-bone passes.
  const validSeeds = seedBoneIds.filter((id) => isBone(byId.get(id)));
  if (validSeeds.length === 0) return result;

  // Find each seed's armature root (first non-bone ancestor). Top-level
  // bones (no parent) share a sentinel "__projectRoot__" — supports
  // ad-hoc rigs without an enclosing armature node.
  const PROJECT_ROOT = '__projectRoot__';
  const armatureRootIds = new Set();
  for (const sid of validSeeds) {
    let cur = byId.get(sid);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (!cur.parent) { armatureRootIds.add(PROJECT_ROOT); break; }
      const parent = byId.get(cur.parent);
      if (!parent) break;
      if (!isBone(parent)) { armatureRootIds.add(parent.id); break; }
      cur = parent;
    }
  }
  if (armatureRootIds.size === 0) return result;

  // Walk each visible bone's chain to find ITS armature root. Memoise
  // per-bone-root so a deep armature doesn't re-walk the shared upper
  // chain N times.
  /** @type {Map<string, string|null>} */
  const boneToRoot = new Map();
  const rootOf = (id) => {
    if (boneToRoot.has(id)) return boneToRoot.get(id);
    let cur = byId.get(id);
    const path = [];
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.push(cur.id);
      if (!cur.parent) {
        for (const p of path) boneToRoot.set(p, PROJECT_ROOT);
        return PROJECT_ROOT;
      }
      const parent = byId.get(cur.parent);
      if (!parent) break;
      if (!isBone(parent)) {
        for (const p of path) boneToRoot.set(p, parent.id);
        return parent.id;
      }
      cur = parent;
    }
    for (const p of path) boneToRoot.set(p, null);
    return null;
  };

  for (const n of project.nodes) {
    if (!isBone(n)) continue;
    if (n.visible === false) continue;
    const r = rootOf(n.id);
    if (r && armatureRootIds.has(r)) result.add(n.id);
  }
  return result;
}

/**
 * Predicate exposed so callers can detect bone selection without
 * re-importing the helper from objectDataAccess.
 *
 * @param {any} node
 * @returns {boolean}
 */
export function isBoneGroupNode(node) {
  return isBone(node);
}
