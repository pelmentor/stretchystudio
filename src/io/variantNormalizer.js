/**
 * variantNormalizer.js
 *
 * After PSD import + rigging, makes sure every `.smile` / `.sad` / `.angry`
 * variant part sits in the SAME parent group as its base sibling and with a
 * draw_order that puts it immediately on top of that base — regardless of
 * where the user placed the variant layer in the original PSD.
 *
 * The normalization is the single source of truth for variant pairing.
 * After running, every variant part carries:
 *   - `variantOf`     : id of its base part
 *   - `variantSuffix` : e.g. 'smile' / 'sad' / 'angry'
 * and its `parent` + `draw_order` match that invariant.
 *
 * Orphan variants (no matching base in the project) are left in place but
 * logged as a warning — they render as plain layers.
 *
 * Idempotent — running it twice on the same project is a no-op.
 */

import { extractVariant } from './psdOrganizer.js';
import { logger } from '../lib/logger.js';

/**
 * @typedef {Object} VariantPairing
 * @property {object} variant  - the variant part node
 * @property {object} base     - the base part node
 * @property {string} suffix   - e.g. 'smile'
 */

/**
 * @typedef {Object} NormalizeResult
 * @property {VariantPairing[]} pairings - successful variant ↔ base pairings
 * @property {object[]} orphans          - variant parts whose base wasn't found
 */

/**
 * Locate the base part for a given variant node by name.
 *
 * Prefers an exact same-name-without-suffix sibling. Case-insensitive name
 * comparison to be forgiving (`foo.Smile` still pairs with `foo`). Excludes
 * the variant node itself and any other variant-named parts.
 */
function findBasePart(variantNode, baseName, allParts) {
  const needle = baseName.toLowerCase().trim();
  let best = null;
  for (const n of allParts) {
    if (n.id === variantNode.id) continue;
    if (n.type !== 'part') continue;
    if ((n.name ?? '').toLowerCase().trim() !== needle) continue;
    // Skip other variants with the same stripped name (e.g. two layers
    // named identically — shouldn't happen, but defensive).
    const { variant: otherVariant } = extractVariant(n.name ?? '');
    if (otherVariant) continue;
    // Prefer the visible / meshed candidate over a stray hidden one
    if (!best) { best = n; continue; }
    const bestScore = (best.visible !== false ? 1 : 0) + (best.mesh ? 1 : 0);
    const thisScore = (n.visible !== false ? 1 : 0) + (n.mesh ? 1 : 0);
    if (thisScore > bestScore) best = n;
  }
  return best;
}

/**
 * Run the normalization pass.
 *
 * Mutates `project.nodes` in place:
 *   - sets `variantOf` / `variantSuffix` on each variant part
 *   - reparents each variant to its base's parent
 *   - renumbers `draw_order` across all parts so each variant sits
 *     immediately on top of its base (and stacks above sibling variants)
 *
 * @param {{nodes: object[]}} project
 * @returns {NormalizeResult}
 */
export function normalizeVariants(project) {
  if (!project || !Array.isArray(project.nodes)) {
    return { pairings: [], orphans: [] };
  }

  const parts = project.nodes.filter(n => n.type === 'part');
  /** @type {VariantPairing[]} */
  const pairings = [];
  /** @type {object[]} */
  const orphans = [];

  // ── 1. Pair each variant with its base ───────────────────────────────────
  for (const node of parts) {
    const { baseName, variant } = extractVariant(node.name ?? '');
    if (!variant) {
      // Not a variant — make sure stale fields are cleared if this node
      // used to be a variant and was renamed.
      if (node.variantOf !== undefined) delete node.variantOf;
      if (node.variantSuffix !== undefined) delete node.variantSuffix;
      continue;
    }
    const base = findBasePart(node, baseName, parts);
    if (!base) {
      orphans.push(node);
      // Best-effort: keep the previous pairing fields clean
      if (node.variantOf !== undefined) delete node.variantOf;
      if (node.variantSuffix !== undefined) delete node.variantSuffix;
      continue;
    }
    node.variantOf = base.id;
    node.variantSuffix = variant;
    pairings.push({ variant: node, base, suffix: variant });
  }

  // ── 2. Reparent + hide variants ──────────────────────────────────────────
  // Variants are driven by `Param<Suffix>` opacity fade (0 → 1 on the
  // suffix param, see `feedback_variant_plateau_ramp` memory). At rest
  // pose (param=0) the variant should be invisible. The PSD's per-layer
  // visibility flag tells us nothing useful — artists routinely paint
  // variants visible while sketching the base, and the auto-rig should
  // own the variant's display state. Force `visible = false` so the
  // post-import scene shows the base alone, and the fade param drives
  // the variant in.
  for (const { variant, base, suffix } of pairings) {
    const wasVisible = variant.visible !== false;
    const wasReparented = (variant.parent ?? null) !== (base.parent ?? null);
    if (wasReparented) {
      variant.parent = base.parent ?? null;
    }
    variant.visible = false;
    logger.info('variantNorm', `Layer "${variant.name}" got hidden automatically, considered a variant`, {
      base: base.name,
      suffix,
      reparented: wasReparented,
      wasVisibleInPsd: wasVisible,
      driverParam: `Param${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`,
    });
  }

  // ── 3. Assign fractional draw_order so variants land above their base,
  //    then renumber everything to integers preserving the sorted order.
  // Group variants by base so multiple variants of the same base stack
  // predictably above the base in their existing order.
  const variantsByBaseId = new Map();
  for (const p of pairings) {
    const list = variantsByBaseId.get(p.base.id) ?? [];
    list.push(p);
    variantsByBaseId.set(p.base.id, list);
  }
  for (const [baseId, list] of variantsByBaseId) {
    const base = parts.find(n => n.id === baseId);
    if (!base) continue;
    // Stable sort by current draw_order so the user's chosen relative
    // order among sibling variants (if any) is preserved.
    list.sort((a, b) =>
      (a.variant.draw_order ?? 0) - (b.variant.draw_order ?? 0)
    );
    for (let i = 0; i < list.length; i++) {
      // Fractional offsets ensure variants land immediately above the base
      // and ahead of other parts at base.draw_order + 1. Renumbering in
      // step 4 turns these into consecutive integers.
      list[i].variant.draw_order = (base.draw_order ?? 0) + (i + 1) * 1e-3;
    }
  }

  // ── 4. Renumber all parts to consecutive integers, preserving sort. ──
  // Scope the renumbering to the whole project: draw_order is a global
  // rendering key across parts, so local per-group renumbering could
  // reorder unrelated parts.
  const sorted = [...parts].sort((a, b) =>
    (a.draw_order ?? 0) - (b.draw_order ?? 0)
  );
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].draw_order = i;
  }

  if (orphans.length > 0) {
    for (const o of orphans) {
      logger.warn('variantNorm', `Orphan variant "${o.name}" — no matching base, will render as plain layer`, {
        name: o.name,
      });
    }
  }

  if (pairings.length > 0) {
    const bySuffix = {};
    for (const p of pairings) {
      bySuffix[p.suffix] = (bySuffix[p.suffix] ?? 0) + 1;
    }
    logger.info('variantNorm', `Variant pass complete: ${pairings.length} hidden, ${orphans.length} orphan(s)`, {
      bySuffix,
    });
  }

  return { pairings, orphans };
}
