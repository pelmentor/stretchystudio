/**
 * Eye closure config — Stage 5 of the native rig refactor.
 *
 * The eyelid-closure system fits a parabola to the lower edge of each
 * eyewhite mesh, then collapses lash/white/iris vertices onto that curve
 * (scaled by the lash strip thickness) when ParamEye{L,R}Open=0. Three
 * tunables drive the geometry:
 *   - `closureTags` — which mesh tags participate (per-side eyelash,
 *     eyewhite, irides).
 *   - `lashStripFrac` — fraction of lash bbox height used as the closed-eye
 *     strip thickness (0.06 = ~6% of lash height).
 *   - `binCount` — number of X-uniform bins for lower-edge sampling when
 *     PNG alpha contour extraction isn't available.
 *
 * All three were hardcoded inside `cmo3writer.js`. Stage 5 lifts them so
 * per-character override is possible (e.g. extreme anime eyes might need
 * a thicker lashStripFrac, or custom tags like `eye-makeup`).
 *
 * Trade-off: changing `closureTags` after seeding leaves stale closure
 * geometry on previously-included meshes — re-seed required. Documented in
 * cross-cutting "ID stability" invariant.
 *
 * Memory cross-refs:
 *   - reference_emotions_two_patterns — eye sub-meshes treated as one unit.
 *   - feedback_no_sharing_eye_2d_grid — variant closure uses its own fit.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 5.
 */

/**
 * Default tags participating in eye closure. Per-side eyelash + eyewhite
 * + irides. Order preserved from cmo3writer.js.
 */
export const DEFAULT_EYE_CLOSURE_TAGS = Object.freeze([
  'eyelash-l', 'eyewhite-l', 'irides-l',
  'eyelash-r', 'eyewhite-r', 'irides-r',
]);

/**
 * Lash strip thickness as a fraction of lash bbox height. 0.06 = ~6%.
 * Empirically tuned to produce a clean thin closed-eye line across both
 * anime and western character styles.
 */
export const DEFAULT_LASH_STRIP_FRAC = 0.06;

/**
 * Bin count for X-uniform lower-edge sampling on eyewhite meshes. Used
 * only when PNG alpha contour extraction fails or pngData isn't present.
 */
export const DEFAULT_BIN_COUNT = 6;

/**
 * @typedef {Object} EyeClosureConfig
 * @property {string[]} closureTags - mesh tags that get closure keyforms
 * @property {number}   lashStripFrac - fraction of lash bbox height
 * @property {number}   binCount - X-uniform bin count for lower-edge fit
 */

/**
 * Build the eye closure config from project state. Today there's no
 * project-level input — defaults are returned as-is.
 *
 * @param {object} _project - reserved for future use
 * @returns {EyeClosureConfig}
 */
export function buildEyeClosureConfigFromProject(_project) {
  return {
    closureTags: [...DEFAULT_EYE_CLOSURE_TAGS],
    lashStripFrac: DEFAULT_LASH_STRIP_FRAC,
    binCount: DEFAULT_BIN_COUNT,
  };
}

/**
 * Resolve the eye closure config the writers should use:
 *   - If `project.eyeClosureConfig` is populated and well-formed, return it.
 *   - Otherwise, build defaults via `buildEyeClosureConfigFromProject`.
 *
 * @param {object} project
 * @returns {EyeClosureConfig}
 */
export function resolveEyeClosureConfig(project) {
  const cfg = project?.eyeClosureConfig;
  if (
    cfg &&
    Array.isArray(cfg.closureTags) && cfg.closureTags.length > 0 &&
    Number.isFinite(cfg.lashStripFrac) &&
    Number.isFinite(cfg.binCount) && cfg.binCount > 0
  ) {
    return cfg;
  }
  return buildEyeClosureConfigFromProject(project);
}

/**
 * Seed `project.eyeClosureConfig` from the defaults. Destructive.
 *
 * @param {object} project - mutated
 * @returns {EyeClosureConfig} the seeded config
 */
export function seedEyeClosureConfig(project) {
  const cfg = buildEyeClosureConfigFromProject(project);
  project.eyeClosureConfig = cfg;
  return cfg;
}
