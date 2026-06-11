// @ts-check

/**
 * Bone post-chain composition — depgraph kernel side.
 *
 * Phase 0.D armature port. Mirrors the renderer's
 * `pickBonePostChainComposition` + `applyTwoBoneSkinning` /
 * `applyOverlayMatrix` step
 * ([src/renderer/bonePostChainComposition.js](../../../renderer/bonePostChainComposition.js),
 * [src/renderer/boneSkinning.js](../../../renderer/boneSkinning.js),
 * [src/renderer/boneOverlayMatrix.js](../../../renderer/boneOverlayMatrix.js))
 * but reads bone pose from `ctx.outputs[<boneId>/TRANSFORM/TRANSFORM_COMPOSE]`
 * instead of `node.pose` directly. So constraint-composed pose feeds
 * skinning, matching Blender's depsgraph order: constraints solve, then
 * armature deform consumes the resolved transforms.
 *
 * # Symmetry with the renderer
 *
 * The renderer's pre-Phase-0.D loop applies skinning + overlay AFTER
 * `evalRig` returns. With the depgraph engine selected, the renderer's
 * post-loop skips skinning and this kernel does the equivalent work
 * inline — so the two engines stay swap-compatible at the
 * `ArtMeshFrame` boundary, with the depgraph emitting POST-skin verts
 * and the classic engine emitting PRE-skin verts that the renderer
 * then post-skins.
 *
 * @module anim/depgraph/kernels/bonePostChain
 */

import { isBoneGroup, getBonePose } from '../../../store/objectDataAccess.js';
import { makeBoneLocalMatrix, mat3Identity, mat3MulInto } from '../../../renderer/transforms.js';
import { applyTwoBoneSkinning, applyWeightedSkinning, isIdentityMatrix } from '../../../renderer/boneSkinning.js';
import { applyOverlayMatrixFlat } from '../../../renderer/boneOverlayMatrix.js';
import { pickBonePostChainComposition } from '../../../renderer/bonePostChainComposition.js';
import { finiteOr } from '../../../lib/finiteOr.js';
import { OperationCode, NodeType } from '../types.js';
import { logger } from '../../../lib/logger.js';

// Eval-time bone-skin instrumentation — fires when applyBonePostChainSkin
// runs with a non-identity bone WORLD matrix. Throttled at module level
// to once per ~500ms across ALL parts so a sustained gesture produces
// a steady stream of legible log lines, not a 60Hz flood. Bypasses RULE
// №1 "no diagnostic-only paths" exception per [[invariant-checks-over-user-repro]]:
// fire-when-thing-changes invariants narrow root-cause without forcing
// the user to click parts.
const SKIN_DIAG_THROTTLE_MS = 500;
let _lastSkinDiagAt = 0;
function _now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Walk the project to find the part's nearest bone-group ancestor.
 * Mirrors `computeBoneOverlayMatrices`'s per-part walk
 * ([boneOverlayMatrix.js:209-219](../../../renderer/boneOverlayMatrix.js)).
 *
 * @param {object} part
 * @param {Map<string, object>} byId
 * @returns {string|null}
 */
