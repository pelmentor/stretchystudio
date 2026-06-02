/**
 * Generate a .cdi3.json (display info) file.
 *
 * Contains human-readable names for parameters and parts, organized into
 * groups. Not required for runtime, but makes debugging and Cubism Viewer
 * inspection much easier.
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.cdi3.json
 *
 * @module io/live2d/cdi3json
 */

/**
 * @typedef {Object} ParameterInfo
 * @property {string} id       - Parameter ID (e.g. "ParamAngleX")
 * @property {string} name     - Display name (e.g. "Angle X")
 * @property {string} [groupId] - Group ID (e.g. "ParamGroupFace")
 */

/**
 * @typedef {Object} PartInfo
 * @property {string} id       - Part ID (e.g. "PartArmA")
 * @property {string} name     - Display name (e.g. "Arm A")
 */

import { logger } from '../../lib/logger.js';

/**
 * Build a .cdi3.json object.
 *
 * @param {Object} opts
 * @param {ParameterInfo[]} opts.parameters
 * @param {PartInfo[]}      opts.parts
 * @param {string[]}        [opts.warnings] - optional sink the caller can
 *   read for L2D-JSON-12 dedup notifications. Not part of the JSON.
 * @returns {object} JSON-serializable .cdi3.json structure
 */
export function generateCdi3Json({ parameters = [], parts = [], warnings }) {
  const result = { Version: 3 };

  // L2D-JSON-12 — dedup on Id. Pre-fix duplicate Parameter/Part ids
  // produced a malformed cdi3.json that Cubism Viewer de-duplicates
  // last-write-wins; the upstream collision was silent.
  if (parameters.length > 0) {
    const seen = new Set();
    const out = [];
    for (const p of parameters) {
      if (seen.has(p.id)) {
        const msg = `cdi3: duplicate Parameter id "${p.id}" — keeping first`;
        logger.warn('cdi3', msg, { id: p.id });
        if (Array.isArray(warnings)) warnings.push(msg);
        continue;
      }
      seen.add(p.id);
      const entry = { Id: p.id, Name: p.name || p.id };
      if (p.groupId) entry.GroupId = p.groupId;
      out.push(entry);
    }
    result.Parameters = out;
  }

  if (parts.length > 0) {
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      if (seen.has(p.id)) {
        const msg = `cdi3: duplicate Part id "${p.id}" — keeping first`;
        logger.warn('cdi3', msg, { id: p.id });
        if (Array.isArray(warnings)) warnings.push(msg);
        continue;
      }
      seen.add(p.id);
      out.push({ Id: p.id, Name: p.name || p.id });
    }
    result.Parts = out;
  }

  return result;
}
