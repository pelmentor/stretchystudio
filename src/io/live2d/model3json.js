/**
 * Generate a .model3.json manifest file.
 *
 * This is the root file that Live2D runtimes use to locate all other
 * resources (moc3, textures, motions, physics, etc.).
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.model3.json
 *
 * @module io/live2d/model3json
 */

/**
 * @typedef {Object} Model3Options
 * @property {string}   modelName       - Base name for generated files (e.g. "character")
 * @property {string[]} textureFiles    - Relative paths to texture atlas PNGs
 * @property {string}   [textureDir]    - Subdirectory for textures (e.g. "character.2048")
 * @property {string[]} [motionFiles]   - Relative paths to .motion3.json files. All files
 *                                         lumped under the `"Idle"` motion group. Pass
 *                                         `motionsByGroup` instead for per-group control.
 * @property {Object<string, Array<{File:string}|string>>} [motionsByGroup]
 *                                       Motion files grouped explicitly:
 *                                       `{Idle: ["motion/idle.motion3.json"], Tap: [...]}`.
 *                                       Takes precedence over `motionFiles` when both supplied.
 * @property {string}   [physicsFile]   - Relative path to .physics3.json
 * @property {string}   [poseFile]      - Relative path to .pose3.json
 * @property {string}   [displayInfoFile] - Relative path to .cdi3.json
 * @property {Object}   [groups]        - { LipSync: [...paramIds], EyeBlink: [...paramIds] }
 * @property {Object[]} [hitAreas]      - [{ Id, Name }]
 */

/**
 * Build a .model3.json object from export options.
 *
 * @param {Model3Options} opts
 * @returns {object} JSON-serializable .model3.json structure
 */
export function generateModel3Json(opts) {
  const {
    modelName,
    textureFiles,
    motionFiles = [],
    motionsByGroup = null,
    physicsFile = null,
    poseFile = null,
    displayInfoFile = null,
    groups = {},
    hitAreas = [],
  } = opts;

  const model = {
    Version: 3,
    FileReferences: {
      Moc: `${modelName}.moc3`,
      Textures: textureFiles,
    },
  };

  // Optional file references
  if (physicsFile) {
    model.FileReferences.Physics = physicsFile;
  }
  if (poseFile) {
    model.FileReferences.Pose = poseFile;
  }
  if (displayInfoFile) {
    model.FileReferences.DisplayInfo = displayInfoFile;
  }

  // Motion groups — explicit map wins; fall back to legacy "everything under Idle".
  const motionsBlock = buildMotionsBlock(motionsByGroup, motionFiles);
  if (motionsBlock) {
    model.FileReferences.Motions = motionsBlock;
  }

  // Groups (LipSync, EyeBlink parameter bindings)
  const groupsArray = [];
  for (const [name, ids] of Object.entries(groups)) {
    if (ids && ids.length > 0) {
      groupsArray.push({
        Target: 'Parameter',
        Name: name,
        Ids: ids,
      });
    }
  }
  if (groupsArray.length > 0) {
    model.Groups = groupsArray;
  }

  // Hit areas
  if (hitAreas.length > 0) {
    model.HitAreas = hitAreas;
  }

  return model;
}

/**
 * Build the `Motions` object for `FileReferences`. Returns `null` when no
 * motions are supplied (caller skips the field entirely).
 *
 * Accepts entries in either `{File: "..."}` shape or bare strings (auto-wrapped).
 */
function buildMotionsBlock(motionsByGroup, legacyMotionFiles) {
  if (motionsByGroup && Object.keys(motionsByGroup).length > 0) {
    const out = {};
    for (const [groupName, entries] of Object.entries(motionsByGroup)) {
      if (!entries || entries.length === 0) continue;
      out[groupName] = entries.map(e => (typeof e === 'string' ? { File: e } : e));
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  if (legacyMotionFiles && legacyMotionFiles.length > 0) {
    return { Idle: legacyMotionFiles.map(f => ({ File: f })) };
  }

  return null;
}
