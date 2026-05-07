// @ts-check

/**
 * Animation-clip → AnimationTree builder.
 *
 * Phase N-3 of the V2 plan. One AnimationTree per clip; one
 * `FCurveStrip` node per track in the clip; one `TimelineOutput`
 * sink that collects every strip's output.
 *
 * Tree id convention: `'animation:<animationId>'`.
 *
 * @module anim/nodetree/animationCompile
 */

import { addNodeToTree, addLinkToTree, makeNodeTree, NodeTreeType } from './types.js';

/**
 * @param {object} animation - SS animation clip ({id, tracks: [...]})
 * @returns {import('./types.js').NodeTree}
 */
export function compileAnimationTree(animation) {
  const animId = animation?.id ?? 'untitled';
  const tree = makeNodeTree(`animation:${animId}`, NodeTreeType.ANIMATION, {
    animationId: animId,
  });

  const outputId = `${animId}__output`;
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
    const stripId = `${animId}__strip_${i}`;
    addNodeToTree(tree, {
      id: stripId,
      typeId: 'FCurveStrip',
      inputs: [],
      outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
      // Store the full track record so eval can dispatch through the
      // same code path as the existing animationEngine.
      storage: { track },
      position: [xPos, yPos],
    });
    yPos += 80;
    lastStripId = stripId;
  }

  // Link only the last strip into TimelineOutput (cosmetic — Phase N-5
  // editor will reveal per-strip wiring; for now strips drive the
  // overrides directly via side effect, and TimelineOutput is just a
  // visible sink).
  if (lastStripId) {
    addLinkToTree(tree, {
      fromNode: lastStripId, fromSocket: 'value',
      toNode: outputId, toSocket: 'value',
    });
  }

  return tree;
}
