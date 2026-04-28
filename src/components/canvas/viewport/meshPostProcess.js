// @ts-check

/**
 * v3 Phase 0F.3 — Pure mesh post-processing helpers.
 *
 * Two cohesive pieces of logic that previously lived inside the
 * mesh-worker callback in CanvasViewport. Both are pure: same
 * inputs always produce the same outputs, no DOM or store reads.
 *
 *   1. computeSkinWeights — for limb parts (arm / leg) with an
 *      elbow / knee child bone, project each vertex onto the
 *      shoulder→elbow axis and produce a 0..1 weight that decides
 *      how much that vertex follows the joint bone vs. stays
 *      rigid to the parent group.
 *
 *   2. computeMeshCentroid — return the (cx, cy) mid-point of the
 *      vertex bounding box. Used to auto-center a part's pivot
 *      when it's still at the default (0, 0).
 *
 * Coverage: this code shipped without tests for years because it
 * was buried in a React component nobody could import. Now it's
 * checkable and unit-testable.
 *
 * @module components/canvas/viewport/meshPostProcess
 */

/**
 * @typedef {Object} BoneRoleMapResult
 * @property {string} childRole         - e.g. 'leftElbow' for parent 'leftArm'
 *
 * @typedef {Object} Vec2
 * @property {number} x
 * @property {number} y
 *
 * @typedef {Object} TransformLike
 * @property {number} pivotX
 * @property {number} pivotY
 *
 * @typedef {Object} JointBoneLike
 * @property {string} id
 * @property {TransformLike} transform
 *
 * @typedef {Object} ParentGroupLike
 * @property {TransformLike} transform
 */

/**
 * Map a parent-group bone role to its expected child-bone role
 * for skin-weight computation. Hard-coded matches the four
 * supported limb chains; non-limb groups return null.
 *
 * @param {string|null|undefined} parentRole
 * @returns {string|null}
 */
export function childBoneRoleFor(parentRole) {
  switch (parentRole) {
    case 'leftArm':  return 'leftElbow';
    case 'rightArm': return 'rightElbow';
    case 'leftLeg':  return 'leftKnee';
    case 'rightLeg': return 'rightKnee';
    default:         return null;
  }
}

/**
 * Compute a per-vertex bone weight in [0, 1] for a limb mesh.
 *
 * Algorithm: project each vertex onto the unit vector from the
 * shoulder pivot (parent group) to the elbow pivot (joint bone).
 * The signed distance past the elbow / blend gets remapped via
 * `weight = (projection / blend) + 0.5` and clamped to [0, 1].
 *
 *   - weight = 0 → vertex stays rigid to the shoulder (upper arm).
 *   - weight = 1 → vertex follows the elbow joint completely.
 *   - 0..1     → blend zone (default 40 px centred on the elbow).
 *
 * Pure - same inputs always produce the same array.
 *
 * @param {Vec2[]} vertices
 * @param {ParentGroupLike} parentGroup    - shoulder / hip
 * @param {JointBoneLike}   jointBone      - elbow / knee
 * @param {number} [blend=40]              - blend-zone width in px
 * @returns {number[]}                     - same length as vertices
 */
export function computeSkinWeights(vertices, parentGroup, jointBone, blend = 40) {
  const sx = parentGroup.transform.pivotX;
  const sy = parentGroup.transform.pivotY;
  const jx = jointBone.transform.pivotX;
  const jy = jointBone.transform.pivotY;

  const axDx = jx - sx;
  const axDy = jy - sy;
  const axLen = Math.sqrt(axDx * axDx + axDy * axDy) || 1;
  const axX = axDx / axLen;
  const axY = axDy / axLen;

  const out = new Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const projection = (v.x - jx) * axX + (v.y - jy) * axY;
    const w = projection / blend + 0.5;
    out[i] = w < 0 ? 0 : w > 1 ? 1 : w;
  }
  return out;
}

/**
 * Mid-point of the axis-aligned bounding box of `vertices`.
 * Returns null when the vertex array is empty.
 *
 * Used to auto-center a part's pivot when it's at the default
 * (0, 0) and we have a real mesh to lean on.
 *
 * @param {Vec2[]} vertices
 * @returns {{cx: number, cy: number}|null}
 */
export function computeMeshCentroid(vertices) {
  if (!vertices || vertices.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
