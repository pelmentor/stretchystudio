/**
 * Variant fade rules — Stage 5 of the native rig refactor.
 *
 * Variant meshes (e.g. `face.smile`, `eyebrow.surprised`) cross-fade with
 * their base sibling on `Param<Suffix>`:
 *   - Variant: opacity 0→1 over Param<Suffix>=[0,1] (linear).
 *   - Base (non-backdrop): opacity 1→0 over the same param (linear crossfade).
 *
 * Backdrop tags are exempt from base-fade. Faces, ears, and front/back hair
 * stay at opacity=1 always — they're the opaque substrate that prevents
 * midpoint translucency. Without backdrops, both base and variant would be
 * partially transparent at Param<Suffix>=0.5, exposing the canvas through
 * the head silhouette.
 *
 * This module hosts:
 *   - `DEFAULT_BACKDROP_TAGS` — tags that NEVER fade as variant bases.
 *     Both writers (cmo3 + moc3) used to keep their own duplicated copy
 *     of this set. Now there's one source of truth.
 *   - `resolveVariantFadeRules(project)` — populated → use as-is, else
 *     return defaults.
 *   - `seedVariantFadeRules(project)` — destructive write to
 *     `project.variantFadeRules`.
 *
 * Memory cross-refs:
 *   - feedback_variant_plateau_ramp — canonical 2-keyform linear fade rule.
 *   - feedback_variant_skips_tag_handling — variants must bypass eyelid /
 *     neck shapekey tag handling.
 *   - feedback_reference_only_hiyori — reference for the backdrop set.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 5.
 */

/**
 * Tags that never fade out when a variant sibling exists. These are the
 * always-present face substrate; variants layer on top.
 *
 * Order is preserved from cmo3writer.js / moc3writer.js. Frozen at the
 * module level so external reads can't mutate the default set.
 */
export const DEFAULT_BACKDROP_TAGS = Object.freeze([
  'face',
  'ears', 'ears-l', 'ears-r',
  'front hair', 'back hair',
]);

/**
 * @typedef {Object} VariantFadeRules
 * @property {string[]} backdropTags - tags exempt from base-fade
 */

/**
 * Build the variant fade rules from project state. Today there's no
 * project-level input — defaults are returned as-is. Reserved for future
 * per-character backdrop overrides (e.g. a hat-only character that wants
 * `hat` as a backdrop).
 *
 * @param {object} _project - reserved for future use
 * @returns {VariantFadeRules}
 */
export function buildVariantFadeRulesFromProject(_project) {
  return {
    backdropTags: [...DEFAULT_BACKDROP_TAGS],
  };
}

/**
 * Resolve the variant fade rules the writers should use:
 *   - If `project.variantFadeRules` is populated and well-formed, return it.
 *   - Otherwise, build defaults via `buildVariantFadeRulesFromProject`.
 *
 * @param {object} project
 * @returns {VariantFadeRules}
 */
export function resolveVariantFadeRules(project) {
  const cfg = project?.variantFadeRules;
  if (cfg && Array.isArray(cfg.backdropTags) && cfg.backdropTags.length > 0) {
    return cfg;
  }
  return buildVariantFadeRulesFromProject(project);
}

/**
 * Seed `project.variantFadeRules` from the defaults. Destructive.
 *
 * @param {object} project - mutated
 * @returns {VariantFadeRules} the seeded config
 */
export function seedVariantFadeRules(project) {
  const cfg = buildVariantFadeRulesFromProject(project);
  project.variantFadeRules = cfg;
  return cfg;
}
