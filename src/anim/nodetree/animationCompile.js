// @ts-check

/**
 * Action → AnimationTree builder.
 *
 * Phase N-3 of the V2 plan. One AnimationTree per action; one
 * `FCurveStrip` node per fcurve in the action; one `TimelineOutput`
 * sink that collects every strip's output.
 *
 * Tree id convention: `'animation:<actionId>'`.
 *
 * NOTE: NodeTree retirement is a separate follow-up commit (per the
 * post-v36 rewire plan); this compile pass stays alive but rewired
 * to walk `action.fcurves` instead of legacy `animation.tracks`.
 *
 * @module anim/nodetree/animationCompile
 */

import { addNodeToTree, addLinkToTree, makeNodeTree, NodeTreeType } from './types.js';

/**
 * @param {object} action - SS action datablock ({id, fcurves: [...]})
 * @returns {import('./types.js').NodeTree}
 */
export function compileAnimationTree(action) {
  const actionId = action?.id ?? 'untitled';
  const tree = makeNodeTree(`animation:${actionId}`, NodeTreeType.ANIMATION, {
    actionId,
  });

  const outputId = `${actionId}__output`;
  addNodeToTree(tree, {
    id: outputId,
    typeId: 'TimelineOutput',
    inputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'input', defaultValue: 0 }],
    outputs: [],
    position: [600, 0],
  });

  const fcurves = Array.isArray(action?.fcurves) ? action.fcurves : [];
  let xPos = 0;
  let yPos = 0;
  let lastStripId = null;
  for (let i = 0; i < fcurves.length; i++) {
    const fc = fcurves[i];
    if (!fc) continue;
    const stripId = `${actionId}__strip_${i}`;
    addNodeToTree(tree, {
      id: stripId,
      typeId: 'FCurveStrip',
      inputs: [],
      outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
      // Store the full fcurve record so eval can dispatch through the
      // same code path as `evaluateActionFCurves` / `evaluateFCurve`.
      storage: { fcurve: fc },
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
