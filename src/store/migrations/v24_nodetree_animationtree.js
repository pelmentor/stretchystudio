// @ts-check

/**
 * v24 — Blender Parity V2 Phase N-3: AnimationTree datablock migration.
 *
 * Lifts every `project.animations[i]` clip into a derived
 * `AnimationTree` stored on `project.nodeTrees.animation[clipId]`.
 *
 * Each tree contains one `FCurveStrip` per track + a `TimelineOutput`
 * sink. The strips evaluate via `interpolateTrack` (same code path as
 * `animationEngine.computeParamOverrides` / `computePoseOverrides`),
 * so byte-equivalence is mechanical.
 *
 * # Side-by-side with N-1 + N-2
 *
 * v24 doesn't touch `animation.tracks[]`; the tracks stay canonical
 * for one release. The tree is a dual-write shadow for the Phase N-4
 * visual editor.
 *
 * @module store/migrations/v24_nodetree_animationtree
 */

import { compileAnimationTree } from '../../anim/nodetree/animationCompile.js';
// Side-effect import: registers FCurveStrip + TimelineOutput in the
// node-type registry.
import '../../anim/nodetree/nodes/animation.js';

/**
 * @param {object} project - mutated in place
 */
export function migrateNodeTreeAnimationTree(project) {
  if (!project) return project;

  if (!project.nodeTrees || typeof project.nodeTrees !== 'object') {
    project.nodeTrees = { rig: {}, driver: {}, animation: {} };
  } else {
    if (!project.nodeTrees.rig)       project.nodeTrees.rig = {};
    if (!project.nodeTrees.driver)    project.nodeTrees.driver = {};
    if (!project.nodeTrees.animation) project.nodeTrees.animation = {};
  }

  /** @type {Record<string, import('../../anim/nodetree/types.js').NodeTree>} */
  const trees = {};
  for (const anim of project.animations ?? []) {
    if (!anim?.id) continue;
    trees[anim.id] = compileAnimationTree(anim);
  }
  project.nodeTrees.animation = trees;

  return project;
}
