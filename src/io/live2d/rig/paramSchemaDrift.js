// @ts-check

import { coerceNumberArray } from '../../../lib/numberArrayCoerce.js';

/**
 * Hole I-2 — Binding-vs-param schema drift detection.
 *
 * # The problem this solves
 *
 * Each binding stores `parameterId` + `keys: number[]` verbatim
 * (e.g. `parameterId: 'ParamAngleZ', keys: [-30, 0, 30]`). The param
 * itself owns its own `keys` (e.g. `[-30, 0, 30]`) plus `min/max/default`.
 *
 * Bindings and params start synchronised at Init Rig (the harvest
 * generates bindings whose keys match the param's keys). They drift
 * when the user edits a param's keys via the V4 Track 2 param editor
 * (`addParamKey` / `removeParamKey`) or its range
 * (`patchParameter min/max`) WITHOUT re-running Init Rig:
 *
 *   - `param.keys = [-45, 0, 45]` but `binding.keys = [-30, 0, 30]`
 *     → keyforms beyond ±30 don't exist; live values clamp at
 *     `cellSelect`'s edge weights.
 *   - `param.min/max` shrunk below existing binding keys
 *     → out-of-range keyforms are unreachable.
 *
 * # Detection only
 *
 * Sister to `paramReferences.js` (Hole I-3). That module catches
 * dangling `parameterId` (param doesn't exist). This module catches
 * existing-but-mismatched (param exists, binding keys disagree).
 *
 * Pure function; no store reads. Caller hooks the result into the
 * Logs panel via `logger.warn('paramSchemaDrift', …)`.
 *
 * Phase A scope: detection + warn. Phase B (auto-fix banner / re-Init
 * Rig prompt) gates on a future "stale rig" UI surface — out of scope
 * here.
 *
 * @module io/live2d/rig/paramSchemaDrift
 */

const KEY_EPS = 1e-6;

/**
 * @typedef {Object} BindingDrift
 * @property {string} deformerId
 * @property {number} bindingIndex
 * @property {string} parameterId
 * @property {Array<'keys-mismatch'|'out-of-range'>} kinds
 * @property {number[]} bindingKeys
 * @property {number[]=} paramKeys
 * @property {{min?:number, max?:number}=} paramRange
 */

/**
 * Walk every deformer-node binding; compare against the resolved
 * param's current schema. Skip bindings whose `parameterId` doesn't
 * resolve — those are paramReferences.js's territory (Hole I-3).
 *
 * @param {object} project
 * @returns {BindingDrift[]}
 */
export function findBindingSchemaDrift(project) {
  /** @type {BindingDrift[]} */
  const drift = [];
  if (!project || !Array.isArray(project.nodes)) return drift;
  /** @type {Map<string, any>} */
  const paramById = new Map();
  for (const p of project.parameters ?? []) {
    if (p?.id) paramById.set(p.id, p);
  }
  if (paramById.size === 0) return drift;

  for (const node of project.nodes) {
    if (node?.type !== 'deformer') continue;
    if (!Array.isArray(node.bindings)) continue;
    for (let bi = 0; bi < node.bindings.length; bi++) {
      const binding = node.bindings[bi];
      const paramId = binding?.parameterId;
      if (!paramId) continue;
      const param = paramById.get(paramId);
      if (!param) continue; // dangling — Hole I-3 handles it
      const bKeys = coerceNumberArray(binding.keys, `paramSchemaDrift.binding[${bi}].keys`);
      const pKeys = coerceNumberArray(param.keys, `paramSchemaDrift.param[${paramId}].keys`);
      /** @type {Array<'keys-mismatch'|'out-of-range'>} */
      const kinds = [];

      // 1) Keys-mismatch — different length OR values differ outside epsilon.
      let keysMismatch = bKeys.length !== pKeys.length;
      if (!keysMismatch) {
        for (let i = 0; i < bKeys.length; i++) {
          if (Math.abs(bKeys[i] - pKeys[i]) > KEY_EPS) {
            keysMismatch = true;
            break;
          }
        }
      }
      if (keysMismatch && pKeys.length > 0) {
        // Only report mismatch if param has its own keys (otherwise
        // there's nothing meaningful to compare to).
        kinds.push('keys-mismatch');
      }

      // 2) Out-of-range — any binding key outside [param.min, param.max].
      // Skip when the param doesn't define a range (some legacy params
      // have `min === undefined`).
      const hasRange = typeof param.min === 'number' && typeof param.max === 'number';
      if (hasRange && bKeys.length > 0) {
        for (const k of bKeys) {
          if (k < param.min - KEY_EPS || k > param.max + KEY_EPS) {
            kinds.push('out-of-range');
            break;
          }
        }
      }

      if (kinds.length > 0) {
        /** @type {BindingDrift} */
        const entry = {
          deformerId: node.id,
          bindingIndex: bi,
          parameterId: paramId,
          kinds,
          bindingKeys: bKeys.slice(),
        };
        if (pKeys.length > 0) entry.paramKeys = pKeys.slice();
        if (hasRange) entry.paramRange = { min: param.min, max: param.max };
        drift.push(entry);
      }
    }
  }
  return drift;
}
