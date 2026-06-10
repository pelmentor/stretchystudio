// @ts-check

/**
 * Auto-skinning — assign rigid `mesh.boneWeights = [1,1,…]` +
 * `mesh.jointBoneId` for meshed parts that have NO existing bone
 * binding AND NO bone-group ancestor in their `node.parent` chain.
 *
 * # Why this exists
 *
 * Pre-2026-06-10 the PSD-import wizard's mesh-worker callback assigned
 * skinning weights ONLY for the four limb blend zones (leftArm→
 * leftElbow, rightArm→rightElbow, leftLeg→leftKnee, rightLeg→
 * rightKnee) via `childBoneRoleFor` at `meshPostProcess.js:55-62`.
 * Every other bone in the armature — shoulder bones, head, neck,
 * torso, eyes — had zero parts with `jointBoneId` pointing to them.
 *
 * The downstream chain depends on `mesh.jointBoneId + boneWeights`:
 *
 *   - `paramSpec.js:286` only creates `ParamRotation_<bone>` params
 *     for bones that have a weighted part — so no param exists for the
 *     unwired bones.
 *   - `rigSpecStore._buildBoneMirrorEntries` pre-2026-06-10 only
 *     registered bones with a weighted part (the gate is now dropped
 *     by name-match, but no param exists to match against).
 *   - `pickBonePostChainComposition` returns `kind: 'overlay'` for
 *     weightless parts and falls back to walking `node.parent` for a
 *     bone ancestor; for Kora's PSD imports, parts are parented to
 *     warp deformers, NOT bones, so no ancestor is found.
 *
 * Result: rotating an unwired bone in pose mode rotated the skeleton
 * overlay but the mesh stayed at rest. User report: "I rotate the
 * bones — the bones don't move anything. bruh third time iterating."
 *
 * # The fix
 *
 * Assign rigid LBS weights (all 1.0) to the spatially-nearest bone for
 * every meshed part that:
 *
 *   1. Has NO existing `mesh.boneWeights` or `mesh.jointBoneId` (the
 *      blend-zone path or a hand-routed binding already won; don't
 *      overwrite user authoring).
 *   2. Has NO bone-group ancestor in `node.parent` chain (overlay path
 *      already covers ancestor-linked parts; double-applying would
 *      reproduce v31's rotation-doubling regression that v32 had to
 *      revert).
 *   3. Has a mesh with vertices (centroid is meaningful).
 *
 * Closest-bone heuristic: minimise squared distance from the mesh
 * centroid (`computeMeshCentroid`) to each bone's `transform.pivot{X,Y}`.
 * Same coordinate space (canvas pixels) at both sides — no projection
 * needed. Simpler than Blender's heat-map distance, but adequate for
 * 2D character layouts where each part has one "natural" bone owner.
 *
 * # Idempotency
 *
 * `assignRigidSkinningToPart` returns `false` if the part already has
 * weights OR a bone ancestor. Safe to call from the wizard mesh
 * callback, a migration, or an explicit "Re-skin bones" operator
 * without thrashing user authoring.
 *
 * # Composition with v32's strip
 *
 * v32's `isRigidVertexGroup` strips weights when `jointBoneId ===
 * nearestBoneAncestorId`. Our auto-skin only fires when
 * `nearestBoneAncestorId === null`, so v32 ignores our writes
 * (predicate returns false at the ancestor-null guard,
 * `vertexGroupVariance.js:90-92`).
 *
 * @module io/live2d/rig/autoSkinning
 */

import { getMesh, isBoneGroup } from '../../../store/objectDataAccess.js';
import {
  computeMeshCentroid,
} from '../../../components/canvas/viewport/meshPostProcess.js';
import { nearestBoneAncestorId } from '../../../lib/vertexGroupVariance.js';
import { logger } from '../../../lib/logger.js';

/**
 * Find the spatially-nearest bone-group node by mesh-centroid →
 * bone-pivot distance.
 *
 * @param {{cx: number, cy: number}} centroid
 * @param {Array<object>} bones - filtered list of bone-group nodes
 * @returns {object|null} - the closest bone, or null if `bones` is empty
 */
function nearestBoneByPivot(centroid, bones) {
  /** @type {object|null} */
  let best = null;
  let bestDsq = Infinity;
  for (const b of bones) {
    const px = b.transform?.pivotX;
    const py = b.transform?.pivotY;
    if (typeof px !== 'number' || !Number.isFinite(px)) continue;
    if (typeof py !== 'number' || !Number.isFinite(py)) continue;
    const dx = centroid.cx - px;
    const dy = centroid.cy - py;
    const dsq = dx * dx + dy * dy;
    if (dsq < bestDsq) {
      bestDsq = dsq;
      best = b;
    }
  }
  return best;
}

