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

export const CURRENT_SCHEMA_VERSION = 1;

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
