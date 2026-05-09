/**
 * 2D transform utilities — shared between the renderer and UI components.
 *
 * All matrices are 3×3 column-major Float32Array(9).
 * Index convention: m[col*3 + row]
 *
 *  col0  col1  col2
 *  [0]   [3]   [6]   row 0
 *  [1]   [4]   [7]   row 1
 *  [2]   [5]   [8]   row 2
 */

import { isBoneGroup } from '../store/objectDataAccess.js';

/** Identity matrix */
export function mat3Identity() {
  return new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
}

/**
 * Multiply two column-major 3×3 matrices into a caller-supplied
 * output buffer: out = a × b. Reads every input cell BEFORE writing
 * to `out` so aliasing (`out === a` or `out === b`) is safe.
 *
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {Float32Array} the same `out` buffer for convenience.
 */
export function mat3MulInto(out, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2];
  const a3 = a[3], a4 = a[4], a5 = a[5];
  const a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const b3 = b[3], b4 = b[4], b5 = b[5];
  const b6 = b[6], b7 = b[7], b8 = b[8];
  out[0] = a0 * b0 + a3 * b1 + a6 * b2;
  out[1] = a1 * b0 + a4 * b1 + a7 * b2;
  out[2] = a2 * b0 + a5 * b1 + a8 * b2;
  out[3] = a0 * b3 + a3 * b4 + a6 * b5;
  out[4] = a1 * b3 + a4 * b4 + a7 * b5;
  out[5] = a2 * b3 + a5 * b4 + a8 * b5;
  out[6] = a0 * b6 + a3 * b7 + a6 * b8;
  out[7] = a1 * b6 + a4 * b7 + a7 * b8;
  out[8] = a2 * b6 + a5 * b7 + a8 * b8;
  return out;
}

/**
 * Allocating wrapper for callers that need a fresh result. Hot paths
 * should use `mat3MulInto(scratch, a, b)` to avoid the per-call
 * Float32Array(9) allocation.
 */
export function mat3Mul(a, b) {
  return mat3MulInto(new Float32Array(9), a, b);
}

/**
 * Invert a 2D affine 3×3 column-major matrix.
 * Assumes no perspective (last row is [0, 0, 1]).
 */
export function mat3Inverse(m) {
  const a = m[0], b = m[1];   // col 0
  const c = m[3], d = m[4];   // col 1
  const tx = m[6], ty = m[7]; // col 2
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return mat3Identity();
  const inv = 1 / det;
  return new Float32Array([
     d  * inv,              // [0]
    -b  * inv,              // [1]
     0,                     // [2]
    -c  * inv,              // [3]
     a  * inv,              // [4]
     0,                     // [5]
    (c * ty - d * tx) * inv, // [6]
    (b * tx - a * ty) * inv, // [7]
     1,                     // [8]
  ]);
}

/**
 * Build a local 3×3 matrix from a node's transform properties.
 *
 * Applies (right to left):
 *   T(x+pivotX, y+pivotY) × R(rotation°) × S(scaleX, scaleY) × T(-pivotX, -pivotY)
 *
 * @param {{ x?, y?, rotation?, scaleX?, scaleY?, pivotX?, pivotY? }|null|undefined} t
 */
export function makeLocalMatrix(t) {
  const {
    x = 0, y = 0,
    rotation = 0,
    scaleX = 1, scaleY = 1,
    pivotX = 0, pivotY = 0,
  } = t ?? {};

  const θ = rotation * (Math.PI / 180);
  const c = Math.cos(θ);
  const s = Math.sin(θ);

  const m0 = scaleX * c;
  const m1 = scaleX * s;
  const m3 = -scaleY * s;
  const m4 = scaleY * c;

  return new Float32Array([
     m0,                                        // [0]
     m1,                                        // [1]
     0,                                         // [2]
     m3,                                        // [3]
     m4,                                        // [4]
     0,                                         // [5]
    (x + pivotX) - m0 * pivotX - m3 * pivotY,   // [6]
    (y + pivotY) - m1 * pivotX - m4 * pivotY,   // [7]
     1,                                         // [8]
  ]);
}

/**
 * Build a bone-group's local matrix.
 *
 * Bones split rest layout (`transform`) from pose offset (`pose`). The
 * bone's local frame is `restMatrix × poseMatrix`, both centered on the
 * same pivot:
 *
 *   localBone = makeLocalMatrix(transform) × makeLocalMatrix(poseAroundPivot)
 *
 * Where `poseAroundPivot` is the bone's `pose` reinterpreted as a
 * transform whose `pivotX/pivotY` matches the rest pivot.
 *
 * `transform.rotation`, `transform.scaleX/Y`, and `transform.x/y` are
 * the bone's REST layout fields. Direct user editing happens through
 * the Properties panel (typed numeric input) or by posing in Pose Mode
 * + Apply Pose As Rest. When all are at their identity values
 * (rotation=0, scale=1, x=y=0) the rest matrix is identity-modulo-pivot
 * and the compose reduces to pose-around-pivot.
 *
 * @param {{ pivotX?, pivotY?, rotation?, x?, y?, scaleX?, scaleY? }|null|undefined} transform
 * @param {{ rotation?, x?, y?, scaleX?, scaleY? }|null|undefined} pose
 */
