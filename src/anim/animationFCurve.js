// @ts-check

/**
 * FCurve construction + helpers for the v36 Action datablock.
 *
 * Pre-v36 this module was the "track → fcurve bridge" — it converted
 * the legacy SS track shape (`{paramId|nodeId, property, keyframes}`)
 * to the FCurve shape on demand. v36 retired the track shape entirely:
 * `project.actions[i].fcurves[]` IS the fcurve list. So this module's
 * role shifted from "bridge" to "fcurve construction + identity
 * helpers" (used by writers like the idle generator + motion3 import +
 * projectStore mutations that need to filter / rename rnaPath targets).
 *
 * # rnaPath conventions (per `anim/rnaPath.js`)
 *
 *   - Parameter target:  `objects['__params__'].values['<paramId>']`
 *   - Object property:   `objects['<nodeId>'].<property>`
 *
 * # Easing → type mapping
 *
 * The FCurve evaluator (`anim/fcurve.js#evaluateFCurve`) reads
 * `keyform.type ∈ {'linear', 'constant', 'bezier'}`. Phase 1 keyforms
 * still carry the legacy `easing` string for forward-compat with the
 * Phase 2 BezTriple migration; this module derives `type` from `easing`
 * the same way the v36 migration does. The two derivations MUST stay
 * in sync — either both branches treat 'constant'/'hold' as constant,
 * else the migration produces fcurves that don't evaluate the same as
 * fresh authored ones.
 *
 * @module anim/animationFCurve
 */

import { evaluateFCurve } from './fcurve.js';

/** Easing values that collapse to constant-step keyforms. */
const HOLD_EASINGS = new Set(['constant', 'hold']);

/**
 * @typedef {Object} KeyformLike
 * @property {number} time
 * @property {number} value
 * @property {string} [easing]
 * @property {('linear'|'constant'|'bezier')} [type]
 *
 * @typedef {Object} FCurve
 * @property {string} id
 * @property {string} rnaPath
 * @property {number} arrayIndex
 * @property {Array<{time:number, value:number, easing:string, type:('linear'|'constant'|'bezier')}>} keyforms
 * @property {Array<*>} modifiers
 * @property {string} extrapolation
 * @property {object} [driver]
 */

/**
 * Build a kit of `{time, value, easing, type}` keyforms from a loose
 * input array. Drops malformed entries; defaults missing easing to
 * 'linear'; derives `type` per the easing → type mapping.
 *
 * @param {Array<KeyformLike>} input
 * @returns {Array<{time:number, value:number, easing:string, type:('linear'|'constant'|'bezier')}>}
 */
export function normalizeKeyforms(input) {
  const out = [];
  if (!Array.isArray(input)) return out;
  for (const kf of input) {
    if (typeof kf?.time !== 'number' || typeof kf?.value !== 'number') continue;
    const easing = typeof kf.easing === 'string' ? kf.easing
                : (typeof kf.type === 'string' ? kf.type : 'linear');
    out.push({
      time: kf.time,
      value: kf.value,
      easing,
      type: /** @type {'linear'|'constant'|'bezier'} */ (HOLD_EASINGS.has(easing) ? 'constant' : 'linear'),
    });
  }
  return out;
}

/**
 * Construct an FCurve targeting a parameter.
 *
 * @param {string} paramId
 * @param {Array<KeyformLike>} keyforms
 * @param {{driver?: object}} [opts]
 * @returns {FCurve|null}
 */
export function buildParamFCurve(paramId, keyforms, opts = {}) {
  if (typeof paramId !== 'string' || paramId.length === 0) return null;
  const kfs = normalizeKeyforms(keyforms);
  if (kfs.length === 0) return null;
  /** @type {FCurve} */
  const fc = {
    id: `param:${paramId}`,
    rnaPath: `objects['__params__'].values['${paramId}']`,
    arrayIndex: 0,
    keyforms: kfs,
    modifiers: [],
    extrapolation: 'constant',
  };
  if (opts.driver && typeof opts.driver === 'object') fc.driver = opts.driver;
  return fc;
}

/**
 * Construct an FCurve targeting an Object property.
 *
 * @param {string} nodeId
 * @param {string} property
 * @param {Array<KeyformLike>} keyforms
 * @param {{driver?: object, arrayIndex?: number}} [opts]
 * @returns {FCurve|null}
 */
