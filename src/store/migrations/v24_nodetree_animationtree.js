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
 * # Migration ordering note (post-v36)
 *
 * v24 runs at schema 24 — BEFORE v36 lifts `project.animations` →
 * `project.actions`. So this migration sees the legacy track shape
 * (`{paramId | (nodeId, property), keyframes}`). After v36 the project
 * shape changes, but the AnimationTree shadow stays frozen at v24's
 * legacy shape (the v24 migration only ever runs once per project).
 *
 * The v36 follow-up commit (NodeTree retirement) deletes the
 * `nodeTrees.animation` shadow entirely — until then it remains as
 * read-only stale snapshot data, accessed only by the NodeTreeEditor
 * which renders it as a structural diagram.
 *
 * # Why a self-contained inline builder
 *
 * Pre-v36 this called `compileAnimationTree(anim)` which read
 * `anim.tracks`. Post-v36 `compileAnimationTree` expects an action
 * with `.fcurves`. To keep v24 time-locked to the schema state it
 * actually sees (legacy tracks), the compile is inlined here. No
 * dependency on the evolving `compileAnimationTree` signature.
 *
 * @module store/migrations/v24_nodetree_animationtree
 */

import { addNodeToTree, addLinkToTree, makeNodeTree, NodeTreeType } from '../../anim/nodetree/types.js';
// Side-effect import: registers FCurveStrip + TimelineOutput in the
// node-type registry.
import '../../anim/nodetree/nodes/animation.js';

/**
 * Compile a legacy `{id, tracks: [...]}` animation clip into an
 * AnimationTree. Time-locked to the v24 schema state — does NOT depend
 * on the post-v36 `compileAnimationTree(action)` signature.
 *
 * @param {object} animation - legacy clip with `.tracks[]`
 * @returns {import('../../anim/nodetree/types.js').NodeTree}
 */
function compileLegacyAnimationTree(animation) {
  const animationId = animation?.id ?? 'untitled';
  const tree = makeNodeTree(`animation:${animationId}`, NodeTreeType.ANIMATION, {
    actionId: animationId,
  });

  const outputId = `${animationId}__output`;
  addNodeToTree(tree, {
    id: outputId,
    typeId: 'TimelineOutput',
    inputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'input', defaultValue: 0 }],
    outputs: [],
    position: [600, 0],
  });

  const tracks = Array.isArray(animation?.tracks) ? animation.tracks : [];
  let xPos = 0;
  let yPos = 0;
  let lastStripId = null;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track) continue;
    const stripId = `${animationId}__strip_${i}`;
    addNodeToTree(tree, {
      id: stripId,
      typeId: 'FCurveStrip',
      inputs: [],
      outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
      // Store the full track record so eval can dispatch through
      // `interpolateTrack`.
      storage: { track },
      position: [xPos, yPos],
    });
    yPos += 80;
    lastStripId = stripId;
  }

  if (lastStripId) {
    addLinkToTree(tree, {
      fromNode: lastStripId, fromSocket: 'value',
      toNode: outputId, toSocket: 'value',
    });
  }

  return tree;
}

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
    trees[anim.id] = compileLegacyAnimationTree(anim);
  }
  project.nodeTrees.animation = trees;

  return project;
}
