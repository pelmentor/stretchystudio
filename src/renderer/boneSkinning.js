// @ts-check

/**
 * Per-vertex weighted bone skinning.
 *
 * Linear blend skinning for parts with single-bone-per-part vertex
 * weights (`mesh.boneWeights: number[]` + `mesh.jointBoneId`). Mirrors
 * the math Blender's `pchan_bone_deform` accumulates per-vertex
 * (`reference/blender/source/blender/blenkernel/intern/armature_deform.cc:249-268`)
 * — `out_v = lerp(in_v, M·in_v, weight[i])` where `M` is the joint
 * bone's WORLD matrix (composed through bone-group ancestors via
 * `boneOverlayMatrix.computeBoneWorldMatrices`).
 *
 * **Why this exists.** `boneOverlayMatrix` applies a single overlay
 * matrix to every vertex of a part. That's correct for parts whose
 * vertices all rotate together (e.g. topwear under torso). For parts
 * with weighted skinning (handwear, legwear under their respective
 * elbow/knee bones), the overlay would rotate the whole part as a
 * rigid block, ignoring per-vertex `boneWeights` — vertex 0 (shoulder
 * end) would rotate as much as vertex N (wrist end), producing a stiff
 * rotation instead of a natural bend.
 *
 * Per-vertex skinning takes the same world matrix and scales its
 * effect by each vertex's weight. Weight 1.0 → full rotation
 * (identical to overlay path). Weight 0.0 → no rotation (vertex stays
 * at rest position). Mid-values produce the natural bend at the joint.
 *
 * **Composition with chainEval.** chainEval emits canvas-space verts
 * including any `ParamRotation_<bone>` rotation already encoded via
 * baked keyforms (cellSelect picks the keyform geometry for the
 * current param value). Skinning runs ON TOP of those verts: the
 * bone gesture's `pose.rotation` produces an additional rotation
 * matrix, and skinning rotates the chainEval output by it. If the
 * user has both the slider non-zero AND the bone non-zero, the two
 * compose user-additively (Blender's shape-key + armature stacking).
 *
 * **Mutual exclusivity with `boneOverlayMatrix`.** A part with weighted
 * skinning should NOT also receive the per-part overlay matrix from
 * `boneOverlayMatrix`. The skinning path subsumes it (weights of 1.0
 * collapse to identical math). Caller is responsible for choosing
 * one or the other per part.
 *
 * @module renderer/boneSkinning
 */

const EPS = 1e-6;

/**
 * True when the matrix is essentially identity (skip the per-vertex
 * loop). Tolerance matches `boneOverlayMatrix.isIdentityLike`.
 *
 * @param {Float32Array} m
 */
export function isIdentityMatrix(m) {
  return Math.abs(m[0] - 1) < EPS
      && Math.abs(m[1])     < EPS
      && Math.abs(m[3])     < EPS
      && Math.abs(m[4] - 1) < EPS
      && Math.abs(m[6])     < EPS
      && Math.abs(m[7])     < EPS;
}

/**
 * Apply per-vertex weighted skinning to a flat positions array.
 *
 * For each vertex i: `out_v = lerp(in_v, M·in_v, weight[i])`.
 *
 * In place. No-op when `matrix` is null/undefined or identity, or
 * when `weights` is null/undefined or shorter than `positions / 2`.
 *
 * @param {Float32Array} positions - flat [x0, y0, x1, y1, ...]
 * @param {Float32Array|null|undefined} matrix - 3×3 column-major
 * @param {ArrayLike<number>|null|undefined} weights - per-vertex weights, length ≥ positions.length / 2
 */
export function applyWeightedSkinning(positions, matrix, weights) {
  if (!matrix || isIdentityMatrix(matrix)) return positions;
  if (!weights) return positions;
  const m0 = matrix[0], m1 = matrix[1], m3 = matrix[3], m4 = matrix[4], m6 = matrix[6], m7 = matrix[7];
  const n = positions.length >> 1;
  if (weights.length < n) return positions;
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0;
    if (w === 0) continue;
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const tx = m0 * x + m3 * y + m6;
    const ty = m1 * x + m4 * y + m7;
    if (w === 1) {
      positions[i * 2]     = tx;
      positions[i * 2 + 1] = ty;
    } else {
      positions[i * 2]     = x + (tx - x) * w;
      positions[i * 2 + 1] = y + (ty - y) * w;
    }
  }
  return positions;
}

