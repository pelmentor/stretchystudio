// @ts-check

/**
 * Eye tag sets used across sections 3c (per-part rig warps) and
 * 4 (CArtMeshSource per-vertex closure) of the .cmo3 generator.
 *
 * Lifted out of cmo3writer.js as a shared module so the extracted
 * helpers can reuse them without redeclaring (Phase 6, sweep #43).
 *
 *   - **EYEWHITE_TAGS** — `eyewhite`, `eyewhite-l`, `eyewhite-r`. The
 *     "primary" closure source: lower edge = lower-eyelid line.
 *   - **EYELASH_TAGS** — `eyelash`, `eyelash-l`, `eyelash-r`. Closure
 *     fallback when no eyewhite exists; lower edge gets flipped because
 *     it traces the upper opening, not the closing line.
 *   - **EYE_SOURCE_TAGS** — union of the two; a mesh with this tag can
 *     act as the source for one side's parabola fit.
 *   - **EYE_PART_TAGS** — every eye-region mesh (lash + white + iris,
 *     both sides). Drives the rig-warp grid bbox extension to eye-union
 *     bounds + the per-vertex closure path in Section 4.
 *
 * @module io/live2d/cmo3/eyeTags
 */

export const EYEWHITE_TAGS = new Set(['eyewhite', 'eyewhite-l', 'eyewhite-r']);
export const EYELASH_TAGS  = new Set(['eyelash',  'eyelash-l',  'eyelash-r']);
export const EYE_SOURCE_TAGS = new Set([...EYEWHITE_TAGS, ...EYELASH_TAGS]);
export const EYE_PART_TAGS = new Set([
  'eyelash',  'eyelash-l',  'eyelash-r',
  'eyewhite', 'eyewhite-l', 'eyewhite-r',
  'irides',   'irides-l',   'irides-r',
]);
