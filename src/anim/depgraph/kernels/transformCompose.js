// @ts-check

/**
 * TRANSFORM_COMPOSE kernel.
 *
 * Phase 0.C of the Animation Blender-Parity Plan. Wires the Phase 4
 * constraint evaluator (`src/anim/constraints.js`) into the depgraph
 * pipeline.
 *
 * # What it does
 *
 * For an Object IDNode (a part or a group), reads the authored
 * transform/pose, then runs every entry in `owner.constraints[]`
 * through `evaluateConstraints`. Emits the composed transform
 * `{x, y, rotation, scaleX, scaleY}`.
 *
 * Mirrors Blender's `BKE_constraints_solve` stage in the depsgraph
 * pipeline — constraints run AFTER the modifier stack and BEFORE the
 * world matrix is composed (`reference/blender/source/blender/blenkernel/intern/constraint.cc`,
 * `BKE_constraints_solve` at constraint.cc:5672).
 *
 * # Inputs
 *
 *   - `ctx.project.nodes[i]` — the Object node (lookup by `idRef`).
 *   - `ctx.outputs[<targetId>/TRANSFORM/TRANSFORM_COMPOSE]` — when a
 *     constraint references another object as its target, the target's
 *     own composed output is read here so the topology is acyclic.
 *
 * # Output
 *
 *   {
 *     transform: { x, y, rotation, scaleX, scaleY },
 *     ranConstraints: number,    // diagnostic: how many were applied
 *   }
 *
 * # Production wire-in note
 *
 * Phase 0.C ships the kernel + topology only. The downstream consumers
 * (`renderer/boneOverlayMatrix.js`, `renderer/boneSkinning.js`,
 * `selectRigSpec.js` Object-transform reads) still consult
 * `node.pose` / `node.transform` directly. Phase 0.D.0 routes the
 * production tick through `evalDepGraph` and switches consumers to
 * read this op's output.
 *
 * @module anim/depgraph/kernels/transformCompose
 */

import { evaluateConstraints } from '../../constraints.js';
import { OperationCode, NodeType } from '../types.js';
import { getBonePose } from '../../../store/objectDataAccess.js';

/**
 * @typedef {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}} Transform2D
 */

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {{transform: Transform2D, ranConstraints: number} | null}
 */
export function kernelTransformCompose(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const ownerId = idNode.idRef;
  const owner = ctx.project?.nodes?.find((n) => n?.id === ownerId);
  if (!owner) return null;

  // Build a project view that swaps every other object's `transform` /
  // `pose.rotation` for its DEPGRAPH-COMPOSED output, so a constraint
  // that targets `groupA` reads `groupA`'s post-constraint result, not
  // its authored seed. This matches Blender's evaluator iteration:
  // each Object resolves its constraints against its targets'
  // already-resolved transforms (the depgraph topology guarantees
  // target-first ordering via the relations we add at build time).
  const projectView = makeProjectView(ctx, owner);

  const stackLen = Array.isArray(owner.constraints) ? owner.constraints.length : 0;
  const composed = evaluateConstraints(owner, /* seedTransform */ null, projectView);

  return {
    transform: {
      x: composed.x,
      y: composed.y,
      rotation: composed.rotation,
      scaleX: composed.scaleX,
      scaleY: composed.scaleY,
    },
    ranConstraints: stackLen,
  };
}

/**
 * Wrap `ctx.project` so the constraint evaluator sees the
 * depgraph-composed transform of any target it looks up. We don't
 * mutate `ctx.project` itself — the wrap is a thin shim that returns
 * a substituted node when the lookup hits an id we've already composed.
 *
 * @param {import('../eval.js').EvalContext} ctx
 * @param {object} self
 * @returns {object}
 */
function makeProjectView(ctx, self) {
  const project = ctx.project;
  if (!project) return { nodes: [] };
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const substituted = nodes.map((n) => {
    if (!n || n === self) return n;
    if (typeof n.id !== 'string') return n;
    const composedKey = `${n.id}/${NodeType.TRANSFORM}/${OperationCode.TRANSFORM_COMPOSE}`;
    const out = ctx.outputs.get(composedKey);
    if (!out?.transform) return n;
    return overlayTransform(n, out.transform);
  });
  return { ...project, nodes: substituted };
}

/**
 * Return a shallow-cloned node whose `transform` (and pose, when
 * applicable) carries the depgraph-composed values. The clone is
 * read-only — we never write back to `ctx.project`.
 *
 * For bones: the composed `t.x / t.y` is in canvas-pivot frame
 * (`effectiveTransform` for a bone returns `pivotX + pose.x` — see
 * constraints.js:171). To round-trip back to a pose-shape value we
 * must SUBTRACT the pivot before writing pose.x/y; otherwise a
 * downstream constraint that reads this overlaid node via
 * `effectiveTransform` would re-add the pivot and double it
 * (audit fix G-13: bone-target-bone constraint chain pivot doubling).
 *
 * @param {object} node
 * @param {Transform2D} t
 * @returns {object}
 */
function overlayTransform(node, t) {
  const isBone = node.type === 'group' && typeof node.boneRole === 'string';
  if (isBone) {
    const pivotX = node.transform?.pivotX ?? 0;
    const pivotY = node.transform?.pivotY ?? 0;
    // Audit-fix G-2/D-2 (Phase 8 sweep): synthetic pose bases off
    // `getBonePose` so v17/v18 flat AND v19+ channels shapes both
    // resolve to the canonical flat contract. A naive spread of
    // `node.pose` would leak the v19 channels envelope as a sibling
    // to the composed flat fields, creating mixed-state corruption
    // that downstream `getBonePose` reads as stale.
    return {
      ...node,
      pose: {
        ...(getBonePose(node) ?? {}),
        rotation: t.rotation,
        x:        t.x - pivotX,
        y:        t.y - pivotY,
        scaleX:   t.scaleX,
        scaleY:   t.scaleY,
      },
    };
  }
  return {
    ...node,
    transform: { ...(node.transform ?? {}), x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY },
  };
}