export function makeBoneLocalMatrix(transform, pose) {
  const restM = makeLocalMatrix(transform);
  if (!pose) return restM;
  const r = pose.rotation ?? 0;
  const px = pose.x ?? 0;
  const py = pose.y ?? 0;
  const sx = pose.scaleX ?? 1;
  const sy = pose.scaleY ?? 1;
  if (r === 0 && px === 0 && py === 0 && sx === 1 && sy === 1) return restM;
  const poseM = makeLocalMatrix({
    rotation: r, x: px, y: py, scaleX: sx, scaleY: sy,
    pivotX: transform?.pivotX ?? 0,
    pivotY: transform?.pivotY ?? 0,
  });
  // Compose into restM (we own it — fresh from makeLocalMatrix).
  // Saves one Float32Array(9) allocation per posed bone per frame.
  return mat3MulInto(restM, restM, poseM);
}

/**
 * Compute world matrices for every node in a flat array.
 * world = parentWorld × local  (depth-first, memoised).
 *
 * Bones use `makeBoneLocalMatrix(transform, pose)` so user pose drags
 * compose on top of rest. Non-bone nodes use `makeLocalMatrix(transform)`
 * unchanged — `pose` only has meaning on bone groups.
 *
 * @param {Array} nodes  Flat node array from projectStore
 * @returns {Map<string, Float32Array>}  nodeId → column-major 3×3
 */
export function computeWorldMatrices(nodes) {
  const worldMap = new Map();
  const nodeMap  = new Map(nodes.map(n => [n.id, n]));

  function resolve(node) {
    if (worldMap.has(node.id)) return worldMap.get(node.id);
    const isBone = isBoneGroup(node);
    const local = isBone
      ? makeBoneLocalMatrix(node.transform, node.pose)
      : makeLocalMatrix(node.transform);
    let world;
    if (node.parent && nodeMap.has(node.parent)) {
      // Compose into `local` (we own it — fresh from makeLocalMatrix /
      // makeBoneLocalMatrix). Saves one Float32Array(9) allocation per
      // node per frame for the world-matrix product.
      world = mat3MulInto(local, resolve(nodeMap.get(node.parent)), local);
    } else {
      world = local;
    }
    worldMap.set(node.id, world);
    return world;
  }

  for (const node of nodes) resolve(node);
  return worldMap;
}

/**
 * BVR-004 follow-up — drag-time helper for Pose Mode joint translate.
 *
 * Captures the rest-frame inverse matrix + pivot for a bone so that
 * the per-move handler can compute `pose.{x,y}` in one matrix-point
 * multiply (`applyPoseTranslate`) — keeping the drag at 60Hz.
 *
 * The "rest world" here is `parentWorldWithPose × restMatrix(this bone)`.
 * Parent's pose IS included (so dragging a child of a posed parent
 * stays correct). Only THIS bone's pose is excluded — that's what
 * we're computing.
 *
 * @param {Float32Array} parentWorldWithPose  Parent's full world matrix
 *   (from `computeWorldMatrices`). Pass `mat3Identity()` for top-level.
 * @param {{ pivotX?, pivotY?, rotation?, x?, y?, scaleX?, scaleY? }} transform
 *   Bone's `transform` (rest layout).
 * @returns {{inverse: Float32Array, pivotX: number, pivotY: number} | null}
 *   `null` if transform is missing or the rest world is degenerate.
 */
export function preparePoseTranslate(parentWorldWithPose, transform) {
  if (!transform) return null;
  const restM = makeLocalMatrix(transform);
  const restWorld = mat3Mul(parentWorldWithPose, restM);
  const inverse = mat3Inverse(restWorld);
  return {
    inverse,
    pivotX: transform.pivotX ?? 0,
    pivotY: transform.pivotY ?? 0,
  };
}

/**
 * Per-move pair to `preparePoseTranslate`. Maps a canvas-px target to
 * `pose.{x,y}` such that the bone's joint dot lands at that target.
 *
 * Math: `pose = inverse(restWorld) · target - pivot`. Pivot is in the
 * bone's parent-rest frame; subtracting it yields the post-rest
 * translation that `pose.x/y` carries (rotation around pivot fixes
 * pivot, then translate by pose moves it to the target).
 *
 * @param {{inverse: Float32Array, pivotX: number, pivotY: number}} setup
 * @param {number} targetCanvasX
 * @param {number} targetCanvasY
 * @returns {{x: number, y: number}}
 */
export function applyPoseTranslate(setup, targetCanvasX, targetCanvasY) {
  const inv = setup.inverse;
  const localX = inv[0] * targetCanvasX + inv[3] * targetCanvasY + inv[6];
  const localY = inv[1] * targetCanvasX + inv[4] * targetCanvasY + inv[7];
  return { x: localX - setup.pivotX, y: localY - setup.pivotY };
}

/**
 * Compute effective visibility and opacity for every node by walking the
 * parent chain and accumulating values (depth-first, memoised).
 *
 * A node is effectively visible only when it AND all ancestors are visible.
 * Effective opacity is the product of a node's own opacity with all ancestor
 * opacities (mirrors how Photoshop / After Effects layer groups behave).
 *
 * @param {Array} nodes  Flat node array from projectStore
 * @returns {{ visMap: Map<string,boolean>, opMap: Map<string,number> }}
 */
export function computeEffectiveProps(nodes) {
  const visMap  = new Map();
  const opMap   = new Map();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function resolve(node) {
    if (visMap.has(node.id)) return;
    const parentId = node.parent;
    if (parentId && nodeMap.has(parentId)) {
      resolve(nodeMap.get(parentId));
      visMap.set(node.id, visMap.get(parentId) && (node.visible !== false));
      opMap.set(node.id, opMap.get(parentId) * (node.opacity ?? 1));
    } else {
      visMap.set(node.id, node.visible !== false);
      opMap.set(node.id, node.opacity ?? 1);
    }
  }

  for (const node of nodes) resolve(node);
  return { visMap, opMap };
}
