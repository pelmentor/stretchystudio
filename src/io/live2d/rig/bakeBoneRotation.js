// @ts-check

/**
 * Blender LINEAR-BLEND-SKINNING bake for a bone-rotation keyform.
 *
 * Pure, reusable, and TESTED so the Cubism export bake and any live re-bake
 * share ONE implementation (viewport == export by construction). Mirrors
 * `applyTwoBoneSkinning` (src/renderer/boneSkinning.js): the deformed
 * position is the LBS chord
 *
 *   v = rest + (R(angle)·(rest − pivot) + pivot − rest) · weight
 *     = lerp(rest, fullyRotated, weight)
 *
 * where `fullyRotated` rotates the vertex by the FULL bone `angleDeg` around
 * `pivot` (NOT a weight-scaled angle — the weight enters via the lerp). At
 * `w=0` → rest, `w=1` → fully rotated, `0<w<1` → the straight-line chord
 * (Blender's LBS volume-loss), exactly matching `applyTwoBoneSkinning`'s
 * `px + (cx − px)·w` with parent = identity, child = full rotation.
 *
 * # Coordinate frame
 *
 * Verts and pivot are in the keyform's LOCAL frame. `scaleX`/`scaleY` map one
 * local unit to canvas pixels (under a rigWarp: `rwBox.gridW`/`gridH`; in
 * deformer-pixel space: 1/1). The rotation is performed in canvas-pixel space
 * (scale → rotate → unscale) so a degree of rotation is visually a degree
 * even when the local frame is anisotropic (warp-local 0..1 with gridW≠gridH).
 *
 * The lerp is per-component linear, and per-component linear ops COMMUTE with
 * the diagonal `diag(scaleX, scaleY)` map — so this local-frame lerp equals
 * the canvas-pixel lerp `applyTwoBoneSkinning` performs, for the rest grid
 * (a rectangle). Pinned by `test_bakeBoneRotation.mjs`.
 *
 * @param {ArrayLike<number>} verts - flat `[x0,y0,...]` rest verts, local frame
 * @param {number} numVerts
 * @param {ArrayLike<number>} weights - per-vertex bone weight (0..1)
 * @param {number} pivotLocalX
 * @param {number} pivotLocalY
 * @param {number} scaleX - local-unit → canvas-px on X (rwBox.gridW, or 1)
 * @param {number} scaleY - local-unit → canvas-px on Y (rwBox.gridH, or 1)
 * @param {number} angleDeg - the FULL bone rotation angle (degrees)
 * @returns {number[]} flat baked positions, local frame
 */
export function bakeBoneRotationLBS(verts, numVerts, weights, pivotLocalX, pivotLocalY, scaleX, scaleY, angleDeg) {
  const rad = angleDeg * Math.PI / 180; // FULL angle; weight enters via lerp
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const positions = new Array(numVerts * 2);
  for (let i = 0; i < numVerts; i++) {
    const localX = verts[i * 2];
    const localY = verts[i * 2 + 1];
    const w = weights[i] ?? 0;
    // Scale radial offset to canvas pixels → rotate full angle → unscale.
    const dx = (localX - pivotLocalX) * scaleX;
    const dy = (localY - pivotLocalY) * scaleY;
    const fullX = pivotLocalX + (dx * cos - dy * sin) / scaleX;
    const fullY = pivotLocalY + (dx * sin + dy * cos) / scaleY;
    // LBS chord: lerp rest → fully-rotated by weight.
    positions[i * 2]     = localX + (fullX - localX) * w;
    positions[i * 2 + 1] = localY + (fullY - localY) * w;
  }
  return positions;
}
