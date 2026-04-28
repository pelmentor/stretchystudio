// @ts-check

/**
 * v3 Phase 0F.11 - Pure helpers for the wizard re-rig flow.
 *
 * When the user re-runs rigging in the PSD import wizard, every
 * group node previously created by an earlier rig pass for the
 * same set of parts must be removed before the new rig structure
 * is built - otherwise rigs from the previous attempt linger as
 * orphaned siblings.
 *
 * `findAncestorGroupsForCleanup` walks up the parent chain from
 * the given partIds and returns the set of group ids that should
 * be deleted. Walks BFS so deeply-nested rigs (group → group →
 * group → part) are caught at every level.
 *
 * Pure: no project mutation, no DOM, no React. Same inputs always
 * produce the same Set.
 *
 * @module components/canvas/viewport/rigGroupCleanup
 */

/**
 * @typedef {Object} NodeLike
 * @property {string} id
 * @property {string|null} parent
 * @property {('part'|'group')} type
 */

/**
 * Find the set of group node ids that should be deleted when
 * re-rigging a subset of parts. Walks up from the parts, marking
 * each ancestor group reachable through the parent chain.
 *
 * @param {NodeLike[]} nodes      - flat node array
 * @param {Iterable<string>} partIds - parts whose previous rig
 *                                  groups should be removed
 * @returns {Set<string>}         - group ids safe to delete
 */
export function findAncestorGroupsForCleanup(nodes, partIds) {
  const psdSet = new Set(partIds);
  /** @type {Set<string>} */
  const toDelete = new Set();
  // BFS frontier - the parts kick it off, each iteration moves up
  // one level via .parent.
  let currentLevel = nodes.filter((n) => psdSet.has(n.id));

  while (currentLevel.length > 0) {
    /** @type {NodeLike[]} */
    const nextLevel = [];
    for (const n of currentLevel) {
      if (n.parent && !toDelete.has(n.parent)) {
        toDelete.add(n.parent);
        const parentNode = nodes.find((p) => p.id === n.parent);
        // Only continue walking up through GROUPS - we don't want
        // to climb past a non-group ancestor (defensive; in
        // practice the parent of a group should always be another
        // group or null).
        if (parentNode && parentNode.type === 'group') {
          nextLevel.push(parentNode);
        }
      }
    }
    currentLevel = nextLevel;
  }
  return toDelete;
}
