// @ts-check

/**
 * Per-part post-rig bone overlay matrices.
 *
 * **Why this exists.** `chainEval` produces canvas-space vertex positions
 * for every rig-driven art mesh by walking the warp + rotation deformer
 * chain. That output ignores the editor's bone-group `node.pose`
 * entirely. The overlay matrix here folds each bone's pose into its
 * descendant parts' verts at render time — Blender's "Armature modifier
 * on top of shape keys" composition.
 *
 * **Independence from `ParamRotation_<bone>`** (BONE_ARMATURE_INDEPENDENCE
 * plan, 2026-05-08). Pre-2026-05-08 this module force-zeroed the
 * overlay matrix for any bone whose `ParamRotation_<sanitisedName>`
 * existed in `project.parameters`, on the assumption that
 * `SkeletonOverlay` would never write the bone's `pose.rotation` for
 * those bones (it secretly wrote the param instead — the
 * "rotating-an-arm-bone-just-drags-the-slider" hack the user rejected).
 * That guard is gone: every bone-group's `pose.{rotation,x,y,scaleX,
 * scaleY}` folds into the overlay uniformly. Bone gesture and
 * `ParamRotation_<bone>` slider are now independent control surfaces
 * — both can be non-zero, both compose at render time. Same as Blender:
 * shape keys produce one deformation, armature modifier composes
 * another on top.
 *
 * **Translation is composable too.** `node.pose.x` / `.y` are baked
 * into the local matrix.
 *
 * @module renderer/boneOverlayMatrix
 */

import { mat3Identity, mat3Mul, makeBoneLocalMatrix } from './transforms.js';
import { isBoneGroup, isMeshedPart } from '../store/objectDataAccess.js';

/** Local-matrix epsilon. Below this every component is considered
 *  zero and the matrix is treated as identity (skip multiplication). */
const EPS = 1e-6;

/** True if the local matrix is essentially identity (no rotate / scale
 *  / translate). For pure-rest bones this is the common case so it pays
 *  to skip the per-vertex multiply downstream. */
function isIdentityLike(m) {
  return Math.abs(m[0] - 1) < EPS
      && Math.abs(m[1])     < EPS
      && Math.abs(m[3])     < EPS
      && Math.abs(m[4] - 1) < EPS
      && Math.abs(m[6])     < EPS
      && Math.abs(m[7])     < EPS;
}

/**
 * Build per-part bone overlay matrices.
 *
 * @param {Array<{id:string, type?:string, parent?:string|null, boneRole?:string, name?:string, transform?:any, pose?:any, mesh?:any}>} nodes
 *        Flat project node array.
 * @returns {Map<string, Float32Array>}
 *        Map from `partId` → 3×3 column-major canvas-space overlay
 *        matrix. Only contains entries for parts whose ancestor bone
 *        chain has at least one non-identity bone pose.
 */
/**
 * Per-bone composed-world matrix map. For every bone-group node, walks
 * up the bone-group ancestor chain (non-bone groups are skipped — they
 * don't carry pose) and multiplies each ancestor's pose-around-pivot
 * matrix into the bone's own. Result is the bone's WORLD matrix —
 * what the renderer needs to land vertices that are weighted to that
 * bone in canvas space.
 *
 * Critical for weighted skinning: a part rigged to `leftElbow` whose
 * parent in the bone hierarchy is `leftArm` must follow leftArm
 * rotations. `leftElbow.pose` may be identity, but `leftElbow.world`
 * = `leftArm.world * leftElbow.pose` is non-identity when leftArm
 * rotates. Reading the bone's own pose alone misses this.
 *
 * @param {Array<{id:string, type?:string, parent?:string|null, boneRole?:string, name?:string, transform?:any, pose?:any}>} nodes
 * @returns {Map<string, Float32Array>} boneId → 3×3 column-major world matrix
 */
export function computeBoneWorldMatrices(nodes) {
  /** @type {Map<string, Float32Array>} */
  const boneWorld = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0) return boneWorld;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function resolveBoneWorld(boneNode) {
    const cached = boneWorld.get(boneNode.id);
    if (cached) return cached;
    // BONE_ARMATURE_INDEPENDENCE (2026-05-08): every bone contributes
    // its POSE matrix (around its rest pivot). The rest matrix is
    // identity-modulo-pivot since v17 reserves the bone's transform
    // pose-fields at zero. Rig output (chainEval) already lives in
    // the bone's rest frame, so applying rest again would shift it.
    // Pose alone is the additive offset.
    //
    // Bone gesture writes `pose.rotation`; `ParamRotation_<bone>`
    // slider writes paramValues independently. Both compose.
    let local;
    {
      const p = boneNode.pose;
      const r = p?.rotation ?? 0;
      const px = p?.x ?? 0;
      const py = p?.y ?? 0;
      const sx = p?.scaleX ?? 1;
      const sy = p?.scaleY ?? 1;
      if (r === 0 && px === 0 && py === 0 && sx === 1 && sy === 1) {
        local = mat3Identity();
      } else {
        local = makeBoneLocalMatrix({
          pivotX: boneNode.transform?.pivotX ?? 0,
          pivotY: boneNode.transform?.pivotY ?? 0,
        }, p);
      }
    }
    let world;
    // Walk to nearest bone-group ancestor; non-bone groups (visual
    // folders) are skipped — they don't carry pose.
    let parent = boneNode.parent ? byId.get(boneNode.parent) : null;
    while (parent && !isBoneGroup(parent)) {
      parent = parent.parent ? byId.get(parent.parent) : null;
    }
    if (parent) {
      world = mat3Mul(resolveBoneWorld(parent), local);
    } else {
      world = local;
    }
    boneWorld.set(boneNode.id, world);
    return world;
  }

  for (const n of nodes) {
    if (isBoneGroup(n)) resolveBoneWorld(n);
  }
  return boneWorld;
}

