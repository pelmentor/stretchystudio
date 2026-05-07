// @ts-check

/**
 * v22 — Blender Parity V2 Phase N-1: RigTree datablock migration.
 *
 * Lifts every part's `modifiers[]` into a derived `RigTree` node tree
 * stored on `project.nodeTrees.rig[partId]`. The modifier stack stays
 * canonical for one release (Refactor 1's eval engine still reads it);
 * the tree is the dual-write shadow that Phase N-4/N-5's visual
 * editor renders.
 *
 * # Idempotency
 *
 * Re-running the migration overwrites existing `nodeTrees.rig` entries
 * with freshly-built trees — the build is deterministic on the
 * canonical `part.modifiers[]` shape, so re-runs converge.
 *
 * # Schema shape post-v22
 *
 *   project.nodeTrees = {
 *     rig:       { [partId]: RigTree },
 *     driver:    {},   // populated by v23 (Phase N-2)
 *     animation: {},   // populated by v24 (Phase N-3)
 *   }
 *
 * Every part with a non-empty `modifiers[]` gets a tree; parts with
 * empty stacks ALSO get a (minimal) tree containing only PartInput +
 * PartOutput. This keeps the editor consistent — every part shows the
 * graph view even when no modifiers are present yet.
 *
 * # Reference
 *
 * Adapted from Blender's `versioning_350.cc` (and adjacent files)
 * pattern of lifting older inline data into NodeTree datablocks.
 *
 * @module store/migrations/v22_nodetree_rigtree
 */

import { buildRigTreesForProject } from '../../anim/nodetree/build.js';

/**
 * @param {object} project - mutated in place
 */
export function migrateNodeTreeRigTree(project) {
  if (!project) return project;
  if (!Array.isArray(project.nodes)) return project;

  if (!project.nodeTrees || typeof project.nodeTrees !== 'object') {
    project.nodeTrees = { rig: {}, driver: {}, animation: {} };
  } else {
    if (!project.nodeTrees.rig)       project.nodeTrees.rig = {};
    if (!project.nodeTrees.driver)    project.nodeTrees.driver = {};
    if (!project.nodeTrees.animation) project.nodeTrees.animation = {};
  }

  // Build rig trees for every part. buildRigTreesForProject mutates
  // project.nodeTrees.rig in place.
  buildRigTreesForProject(project);

  return project;
}
