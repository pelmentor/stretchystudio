/**
 * Generate a `.physics3.json` runtime physics file from the same `PHYSICS_RULES`
 * source-of-truth that the cmo3 emitter uses. Keeps both export paths in sync
 * — any tuning to a rule in `cmo3/physics.js` is automatically reflected in
 * the runtime JSON output.
 *
 * Reference shape: `reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.physics3.json`
 *
 * @module io/live2d/physics3json
 */

import { PHYSICS_RULES } from './cmo3/physics.js';

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
 * Resolve a rule's outputs against the project's groups (for `boneOutputs` that
 * target auto-generated `ParamRotation_<groupName>` params). Mirrors
 * `ruleOutputs` in cmo3/physics.js — duplicated here to avoid coupling, but the
 * logic must stay in step.
 */
function resolveRuleOutputs(rule, groups) {
  const out = [];
  if (rule.outputs && rule.outputs.length > 0) {
    for (const o of rule.outputs) {
      out.push({
        paramId: o.paramId,
        vertexIndex: o.vertexIndex,
        scale: o.scale,
        isReverse: !!o.isReverse,
      });
    }
  } else if (rule.outputParamId) {
    out.push({
      paramId: rule.outputParamId,
      vertexIndex: rule.vertices.length - 1,
      scale: rule.outputScale,
      isReverse: false,
    });
  }
  if (rule.boneOutputs && rule.boneOutputs.length > 0 && Array.isArray(groups)) {
    const byRole = new Map();
    for (const g of groups) {
      if (g && g.boneRole) byRole.set(g.boneRole, g);
    }
    for (const b of rule.boneOutputs) {
      const g = byRole.get(b.boneRole);
      if (!g) continue;
      const sanitized = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
      out.push({
        paramId: `ParamRotation_${sanitized}`,
        vertexIndex: b.vertexIndex,
        scale: b.scale,
        isReverse: !!b.isReverse,
      });
    }
  }
  return out;
}


/**
 * @typedef {Object} GeneratePhysics3Opts
 * @property {Array<{id:string, paramId:string}>} [paramDefs]
 *   Defined parameters in the model. Used to skip rules whose input/output
 *   params don't exist (matches cmo3/physics.js' silent-skip behaviour).
 * @property {Array<{tag?:string}>} [meshes]
 *   Visible meshes — used to gate rules with `requireTag` / `requireAnyTag`.
 * @property {Array<{id:string, name?:string, boneRole?:string}>} [groups]
 *   Project groups — used for resolving `boneOutputs` (e.g. arms physics).
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
    groups = [],
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

  for (const rule of PHYSICS_RULES) {
    // Category gate (UI-level disable)
    if (disabledCategories && rule.category && disabledCategories.has(rule.category)) {
      continue;
    }
    // Tag gating
    if (rule.requireTag && !tagsPresent.has(rule.requireTag)) continue;
    if (rule.requireAnyTag && !rule.requireAnyTag.some(t => tagsPresent.has(t))) continue;

    // Resolve outputs against groups (boneOutputs need group lookup)
    const outputs = resolveRuleOutputs(rule, groups);
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
