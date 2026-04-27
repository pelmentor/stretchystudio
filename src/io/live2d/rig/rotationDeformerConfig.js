/**
 * Rotation deformer config — Stage 8 of the native rig refactor.
 *
 * Today the rotation deformer auto-rig has four hardcoded constants
 * scattered across paramSpec.js / cmo3writer.js / rotationDeformers.js:
 *
 *   1. `SKIP_ROTATION_ROLES = ['torso', 'eyes', 'neck']`
 *      Group `boneRole` values that DON'T get a rotation deformer
 *      (handled by warps instead). Duplicated in cmo3writer + paramSpec.
 *   2. `DEFORMER_ANGLE_MIN/MAX = ±30`
 *      Range of `ParamRotation_<group>` parameters.
 *   3. Group rotation `paramKeys=[-30,0,30]`, `angles=[-30,0,30]`
 *      The keyform binding for a generic group rotation deformer (1:1).
 *   4. Face rotation `paramKeys=[-30,0,30]`, `angles=[-10,0,10]`
 *      Capped at ±10° even when ParamAngleZ is at full ±30 — keeps head
 *      tilt proportions believable. Hiyori convention.
 *
 * This module hosts:
 *   - `DEFAULT_ROTATION_DEFORMER_CONFIG` — the four bundled defaults.
 *   - `buildRotationDeformerConfigFromProject(project)` — returns a
 *     mutable copy. No project-level input today; reserved for future
 *     per-character overrides (chibi character with limited rotation,
 *     non-standard skip roles, etc.).
 *   - `resolveRotationDeformerConfig(project)` — populated → use as-is,
 *     else build defaults.
 *   - `seedRotationDeformerConfig(project)` — destructive write.
 *
 * Trade-off: changing `paramKeys` or `angles` after seeding leaves stale
 * keyforms in already-emitted .cmo3 files (pivot still derives live from
 * `g.transform`, so re-seed picks up new pivots automatically — but the
 * keyform count + binding shape comes from this config). Documented in
 * cross-cutting "ID stability" invariant.
 *
 * Memory cross-refs:
 *   - SESSION_23_FINDINGS.md — neck added to SKIP_ROTATION_ROLES.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 8.
 */

/**
 * Frozen defaults. Don't mutate; use `buildRotationDeformerConfigFromProject`
 * to get a mutable copy.
 */
export const DEFAULT_ROTATION_DEFORMER_CONFIG = Object.freeze({
  skipRotationRoles: Object.freeze(['torso', 'eyes', 'neck']),
  paramAngleRange: Object.freeze({ min: -30, max: 30 }),
  groupRotation: Object.freeze({
    paramKeys: Object.freeze([-30, 0, 30]),
    angles: Object.freeze([-30, 0, 30]),
  }),
  faceRotation: Object.freeze({
    paramKeys: Object.freeze([-30, 0, 30]),
    angles: Object.freeze([-10, 0, 10]),
  }),
});

/**
 * @typedef {Object} RotationDeformerConfig
 * @property {string[]} skipRotationRoles
 * @property {{min:number, max:number}} paramAngleRange
 * @property {{paramKeys:number[], angles:number[]}} groupRotation
 * @property {{paramKeys:number[], angles:number[]}} faceRotation
 */

function clonePair(src) {
  return {
    paramKeys: [...src.paramKeys],
    angles: [...src.angles],
  };
}

/**
 * Build a mutable copy of the defaults. No project-level inputs today.
 *
 * @param {object} _project - reserved for future use
 * @returns {RotationDeformerConfig}
 */
export function buildRotationDeformerConfigFromProject(_project) {
  return {
    skipRotationRoles: [...DEFAULT_ROTATION_DEFORMER_CONFIG.skipRotationRoles],
    paramAngleRange: { ...DEFAULT_ROTATION_DEFORMER_CONFIG.paramAngleRange },
    groupRotation: clonePair(DEFAULT_ROTATION_DEFORMER_CONFIG.groupRotation),
    faceRotation: clonePair(DEFAULT_ROTATION_DEFORMER_CONFIG.faceRotation),
  };
}

function isWellFormedPair(pair) {
  return (
    pair &&
    Array.isArray(pair.paramKeys) && pair.paramKeys.length > 0 &&
    Array.isArray(pair.angles) && pair.angles.length === pair.paramKeys.length
  );
}

/**
 * Resolve the rotation deformer config the writers should use:
 *   - If `project.rotationDeformerConfig` is populated and well-formed,
 *     return it.
 *   - Otherwise, build defaults via `buildRotationDeformerConfigFromProject`.
 *
 * Well-formed means: `skipRotationRoles` is an array, `paramAngleRange`
 * has finite numeric min/max, both pair sub-objects have matching-length
 * `paramKeys` + `angles` arrays. Any malformed field falls back to defaults
 * (per-field fallback would silently mix user data with defaults; whole-
 * config fallback is louder and matches Stage 7 boneConfig semantics).
 *
 * @param {object} project
 * @returns {RotationDeformerConfig}
 */
export function resolveRotationDeformerConfig(project) {
  const cfg = project?.rotationDeformerConfig;
  if (
    cfg &&
    Array.isArray(cfg.skipRotationRoles) &&
    cfg.paramAngleRange &&
    Number.isFinite(cfg.paramAngleRange.min) &&
    Number.isFinite(cfg.paramAngleRange.max) &&
    isWellFormedPair(cfg.groupRotation) &&
    isWellFormedPair(cfg.faceRotation)
  ) {
    return cfg;
  }
  return buildRotationDeformerConfigFromProject(project);
}

/**
 * Seed `project.rotationDeformerConfig` from the defaults. Destructive.
 *
 * @param {object} project - mutated
 * @returns {RotationDeformerConfig} the seeded config
 */
export function seedRotationDeformerConfig(project) {
  const cfg = buildRotationDeformerConfigFromProject(project);
  project.rotationDeformerConfig = cfg;
  return cfg;
}
