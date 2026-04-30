// @ts-check

/**
 * UV remap, triangle indices, draw-order group emit for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #39).
 *
 * Three small, independent passes:
 *
 *   - **UV remap** — translates per-mesh PSD-space UVs (0..1 over
 *     `srcWidth × srcHeight`) into atlas-space:
 *       1. UV → source pixel via `srcWidth/srcHeight`.
 *       2. Offset from crop origin (`srcX/srcY`).
 *       3. Scale to atlas region (`width/height`).
 *       4. Add atlas position, normalise by `atlasSize`.
 *     Final UV is clamped to [0, 1] — mesh contours can extend
 *     slightly outside the crop due to 2px dilation in
 *     `contour.js`'s mesh generation.
 *
 *   - **Triangle indices** — flatten per-mesh `triangles` (Array of
 *     `[i, j, k]`) into a single I16 stream for `position_index.indices`.
 *
 *   - **Draw order groups** — Hiyori-pattern single-group: one root
 *     containing all art meshes, render order = reverse of draw_order
 *     so highest draw_order paints first (= behind everything else).
 *
 * @module io/live2d/moc3/uvAndIndices
 */

/**
 * @param {Object} opts
 * @returns {{
 *   allUVs: number[],
 *   allIndices: number[],
 *   drawOrderGroupSections: object,
 *   drawOrderGroupObjectSections: object,
 * }}
 */
export function buildUvAndIndices(opts) {
  const { meshParts, regions, atlasSize } = opts;

  // ── UV remap (PSD → atlas) ──
  const allUVs = [];
  for (let mi = 0; mi < meshParts.length; mi++) {
    const part = meshParts[mi];
    const mesh = part.mesh;
    const region = regions.get(part.id);
    if (mesh.uvs && region) {
      for (let i = 0; i < mesh.uvs.length; i += 2) {
        const srcPxX = mesh.uvs[i] * region.srcWidth;
        const srcPxY = mesh.uvs[i + 1] * region.srcHeight;
        const localX = (srcPxX - region.srcX) / region.cropW * region.width;
        const localY = (srcPxY - region.srcY) / region.cropH * region.height;
        allUVs.push(Math.max(0, Math.min(1, (region.x + localX) / atlasSize)));
        allUVs.push(Math.max(0, Math.min(1, (region.y + localY) / atlasSize)));
      }
    }
  }

  // ── Triangle indices flatten ──
  const allIndices = [];
  for (const part of meshParts) {
    if (part.mesh?.triangles) {
      for (const tri of part.mesh.triangles) {
        allIndices.push(tri[0], tri[1], tri[2]);
      }
    }
  }

  // ── Draw order groups (Hiyori pattern, single root group) ──
  const numArtMeshes = meshParts.length;
  const drawOrderGroupSections = {
    'draw_order_group.object_begin_indices': [0],
    'draw_order_group.object_counts': [numArtMeshes],
    'draw_order_group.object_total_counts': [numArtMeshes],
    'draw_order_group.min_draw_orders': [1000],
    'draw_order_group.max_draw_orders': [200],
  };

  // Render order = reverse of draw_order (highest draw_order first → behind).
  const drawOrderGroupObjectSections = {
    'draw_order_group_object.types': meshParts.map(() => 0), // 0 = ArtMesh
    'draw_order_group_object.indices': meshParts.map((_, i) => numArtMeshes - 1 - i),
    'draw_order_group_object.group_indices': meshParts.map(() => -1), // -1 like Hiyori
  };

  return { allUVs, allIndices, drawOrderGroupSections, drawOrderGroupObjectSections };
}
