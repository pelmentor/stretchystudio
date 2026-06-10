// @ts-check

/**
 * v52 — auto-skin parts to their spatially-nearest bone when no
 * existing skinning binding exists.
 *
 * # Why this exists
 *
 * Pre-v52 the PSD-import wizard's mesh-worker callback only assigned
 * `mesh.boneWeights + mesh.jointBoneId` for the four limb blend
 * zones (leftArm→leftElbow, rightArm→rightElbow, leftLeg→leftKnee,
 * rightLeg→rightKnee). Every other bone in a freshly-imported
 * character — shoulders, head, neck, torso, eyes — had zero parts
 * weighted to it. The downstream chain (`paramSpec.js` param
 * creation, `_buildBoneMirrorEntries` registry, `pickBonePostChainComposition`
 * LBS decision) all gated on the part-side binding, so rotating those
 * bones in pose mode rotated the skeleton overlay but didn't deform
 * the mesh.
 *
 * User report (2026-06-10, Kora save): "I rotate her bones — the
 * bones don't move anything." Diagnostic loop confirmed `byBone`
 * registry held only 4 entries (the elbow/knee pair). The other 8
 * bones had no parts pointing at them, so the mirror was a no-op.
 *
 * # What this migration does
 *
 * Calls `autoSkinAllParts(project)` which walks every meshed part and
 * writes rigid `[1, 1, …]` weights + `jointBoneId` to the closest
 * bone (by mesh-centroid → bone-pivot distance) IF:
 *
 *   1. The part has no existing `mesh.boneWeights` or `mesh.jointBoneId`
 *      (don't clobber the wizard's blend-zone authoring or any user
 *      hand-routed binding).
 *   2. The part has no bone-group ancestor in its `node.parent` chain
 *      (overlay-matrix path already covers ancestor-linked parts;
 *      adding LBS on top would reproduce v31's double-rotation bug
 *      that v32 had to revert).
 *
 * Idempotent — re-running on an already-migrated project assigns
 * nothing (every part passes the existing-binding guard). The wizard
 * mesh callback gets the same fallback (in `CanvasViewport.jsx`) so
 * future PSD imports auto-skin without re-migration.
 *
 * # Composition with v32
 *
 * v32's `isRigidVertexGroup` strips weights when `jointBoneId ===
 * nearestBoneAncestorId`. Our auto-skin only fires when
 * `nearestBoneAncestorId === null`, so v32 leaves our writes alone
 * (predicate fails the ancestor-null guard at
 * `vertexGroupVariance.js:90-92`).
 *
 * # Effect for Kora
 *
 * Pre-v52: 4 weighted bones (left/rightElbow, left/rightKnee).
 * Post-v52: every body part weighted to its closest bone — shoulder
 * parts to `rightArm`/`leftArm`, head parts to `head`, etc.
 * `paramSpec.js` will create `ParamRotation_<bone>` for the newly
 * weighted bones on the next Init Rig pass; `_buildBoneMirrorEntries`
 * picks them up; the BONE → PARAM mirror at viewport eval setup
 * (CanvasViewport.jsx) propagates rotation to the warp evaluator;
 * mesh deforms.
 *
 * @module store/migrations/v52_auto_skin_unwired_bones
 */

import { autoSkinAllParts } from '../../io/live2d/rig/autoSkinning.js';

/**
 * @param {object} project — mutated in place
 * @returns {{ partsScanned: number, partsAssigned: number, byBone: Record<string, number> }}
 */
export function migrateAutoSkinUnwiredBones(project) {
  return autoSkinAllParts(project);
}