/**
 * Object-vert variant for the `Array<{x, y}>` shape CanvasViewport
 * uses just before GPU upload. Same math as the flat variant.
 *
 * @param {Array<{x: number, y: number}>} verts
 * @param {Float32Array|null|undefined} matrix
 * @param {ArrayLike<number>|null|undefined} weights
 */
export function applyWeightedSkinningObj(verts, matrix, weights) {
  if (!matrix || isIdentityMatrix(matrix)) return verts;
  if (!weights) return verts;
  if (weights.length < verts.length) return verts;
  const m0 = matrix[0], m1 = matrix[1], m3 = matrix[3], m4 = matrix[4], m6 = matrix[6], m7 = matrix[7];
  for (let i = 0; i < verts.length; i++) {
    const w = weights[i] ?? 0;
    if (w === 0) continue;
    const v = verts[i];
    const x = v.x;
    const y = v.y;
    const tx = m0 * x + m3 * y + m6;
    const ty = m1 * x + m4 * y + m7;
    if (w === 1) {
      v.x = tx;
      v.y = ty;
    } else {
      v.x = x + (tx - x) * w;
      v.y = y + (ty - y) * w;
    }
  }
  return verts;
}

/**
 * Two-bone linear blend skinning. Each vertex receives a weighted blend
 * between two bone matrices: the PARENT bone (e.g. leftArm/shoulder) and
 * the CHILD bone (e.g. leftElbow). Weight 0 → vertex follows parent,
 * weight 1 → vertex follows child, mid-values produce the natural
 * shoulder→elbow bend along a limb.
 *
 * Algebra:
 *   pos = (1-w) · parentWorld · v + w · childWorld · v
 *
 * Mirrors Blender's `pchan_bone_deform` accumulating two bones'
 * contributions into one output vertex
 * (`reference/blender/source/blender/blenkernel/intern/armature_deform.cc`).
 *
 * **Why this exists.** SS's `mesh.boneWeights` array carries a single
 * scalar per vertex along the limb axis. The single-matrix skinning
 * (`applyWeightedSkinningObj` above) treats weight=0 as "vertex stays
 * at rest in canvas-space" — which is wrong when the PARENT bone is
 * the one being rotated (rotating leftArm with leftElbow at rest must
 * still drag the upper-arm vertices weighted to leftArm). Two-bone
 * skinning fixes this: weight=0 verts follow parentWorld instead of
 * the canvas frame.
 *
 * **Edge case — child.local = identity.** When the child bone has rest
 * pose (the user only rotated the parent), childWorld = parentWorld
 * (because childWorld = parentWorld × childLocal). The lerp between
 * two equal matrices collapses, so every vertex transforms by
 * parentWorld regardless of weight. The whole limb rotates rigidly,
 * which is what "rotate the upper-arm bone" should look like.
 *
 * **Edge case — parentWorld = identity.** When the parent bone is at
 * rest (only the child is rotated), weight=0 verts stay at canvas-rest
 * (parentWorld·v = v) and weight=1 verts rotate by childWorld. That's
 * the correct elbow-only bend.
 *
 * In place. No-op when either matrix is missing or weights is shorter
 * than verts.
 *
 * @param {Array<{x: number, y: number}>} verts
 * @param {Float32Array|null|undefined} parentMatrix - parent bone WORLD (3×3 column-major)
 * @param {Float32Array|null|undefined} childMatrix  - child  bone WORLD (3×3 column-major)
 * @param {ArrayLike<number>|null|undefined} weights - per-vertex weights, [0,1]
 */
