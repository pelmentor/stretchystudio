// @ts-check

/**
 * v46 — `node.variantRole` field-name retirement (RULE №2 cleanup).
 *
 * # Why this exists
 *
 * The `variantRole` field was the original name for what's now called
 * `variantSuffix` on part nodes. The variantNormalizer was migrated
 * to write `variantSuffix` (2026-04-26), but ALL readers gained a
 * defensive `variantSuffix ?? variantRole` fallback so old saved
 * projects (carrying only `variantRole`) kept working. v46 retires
 * the alias: consolidate every node to `variantSuffix`, drop
 * `variantRole`, so the readers can drop the fallback.
 *
 * # Coverage
 *
 * Pre-v46 nodes can be in any of these states:
 *   1. `variantSuffix: 'smile'`, no `variantRole`. (Live writer
 *      output; no-op for migration.)
 *   2. `variantSuffix: 'smile'`, `variantRole: 'smile'`. (Older live
 *      projects when both fields were written; canonicalise = drop
 *      variantRole.)
 *   3. `variantSuffix: undefined`, `variantRole: 'smile'`. (Pre-
 *      variantNormalizer-migration save files; promote variantRole
 *      to variantSuffix, then drop variantRole.)
 *   4. Both absent. (Non-variant parts; no-op.)
 *
 * The promotion preserves the canonical suffix value; the explicit
 * `delete node.variantRole` keeps the field count down (no zombie
 * `null` left behind).
 *
 * Sister to [[blender-over-cubism]] RULE №2 ("no migration baggage")
 * — the alias was migration baggage by definition: a fallback that
 * existed only to bridge a transition, never formalised by a
 * migration.
 *
 * @module store/migrations/v46_variant_role_alias_retirement
 */

/**
 * @param {object} project
 * @returns {object}
 */
export function migrateVariantRoleAliasRetirement(project) {
  if (!project || !Array.isArray(project.nodes)) return project;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    // Promote variantRole → variantSuffix when canonical is missing.
    if (
      (typeof node.variantSuffix !== 'string' || node.variantSuffix.length === 0) &&
      typeof node.variantRole === 'string' && node.variantRole.length > 0
    ) {
      node.variantSuffix = node.variantRole;
    }
    // Drop the alias once consolidated (or never present).
    if ('variantRole' in node) {
      delete node.variantRole;
    }
  }
  return project;
}
