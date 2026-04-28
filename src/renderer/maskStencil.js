/**
 * Stencil allocation for clip-mask rendering.
 *
 * Generalises the iris/eyewhite hardcoded stencil heuristic that lived in
 * scenePass.js into a tag-agnostic allocator driven by project.maskConfigs
 * (the data layer Stage 3 of the native rig refactor produced).
 *
 * Each unique mask mesh referenced by any clip pair gets its own 1-based
 * stencil value. The renderer:
 *   - When drawing a mask mesh: writes its allocated stencil ID
 *     (`gl.stencilFunc(ALWAYS, value, 0xFF)` + `REPLACE`).
 *   - When drawing a masked mesh: reads the array of stencil values and
 *     emits one stencil-EQUAL test per value. With a single-mask pair (the
 *     only shape today's heuristic emits) this collapses to a single draw.
 *     Multi-mask is reserved for future fidelity.
 *
 * Only PURE allocation here — the renderer (scenePass.js) walks the result
 * and dispatches GL calls. This module has zero GL dependencies, so it is
 * unit-testable in plain Node.
 *
 * @module renderer/maskStencil
 */

/** Maximum mask-mesh count addressable with an 8-bit stencil buffer. */
export const MAX_STENCIL_ID = 255;

/**
 * @typedef {Object} MaskStencilState
 * @property {Map<string, number>} stencilByMaskMeshId
 *           Mesh id → 1-based stencil value to *write* when drawing this
 *           mesh. Each unique mask mesh appears exactly once.
 * @property {Map<string, number[]>} stencilsByMaskedMeshId
 *           Mesh id → sorted list of stencil values to *test against* when
 *           drawing this masked mesh. Length matches the input
 *           `maskMeshIds` array (after deduping + skipping unallocated).
 * @property {number} overflow
 *           Number of unique mask meshes that didn't fit in [1, 255].
 *           Always 0 in practice (today's heuristic emits at most ~3 mask
 *           meshes for irides/eyewhite); non-zero indicates a pathological
 *           project we should warn about at the caller.
 */

/**
 * Allocate stencil values for the given mask configs.
 *
 * Stable across calls: mask meshes are assigned stencil IDs in
 * first-encounter order across the maskConfigs array, so a project that
 * doesn't change its maskConfigs gets the same stencil layout every frame
 * (good for shader-driven asserts and visual reproducibility).
 *
 * Idempotent on duplicates: the same mask mesh referenced by N pairs gets
 * one stencil ID, not N.
 *
 * @param {Array<{maskedMeshId: string, maskMeshIds: string[]}>} maskConfigs
 * @returns {MaskStencilState}
 */
export function allocateMaskStencils(maskConfigs) {
  const stencilByMaskMeshId = new Map();
  const stencilsByMaskedMeshId = new Map();
  let overflow = 0;
  let nextStencil = 1;

  if (!Array.isArray(maskConfigs) || maskConfigs.length === 0) {
    return { stencilByMaskMeshId, stencilsByMaskedMeshId, overflow: 0 };
  }

  // Pass 1 — assign IDs to every unique mask mesh in first-encounter order.
  for (const pair of maskConfigs) {
    if (!pair || !Array.isArray(pair.maskMeshIds)) continue;
    for (const maskId of pair.maskMeshIds) {
      if (typeof maskId !== 'string' || maskId.length === 0) continue;
      if (stencilByMaskMeshId.has(maskId)) continue;
      if (nextStencil > MAX_STENCIL_ID) {
        overflow += 1;
        continue;
      }
      stencilByMaskMeshId.set(maskId, nextStencil);
      nextStencil += 1;
    }
  }

  // Pass 2 — for each masked mesh, gather the sorted unique stencil values
  // it should test against. Sorting makes the output deterministic and
  // simplifies test assertions.
  for (const pair of maskConfigs) {
    if (!pair || typeof pair.maskedMeshId !== 'string') continue;
    if (!Array.isArray(pair.maskMeshIds) || pair.maskMeshIds.length === 0) continue;
    const stencils = new Set();
    for (const maskId of pair.maskMeshIds) {
      const v = stencilByMaskMeshId.get(maskId);
      if (v != null) stencils.add(v);
    }
    if (stencils.size === 0) continue;
    const sorted = [...stencils].sort((a, b) => a - b);
    // Multiple pairs targeting the same masked mesh get their stencil sets
    // merged (last writer in input order is dominant for the merged
    // ordering; the sort below normalises).
    const prior = stencilsByMaskedMeshId.get(pair.maskedMeshId);
    if (prior) {
      const union = new Set([...prior, ...sorted]);
      stencilsByMaskedMeshId.set(
        pair.maskedMeshId,
        [...union].sort((a, b) => a - b),
      );
    } else {
      stencilsByMaskedMeshId.set(pair.maskedMeshId, sorted);
    }
  }

  return { stencilByMaskMeshId, stencilsByMaskedMeshId, overflow };
}