/**
 * Map each bone-group node to its NEAREST bone-group ANCESTOR (parent
 * bone in the skeleton). Non-bone-group ancestors (visual folders) are
 * skipped — only true bones contribute to the chain. Returns `null` for
 * bones whose chain terminates without another bone (e.g. root).
 *
 * Used by two-bone LBS skinning: a part weighted to leftElbow needs
 * leftElbow's parent bone (leftArm) as the parent matrix so weight=0
 * verts follow the upper arm rotation.
 *
 * @param {Array<{id:string, type?:string, parent?:string|null, boneRole?:string}>} nodes
 * @returns {Map<string, string|null>} boneId → parentBoneId (or null)
 */
export function computeBoneParentMap(nodes) {
  /** @type {Map<string, string|null>} */
  const out = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!isBoneGroup(n)) continue;
    let cur = n.parent ? byId.get(n.parent) : null;
    while (cur && !isBoneGroup(cur)) {
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    out.set(n.id, cur ? cur.id : null);
  }
  return out;
}

/**
 * Per-part bone overlay matrices for rigid-follow parts. Reinstated
 * 2026-05-09 (afternoon) when the Cubism Adapter pattern was reverted
 * back toward Blender parity (see
 * `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`). Phase 2 of
 * the Adapter (commit `3c08290`) had deleted these helpers under the
 * assumption that every meshed part with a bone-group ancestor would
 * carry vertex groups via `seedDefaultRigidWeights` — but that
 * conflated "follows bone" with "is per-vertex skinned" (anti-Blender,
 * source of three regression bugs in two days). The Blender-correct
 * model has TWO separate mechanisms: vertex-groups + Armature
 * modifier (LBS) for true skinning, and parent-chain transform for
 * rigid follow. This module's `applyOverlayMatrixObj` IS the rigid-
 * follow path, called from `CanvasViewport.jsx` when
 * `pickBonePostChainComposition` returns `kind: 'overlay'` (no
 * weights, no modifier, but has bone-group ancestor).
 *
 * @param {Array<{id:string, type?:string, parent?:string|null, boneRole?:string, name?:string, transform?:any, pose?:any, mesh?:any}>} nodes
 * @returns {Map<string, Float32Array>} partId → bone world matrix (only
 *          for parts whose nearest bone ancestor has non-identity pose)
 */
export function computeBoneOverlayMatrices(nodes) {
  /** @type {Map<string, Float32Array>} */
  const out = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const boneWorld = computeBoneWorldMatrices(nodes);
  /** @type {Set<string>} */
  const boneIsIdentity = new Set();
  for (const [boneId, m] of boneWorld) {
    if (isIdentityLike(m)) boneIsIdentity.add(boneId);
  }

  // For every art mesh part, find its nearest bone-group ancestor and
  // attach that bone's overlay matrix.
  for (const n of nodes) {
    if (!isMeshedPart(n)) continue;
    let cur = n.parent ? byId.get(n.parent) : null;
    while (cur && !isBoneGroup(cur)) {
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    if (!cur) continue;
    if (boneIsIdentity.has(cur.id)) continue;
    const m = boneWorld.get(cur.id);
    if (m) out.set(n.id, m);
  }
  return out;
}

/**
 * Apply an overlay matrix to a flat `[x0, y0, x1, y1, ...]` Float32Array
 * in place. Caller decides whether the result is the new GPU upload or
 * a copy. No-op when `m` is null/undefined.
 *
 * @param {Float32Array} positions
 * @param {Float32Array|null|undefined} m
 */
export function applyOverlayMatrixFlat(positions, m) {
  if (!m) return positions;
  const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    positions[i]     = m0 * x + m3 * y + m6;
    positions[i + 1] = m1 * x + m4 * y + m7;
  }
  return positions;
}

/**
 * Object-vert variant: `[{x, y}, ...]` in place. Same math as the flat
 * variant; matches the per-frame shape `CanvasViewport` produces just
 * before the GPU upload pass.
 *
 * @param {Array<{x:number, y:number}>} verts
 * @param {Float32Array|null|undefined} m
 */
export function applyOverlayMatrixObj(verts, m) {
  if (!m) return verts;
  const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const x = v.x;
    const y = v.y;
    v.x = m0 * x + m3 * y + m6;
    v.y = m1 * x + m4 * y + m7;
  }
  return verts;
}
