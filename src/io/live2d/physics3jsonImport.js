// @ts-check

/**
 * Reverse parser for `.physics3.json` runtime physics files.
 *
 * v3 Phase 5 — round-trip: read a Cubism-style physics3.json back into the
 * project's `physicsRules` array. Mirrors the writer in
 * `physics3json.js`, with two notable asymmetries that physics3.json
 * cannot represent and we therefore drop:
 *
 *   - `requireTag` / `requireAnyTag` — gating belongs to authoring (cmo3),
 *     not the runtime. Imported rules emit unconditionally on next export.
 *   - `category` — UI grouping (hair / clothing / bust / arms). Defaults to
 *     'imported' so users can re-categorise via future editor surface.
 *
 * Returns the parsed rules in the same shape `resolvePhysicsRules` returns —
 * `outputs[]` already flat, no `boneOutputs`. After import the project's
 * `physicsRules` is the source of truth and the writer round-trips the
 * exact same JSON (modulo the dropped UI fields).
 *
 * @module io/live2d/physics3jsonImport
 */

import { markUserAuthored } from './rig/userAuthorMarkers.js';

/**
 * Inverse of physics3json.js' INPUT_TYPE_MAP.
 */
const INPUT_TYPE_REVERSE = {
  X: 'SRC_TO_X',
  Y: 'SRC_TO_Y',
  Angle: 'SRC_TO_G_ANGLE',
};

/**
 * @typedef {Object} ParsedPhysics
 * @property {Array<object>} rules    — physicsRules[] in resolved shape
 * @property {string[]}      warnings — non-fatal issues (unknown input types,
 *                                       missing fields filled with defaults).
 */

/**
 * Parse a physics3.json string. Throws on malformed JSON or wrong Version.
 *
 * @param {string} jsonText
 * @returns {ParsedPhysics}
 */
export function parsePhysics3Json(jsonText) {
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`physics3.json: not valid JSON — ${(e && e.message) || e}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('physics3.json: expected an object at the root');
  }
  if (doc.Version !== 3) {
    throw new Error(`physics3.json: unsupported Version (got ${doc.Version}, expected 3)`);
  }
  if (!Array.isArray(doc.PhysicsSettings)) {
    throw new Error('physics3.json: missing PhysicsSettings array');
  }

  const dictionary = new Map();
  const dictArr = doc?.Meta?.PhysicsDictionary;
  if (Array.isArray(dictArr)) {
    for (const d of dictArr) {
      if (d && typeof d.Id === 'string' && typeof d.Name === 'string') {
        dictionary.set(d.Id, d.Name);
      }
    }
  }

  /** @type {string[]} */
  const warnings = [];
  const rules = [];

  for (let i = 0; i < doc.PhysicsSettings.length; i++) {
    const s = doc.PhysicsSettings[i];
    if (!s || typeof s !== 'object') {
      warnings.push(`Setting [${i}]: skipped (not an object)`);
      continue;
    }
    const id = typeof s.Id === 'string' && s.Id ? s.Id : `PhysicsSetting${i + 1}`;
    const name = dictionary.get(id) ?? id;

    const inputs = [];
    if (Array.isArray(s.Input)) {
      for (let j = 0; j < s.Input.length; j++) {
        const inp = s.Input[j];
        if (!inp || typeof inp !== 'object') continue;
        const paramId = inp?.Source?.Id;
        if (typeof paramId !== 'string' || !paramId) {
          warnings.push(`${id}.Input[${j}]: missing Source.Id, skipped`);
          continue;
        }
        const mappedType = INPUT_TYPE_REVERSE[inp.Type];
        if (!mappedType) {
          warnings.push(`${id}.Input[${j}]: unknown Type "${inp.Type}", defaulting to SRC_TO_G_ANGLE`);
        }
        inputs.push({
          paramId,
          type: mappedType ?? 'SRC_TO_G_ANGLE',
          weight: numOr(inp.Weight, 0),
          isReverse: !!inp.Reflect,
        });
      }
    }

    const outputs = [];
    if (Array.isArray(s.Output)) {
      for (let j = 0; j < s.Output.length; j++) {
        const out = s.Output[j];
        if (!out || typeof out !== 'object') continue;
        const paramId = out?.Destination?.Id;
        if (typeof paramId !== 'string' || !paramId) {
          warnings.push(`${id}.Output[${j}]: missing Destination.Id, skipped`);
          continue;
        }
        outputs.push({
          paramId,
          vertexIndex: numOr(out.VertexIndex, 1) | 0,
          scale: numOr(out.Scale, 0),
          isReverse: !!out.Reflect,
        });
      }
    }

    const vertices = [];
    if (Array.isArray(s.Vertices)) {
      for (let j = 0; j < s.Vertices.length; j++) {
        const v = s.Vertices[j];
        if (!v || typeof v !== 'object') continue;
        vertices.push({
          x: numOr(v?.Position?.X, 0),
          y: numOr(v?.Position?.Y, 0),
          mobility: numOr(v.Mobility, 1),
          delay: numOr(v.Delay, 1),
          acceleration: numOr(v.Acceleration, 1),
          radius: numOr(v.Radius, 0),
        });
      }
    }

    const norm = s?.Normalization ?? {};
    const normalization = {
      posMin: numOr(norm?.Position?.Minimum, -10),
      posDef: numOr(norm?.Position?.Default, 0),
      posMax: numOr(norm?.Position?.Maximum, 10),
      angleMin: numOr(norm?.Angle?.Minimum, -10),
      angleDef: numOr(norm?.Angle?.Default, 0),
      angleMax: numOr(norm?.Angle?.Maximum, 10),
    };

    if (inputs.length === 0 || outputs.length === 0 || vertices.length < 2) {
      warnings.push(`${id}: skipped (needs ≥1 input, ≥1 output, ≥2 vertices)`);
      continue;
    }

    // V3 Re-Rig Phase 0 — imported rules are user-authored (the user
    // explicitly chose to import them). Refit (`mode: 'merge'`) preserves
    // them; full re-init (`mode: 'replace'`) wipes them as it always has.
    rules.push(markUserAuthored({
      id,
      name,
      category: 'imported',
      requireTag: null,
      requireAnyTag: null,
      inputs,
      outputs,
      vertices,
      normalization,
    }));
  }

  return { rules, warnings };
}

function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
