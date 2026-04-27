/**
 * Project schema migrations.
 *
 * Applied by `projectFile.loadProject()` immediately after parsing
 * `project.json` from a `.stretch` ZIP. Brings any older save up to
 * `CURRENT_SCHEMA_VERSION` so downstream code (projectStore, exporter)
 * can assume a single canonical shape.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` →
 * "Cross-cutting invariants → Schema versioning" for rationale.
 *
 * Adding a migration:
 *   1. Bump CURRENT_SCHEMA_VERSION.
 *   2. Add an entry to MIGRATIONS keyed by the new version number.
 *   3. The migration receives a project at version (newVersion - 1) and
 *      mutates / returns it at the new version. Don't bump
 *      project.schemaVersion inside the migration — `migrateProject`
 *      writes it after each step.
 *   4. Add a test in `scripts/test_migrations.mjs`.
 */

export const CURRENT_SCHEMA_VERSION = 8;

const DEFAULT_CANVAS = () => ({
  width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff',
});

const MIGRATIONS = {
  // v1 — establishes the canonical defaults. Applied to any save that
  // lacked schemaVersion entirely (i.e. anything written before this
  // refactor). Replaces the scattered forward-compat patches that lived
  // in projectFile.loadProject and projectStore.loadProject.
  1: (project) => {
    project.canvas = { ...DEFAULT_CANVAS(), ...(project.canvas ?? {}) };
    if (!Array.isArray(project.textures)) project.textures = [];
    if (!Array.isArray(project.nodes)) project.nodes = [];
    if (!Array.isArray(project.animations)) project.animations = [];
    if (!Array.isArray(project.parameters)) project.parameters = [];
    if (!Array.isArray(project.physics_groups)) project.physics_groups = [];

    for (const node of project.nodes) {
      if (node.blendShapes === undefined) node.blendShapes = [];
      if (node.blendShapeValues === undefined) node.blendShapeValues = {};
      if (node.puppetWarp === undefined) node.puppetWarp = null;
    }

    for (const anim of project.animations) {
      if (!Array.isArray(anim.audioTracks)) anim.audioTracks = [];
      if (!Array.isArray(anim.tracks)) anim.tracks = [];
    }

    return project;
  },

  // v2 — Stage 3: project.maskConfigs is the native rig field for clip
  // mask pairings (iris↔eyewhite, variant-aware). Defaults to empty;
  // empty means the export pipeline runs today's heuristic. Populated
  // means the seeder has frozen the pairings on this project.
  2: (project) => {
    if (!Array.isArray(project.maskConfigs)) project.maskConfigs = [];
    return project;
  },

  // v3 — Stage 6: project.physicsRules is the native rig field for
  // physics simulations (hair sway, clothing, bust, arm pendulum).
  // Defaults to empty; empty means the export pipeline runs today's
  // hardcoded DEFAULT_PHYSICS_RULES with boneOutputs resolution.
  // Populated means the seeder has frozen rules into project state.
  3: (project) => {
    if (!Array.isArray(project.physicsRules)) project.physicsRules = [];
    return project;
  },

  // v4 — Stage 7: project.boneConfig.bakedKeyformAngles is the native
  // rig field for the bone rotation keyform angle set (default
  // [-90, -45, 0, 45, 90]). null/missing → resolver returns defaults.
  // Once populated, writers use the project-specific angle set.
  4: (project) => {
    if (project.boneConfig === undefined || project.boneConfig === null) {
      project.boneConfig = null;
    }
    return project;
  },

  // v5 — Stage 5: project.variantFadeRules + project.eyeClosureConfig.
  //   - variantFadeRules.backdropTags: tags exempt from base-fade when a
  //     variant sibling exists (face / ears / front+back hair).
  //   - eyeClosureConfig: tags + lashStripFrac + binCount that drive the
  //     parabola-fit closure system on eyelash/eyewhite/irides.
  // null/missing → resolvers return defaults.
  5: (project) => {
    if (project.variantFadeRules === undefined || project.variantFadeRules === null) {
      project.variantFadeRules = null;
    }
    if (project.eyeClosureConfig === undefined || project.eyeClosureConfig === null) {
      project.eyeClosureConfig = null;
    }
    return project;
  },

  // v6 — Stage 8: project.rotationDeformerConfig bundles the four
  // rotation-deformer auto-rig constants:
  //   - skipRotationRoles (boneRoles handled by warps, not rotation deformers)
  //   - paramAngleRange (ParamRotation_<group> min/max, default ±30)
  //   - groupRotation.{paramKeys, angles} (default 1:1 ±30)
  //   - faceRotation.{paramKeys, angles} (default ±10° angles for ±30 keys)
  // null/missing → resolver returns defaults.
  6: (project) => {
    if (project.rotationDeformerConfig === undefined || project.rotationDeformerConfig === null) {
      project.rotationDeformerConfig = null;
    }
    return project;
  },

  // v7 — Stage 2: project.autoRigConfig is the seeder tuning surface.
  // Three sections: bodyWarp (HIP/FEET fallbacks, BX/BY/Breath margins,
  // upper-body shape), faceParallax (depth coefficients, protection
  // per tag, super-groups, eye/squash amps), neckWarp (tilt fraction).
  // null/missing → resolver returns defaults for each section.
  7: (project) => {
    if (project.autoRigConfig === undefined || project.autoRigConfig === null) {
      project.autoRigConfig = null;
    }
    return project;
  },

  // v8 — Stage 4: project.faceParallax is the serialized FaceParallax
  // warp deformer spec — id, parent, gridSize, baseGrid (flat number[]),
  // bindings, keyforms (each with positions as flat number[]), opacity.
  // null/missing → resolver returns null and the cmo3 writer falls back
  // to its inline buildFaceParallaxSpec heuristic (today's path).
  // Populated → cmo3 writer skips the heuristic and serializes the
  // stored spec verbatim.
  8: (project) => {
    if (project.faceParallax === undefined || project.faceParallax === null) {
      project.faceParallax = null;
    }
    return project;
  },
};

/**
 * Migrate a parsed project JSON to CURRENT_SCHEMA_VERSION in place.
 *
 * @param {object} project - parsed contents of project.json
 * @returns {object} - the same object, mutated, at current version
 * @throws if the project is from a future schema version this build
 *         doesn't recognise.
 */
export function migrateProject(project) {
  const fromVersion = project.schemaVersion ?? 0;

  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project schema v${fromVersion} is newer than this build supports ` +
      `(v${CURRENT_SCHEMA_VERSION}). Upgrade Stretchy Studio.`
    );
  }

  for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      throw new Error(`No migration registered for schema v${v}`);
    }
    migrate(project);
    project.schemaVersion = v;
  }

  return project;
}
