// @ts-check

/**
 * Mask-pairing resolution for the .cmo3 generator's Section 4 head.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #33).
 *
 * Cubism handles clipping natively: when a mesh's `clipGuidList`
 * references another mesh's `CDrawableGuid`, the clipping mesh
 * occludes the masked one. Two routing paths:
 *
 *   1. **Stage 3 native rig path** (`maskConfigs.length > 0`) — the
 *      caller has already resolved pairings (typically via
 *      `rig/maskConfigs.js:buildMaskConfigsFromProject`). This path
 *      simply maps each pair's `maskMeshIds` from partId to pid via
 *      the `pidByPartId` index, taking the first non-null mask as
 *      the cmo3 emission target (cmo3 emits one clip ref per mesh
 *      today; rigSpec preserves the full mask list for runtime).
 *
 *   2. **Heuristic fallback** (no `maskConfigs`) — mirrors the
 *      algorithm in `rig/maskConfigs.js`: hard-coded `CLIP_RULES`
 *      table maps tagged meshes to their masking peer (irides →
 *      eyewhite, with -l/-r suffix-aware matching). Variant-aware
 *      pairing matches `irides-l.smile` to `eyewhite-l.smile` when
 *      both exist, falling back to base eyewhite otherwise.
 *
 * Variant-aware reason: base eyewhite fades to α=0 at the variant's
 * Param<Suffix>=1 endpoint (hasBaseFade / 2D compound), and Cubism
 * uses the mask's alpha for clipping — so a base-eyewhite-clipped
 * variant iris would vanish whenever its own param is high.
 *
 * Returns two parallel maps:
 *   - `maskPidByMaskedPartId`: partId → first mask's pid (cmo3 single
 *     clip ref).
 *   - `maskMeshIdsByPartId`: partId → full array of mask partIds
 *     (rigSpec multi-mask preservation for runtime/scenePass).
 *
 * @module io/live2d/cmo3/maskResolve
 */

const CLIP_RULES = {
  irides: 'eyewhite',
  'irides-l': 'eyewhite-l',
  'irides-r': 'eyewhite-r',
};

/**
 * @param {Object} opts
 * @param {Array} opts.perMesh
 * @param {Array} opts.meshes
 * @param {Array<{maskedMeshId:string, maskMeshIds:string[]}>} [opts.maskConfigs]
 * @returns {{
 *   maskPidByMaskedPartId: Map<string, string|number>,
 *   maskMeshIdsByPartId: Map<string, string[]>,
 *   pidByPartId: Map<string, string|number>,
 * }}
 */
export function resolveMaskPairings(opts) {
  const { perMesh, meshes, maskConfigs = [] } = opts;

  /** @type {Map<string, string|number>} */
  const pidByPartId = new Map();
  for (const pmEntry of perMesh) {
    pidByPartId.set(meshes[pmEntry.mi].partId, pmEntry.pidDrawable);
  }

  /** @type {Map<string, string|number>} */
  const maskPidByMaskedPartId = new Map();
  /** @type {Map<string, string[]>} */
  const maskMeshIdsByPartId = new Map();

  if (maskConfigs.length > 0) {
    // Stage 3 native rig path — pairings pre-resolved by caller.
    for (const pair of maskConfigs) {
      const masks = (pair.maskMeshIds ?? [])
        .map(id => pidByPartId.get(id))
        .filter(pid => pid != null);
      if (masks.length > 0) {
        // cmo3 emits one clip ref per mesh — first wins.
        maskPidByMaskedPartId.set(pair.maskedMeshId, masks[0]);
      }
      if (Array.isArray(pair.maskMeshIds) && pair.maskMeshIds.length > 0) {
        maskMeshIdsByPartId.set(pair.maskedMeshId, [...pair.maskMeshIds]);
      }
    }
    return { maskPidByMaskedPartId, maskMeshIdsByPartId, pidByPartId };
  }

  // Heuristic fallback — mirrors rig/maskConfigs.js's pairing algorithm.
  const basePidByTag = new Map();
  const variantPidByTagAndSuffix = new Map();
  const basePartIdByTag = new Map();
  const variantPartIdByTagAndSuffix = new Map();

  for (const pmEntry of perMesh) {
    const mesh = meshes[pmEntry.mi];
    const tag = mesh.tag;
    if (!tag) continue;
    const sfx = mesh.variantSuffix ?? mesh.variantRole ?? null;
    if (sfx) {
      const key = `${tag}|${sfx}`;
      if (!variantPidByTagAndSuffix.has(key)) {
        variantPidByTagAndSuffix.set(key, pmEntry.pidDrawable);
        variantPartIdByTagAndSuffix.set(key, mesh.partId);
      }
    } else if (!basePidByTag.has(tag)) {
      basePidByTag.set(tag, pmEntry.pidDrawable);
      basePartIdByTag.set(tag, mesh.partId);
    }
  }

  for (const pmEntry of perMesh) {
    const mesh = meshes[pmEntry.mi];
    const tag = mesh.tag;
    if (!tag) continue;
    const maskTag = CLIP_RULES[tag];
    if (!maskTag) continue;
    const sfx = mesh.variantSuffix ?? mesh.variantRole ?? null;
    const pid = sfx
      ? (variantPidByTagAndSuffix.get(`${maskTag}|${sfx}`) ?? basePidByTag.get(maskTag) ?? null)
      : (basePidByTag.get(maskTag) ?? null);
    if (pid) maskPidByMaskedPartId.set(mesh.partId, pid);
    const maskPartId = sfx
      ? (variantPartIdByTagAndSuffix.get(`${maskTag}|${sfx}`) ?? basePartIdByTag.get(maskTag) ?? null)
      : (basePartIdByTag.get(maskTag) ?? null);
    if (maskPartId) maskMeshIdsByPartId.set(mesh.partId, [maskPartId]);
  }

  return { maskPidByMaskedPartId, maskMeshIdsByPartId, pidByPartId };
}
