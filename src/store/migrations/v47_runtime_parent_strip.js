// @ts-check

/**
 * v47 — `mesh.runtime.parent` field strip (RULE №4 Slice M3.3 cleanup).
 *
 * # Why this exists
 *
 * The persisted field `part.mesh.runtime.parent` (shape:
 * `{type: 'warp'|'rotation'|'part'|'root', id: string|null}`) was a
 * Cubism-shaped cache of the part's modifier-chain leaf. The 3-way
 * drift hazard (`part.modifiers[]` vs `part.rigParent` vs
 * `mesh.runtime.parent`) was the RULE-№4 audit's #2 highest-impact open
 * item; the modifier-stack flip plan retired the field across six
 * shipped slices (M1/M2.1/M2.2/M3.1/M3.2/M5).
 *
 * v47 is the final cleanup: after Slice M3.3 dropped the last reader
 * (the v44 migration's redundant `|| p.mesh?.runtime?.parent?.id ===
 * def.id` OR-branch, made redundant by `p.rigParent === def.id` on
 * pre-v44 saves) AND the writer (`persistArtMeshRuntime` and the v44
 * migration's `rt.parent = parentRef` line), v47 walks every part and
 * deletes the `parent` sub-field from `mesh.runtime`. The rest of
 * `mesh.runtime` (`bindings`, `keyforms`) is untouched — those are
 * still actively read by selectRigSpec + chainEval.
 *
 * # Coverage
 *
 * Pre-v47 parts can be in any of these states:
 *   1. `mesh.runtime.parent` present (live writer output before M3.3 +
 *      every persisted save written by any prior schema version).
 *      Action: delete the sub-field, leave `mesh.runtime` itself in
 *      place with `bindings` + `keyforms`.
 *   2. `mesh.runtime` present without `parent` (no-op — fresh post-M3.3
 *      writes already omit the field; survives the migration unchanged).
 *   3. `mesh.runtime` absent (parts without rig data; no-op).
 *   4. `node.mesh` absent or non-object (defensive; no-op).
 *
 * # RULE №2 alignment
 *
 * This migration is the canonical "shim-free retirement" pattern from
 * `projectMigrations.js` header → "Retiring a migration": add a cleanup
 * step at `CURRENT_SCHEMA_VERSION+1` that strips the now-stale field
 * (mirror v38 → `project.nodeTrees`). The redundant reader and the
 * writer are both gone from the live tree as of M3.3; v47 ensures the
 * persisted data matches.
 *
 * @module store/migrations/v47_runtime_parent_strip
 */

/**
 * @param {object} project
 * @returns {object}
 */
export function migrateRuntimeParentStrip(project) {
  if (!project || !Array.isArray(project.nodes)) return project;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    const rt = node.mesh?.runtime;
    if (rt && typeof rt === 'object' && 'parent' in rt) {
      delete rt.parent;
    }
  }
  return project;
}