export function applyTwoBoneSkinningObj(verts, parentMatrix, childMatrix, weights) {
  if (!weights) return verts;
  if (weights.length < verts.length) return verts;
  const pIdent = !parentMatrix || isIdentityMatrix(parentMatrix);
  const cIdent = !childMatrix  || isIdentityMatrix(childMatrix);
  // Both at rest → no work to do.
  if (pIdent && cIdent) return verts;
  // Pull parent matrix coefficients (or identity).
  const p0 = pIdent ? 1 : parentMatrix[0];
  const p1 = pIdent ? 0 : parentMatrix[1];
  const p3 = pIdent ? 0 : parentMatrix[3];
  const p4 = pIdent ? 1 : parentMatrix[4];
  const p6 = pIdent ? 0 : parentMatrix[6];
  const p7 = pIdent ? 0 : parentMatrix[7];
  // Pull child matrix coefficients (or identity).
  const c0 = cIdent ? 1 : childMatrix[0];
  const c1 = cIdent ? 0 : childMatrix[1];
  const c3 = cIdent ? 0 : childMatrix[3];
  const c4 = cIdent ? 1 : childMatrix[4];
  const c6 = cIdent ? 0 : childMatrix[6];
  const c7 = cIdent ? 0 : childMatrix[7];
  for (let i = 0; i < verts.length; i++) {
    const w = weights[i] ?? 0;
    const v = verts[i];
    const x = v.x;
    const y = v.y;
    const px = p0 * x + p3 * y + p6;
    const py = p1 * x + p4 * y + p7;
    if (w === 0) {
      v.x = px;
      v.y = py;
    } else if (w === 1) {
      v.x = c0 * x + c3 * y + c6;
      v.y = c1 * x + c4 * y + c7;
    } else {
      const cx = c0 * x + c3 * y + c6;
      const cy = c1 * x + c4 * y + c7;
      v.x = px + (cx - px) * w;
      v.y = py + (cy - py) * w;
    }
  }
  return verts;
}

/**
 * Flat-array variant of `applyTwoBoneSkinningObj`. Same math, operates
 * on `[x0, y0, x1, y1, ...]`.
 *
 * @param {Float32Array} positions
 * @param {Float32Array|null|undefined} parentMatrix
 * @param {Float32Array|null|undefined} childMatrix
 * @param {ArrayLike<number>|null|undefined} weights
 */
export function applyTwoBoneSkinning(positions, parentMatrix, childMatrix, weights) {
  if (!weights) return positions;
  const n = positions.length >> 1;
  if (weights.length < n) return positions;
  const pIdent = !parentMatrix || isIdentityMatrix(parentMatrix);
  const cIdent = !childMatrix  || isIdentityMatrix(childMatrix);
  if (pIdent && cIdent) return positions;
  const p0 = pIdent ? 1 : parentMatrix[0];
  const p1 = pIdent ? 0 : parentMatrix[1];
  const p3 = pIdent ? 0 : parentMatrix[3];
  const p4 = pIdent ? 1 : parentMatrix[4];
  const p6 = pIdent ? 0 : parentMatrix[6];
  const p7 = pIdent ? 0 : parentMatrix[7];
  const c0 = cIdent ? 1 : childMatrix[0];
  const c1 = cIdent ? 0 : childMatrix[1];
  const c3 = cIdent ? 0 : childMatrix[3];
  const c4 = cIdent ? 1 : childMatrix[4];
  const c6 = cIdent ? 0 : childMatrix[6];
  const c7 = cIdent ? 0 : childMatrix[7];
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0;
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const px = p0 * x + p3 * y + p6;
    const py = p1 * x + p4 * y + p7;
    if (w === 0) {
      positions[i * 2]     = px;
      positions[i * 2 + 1] = py;
    } else if (w === 1) {
      positions[i * 2]     = c0 * x + c3 * y + c6;
      positions[i * 2 + 1] = c1 * x + c4 * y + c7;
    } else {
      const cx = c0 * x + c3 * y + c6;
      const cy = c1 * x + c4 * y + c7;
      positions[i * 2]     = px + (cx - px) * w;
      positions[i * 2 + 1] = py + (cy - py) * w;
    }
  }
  return positions;
}
