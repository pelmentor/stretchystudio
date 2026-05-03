/**
 * Clip mask configuration — Stage 3 of the native rig refactor.
 *
 * Currently both `moc3writer` and `cmo3writer` carry an inline
 * `CLIP_RULES` map and reproduce the same variant-aware iris↔eyewhite
 * pairing logic. This module hosts the rule + a pure pair-builder, so
 * the seeder can pre-compute pairs and store them on `project.maskConfigs`,
 * and the writers can fall back to the same algorithm verbatim when the
 * project is unseeded.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 3.
 */

import { matchTag } from '../../armatureOrganizer.js';
import { mergeAuthoredByStage } from './userAuthorMarkers.js';

/**
 * Tag → mask tag. A mesh whose tag is a key here gets clipped by the
 * matching mesh whose tag is the value.
 *
 * Variant-aware: if the masked mesh has a variant suffix (e.g.
 * `irides-l.smile`), the seeder prefers a same-suffix mask
 * (`eyewhite-l.smile`). Falls back to the base mask if no matching
 * variant mask exists. This avoids the variant iris vanishing when its
 * Param<Suffix>=1 fades the base eyewhite to α=0.
 */
export const CLIP_RULES = Object.freeze({
  irides:     'eyewhite',
  'irides-l': 'eyewhite-l',
  'irides-r': 'eyewhite-r',
});

/**
 * @typedef {Object} MaskConfig
 * @property {string}   maskedMeshId  - The mesh that gets clipped
 * @property {string[]} maskMeshIds   - Meshes that mask it (Cubism allows multiple;
 *                                      today's rules emit single-element arrays).
 */

/**
 * Filter project nodes to the visible art-mesh parts that participate in
 * mask pairing.
 */
function visibleMeshNodes(project) {
  return (project.nodes ?? []).filter(
    (n) => n && n.type === 'part' && n.mesh && n.visible !== false
  );
}

/**
 * Apply CLIP_RULES + variant-aware pairing to the project's meshes and
 * return the resulting mask configs. Pure function — does not mutate.
 *
 * Algorithm (same as the inline logic in moc3writer:892-922 and
 * cmo3writer:3482-3690):
 *   1. Walk meshes, build `basePidByTag` (tag → mesh id) and
 *      `variantPidByTagAndSuffix` (`tag|suffix` → mesh id).
 *   2. For each mesh whose tag is a CLIP_RULES key:
 *        a. Resolve the mask tag from the rule.
 *        b. If mesh has a variant suffix, prefer the same-suffix mask
 *           (`maskTag|suffix`) — fall back to base mask.
 *        c. Otherwise use the base mask.
 *      If neither base nor variant mask exists, the mesh gets no clip.
 *
 * @param {object} project - { nodes: Node[] }
 * @returns {MaskConfig[]}
 */
export function buildMaskConfigsFromProject(project) {
  const meshes = visibleMeshNodes(project);

  const basePidByTag = new Map();
  const variantPidByTagAndSuffix = new Map();
  const meshTagCache = new Map(); // node.id → resolved tag (avoid double work)

  for (const node of meshes) {
    const tag = matchTag(node.name || node.id);
    if (!tag) continue;
    meshTagCache.set(node.id, tag);
    const sfx = node.variantSuffix ?? node.variantRole ?? null;
    if (sfx) {
      const key = `${tag}|${sfx}`;
      if (!variantPidByTagAndSuffix.has(key)) {
        variantPidByTagAndSuffix.set(key, node.id);
      }
    } else if (!basePidByTag.has(tag)) {
      basePidByTag.set(tag, node.id);
    }
  }

  const out = [];
  for (const node of meshes) {
    const tag = meshTagCache.get(node.id);
    if (!tag) continue;
    const maskTag = CLIP_RULES[tag];
    if (!maskTag) continue;

    const sfx = node.variantSuffix ?? node.variantRole ?? null;
    let maskMeshId = null;
    if (sfx) {
      maskMeshId =
        variantPidByTagAndSuffix.get(`${maskTag}|${sfx}`) ??
        basePidByTag.get(maskTag) ??
        null;
    } else {
      maskMeshId = basePidByTag.get(maskTag) ?? null;
    }
    if (!maskMeshId) continue;

    out.push({ maskedMeshId: node.id, maskMeshIds: [maskMeshId] });
  }

  return out;
}

/**
 * Resolve the mask configs the writers should use:
 *   - If `project.maskConfigs` is populated (seeded), return it.
 *   - Otherwise, compute via `buildMaskConfigsFromProject` (today's path).
 *
 * Writers should call this rather than re-implementing the heuristic.
 *
 * @param {object} project
 * @returns {MaskConfig[]}
 */
export function resolveMaskConfigs(project) {
  if (Array.isArray(project.maskConfigs) && project.maskConfigs.length > 0) {
    return project.maskConfigs;
  }
  return buildMaskConfigsFromProject(project);
}

/**
 * Seed `project.maskConfigs` from the auto-rig heuristic.
 *
 * **Mode semantics (V3 Re-Rig Phase 0):**
 *   - `'replace'` (default, back-compat): destructive — overwrites
 *     existing configs entirely. Original Stage-3 behaviour; what
 *     full Re-Init Rig + the existing call sites still expect.
 *   - `'merge'`: preserves any existing entry with `_userAuthored: true`
 *     (manually added via MaskTab); reseeds the rest. Used by per-stage
 *     "Refit" UI in Phase 1.
 *
 * After this runs, `project.maskConfigs` is populated and the export
 * pipeline reads from it directly via `resolveMaskConfigs`.
 *
 * @param {object} project - mutated
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {MaskConfig[]} - the seeded list (also written to project.maskConfigs)
 */
export function seedMaskConfigs(project, mode = 'replace') {
  const autoSeeded = buildMaskConfigsFromProject(project);
  const next = mode === 'merge'
    ? mergeAuthoredByStage('maskConfigs', autoSeeded, project.maskConfigs)
    : autoSeeded;
  project.maskConfigs = next;
  return next;
}
