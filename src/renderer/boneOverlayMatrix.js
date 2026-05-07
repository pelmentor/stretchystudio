// @ts-check

/**
 * Per-part post-rig bone overlay matrices.
 *
 * **Why this exists.** `chainEval` produces canvas-space vertex positions
 * for every rig-driven art mesh by walking the warp + rotation deformer
 * chain. That output ignores the editor's bone-group `node.transform`
 * entirely, so dragging the torso / neck / bothLegs / root arc (or any
 * bone that has no `ParamRotation_<role>` deformer) was visually
 * dead post-Init-Rig. Adding fallback writes to `ParamBodyAngleZ` etc.
 * was a band-aid — it surprised users by routing torso drags into a
 * body-wide param.
 *
 * **The Blender-style fix.** Treat each bone-group's `node.transform`
 * as a *pose offset* that composes ON TOP of rig output. For every art
 * mesh, walk its parent chain, collect the bone-group ancestors, and
 * multiply their local transforms (root → leaf) into a single overlay
 * matrix. Apply that matrix to the rig's canvas-space verts.
 *
 * **No double-rotation.** Bones whose rotation IS rig-driven (arms /
 * elbows / head — they have `ParamRotation_<role>` deformers) keep
 * their `node.transform.rotation` at zero by contract: SkeletonOverlay
 * writes to the param only, never the transform, when a driver param
 * exists. Their local matrix is identity here, so they contribute
 * nothing to the overlay — the rig deformer already moved the verts.
 *
 * Bones with no driver param (torso / neck / bothLegs / root) are the
 * only contributors to a non-identity overlay. Dragging them now
 * translates / rotates everything beneath, exactly as in Blender pose
 * mode. Pre-Init-Rig the rig output is missing entirely and the regular
 * `worldMatrix` path drives the canvas; this overlay is a no-op then.
 *
 * **Translation is composable too.** `node.transform.x` / `.y` are
 * baked into the local matrix, so future bone-translate gestures work
 * without further plumbing.
 *
 * @module renderer/boneOverlayMatrix
 */

import { mat3Identity, mat3Mul, makeBoneLocalMatrix } from './transforms.js';
import { sanitisePartName } from '../lib/partId.js';
import {
  isBoneGroup,
  isMeshedPart,
  getBoneRole,
} from '../store/objectDataAccess.js';

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
 * @param {Array<{id:string, type?:string, parent?:string|null, boneRole?:string, name?:string, transform?:any, mesh?:any}>} nodes
 *        Flat project node array.
 * @param {Array<{id:string}>|null|undefined} [parameters]
 *        Project parameter spec. When present, any bone whose
 *        `ParamRotation_<sanitised(name)>` exists is treated as
 *        identity here — its rotation is the rig's responsibility,
 *        and folding it in again would double-rotate. Pre-Init-Rig
 *        callers can pass `null` (or an empty array) to apply every
 *        bone's transform.
 * @returns {Map<string, Float32Array>}
 *        Map from `partId` → 3×3 column-major canvas-space overlay
 *        matrix. Only contains entries for parts whose ancestor bone
 *        chain has at least one non-identity bone transform.
 */
export function computeBoneOverlayMatrices(nodes, parameters = null) {
  /** @type {Map<string, Float32Array>} */
  const out = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Set of `ParamRotation_<sanitised>` ids — bones whose rotation is
  // owned by the rig. Their `node.transform.rotation` is contractually
  // zero (SkeletonOverlay writes the param only when a driver exists);
  // we still defensively zero them here to survive legacy projects
  // saved before the single-writer contract landed.
  const driverParamIds = new Set();
  if (Array.isArray(parameters)) {
    for (const p of parameters) {
      if (p?.id && typeof p.id === 'string' && p.id.startsWith('ParamRotation_')) {
        driverParamIds.add(p.id);
      }
    }
  }
  function isRigDriven(boneNode) {
    if (driverParamIds.size === 0) return false;
    const role = getBoneRole(boneNode);
    if (!role) return false;
    const candidate = `ParamRotation_${sanitisePartName(boneNode.name || role)}`;
    return driverParamIds.has(candidate);
  }

  // Per-bone composed world matrix (only over bone-group ancestors).
  // Cached so that siblings of the same bone don't recompose the chain.
  /** @type {Map<string, Float32Array>} */
  const boneWorld = new Map();
  /** @type {Set<string>} */
  const boneIsIdentity = new Set();

  function resolveBoneWorld(boneNode) {
    const cached = boneWorld.get(boneNode.id);
    if (cached) return cached;
    // Rig-driven bones contribute identity here — the rig deformer
    // already moved their descendants. Use identity instead of the
    // bone's actual rest+pose so legacy values don't double-compose.
    //
    // Non-rig-driven bones contribute their POSE matrix only (the rest
    // matrix is identity-modulo-pivot since v17 reserves bone-transform
    // pose-fields at zero; rest-around-pivot doesn't move points). The
    // rig framework's deformers and verts ALREADY live in the bone's
    // rest frame post-init-rig, so applying rest again would shift
    // them. Pose alone is the additive offset, which is what we want.
    let local;
    if (isRigDriven(boneNode)) {
      local = mat3Identity();
    } else {
      const p = boneNode.pose;
      const r = p?.rotation ?? 0;
      const px = p?.x ?? 0;
      const py = p?.y ?? 0;
      const sx = p?.scaleX ?? 1;
      const sy = p?.scaleY ?? 1;
      if (r === 0 && px === 0 && py === 0 && sx === 1 && sy === 1) {
        local = mat3Identity();
      } else {
        // Pose-only matrix around the rest pivot.
        local = makeBoneLocalMatrix({
          pivotX: boneNode.transform?.pivotX ?? 0,
          pivotY: boneNode.transform?.pivotY ?? 0,
        }, p);
      }
    }
    let world;
    // Walk to nearest bone-group ancestor; non-bone groups (e.g. plain
    // organisational folders) are skipped — they don't carry pose.
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
    if (isIdentityLike(world)) boneIsIdentity.add(boneNode.id);
    return world;
  }

  // Resolve every bone first so the caches are warm.
  for (const n of nodes) {
    if (isBoneGroup(n)) resolveBoneWorld(n);
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
 * variant; matches the per-frame shape CanvasViewport produces just
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