export function buildNodeFCurve(nodeId, property, keyforms, opts = {}) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
  if (typeof property !== 'string' || property.length === 0) return null;
  const kfs = normalizeKeyforms(keyforms);
  if (kfs.length === 0) return null;
  /** @type {FCurve} */
  const fc = {
    id: `${nodeId}.${property}`,
    rnaPath: `objects['${nodeId}'].${property}`,
    arrayIndex: typeof opts.arrayIndex === 'number' ? opts.arrayIndex : 0,
    keyforms: kfs,
    modifiers: [],
    extrapolation: 'constant',
  };
  if (opts.driver && typeof opts.driver === 'object') fc.driver = opts.driver;
  return fc;
}

/**
 * Decode an FCurve's rnaPath into its target spec, or null if the
 * rnaPath shape isn't one of the two Phase 1 patterns. Used by
 * `paramReferences.js`, projectStore `renameParameter` /
 * `duplicateNode` / `deleteNode`, and any UI that wants to know "what
 * does this fcurve animate?".
 *
 * @param {FCurve} fcurve
 * @returns {{kind:'param', paramId:string} | {kind:'node', nodeId:string, property:string} | null}
 */
export function decodeFCurveTarget(fcurve) {
  const rna = fcurve?.rnaPath;
  if (typeof rna !== 'string') return null;
  const paramMatch = /^objects\['__params__'\]\.values\['([^']+)'\]$/.exec(rna);
  if (paramMatch) return { kind: 'param', paramId: paramMatch[1] };
  const nodeMatch = /^objects\['([^']+)'\]\.(.+)$/.exec(rna);
  if (nodeMatch) return { kind: 'node', nodeId: nodeMatch[1], property: nodeMatch[2] };
  return null;
}

/**
 * @param {FCurve} fcurve
 * @param {string} paramId
 * @returns {boolean}
 */
export function fcurveTargetsParam(fcurve, paramId) {
  const t = decodeFCurveTarget(fcurve);
  return t?.kind === 'param' && t.paramId === paramId;
}

/**
 * @param {FCurve} fcurve
 * @param {string} nodeId
 * @returns {boolean}
 */
export function fcurveTargetsNode(fcurve, nodeId) {
  const t = decodeFCurveTarget(fcurve);
  return t?.kind === 'node' && t.nodeId === nodeId;
}

/**
 * Rewrite an fcurve's rnaPath + id to point at a different paramId.
 * Mutates in place (caller is inside a store recipe / clone).
 *
 * @param {FCurve} fcurve
 * @param {string} oldParamId
 * @param {string} newParamId
 */
export function renameFCurveParam(fcurve, oldParamId, newParamId) {
  if (!fcurveTargetsParam(fcurve, oldParamId)) return;
  fcurve.id = `param:${newParamId}`;
  fcurve.rnaPath = `objects['__params__'].values['${newParamId}']`;
}

/**
 * Rewrite an fcurve's rnaPath + id to point at a different nodeId
 * (preserves the property suffix). Mutates in place.
 *
 * @param {FCurve} fcurve
 * @param {string} oldNodeId
 * @param {string} newNodeId
 */
export function renameFCurveNode(fcurve, oldNodeId, newNodeId) {
  if (!fcurveTargetsNode(fcurve, oldNodeId)) return;
  const t = decodeFCurveTarget(fcurve);
  if (!t || t.kind !== 'node') return;
  fcurve.id = `${newNodeId}.${t.property}`;
  fcurve.rnaPath = `objects['${newNodeId}'].${t.property}`;
}

/**
 * Evaluate every fcurve in an action and return a `rnaPath → value`
 * map. Mirrors `computePoseOverrides` / `computeParamOverrides` in
 * `renderer/animationEngine.js` but addresses by rnaPath instead of
 * paramId/nodeId/property fields. Pure: no mutation.
 *
 * Drivers attached to an fcurve are evaluated after the keyform pass
 * and override the keyform value (Blender's behaviour). The
 * `evalContext` is forwarded to `evaluateFCurve`.
 *
 * @param {{fcurves: FCurve[]}|null|undefined} action
 * @param {number} time
 * @param {object} [evalContext]
 * @returns {Map<string, number>}
 */
export function evaluateActionFCurves(action, time, evalContext = {}) {
  const out = new Map();
  if (!action || !Array.isArray(action.fcurves)) return out;
  for (const fc of action.fcurves) {
    const v = evaluateFCurve(fc, time, evalContext);
    if (Number.isFinite(v)) out.set(fc.rnaPath, v);
  }
  return out;
}
