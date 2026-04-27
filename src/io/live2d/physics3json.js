/**
 * Generate a `.physics3.json` runtime physics file from pre-resolved rules.
 *
 * Stage 6 (native rig): rules come pre-resolved from
 * `rig/physicsConfig.js:resolvePhysicsRules` — boneOutputs already
 * flattened into `outputs[]`, so this writer no longer needs to
 * re-implement boneOutputs resolution.
 *
 * Reference shape: `reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.physics3.json`
 *
 * @module io/live2d/physics3json
 */

/**
 * Map SS rule input type → physics3.json input type tag.
 *
 *   SRC_TO_X       → "X"      (horizontal source position)
 *   SRC_TO_Y       → "Y"      (vertical source position)
 *   SRC_TO_G_ANGLE → "Angle"  (angle source)
 */
const INPUT_TYPE_MAP = {
  SRC_TO_X: 'X',
  SRC_TO_Y: 'Y',
  SRC_TO_G_ANGLE: 'Angle',
};


/**
 * @typedef {Object} GeneratePhysics3Opts
 * @property {Array<{id:string, paramId:string}>} [paramDefs]
 *   Defined parameters in the model. Used to skip rules whose input/output
 *   params don't exist (matches cmo3/physics.js' silent-skip behaviour).
 * @property {Array<{tag?:string}>} [meshes]
 *   Visible meshes — used to gate rules with `requireTag` / `requireAnyTag`.
 * @property {Array<object>} rules
 *   Pre-resolved physics rules (boneOutputs already flattened into outputs[]).
 *   Compute via `rig/physicsConfig.js:resolvePhysicsRules(project)`.
 * @property {Set<string>} [disabledCategories]
 *   UI-level categories to suppress (e.g. {'hair', 'bust'}).
 */

/**
 * Build a complete physics3.json object from project state.
 *
 * @param {GeneratePhysics3Opts} opts
 * @returns {object} JSON-serializable physics3.json structure (Version 3).
 *                  Returns a "header-only" object (zero settings) when no
 *                  rule survives gating — caller may decide whether to emit
 *                  the file or skip it.
 */
export function generatePhysics3Json(opts = {}) {
  const {
    paramDefs = [],
    meshes = [],
    rules = [],
    disabledCategories = null,
  } = opts;

  const paramIdSet = new Set();
  for (const p of paramDefs) {
    if (p?.id) paramIdSet.add(p.id);
    if (p?.paramId) paramIdSet.add(p.paramId);
  }

  const tagsPresent = new Set();
  for (const m of meshes) {
    if (m?.tag) tagsPresent.add(m.tag);
  }

  const settings = [];
  const dictionary = [];

  for (const rule of rules) {
    // Category gate (UI-level disable)
    if (disabledCategories && rule.category && disabledCategories.has(rule.category)) {
      continue;
    }
    // Tag gating
    if (rule.requireTag && !tagsPresent.has(rule.requireTag)) continue;
    if (rule.requireAnyTag && !rule.requireAnyTag.some(t => tagsPresent.has(t))) continue;

    // Stage 6: outputs[] is pre-resolved by physicsConfig (no boneOutputs lookup here).
    const outputs = rule.outputs ?? [];
    if (outputs.length === 0) continue;

    // Drop rules with missing param refs (input or output) — matches
    // cmo3/physics.js silent-skip semantics.
    if (paramIdSet.size > 0) {
      const inputMissing = rule.inputs.some(inp => !paramIdSet.has(inp.paramId));
      if (inputMissing) continue;
      const outputMissing = outputs.some(o => !paramIdSet.has(o.paramId));
      if (outputMissing) continue;
    }

    // Translate to physics3 JSON shape
    const Input = rule.inputs.map(inp => ({
      Source: { Target: 'Parameter', Id: inp.paramId },
      Weight: inp.weight,
      Type: INPUT_TYPE_MAP[inp.type] ?? 'Angle',
      Reflect: !!inp.isReverse,
    }));

    const Output = outputs.map(o => ({
      Destination: { Target: 'Parameter', Id: o.paramId },
      VertexIndex: o.vertexIndex,
      Scale: o.scale,
      Weight: 100,
      Type: 'Angle',
      Reflect: !!o.isReverse,
    }));

    const Vertices = rule.vertices.map(v => ({
      Position: { X: v.x, Y: v.y },
      Mobility: v.mobility,
      Delay: v.delay,
      Acceleration: v.acceleration,
      Radius: v.radius,
    }));

    const Normalization = {
      Position: {
        Minimum: rule.normalization.posMin,
        Default: rule.normalization.posDef,
        Maximum: rule.normalization.posMax,
      },
      Angle: {
        Minimum: rule.normalization.angleMin,
        Default: rule.normalization.angleDef,
        Maximum: rule.normalization.angleMax,
      },
    };

    settings.push({
      Id: rule.id,
      Input,
      Output,
      Vertices,
      Normalization,
    });
    dictionary.push({ Id: rule.id, Name: rule.name });
  }

  const totalInputs = settings.reduce((s, x) => s + x.Input.length, 0);
  const totalOutputs = settings.reduce((s, x) => s + x.Output.length, 0);
  const totalVertices = settings.reduce((s, x) => s + x.Vertices.length, 0);

  return {
    Version: 3,
    Meta: {
      PhysicsSettingCount: settings.length,
      TotalInputCount: totalInputs,
      TotalOutputCount: totalOutputs,
      VertexCount: totalVertices,
      EffectiveForces: {
        Gravity: { X: 0, Y: -1 },
        Wind:    { X: 0, Y: 0 },
      },
      PhysicsDictionary: dictionary,
    },
    PhysicsSettings: settings,
  };
}
