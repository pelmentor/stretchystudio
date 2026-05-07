// @ts-check

/**
 * NodeTree builder — derive RigTree / DriverTree / AnimationTree
 * datablocks from the project.
 *
 * Phase N-1 of the V2 plan. Loose port of Blender's
 * `node_tree_runtime.cc` build flow + the migration shape from
 * `versioning_*.cc` files (where module-level migrations lift older
 * data into the current NodeTree shape).
 *
 * # RigTree shape (per part)
 *
 *   PartInput → [WarpModifier | RotationModifier]ⁿ → PartOutput
 *
 * The chain is leaf-first (matches `part.modifiers[]`'s convention —
 * leaf at index 0, root at index N-1). The first modifier reads the
 * PartInput's positions; each subsequent modifier reads the previous
 * modifier's output; PartOutput sinks the last modifier's output.
 *
 * # Idempotency
 *
 * Calling `buildRigTreeForPart` twice on the same part yields a
 * structurally identical tree (same node ids, same link tuples).
 * That makes the migration safe to re-run — Phase N-2's `riggingPath`
 * flag flip won't double-write.
 *
 * # Dual-write
 *
 * Phase N-1 ships in dual-write mode: `part.modifiers[]` STAYS the
 * canonical source. The RigTree is a derived view rebuilt by
 * `buildNodeTreesFromProject` whenever the canonical shape changes.
 * Phase N-2 will flip canonical → tree (after Refactor 1's flag flip,
 * per Rule 3).
 *
 * @module anim/nodetree/build
 */

import {
  makeNodeTree,
  addNodeToTree,
  addLinkToTree,
  NodeTreeType,
} from './types.js';

/**
 * Build a RigTree datablock for a single part. Returns the tree.
 *
 * Tree id convention: `'rig:<partId>'`.
 *
 * @param {object} part - project node with type='part' and modifiers[]
 * @returns {import('./types.js').NodeTree}
 */
export function buildRigTreeForPart(part) {
  const tree = makeNodeTree(`rig:${part.id}`, NodeTreeType.RIG, {
    partId: part.id,
  });
  const stack = Array.isArray(part?.modifiers) ? part.modifiers : [];

  // PartInput at the source. Always present.
  const partInputId = `${part.id}__input`;
  addNodeToTree(tree, {
    id: partInputId,
    typeId: 'PartInput',
    inputs: [],
    outputs: [{
      identifier: 'positions',
      name: 'Positions',
      type: 'mesh',
      inOut: 'output',
    }],
    position: [0, 0],
  });

  // Walk modifier stack leaf-first, emitting one node per modifier.
  let prevId = partInputId;
  let prevSocket = 'positions';
  let xPos = 200;
  for (let i = 0; i < stack.length; i++) {
    const mod = stack[i];
    if (!mod || typeof mod.deformerId !== 'string') continue;
    const typeId = mod.type === 'rotation' ? 'RotationModifier' : 'WarpModifier';
    const nodeId = `${part.id}__mod_${i}`;
    addNodeToTree(tree, {
      id: nodeId,
      typeId,
      inputs:  [{ identifier: 'positions', name: 'Positions', type: 'mesh', inOut: 'input'  }],
      outputs: [{ identifier: 'positions', name: 'Positions', type: 'mesh', inOut: 'output' }],
      storage: {
        deformerId: mod.deformerId,
        enabled: mod.enabled !== false,
        mode: typeof mod.mode === 'number' ? mod.mode : undefined,
        showInEditor: mod.showInEditor !== false,
        synthetic: mod.synthetic === true ? true : undefined,
      },
      position: [xPos, 0],
    });
    addLinkToTree(tree, {
      fromNode: prevId, fromSocket: prevSocket,
      toNode: nodeId,   toSocket: 'positions',
    });
    prevId = nodeId;
    prevSocket = 'positions';
    xPos += 200;
  }

  // PartOutput sinks. Always present.
  const partOutputId = `${part.id}__output`;
  addNodeToTree(tree, {
    id: partOutputId,
    typeId: 'PartOutput',
    inputs: [{
      identifier: 'positions',
      name: 'Positions',
      type: 'mesh',
      inOut: 'input',
    }],
    outputs: [],
    position: [xPos, 0],
  });
  addLinkToTree(tree, {
    fromNode: prevId, fromSocket: prevSocket,
    toNode: partOutputId, toSocket: 'positions',
  });

  return tree;
}

/**
 * Walk every part in `project.nodes`, derive a RigTree, and store the
 * collection on `project.nodeTrees.rig` keyed by part id.
 *
 * Idempotent: existing entries are overwritten with freshly-built
 * trees so the dual-write stays consistent with `part.modifiers[]`.
 *
 * @param {object} project - mutated in place
 * @returns {Record<string, import('./types.js').NodeTree>}
 */
export function buildRigTreesForProject(project) {
  if (!project || !Array.isArray(project.nodes)) return {};
  /** @type {Record<string, import('./types.js').NodeTree>} */
  const rig = {};
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    rig[node.id] = buildRigTreeForPart(node);
  }
  if (!project.nodeTrees || typeof project.nodeTrees !== 'object') {
    project.nodeTrees = { rig: {}, driver: {}, animation: {} };
  }
  project.nodeTrees.rig = rig;
  return rig;
}

/**
 * Convenience: build all node trees for the project. Phase N-1 only
 * populates rig trees; N-2/N-3 extend driver/animation.
 *
 * @param {object} project
 */
export function buildNodeTreesFromProject(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  if (!project.nodeTrees || typeof project.nodeTrees !== 'object') {
    project.nodeTrees = { rig: {}, driver: {}, animation: {} };
  }
  buildRigTreesForProject(project);
}
