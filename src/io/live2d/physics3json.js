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

import { finiteOr } from '../../lib/finiteOr.js';
import { logger } from '../../lib/logger.js';

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

const OUTPUT_TYPE_VALUES = new Set(['Angle', 'X', 'Y']);


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
    // L2D-JSON-05 — Cubism's pendulum solver requires ≥2 vertices
    // (one anchor + one tip). The importer skips < 2 — symmetrise.
    if ((rule.vertices?.length ?? 0) < 2) {
      logger.warn('physics3', `rule ${rule.id} skipped: needs ≥2 vertices, has ${rule.vertices?.length ?? 0}`, { ruleId: rule.id });
      continue;
    }

    // Drop rules with missing param refs (input or output) — matches
    // cmo3/physics.js silent-skip semantics.
    if (paramIdSet.size > 0) {
      const inputMissing = rule.inputs.some(inp => !paramIdSet.has(inp.paramId));
      if (inputMissing) continue;
      const outputMissing = outputs.some(o => !paramIdSet.has(o.paramId));
      if (outputMissing) continue;
    }

    // Translate to physics3 JSON shape.
    // L2D-JSON-03 — surface unknown input.type as a warning instead of
    // silently coercing every typo to 'Angle' (would drive the wrong
    // physical channel).
    // L2D-JSON-04 — finiteOr on every numeric write; NaN/Infinity would
    // serialise as literal `null` in JSON.stringify and crash the
    // Cubism runtime.
    const Input = [];
    for (let i = 0; i < rule.inputs.length; i++) {
      const inp = rule.inputs[i];
      const mappedType = INPUT_TYPE_MAP[inp.type];
      if (!mappedType) {
        logger.warn('physics3', `rule ${rule.id} Input[${i}]: unknown type "${inp.type}", input dropped`, { ruleId: rule.id, type: inp.type });
        continue;
      }
      Input.push({
        Source: { Target: 'Parameter', Id: inp.paramId },
        Weight: finiteOr(inp.weight, 100),
        Type: mappedType,
        Reflect: !!inp.isReverse,
      });
    }
    if (Input.length === 0) continue;

    // L2D-JSON-01 — preserve per-output Weight + Type instead of
    // hardcoding 100 + 'Angle'. Default to 100 + 'Angle' for
    // pre-existing rules that never carried these fields.
    const Output = outputs.map(o => {
      const outType = OUTPUT_TYPE_VALUES.has(o.outputType) ? o.outputType : 'Angle';
      return {
        Destination: { Target: 'Parameter', Id: o.paramId },
        VertexIndex: finiteOr(o.vertexIndex, 1) | 0,
        Scale: finiteOr(o.scale, 0),
        Weight: finiteOr(o.weight, 100),
        Type: outType,
        Reflect: !!o.isReverse,
      };
    });

    const Vertices = rule.vertices.map(v => ({
      // No fallback for vertex position — NaN here means the upstream
      // pendulum-strand layout produced corrupt geometry; finiteOr with
      // 0 would silently emit (0,0) and stack every pendulum at origin.
      Position: { X: requireFinite(v.x, rule.id, 'vertex.x'), Y: requireFinite(v.y, rule.id, 'vertex.y') },
      Mobility: finiteOr(v.mobility, 1),
      Delay: finiteOr(v.delay, 1),
      Acceleration: finiteOr(v.acceleration, 1),
      Radius: finiteOr(v.radius, 0),
    }));

    const Normalization = {
      Position: {
        Minimum: finiteOr(rule.normalization.posMin, -10),
        Default: finiteOr(rule.normalization.posDef, 0),
        Maximum: finiteOr(rule.normalization.posMax, 10),
      },
      Angle: {
        Minimum: finiteOr(rule.normalization.angleMin, -10),
        Default: finiteOr(rule.normalization.angleDef, 0),
        Maximum: finiteOr(rule.normalization.angleMax, 10),
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

  // L2D-JSON-02 — preserve imported EffectiveForces. Defaults to the
  // Cubism canonical values when no explicit forces are set.
  const ef = opts.effectiveForces ?? null;
  const EffectiveForces = ef && typeof ef === 'object'
    ? {
        Gravity: {
          X: finiteOr(ef.gravity?.x, 0),
          Y: finiteOr(ef.gravity?.y, -1),
        },
        Wind: {
          X: finiteOr(ef.wind?.x, 0),
          Y: finiteOr(ef.wind?.y, 0),
        },
      }
    : {
        Gravity: { X: 0, Y: -1 },
        Wind: { X: 0, Y: 0 },
      };

  return {
    Version: 3,
    Meta: {
      PhysicsSettingCount: settings.length,
      TotalInputCount: totalInputs,
      TotalOutputCount: totalOutputs,
      VertexCount: totalVertices,
      EffectiveForces,
      PhysicsDictionary: dictionary,
    },
    PhysicsSettings: settings,
  };
}

/**
 * Like `finiteOr` but throws — for fields where there is no sane fallback
 * and a silent substitute would corrupt the user's data (e.g. vertex
 * position). Per RULE-№1 we surface the upstream bug instead.
 *
 * @param {unknown} v
 * @param {string} ruleId
 * @param {string} field
 * @returns {number}
 */
function requireFinite(v, ruleId, field) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`physics3 rule ${ruleId}: non-finite ${field} (got ${String(v)}) — upstream bug, refusing to corrupt the export`);
}
