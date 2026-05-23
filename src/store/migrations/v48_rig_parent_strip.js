// @ts-check

/**
 * v48 — `part.rigParent` field strip (RULE №4 Slice M4 cleanup).
 *
 * # Why this exists
 *
 * The persisted field `part.rigParent` was a Cubism-shaped pointer at
 * the part's modifier-chain leaf (a deformer id, or a v43 lattice
 * object id). It existed alongside the Blender-faithful
 * `part.modifiers[]` stack — the 3-way drift hazard the RULE-№4 audit
 * flagged. The modifier-stack flip plan progressively retired
 * `rigParent` as a runtime signal:
 *   - **M1** (2026-05-23): authoring callers (`seedRigWarps`/
 *     `clearRigWarps`) flipped from writing `rigParent` to writing
 *     `modifiers[0]`. The synth started reading `modifiers[0]` FIRST
 *     and treated `rigParent` as a legacy fallback.
 *   - **M2.1 / M2.2 / M5**: retired dead read paths in the depgraph
 *     kernel, selectRigSpec gate, and rotation-modifier display filter.
 *   - **M3.1 / M3.2 / M3.3**: retired `mesh.runtime.parent` end-to-end
 *     (v47 strip migration).
 *   - **M4** (THIS): retires `rigParent` end-to-end. `synthesizeModifierStacks`
 *     no longer reads it (v20 schema migration was inlined with a
 *     rigParent→modifiers[0] bootstrap to keep pre-v20 saves walking).
 *     `selectRigSpec`'s pre-rig fallback no longer reads it (falls back
 *     to `innermostBodyWarpId` instead). `synthesizeDeformerParents` no
 *     longer writes it (still maintains `deformer.parent` chain links
 *     for export). v44 runtime migration's `rigParent = null` cleanup +
 *     OR-branch `partsOf` filter are retired (topology signal
 *     `part.parent === groupName` is sufficient).
 *
 * v48 is the final cleanup: walk every persisted node and delete
 * `rigParent` from parts AND from lattice object nodes (the v43
 * migration copied `rigParent` onto the synthesised lattice object
 * node, where it was harmless orphan data; the strip removes that
 * surface).
 *
 * # Coverage
 *
 * Pre-v48 nodes can be in any of these states:
 *   1. Part node with `rigParent: 'someDeformerId'` (live writer
 *      output before M4 + every persisted save written by any prior
 *      schema version). Action: delete the property.
 *   2. Part node with `rigParent: null` (legacy `clearRigWarps`
 *      output before M4 also nulled the field). Action: same — delete
 *      the property so the shape is fully clean.
 *   3. Part node without `rigParent` (no-op — fresh post-M4 writes
 *      already omit the field).
 *   4. Lattice object node (`type: 'object', objectKind: 'lattice'`)
 *      with `rigParent` copied from a pre-v43 warp deformer. Action:
 *      delete the property — harmless orphan data, but a clean sweep
 *      removes drift surface.
 *   5. Any other node type (deformer, group, etc.). Action: no-op.
 *
 * # RULE №2 alignment
 *
 * Canonical "shim-free retirement" per `projectMigrations.js` header.
 * The v15 migration still writes `rigParent` via
 * `synthesizeDeformerNodesFromSidetables` — that runs at v15 (well
 * before v48), and the v20 migration's inlined bootstrap consumes it
 * to seed `modifiers[0]`; v48 then strips the field. The v43 migration
 * still copies `rigParent` onto lattice object nodes — also runs at
 * v43, before v48. Migration ordering is sequential, so the field
 * survives just long enough for the upstream consumers.
 *
 * @module store/migrations/v48_rig_parent_strip
 */

/**
 * @param {object} project
 * @returns {object}
 */
export function migrateRigParentStrip(project) {
  if (!project || !Array.isArray(project.nodes)) return project;
  for (const node of project.nodes) {
    if (!node) continue;
    const isPart = node.type === 'part';
    const isLatticeObject = node.type === 'object' && node.objectKind === 'lattice';
    if (!isPart && !isLatticeObject) continue;
    if ('rigParent' in node) {
      delete node.rigParent;
    }
  }
  return project;
}
