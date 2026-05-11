// @ts-check

/**
 * v38 — Animation Phase 1 Stage 1.F (preceding): NodeTree retirement.
 *
 * The V2 plan shipped `project.nodeTrees.{rig, driver, animation}` as
 * a dual-write shadow of `part.modifiers[]` / `param.driver` /
 * `project.actions[i].fcurves[]`. Per Animation Phase 1's audit-driven
 * design (see `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1,
 * line 493), the NodeTree datablocks are retired here — the canonical
 * sources are all the data we need, and the NodeTreeEditor surface
 * derives trees on-the-fly via `buildRigTreeForPart` /
 * `compileDriverTree` / `compileAnimationTree`.
 *
 * # Blender deviation (Audit-fix D-2)
 *
 * Blender treats `bNodeTree` as a first-class `ID_NT` datablock peer
 * of `ID_OB` (`reference/blender/source/blender/makesdna/DNA_node_types.h:1879-1882`)
 * because Blender needs per-NodeTree undo, library linking, and
 * library overrides. SS's NodeTreeArea is read-only — undo flows
 * through canonical-source mutations, no library system, no
 * overrides. The retirement is semantically safe BECAUSE the
 * Blender-specific reasons to keep the datablock don't apply to SS.
 *
 * # The retirement
 *
 * - `project.nodeTrees.rig`       — was dual-write of `part.modifiers[]`.
 *   `buildRigTreeForPart(part)` recomputes it per render. Cheap (linear
 *   in modifier count; the chain is leaf-first walking).
 * - `project.nodeTrees.driver`    — was dual-write of `param.driver`.
 *   `compileDriverTree(paramId, driver)` recomputes it per render.
 *   (Deterministic on the driver record.)
 * - `project.nodeTrees.animation` — was a v24-shadow frozen at v23's
 *   pre-v36 track shape. Post-v36 the canonical fcurves carry rnaPath
 *   strings; `compileAnimationTree(action)` recomputes the tree from
 *   the action's fcurves directly.
 *
 * # Why a migration
 *
 * Old saves stamped at v22..v37 carry a `project.nodeTrees` field. The
 * NodeTreeArea read path was rewired to ignore it, but Rule №2 forbids
 * carrying stale data forward — old saves must be normalised on load
 * so the saved-and-reloaded shape stays canonical.
 *
 * # Shape
 *
 *   pre-v38:  project.nodeTrees = { rig: {...}, driver: {...}, animation: {...} }
 *   post-v38: (field absent)
 *
 * # Idempotency
 *
 * Re-running on a v38 project is a no-op — `delete obj.field` on a
 * missing field is harmless.
 *
 * # Companion clean-ups
 *
 * v22 / v23 / v24 entries in `projectMigrations.js` become no-op shims
 * (per the v30/v31 pattern) — the migration walker requires contiguous
 * versions. Their migration MODULES are deleted from disk; the entries
 * stay as pass-throughs so v0 → v38 pre-v38 saves walk cleanly.
 *
 * The `FCurveStrip` node-type executor's `storage.track` shadow branch
 * is deleted as part of this commit — that path was reachable only via
 * the v24 migration's `compileLegacyAnimationTree` (which is gone with
 * the v24 module).
 *
 * @module store/migrations/v38_nodetree_retirement
 */

/**
 * @param {object} project - mutated in place
 * @returns {object}
 */
export function migrateNodeTreeRetirement(project) {
  if (!project) return project;
  if ('nodeTrees' in project) {
    delete project.nodeTrees;
  }
  return project;
}