/**
 * Assign rigid LBS weights to a part if it has no existing skinning
 * binding. By default skips parts with a bone-group ancestor in their
 * parent chain (overlay path covers them). Pass
 * `{includeBoneAncestor: true}` to force-LBS those parts too — that's
 * the Blender "Parent with Automatic Weights" mode the Init Rig
 * operator uses to guarantee every meshed part has a usable bone
 * binding even when overlay would have sufficed.
 *
 * Caller is inside an immer recipe; this mutates the draft mesh in
 * place. Returns `true` when a binding was newly written, `false`
 * when the part was skipped (existing weights, existing
 * `jointBoneId`, bone ancestor present + not forced, missing mesh,
 * or no bones in the project).
 *
 * @param {object} part - part node (`type === 'part'`)
 * @param {object} project - project draft
 * @param {{ byId?: Map<string, object>, bones?: Array<object> }} [cache]
 *   Optional precomputed lookups. When iterating many parts (the
 *   migration / wizard mass-call path), pass shared cache objects
 *   to avoid quadratic rebuild cost on the bone list / id index.
 * @param {{ includeBoneAncestor?: boolean }} [options]
 *   `includeBoneAncestor: true` drops the bone-ancestor skip predicate
 *   so parts already parented to a bone group ALSO get LBS weights
 *   (matches Blender's "Parent with Automatic Weights"). Default
 *   `false` preserves the legacy "overlay handles bone-ancestor
 *   parts" behaviour.
 * @returns {boolean}
 */
export function assignRigidSkinningToPart(part, project, cache, options) {
  if (!part || part.type !== 'part') return false;
  if (!project) return false;
  const mesh = getMesh(part, project);
  if (!mesh) return false;
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length === 0) return false;
  if (Array.isArray(mesh.boneWeights) && mesh.boneWeights.length > 0) return false;
  if (typeof mesh.jointBoneId === 'string' && mesh.jointBoneId.length > 0) return false;

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  /** @type {Map<string, object>} */
  let byId = cache?.byId ?? null;
  if (!byId) {
    byId = new Map();
    for (const n of nodes) if (n?.id) byId.set(n.id, n);
  }
  /** @type {Array<object>} */
  let bones = cache?.bones ?? null;
  if (!bones) {
    bones = [];
    for (const n of nodes) if (isBoneGroup(n)) bones.push(n);
  }
  if (bones.length === 0) return false;

  const includeBoneAncestor = options?.includeBoneAncestor === true;
  if (!includeBoneAncestor) {
    const ancestor = nearestBoneAncestorId(part, byId, isBoneGroup);
    if (ancestor) return false;
  }

  const centroid = computeMeshCentroid(mesh.vertices);
  if (!centroid) return false;

  // When forcing LBS over an existing bone-ancestor chain, prefer the
  // ancestor bone as the binding target — it's the bone the user
  // structurally expects this part to follow (e.g. shirt under leftArm
  // → bind to leftArm, not to a nearer torso bone). Falls back to
  // nearest-by-pivot when no ancestor exists.
  let winner = null;
  if (includeBoneAncestor) {
    const ancestorId = nearestBoneAncestorId(part, byId, isBoneGroup);
    if (typeof ancestorId === 'string' && ancestorId.length > 0) {
      winner = byId.get(ancestorId) ?? null;
    }
  }
  if (!winner) winner = nearestBoneByPivot(centroid, bones);
  if (!winner?.id) return false;

  mesh.boneWeights = new Array(mesh.vertices.length).fill(1);
  mesh.jointBoneId = winner.id;
  return true;
}

/**
 * Walk every meshed part in the project and apply
 * `assignRigidSkinningToPart`. Returns a summary count.
 *
 * Used by:
 *   - the v52 migration (retro-skin existing saves) — default options.
 *   - the `rig.autoSkinUnwiredBones` operator (F3 palette) — default
 *     options.
 *   - `RigService.initializeRig` — passes `{includeBoneAncestor: true}`
 *     so EVERY meshed part gets an LBS binding, matching Blender's
 *     "Parent with Automatic Weights" semantics. Without this, parts
 *     under bone-role groups stay weightless and the only path that
 *     moves them on bone rotation is the overlay matrix — which
 *     requires `bone.pose.rotation` (skeleton-gesture writes), NOT
 *     the `ParamRotation_<bone>` slider that the Parameters panel
 *     surfaces. Forcing LBS on Init Rig makes every bone slider
 *     deform every part it owns, end-to-end.
 *
 * @param {object} project - project draft
 * @param {{ includeBoneAncestor?: boolean }} [options]
 *   Forwarded to `assignRigidSkinningToPart`. See its docstring for
 *   the semantic.
 * @returns {{ partsScanned: number, partsAssigned: number, byBone: Record<string, number> }}
 */
export function autoSkinAllParts(project, options) {
  /** @type {Record<string, number>} */
  const byBone = {};
  let partsScanned = 0;
  let partsAssigned = 0;
  if (!project || !Array.isArray(project.nodes)) {
    return { partsScanned, partsAssigned, byBone };
  }

  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const n of project.nodes) if (n?.id) byId.set(n.id, n);
  const bones = project.nodes.filter((n) => isBoneGroup(n));
  /** @type {{ byId: Map<string, object>, bones: Array<object> }} */
  const cache = { byId, bones };

  for (const n of project.nodes) {
    if (n?.type !== 'part') continue;
    partsScanned++;
    const ok = assignRigidSkinningToPart(n, project, cache, options);
    if (!ok) continue;
    partsAssigned++;
    const mesh = getMesh(n, project);
    const boneId = mesh?.jointBoneId;
    if (typeof boneId === 'string') {
      byBone[boneId] = (byBone[boneId] ?? 0) + 1;
    }
  }

  if (partsAssigned > 0) {
    const tag = options?.includeBoneAncestor ? 'forced-LBS' : 'unwired-only';
    logger.info('autoSkin',
      `autoSkinAllParts (${tag}): ${partsAssigned}/${partsScanned} parts newly weighted`,
      { partsScanned, partsAssigned, byBone, includeBoneAncestor: !!options?.includeBoneAncestor });
  }
  return { partsScanned, partsAssigned, byBone };
}
