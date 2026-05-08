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
