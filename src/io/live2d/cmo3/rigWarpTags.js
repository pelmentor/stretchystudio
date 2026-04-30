// @ts-check

/**
 * Tag → rig-warp configuration tables shared by the .cmo3 generator's
 * standard-rig section (3c) and structural body chain (3d).
 *
 * Three independent constants live here:
 *
 *   - `RIG_WARP_TAGS` — per-tag warp grid sizes (col × row) from
 *     `TEMPLATES.md` Bezier Division Spec. Body/limb parts use the 3×3
 *     default; face parts use per-part dimensions for finer control.
 *   - `FACE_PARALLAX_TAGS` — meshes that re-parent under the single
 *     unified Face Parallax warp (Session 19, Option B v2). The warp
 *     deforms once under ParamAngleX/Y and every child mesh inherits
 *     the deformation via bilinear interp — no independent per-part
 *     movement, the face rotates as one coherent surface.
 *   - `FACE_PARALLAX_DEPTH` — global depth scalar for that warp;
 *     bigger = stronger 3D-rotation parallax.
 *   - `NECK_WARP_TAGS` — meshes that hang under the Neck Warp,
 *     mirroring Hiyori's pattern (top row shifts under head tilt,
 *     bottom row pinned at shoulders).
 *
 * Lifted out of `cmo3writer.js` (Phase 6 god-class breakup); this
 * module is consumed only by the writer today, but kept separate so
 * future tag additions can be edited without scrolling through 4400+
 * LOC of generator code.
 *
 * @module io/live2d/cmo3/rigWarpTags
 */

/** @typedef {{ col: number, row: number }} WarpGridSize */

/**
 * Per-tag warp grid sizes (col × row).
 *
 * Body/limb parts default to 3×3. Face parts override per-tag for
 * finer control: small square parts (nose, ears, headwear) get 2×2,
 * vertically-long parts (face, back hair, tail) get 2×3, eye-region
 * parts that need precise control get 3×3, and the mouth gets 3×2.
 *
 * @type {Map<string, WarpGridSize>}
 */
export const RIG_WARP_TAGS = new Map([
  // Body / limbs
  ['topwear',     { col: 3, row: 3 }],
  ['bottomwear',  { col: 3, row: 3 }],
  ['handwear',    { col: 3, row: 3 }],
  ['handwear-l',  { col: 3, row: 3 }],
  ['handwear-r',  { col: 3, row: 3 }],
  ['legwear',     { col: 3, row: 3 }],
  ['legwear-l',   { col: 3, row: 3 }],
  ['legwear-r',   { col: 3, row: 3 }],
  ['footwear',    { col: 3, row: 3 }],
  ['footwear-l',  { col: 3, row: 3 }],
  ['footwear-r',  { col: 3, row: 3 }],
  ['neck',        { col: 3, row: 3 }],
  ['neckwear',    { col: 3, row: 3 }],
  // Head / face
  ['face',        { col: 2, row: 3 }],
  ['front hair',  { col: 2, row: 2 }],
  ['back hair',   { col: 2, row: 3 }],
  ['headwear',    { col: 2, row: 2 }],
  ['eyebrow',     { col: 2, row: 2 }],
  ['eyebrow-l',   { col: 2, row: 2 }],
  ['eyebrow-r',   { col: 2, row: 2 }],
  ['eyewhite',    { col: 3, row: 3 }],
  ['eyewhite-l',  { col: 3, row: 3 }],
  ['eyewhite-r',  { col: 3, row: 3 }],
  ['eyelash',     { col: 3, row: 3 }],
  ['eyelash-l',   { col: 3, row: 3 }],
  ['eyelash-r',   { col: 3, row: 3 }],
  ['irides',      { col: 3, row: 3 }],
  ['irides-l',    { col: 3, row: 3 }],
  ['irides-r',    { col: 3, row: 3 }],
  ['nose',        { col: 2, row: 2 }],
  ['mouth',       { col: 3, row: 2 }],
  ['ears',        { col: 2, row: 2 }],
  ['ears-l',      { col: 2, row: 2 }],
  ['ears-r',      { col: 2, row: 2 }],
  ['earwear',     { col: 2, row: 2 }],
  ['eyewear',     { col: 3, row: 3 }],
  ['tail',        { col: 2, row: 3 }],
  ['wings',       { col: 3, row: 3 }],
]);

/**
 * Meshes that re-parent under the single unified Face Parallax warp.
 *
 * The warp deforms once under ParamAngleX/Y and every member inherits
 * the deformation via bilinear interpolation, matching the "Blender
 * proportional-edit with smooth falloff" mental model: one continuous
 * deformation field across the whole face.
 *
 * @type {Set<string>}
 */
export const FACE_PARALLAX_TAGS = new Set([
  'face', 'nose',
  'eyebrow', 'eyebrow-l', 'eyebrow-r',
  'front hair', 'back hair',
  'eyewhite-l', 'irides-l', 'eyelash-l',
  'eyewhite-r', 'irides-r', 'eyelash-r',
  'mouth',
  'ears-l', 'ears-r',
]);

/**
 * Global depth scalar for the Face Parallax warp. Larger = bigger 3D
 * parallax. Spatial depth variation (per-region) can be added later.
 */
export const FACE_PARALLAX_DEPTH = 0.5;

/**
 * Meshes that hang under the Neck Warp — top row shifts under head
 * tilt, bottom row pinned at shoulders. Matches Hiyori's pattern.
 *
 * @type {Set<string>}
 */
export const NECK_WARP_TAGS = new Set(['neck', 'neckwear']);
