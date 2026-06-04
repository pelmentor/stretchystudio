// @ts-check

/**
 * v49 — variant `visible: false` → `visible: true, opacity: 0` (bug-08 closure).
 *
 * # Why this exists
 *
 * Pre-v49 the `variantNormalizer` set `variant.visible = false` on every
 * detected variant part so the post-import scene showed the base alone
 * and `Param<Suffix>` fade-ramped the variant in. But this broke the
 * runtime fade path silently: every rig pipeline gate is `n.visible !==
 * false` (`buildMeshesForRig`, `exportLive2DProject`, `_buildArtMeshes`,
 * etc.), so variants never entered `rigSpec.artMeshes` and the depgraph
 * had no ART_MESH_EVAL chain for them. The cmo3 emit logic at
 * `artMeshSourceEmit.js:651-658` would have synthesized the 2-keyform
 * opacity fade if the variant had survived the filter, but it didn't.
 *
 * Result: at ParamSmile=1, `face.smile` stayed invisible because:
 *   1. `node.visible === false` → `visMap` = false → renderer skipped draw.
 *   2. Even if visMap were true, no opacity keyform was authored at
 *      runtime, so depgraph would have produced opacity=1 (single-keyform
 *      default) — not the fade ramp.
 *
 * v49 flips the schema so variants always enter the rig pipeline:
 *   `variant.visible = true, variant.opacity = 0`.
 *
 * The cmo3 emit path's `hasEmotionVariantOnly` branch then synthesizes
 * the correct opacity ramp (gate is `!!m.variantSuffix`, NOT visibility).
 * `seedAllRig` mirrors it into `mesh.runtime`; depgraph blends opacity;
 * `applyOverrideToNode` routes `poseOverrides.opacity` into the
 * effective node; renderer reads it. See bug-08 closure note.
 *
 * # Coverage
 *
 * Pre-v49 variant nodes can be in:
 *   1. `{visible: false, variantSuffix: 'smile'}` — the live writer
 *      output before this fix. Action: flip to `{visible: true,
 *      opacity: 0}`.
 *   2. `{visible: false, variantSuffix: 'smile', opacity: <n>}` — odd
 *      hand-edited or stale state. Action: keep `opacity` as-is if
 *      already 0, else overwrite to 0 (variant rest-opacity is 0 by
 *      definition).
 *   3. `{visible: true, variantSuffix: 'smile', opacity: 0}` — already
 *      v49-shape. No-op.
 *   4. Non-variant parts (`variantSuffix` falsy). No-op regardless of
 *      visibility — `node.visible = false` on a non-variant is the user's
 *      explicit hide and stays honored.
 *
 * @module store/migrations/v49_variant_visible_to_opacity
 */

/**
 * @param {object} project
 * @returns {object}
 */
export function migrateVariantVisibleToOpacity(project) {
  if (!project || !Array.isArray(project.nodes)) return project;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    if (typeof node.variantSuffix !== 'string' || node.variantSuffix.length === 0) continue;
    if (node.visible !== false) {
      // Already v49-shape (visible:true) or undefined (treated as true).
      // Still ensure opacity is set to 0 for the variant rest state.
      if (node.opacity !== 0) node.opacity = 0;
      continue;
    }
    node.visible = true;
    node.opacity = 0;
  }
  return project;
}
