/**
 * Bone configuration — Stage 7 of the native rig refactor.
 *
 * The "baked keyform angle set" — `[-90, -45, 0, 45, 90]` — drives:
 *   1. `paramSpec.js`: min/max range of `ParamRotation_<bone>` parameters
 *   2. `cmo3writer.js`: number of baked keyforms emitted for bone-weighted
 *      meshes (one keyform per angle, with the mesh rotated to that pose)
 *   3. `moc3writer.js`: same keyform count, kept in sync
 *
 * Today the constant is hardcoded in three places (twice imported from
 * paramSpec, once duplicated in moc3writer). Stage 7 lifts it to
 * `project.boneConfig.bakedKeyformAngles` so per-character override
 * is possible (e.g. a chibi character with limited arm rotation can
 * use [-30, 0, 30] for higher keyform density in the working range).
 *
 * Trade-off: changing this set after seeding invalidates baked mesh
 * keyforms in cmo3 — re-seed required. Documented in cross-cutting
 * invariants.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 7.
 */

/**
 * Default baked keyform angles for bone rotations, in degrees.
 * Symmetric around 0; ±90° = full rotation. Five samples is enough
 * for smooth Catmull-Rom interpolation in Cubism's runtime.
 */
export const DEFAULT_BAKED_KEYFORM_ANGLES = Object.freeze([-90, -45, 0, 45, 90]);

/**
 * @typedef {Object} BoneConfig
 * @property {number[]} bakedKeyformAngles - sorted ascending, includes 0
 */

/**
 * Build the bone config from project state. Today there's no
 * project-level input — defaults are returned as-is. Future versions
 * could derive per-bone overrides from project.nodes (e.g. a chibi
 * character flag).
 *
 * @param {object} _project - reserved for future use
 * @returns {BoneConfig}
 */
export function buildBoneConfigFromProject(_project) {
  return {
    bakedKeyformAngles: [...DEFAULT_BAKED_KEYFORM_ANGLES],
  };
}

/**
 * Resolve the bone config the writers should use:
 *   - If `project.boneConfig` is populated and well-formed, return it.
 *   - Otherwise, build defaults via `buildBoneConfigFromProject`.
 *
 * @param {object} project
 * @returns {BoneConfig}
 */
export function resolveBoneConfig(project) {
  const cfg = project?.boneConfig;
  if (cfg && Array.isArray(cfg.bakedKeyformAngles) && cfg.bakedKeyformAngles.length > 0) {
    return cfg;
  }
  return buildBoneConfigFromProject(project);
}

/**
 * Seed `project.boneConfig` from the defaults. Destructive.
 *
 * @param {object} project - mutated
 * @returns {BoneConfig} the seeded config
 */
export function seedBoneConfig(project) {
  const cfg = buildBoneConfigFromProject(project);
  project.boneConfig = cfg;
  return cfg;
}
