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
  const ownerRaw = ctx.project?.nodes?.find((n) => n?.id === ownerId);
  if (!ownerRaw) return null;

  // Apply animated pose overrides (action fcurves + draftPose) as the
  // owner's pose/transform SEED before constraints run. `ctx.poseOverrides`
  // is the depgraph mirror of `animationEngine.computePoseOverrides` — the
  // engine-independent override layer. Without this, bone/part pose
  // animation never reached skinning (the skeleton overlay moved but the
  // mesh stayed at rest). Only transform channels are consumed here;
  // `mesh_verts` / blend-shape / opacity overrides are applied elsewhere.
  const owner = applyPoseOverrides(ownerRaw, ctx.poseOverrides?.get(ownerId));

  // Build a project view that swaps every other object's `transform` /
  // `pose.rotation` for its DEPGRAPH-COMPOSED output, so a constraint
  // that targets `groupA` reads `groupA`'s post-constraint result, not
  // its authored seed. This matches Blender's evaluator iteration:
  // each Object resolves its constraints against its targets'
  // already-resolved transforms (the depgraph topology guarantees
  // target-first ordering via the relations we add at build time).
  // Self-exclusion in the view keys on the REAL project node (ownerRaw),
  // not the pose-overlaid clone — the clone isn't in `project.nodes`.
  const projectView = makeProjectView(ctx, ownerRaw);

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

/** Transform channels a pose/transform fcurve (or draftPose) can drive.
 *  mesh_verts / blendShape:* / opacity / visible are intentionally NOT
 *  here — they're not part of the composed affine transform. */
const POSE_CHANNELS = ['rotation', 'x', 'y', 'scaleX', 'scaleY'];

/**
 * Return a node clone whose pose (bones) or transform (non-bones) carries
 * the supplied animated channel overrides, as the seed for constraint
 * evaluation. Absolute values (the fcurve/draftPose value IS the channel
 * value, matching `animationEngine`'s `effectiveValueForProperty`). When
 * `ov` is null/empty the original node is returned unchanged (zero cost
 * for the static / no-animation case).
 *
 * @param {object} node
 * @param {Map<string, number>|undefined} ov - channel → value
 * @returns {object}
 */
function applyPoseOverrides(node, ov) {
  if (!(ov instanceof Map) || ov.size === 0) return node;
  let any = false;
  for (const ch of POSE_CHANNELS) { if (ov.has(ch)) { any = true; break; } }
  if (!any) return node;

  const isBone = node.type === 'group' && typeof node.boneRole === 'string';
  if (isBone) {
    // Mirror `overlayTransform`'s bone branch: spread the canonical flat
    // pose (`getBonePose` handles v17/v18-flat + v19-channels) then
    // overwrite the animated channels.
    const pose = { ...(getBonePose(node) ?? {}) };
    for (const ch of POSE_CHANNELS) if (ov.has(ch)) pose[ch] = ov.get(ch);
    return { ...node, pose };
  }
  const transform = { ...(node.transform ?? {}) };
  for (const ch of POSE_CHANNELS) if (ov.has(ch)) transform[ch] = ov.get(ch);
  return { ...node, transform };
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
