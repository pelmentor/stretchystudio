// @ts-check

/**
 * RigTree visualisation builder — synthesises a SS-specific node-graph
 * view of a part's canonical Blender-style modifier stack.
 *
 * # Schema state
 *
 * Post-v38 NodeTree retirement (Animation Phase 1 Stage 1.F pre-exit):
 * the canonical source is `part.modifiers[]` (Blender-shaped
 * `Object.modifiers` — `ListBase<ModifierData>` per
 * `reference/blender/source/blender/makesdna/DNA_modifier_types.h:169`).
 * This module derives a one-shot read-only graph for the
 * `NodeTreeArea` editor surface ONLY; nothing else consumes the
 * synthesised tree. Audit-fix D-3 from the retirement audit dropped
 * the pre-v38 framing that positioned this as a shadow data store
 * which a future migration would flip to canonical — that V2 bet was
 * retired with v38; the modifier stack stays canonical permanently.
 *
 * # SS-specific deviation
 *
 * Blender does not represent the modifier stack as a node tree —
 * Geometry Nodes is a separate `NodesModifierData` wrapper around its
 * own `bNodeTree`. `buildRigTreeForPart` synthesises a SS-invented
 * visualisation that has no Blender datablock counterpart. The
 * synthesised tree is purely a render-time aid; edits flow through
 * `part.modifiers[]` mutations on the canonical source.
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
 * Pure function of `part.modifiers[]`.
 *
 * @module anim/nodetree/build
 */

import {
  makeNodeTree,
  addNodeToTree,
  addLinkToTree,
  NodeTreeType,
} from './types.js';
import { modifierRefId } from '../../store/warpLatticeAccess.js';

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
    // v43 — a warp modifier references its cage object via `objectId`
    // (`type:'lattice'`); rotation via `deformerId`. Resolve either.
    const refId = modifierRefId(mod);
    if (typeof refId !== 'string') continue;
    const typeId = mod.type === 'rotation' ? 'RotationModifier' : 'WarpModifier';
    const nodeId = `${part.id}__mod_${i}`;
    addNodeToTree(tree, {
      id: nodeId,
      typeId,
      inputs:  [{ identifier: 'positions', name: 'Positions', type: 'mesh', inOut: 'input'  }],
      outputs: [{ identifier: 'positions', name: 'Positions', type: 'mesh', inOut: 'output' }],
      storage: {
        deformerId: refId,
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
