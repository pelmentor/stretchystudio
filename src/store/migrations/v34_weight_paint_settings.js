// @ts-check

/**
 * Schema v34 — `node.weightPaintSettings: { xMirror: boolean }` for every
 * `part` node.
 *
 * # Why this migration exists
 *
 * Toolset Plan Phase 7.B.4 — X-Axis Mirror toggle. Per-Object property
 * (Blender stores the equivalent on `Mesh.symmetry & ME_SYMMETRY_X` per
 * `reference/blender/source/blender/makesrna/intern/rna_mesh.cc:3243-3247`,
 * exposed as `Mesh.use_mirror_x` and shown in the N-panel as the "X"
 * toggle in the Symmetry section per `space_view3d.py:169`). When on,
 * paint strokes at vertex `v` also paint at the mirrored vertex `mirror(v)`
 * with the same brush weight, so symmetric character meshes can be
 * weighted from either side.
 *
 * # Why per-Object (not per-session)
 *
 * Some characters' meshes are symmetric (head, body) and some aren't
 * (asymmetric props, hair tufts). The toggle should follow the mesh.
 * Blender's `Mesh.use_mirror_x` is per-mesh; SS uses per-Object because
 * `node.dataId` indirection makes per-mesh storage awkward and Object-
 * level state is the v18-onward Blender-shape default. Net behaviour
 * matches Blender for v1 (one Object = one mesh).
 *
 * # Default value
 *
 * `false`. Pre-v34 projects open with the toggle off — paint strokes
 * affect only the cursor-side vertex, matching today's behaviour. The
 * user opts in per-part via the N-panel toggle.
 *
 * # Why this lives on every part (not just meshed parts)
 *
 * Idempotence + uniformity. Bone-role groups and non-meshed parts will
 * never enter weight paint mode, so the field is unused there but
 * harmless. Sparse JSON cost is one boolean per node — negligible.
 *
 * Actually for migration discipline we ONLY add the field on parts.
 * Other node types don't need it — adding it would clutter the JSON
 * with 50+ unused entries for a typical character.
 *
 * # Cross-references
 *
 * - `docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md` §7.B.4 — toggle spec
 * - `reference/blender/source/blender/makesrna/intern/rna_mesh.cc:3243-3247`
 *   — Blender's `Mesh.use_mirror_x`
 * - `src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx` — reads it
 *   during paint stroke
 *
 * @module store/migrations/v34_weight_paint_settings
 */

/**
 * Add `node.weightPaintSettings = { xMirror: false }` for every part
 * node that doesn't already carry it. Idempotent: re-running on a v34+
 * project leaves the existing settings untouched.
 *
 * @param {object} project — mutated in place
 * @returns {{ added: number }} count of nodes that gained the field
 */
export function migrateWeightPaintSettings(project) {
  if (!project || !Array.isArray(project.nodes)) return { added: 0 };
  let added = 0;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    if (node.weightPaintSettings
        && typeof node.weightPaintSettings === 'object'
        && typeof node.weightPaintSettings.xMirror === 'boolean') {
      continue;
    }
    node.weightPaintSettings = { xMirror: false };
    added++;
  }
  return { added };
}