function findNearestBoneAncestorId(part, byId) {
  let cur = part?.parent ? byId.get(part.parent) : null;
  while (cur && !isBoneGroup(cur)) {
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return cur ? cur.id : null;
}

/**
 * Lookup the depgraph's composed transform for a given owner id. Returns
 * `null` if the op didn't run yet (e.g. the bone has no TRANSFORM
 * component because it wasn't a part/group at build time — shouldn't
 * happen for valid bones, but defensive).
 *
 * @param {import('../eval.js').EvalContext} ctx
 * @param {string} ownerId
 * @returns {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}|null}
 */
function readComposedTransform(ctx, ownerId) {
  const key = `${ownerId}/${NodeType.TRANSFORM}/${OperationCode.TRANSFORM_COMPOSE}`;
  const out = ctx.outputs?.get(key);
  return out?.transform ?? null;
}

/**
 * Translate a bone's depgraph-composed transform back to the pose-shape
 * that `makeBoneLocalMatrix` expects. The kernel writes `transform.x =
 * pivotX + pose.x` (and similarly for y) to express the bone's
 * canvas-px joint position; here we subtract the rest pivot to recover
 * the additive `pose.{x,y}` channel.
 *
 * Mirrors the inverse of `effectiveTransform`'s bone branch
 * (`anim/constraints.js:165`).
 *
 * @param {object} bone
 * @param {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}} composed
 * @returns {{rotation:number, x:number, y:number, scaleX:number, scaleY:number}}
 */
function composedTransformToBonePose(bone, composed) {
  const px = finiteOr(bone?.transform?.pivotX, 0);
  const py = finiteOr(bone?.transform?.pivotY, 0);
  return {
    rotation: finiteOr(composed.rotation, 0),
    x: finiteOr(composed.x, 0) - px,
    y: finiteOr(composed.y, 0) - py,
    scaleX: finiteOr(composed.scaleX, 1),
    scaleY: finiteOr(composed.scaleY, 1),
  };
}

/**
 * Resolve a single bone's WORLD matrix (canvas-space) by reading
 * TRANSFORM_COMPOSE outputs along the bone parent chain. Falls back to
 * `node.pose` (via `getBonePose` for v17/v18-flat / v19+-channels
 * compat) when the depgraph hasn't computed a value (only relevant
 * for partial graphs / tests that bypass the build pass).
 *
 * Audit-fix G-13 (Phase 8 sweep) — partial-graph fallback contract:
 * if the depgraph build pass starts skipping bones (a future
 * optimization that prunes "no constraints, no animation" bones), the
 * fallback would become production-reachable for those bones. The
 * fallback path is shape-aware via `getBonePose` so it stays correct
 * regardless of when it fires; the test scoreboard for the depgraph
 * build pass should pin "every bone gets a TRANSFORM_COMPOSE node
 * unless explicitly skipped" so the fallback's reachability is
 * documented, not accidental.
 *
 * Memoised in the supplied `cache` so the chain walk is amortised
 * across all parts that share ancestor bones.
 *
 * @param {string} boneId
 * @param {import('../eval.js').EvalContext} ctx
 * @param {Map<string, object>} byId
 * @param {Map<string, Float32Array>} cache - boneId → WORLD
 * @returns {Float32Array}
 */
export function resolveBoneWorldFromCtx(boneId, ctx, byId, cache) {
  const cached = cache.get(boneId);
  if (cached) return cached;
  const bone = byId.get(boneId);
  if (!bone || !isBoneGroup(bone)) {
    const id = mat3Identity();
    cache.set(boneId, id);
    return id;
  }

  const composed = readComposedTransform(ctx, boneId);
  // Audit-fix G-1/D-1 (Phase 8 sweep): the partial-graph fallback
  // previously read `bone.pose` directly, which returns the v19
  // channels envelope (`{channels:{...}}`) — pose-field reads then
  // resolve to undefined → identity, dropping every pose delta.
  // Route through `getBonePose` so v17/v18 flat AND v19 channels
  // shapes both yield the canonical flat `{rotation, x, y, scaleX,
  // scaleY}` contract `makeBoneLocalMatrix` expects.
  const pose = composed ? composedTransformToBonePose(bone, composed) : getBonePose(bone);
  const r = finiteOr(pose?.rotation, 0);
  const px = finiteOr(pose?.x, 0);
  const py = finiteOr(pose?.y, 0);
  const sx = finiteOr(pose?.scaleX, 1);
  const sy = finiteOr(pose?.scaleY, 1);
  let local;
  if (r === 0 && px === 0 && py === 0 && sx === 1 && sy === 1) {
    local = mat3Identity();
  } else {
    local = makeBoneLocalMatrix({
      pivotX: finiteOr(bone.transform?.pivotX, 0),
      pivotY: finiteOr(bone.transform?.pivotY, 0),
    }, { rotation: r, x: px, y: py, scaleX: sx, scaleY: sy });
  }

  // Walk to nearest bone-group ancestor; non-bone groups (visual
  // folders) are skipped — they don't contribute pose. Mirrors
  // `computeBoneWorldMatrices` exactly.
  let parent = bone.parent ? byId.get(bone.parent) : null;
  while (parent && !isBoneGroup(parent)) {
    parent = parent.parent ? byId.get(parent.parent) : null;
  }
  let world;
  if (parent) {
    world = mat3MulInto(local, resolveBoneWorldFromCtx(parent.id, ctx, byId, cache), local);
  } else {
    world = local;
  }
  cache.set(boneId, world);
  return world;
}

/**
 * Apply the bone post-chain composition to a flat positions buffer
 * in place. Returns the same buffer so callers can chain.
 *
 * Mirrors the CanvasViewport post-loop's three-state composition
 * (LBS / overlay / none) but operates inside the depgraph kernel.
 *
 * @param {object} part - the project node for the part
 * @param {object|null} partMesh - resolved mesh datablock (typically `part.mesh`)
 * @param {Float32Array} positions - flat `[x0, y0, x1, y1, ...]` (modified in place)
 * @param {import('../eval.js').EvalContext} ctx
 * @param {Map<string, object>} byId - project nodes indexed by id
 * @param {Map<string, Float32Array>} boneWorldCache - per-eval cache
 * @returns {Float32Array}
 */
export function applyBonePostChainSkin(part, partMesh, positions, ctx, byId, boneWorldCache) {
  if (!part || !positions || positions.length === 0) return positions;

  const decision = pickBonePostChainComposition(part, partMesh ?? part?.mesh ?? null);
  if (decision.kind === 'none') return positions;

  if (decision.kind === 'lbs') {
    const childMatrix = resolveBoneWorldFromCtx(decision.jointBoneId, ctx, byId, boneWorldCache);
    const parentBoneId = decision.parentBoneId
      ?? findParentBoneId(decision.jointBoneId, byId);
    const parentMatrix = parentBoneId
      ? resolveBoneWorldFromCtx(parentBoneId, ctx, byId, boneWorldCache)
      : null;
    const weights = partMesh?.boneWeights ?? part?.mesh?.boneWeights ?? null;
    if (!weights) return positions;
    // boneSkinDiag — fires when EITHER bone WORLD is non-identity. Logs
    // the actual matrices the kernel sees so a "bones don't deform mesh"
    // report has a single line confirming what eval produces. Throttled
    // module-wide; first eval call within the window wins. Capture vert
    // sample BEFORE applyTwoBoneSkinning so we can show before+after.
    const _childIdent = isIdentityMatrix(childMatrix);
    const _parentIdent = !parentMatrix || isIdentityMatrix(parentMatrix);
    /** @type {Parameters<typeof _emitSkinDiag>[0] | null} */
    let _diagSnapshot = null;
    if (!_childIdent || !_parentIdent) {
      const t = _now();
      if (t - _lastSkinDiagAt >= SKIN_DIAG_THROTTLE_MS) {
        _lastSkinDiagAt = t;
        _diagSnapshot = {
          part,
          partMesh,
          kind: /** @type {'lbs'} */ ('lbs'),
          childMatrix: Array.from(childMatrix),
          parentMatrix: parentMatrix ? Array.from(parentMatrix) : null,
          jointBoneId: decision.jointBoneId,
          parentBoneId,
          beforeXY: [positions[0], positions[1]],
          weight0: weights[0] ?? null,
          byId,
        };
      }
    }
    // Weight=1 fast path subsumed by applyTwoBoneSkinning's per-vertex
    // dispatch; no need to special-case here.
    applyTwoBoneSkinning(positions, parentMatrix, childMatrix, weights);
    if (_diagSnapshot) _emitSkinDiag(_diagSnapshot, [positions[0], positions[1]]);
    return positions;
  }

  // overlay path — uniform multiplication for parts with a bone-group
  // ancestor that aren't per-vertex skinned.
  const ancestorId = findNearestBoneAncestorId(part, byId);
  if (!ancestorId) return positions;
  const m = resolveBoneWorldFromCtx(ancestorId, ctx, byId, boneWorldCache);
  if (isIdentityMatrix(m)) return positions;
  // boneSkinDiag (overlay path) — fires when ancestor WORLD is non-identity.
  /** @type {Parameters<typeof _emitSkinDiag>[0] | null} */
  let _overlayDiag = null;
  const _t = _now();
  if (_t - _lastSkinDiagAt >= SKIN_DIAG_THROTTLE_MS) {
    _lastSkinDiagAt = _t;
    _overlayDiag = {
      part,
      partMesh: null,
      kind: /** @type {'overlay'} */ ('overlay'),
      childMatrix: Array.from(m),
      parentMatrix: null,
      jointBoneId: ancestorId,
      parentBoneId: null,
      beforeXY: [positions[0], positions[1]],
      weight0: null,
      byId,
    };
  }
  applyOverlayMatrixFlat(positions, m);
  if (_overlayDiag) _emitSkinDiag(_overlayDiag, [positions[0], positions[1]]);
  return positions;
}

/**
 * One-line summary log for a single skin event. Format is designed for
 * console-paste legibility: bone name, matrix shorthand
 * `[m0 m1 m3 m4 m6 m7]` (last column omitted — always [0,0,1]), and the
 * before/after delta on vertex 0.
 *
 * @param {{
 *   part: object,
 *   partMesh: object|null,
 *   kind: 'lbs'|'overlay',
 *   childMatrix: number[],
 *   parentMatrix: number[]|null,
 *   jointBoneId: string,
 *   parentBoneId: string|null,
 *   beforeXY: [number, number],
 *   weight0: number|null,
 *   byId: Map<string, object>,
 * }} snap
 * @param {[number, number]} afterXY
 */
function _emitSkinDiag(snap, afterXY) {
  const childBone = snap.byId.get(snap.jointBoneId);
  const parentBone = snap.parentBoneId ? snap.byId.get(snap.parentBoneId) : null;
  const childName = childBone?.name ?? snap.jointBoneId;
  const parentName = parentBone?.name ?? snap.parentBoneId ?? '—';
  const fmt6 = (m) => m
    ? `[${m[0].toFixed(3)} ${m[1].toFixed(3)} ${m[3].toFixed(3)} ${m[4].toFixed(3)} ${m[6].toFixed(1)} ${m[7].toFixed(1)}]`
    : '—';
  const [bx, by] = snap.beforeXY;
  const [ax, ay] = afterXY;
  const dx = ax - bx;
  const dy = ay - by;
  const moved = (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001);
  logger.info('boneSkinDiag',
    `part="${snap.part.name ?? snap.part.id}" kind=${snap.kind} child="${childName}":${fmt6(snap.childMatrix)} parent="${parentName}":${fmt6(snap.parentMatrix)} weight0=${snap.weight0 ?? 'n/a'} v0:(${bx.toFixed(1)}, ${by.toFixed(1)})→(${ax.toFixed(1)}, ${ay.toFixed(1)}) Δ=(${dx.toFixed(2)}, ${dy.toFixed(2)})${moved ? '' : ' STATIONARY'}`,
    {
      partId: snap.part.id,
      partName: snap.part.name,
      kind: snap.kind,
      jointBoneId: snap.jointBoneId,
      parentBoneId: snap.parentBoneId,
      childMatrix: snap.childMatrix,
      parentMatrix: snap.parentMatrix,
      weight0: snap.weight0,
      beforeXY: snap.beforeXY,
      afterXY,
      deltaXY: [dx, dy],
      moved,
    });
}

/**
 * Mirror of `computeBoneParentMap` for a single bone — walk to the
 * nearest bone-group ancestor and return its id.
 *
 * @param {string} boneId
 * @param {Map<string, object>} byId
 * @returns {string|null}
 */
function findParentBoneId(boneId, byId) {
  const bone = byId.get(boneId);
  if (!bone) return null;
  let cur = bone.parent ? byId.get(bone.parent) : null;
  while (cur && !isBoneGroup(cur)) {
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return cur ? cur.id : null;
}

// `applyWeightedSkinning` re-export for tests that want the single-bone
// algebra without going through pickBonePostChainComposition.
export { applyWeightedSkinning };
