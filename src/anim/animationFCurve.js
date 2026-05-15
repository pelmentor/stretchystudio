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
 *   - Parameter target:  `objects["__params__"].values["<paramId>"]`
 *   - Object property:   `objects["<nodeId>"].<property>`
 *
 * The bracket-string syntax uses double-quotes to match Blender's RNA
 * tokenizer (`reference/blender/source/blender/makesrna/intern/rna_path.cc:127`
 * — `if (*p == '"')` is the only branch that recognises a quoted string
 * key). Single-quoted bracket strings would tokenise as the unquoted
 * numeric branch in Blender and parse-fail. Phase 1 audit-fix sweep
 * 2026-05-11 normalised the project-wide grammar.
 *
 * # Keyform shape (post-v39)
 *
 * Every keyform is Blender's `BezTriple` shape:
 *   { time, value,
 *     handleLeft:{time,value}, handleRight:{time,value},
 *     handleType:{left,right},   // 'free'|'aligned'|'vector'|'auto'|'auto_clamped'
 *     interpolation,             // 'constant'|'linear'|'bezier'|<10 named easings>
 *     easeMode?, autoHandleType?, flag }
 *
 * The single `interpolation` field replaced the pre-v39 split between
 * `easing` (read by `interpolateTrack`) and `type` (read by
 * `evaluateFCurve`). Both evaluators converge on `interpolation` as the
 * sole discriminator. See `store/migrations/v39_beztriple_keyforms.js`
 * for the legacy → BezTriple field mapping.
 *
 * `normalizeKeyforms` is the canonical write-side factory: anything
 * that constructs a fresh keyform should funnel through here so the new
 * shape stays single-sourced. Loose `{time, value, easing}` input is
 * accepted for back-compat with motion3json import + idle generator,
 * which carry the legacy easing-name vocabulary.
 *
 * @module anim/animationFCurve
 */

import { evaluateFCurve } from './fcurve.js';

/** Legacy easing names that collapse to constant-step keyforms. */
const HOLD_EASINGS = new Set(['constant', 'hold', 'stepped', 'inverse-stepped']);
/** Legacy easing names that map to 'bezier' interpolation. */
const BEZIER_EASING_NAMES = new Set(['ease', 'ease-both', 'ease-in-out', 'bezier']);
/** Legacy ease-in / ease-out get free-handle on the lopsided side. */
const ASYMMETRIC_BEZIER_EASINGS = new Set(['ease-in', 'ease-out']);

/**
 * Map a legacy easing token (string OR `[c1,c2,c3,c4]` cubic-bezier
 * coefficient array) plus a legacy type discriminator to the v39
 * `interpolation` enum + handle-type pair.
 *
 * Mirrors `legacyToBezTripleShape` in the v39 migration; kept in sync
 * by exporting a shared internal helper would couple the migration
 * module to runtime code, which it shouldn't (migrations should be
 * frozen at their shipping state). The two impls MUST agree on the
 * mapping table.
 *
 * @param {string|number[]|undefined} legacyEasing
 * @param {string|undefined} legacyType
 * @returns {{
 *   interpolation: 'constant'|'linear'|'bezier',
 *   handleType: { left: string, right: string }
 * }}
 */
function legacyEasingToInterpolation(legacyEasing, legacyType) {
  if (legacyType === 'constant' || (typeof legacyEasing === 'string' && HOLD_EASINGS.has(legacyEasing))) {
    return { interpolation: 'constant', handleType: { left: 'vector', right: 'vector' } };
  }
  if (Array.isArray(legacyEasing) && legacyEasing.length === 4) {
    return { interpolation: 'bezier', handleType: { left: 'free', right: 'free' } };
  }
  if (legacyType === 'bezier' || (typeof legacyEasing === 'string' && BEZIER_EASING_NAMES.has(legacyEasing))) {
    return { interpolation: 'bezier', handleType: { left: 'auto', right: 'auto' } };
  }
  if (typeof legacyEasing === 'string' && ASYMMETRIC_BEZIER_EASINGS.has(legacyEasing)) {
    if (legacyEasing === 'ease-in') {
      return { interpolation: 'bezier', handleType: { left: 'free', right: 'auto' } };
    }
    return { interpolation: 'bezier', handleType: { left: 'auto', right: 'free' } };
  }
  return { interpolation: 'linear', handleType: { left: 'vector', right: 'vector' } };
}

/**
 * @typedef {Object} HandlePoint
 * @property {number} time
 * @property {number} value
 *
 * @typedef {Object} BezTripleKeyform
 * @property {number} time
 * @property {number} value
 * @property {HandlePoint} handleLeft
 * @property {HandlePoint} handleRight
 * @property {{left:string, right:string}} handleType
 * @property {('constant'|'linear'|'bezier'|'sine'|'quad'|'cubic'|'quart'|'quint'|'expo'|'circ'|'back'|'bounce'|'elastic')} interpolation
 * @property {('auto'|'in'|'out'|'inout')} [easeMode]
 * @property {('normal'|'locked_final')} [autoHandleType]
 * @property {number} flag
 *
 * @typedef {Object} KeyformLike
 * @property {number} time
 * @property {number} value
 * @property {string} [easing]                       -- legacy input: 'linear'|'ease'|'ease-both'|'ease-in'|'ease-out'|'stepped'|'constant'|'hold'|'inverse-stepped'|'bezier'
 * @property {string} [type]                          -- legacy input: 'linear'|'constant'|'bezier'
 * @property {string} [interpolation]                 -- v39+ input: passes through unchanged
 * @property {HandlePoint} [handleLeft]
 * @property {HandlePoint} [handleRight]
 * @property {{left:string, right:string}} [handleType]
 *
 * @typedef {Object} FCurve
 * @property {string} id
 * @property {string} rnaPath
 * @property {number} arrayIndex
 * @property {BezTripleKeyform[]} keyforms
 * @property {Array<*>} modifiers
 * @property {string} extrapolation
 * @property {object} [driver]
 */

/**
 * Build a v39 BezTriple-shaped keyform from a loose record. Accepts
 * legacy `{time, value, easing/type}` input (back-compat for motion3
 * import + idle generator + UI menu strings) and emits a complete
 * BezTriple. Pass-through on already-v39 input (idempotent).
 *
 * @param {KeyformLike} input
 * @returns {BezTripleKeyform|null}
 */
export function makeBezTripleKeyform(input) {
  if (!input || typeof input.time !== 'number' || typeof input.value !== 'number') return null;
  // Already v39 shape — clone with field defaults filled in.
  if (typeof input.interpolation === 'string') {
    return {
      time: input.time,
      value: input.value,
      handleLeft: input.handleLeft ?? { time: input.time, value: input.value },
      handleRight: input.handleRight ?? { time: input.time, value: input.value },
      handleType: input.handleType ?? { left: 'vector', right: 'vector' },
      interpolation: /** @type {any} */ (input.interpolation),
      flag: 0,
    };
  }
  const { interpolation, handleType } = legacyEasingToInterpolation(input.easing, input.type);
  // Default handle vectors at the keyform position (zero-length).
  // Slice 2.D's auto-handle calculator computes proper neighbour-aware
  // vectors when interpolation === 'bezier' and handleType.* === 'auto'.
  let handleLeft = { time: input.time, value: input.value };
  let handleRight = { time: input.time, value: input.value };
  if (Array.isArray(input.easing) && input.easing.length === 4) {
    handleRight = { time: input.easing[0], value: input.easing[1] };
    handleLeft = { time: input.easing[2], value: input.easing[3] };
  }
  return {
    time: input.time,
    value: input.value,
    handleLeft,
    handleRight,
    handleType,
    interpolation,
    flag: 0,
  };
}

/**
 * Build a kit of v39 BezTriple keyforms from a loose input array.
 * Drops malformed entries.
 *
 * @param {Array<KeyformLike>} input
 * @returns {BezTripleKeyform[]}
 */
export function normalizeKeyforms(input) {
  const out = [];
  if (!Array.isArray(input)) return out;
  for (const kf of input) {
    const made = makeBezTripleKeyform(kf);
    if (made) out.push(made);
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
    rnaPath: `objects["__params__"].values["${paramId}"]`,
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
    rnaPath: `objects["${nodeId}"].${property}`,
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
 * # Escape grammar — Blender deviation (Stage 1.F audit-fix D-5)
 *
 * SS rnaPath bracket-string keys do NOT support embedded double-quotes
 * — the regex `[^"]+` greedily matches anything-but-quote. Blender's
 * RNA tokenizer DOES support escaped quotes inside bracket-string
 * keys: see `reference/blender/source/blender/makesrna/intern/rna_path.cc:99-191`
 * (`rna_path_token_in_brackets`), which uses
 * `BLI_str_unescape` + `BLI_str_escape_find_quote` (lines 130, 170)
 * to handle `["Some\"Quote"]` → `Some"Quote`.
 *
 * SS id namespaces are validated to a strict charset
 * (`[a-zA-Z0-9_-]+`-ish) at id-construction time — paramId validators
 * in projectStore + nodeId validators in nodeOps both reject characters
 * that would need escaping. Therefore the simpler regex is sufficient
 * for SS today. **If SS ever loosens id grammar to permit `"` in ids,
 * this decoder + the v36 migration's `normalizeRnaPathQuotes` helper
 * MUST adopt the escape-aware Blender path** — the `[^"]+` regex would
 * silently mis-tokenise an id like `'foo"bar'` as just `'foo'`.
 *
 * @param {FCurve} fcurve
 * @returns {{kind:'param', paramId:string} | {kind:'node', nodeId:string, property:string} | null}
 */
export function decodeFCurveTarget(fcurve) {
  const rna = fcurve?.rnaPath;
  if (typeof rna !== 'string') return null;
  const paramMatch = /^objects\["__params__"\]\.values\["([^"]+)"\]$/.exec(rna);
  if (paramMatch) return { kind: 'param', paramId: paramMatch[1] };
  const nodeMatch = /^objects\["([^"]+)"\]\.(.+)$/.exec(rna);
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
  fcurve.rnaPath = `objects["__params__"].values["${newParamId}"]`;
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
  fcurve.rnaPath = `objects["${newNodeId}"].${t.property}`;
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
 * @param {number} timeMs - canonical animation-time unit per memory
 *   `feedback_ms_canonical_animation_time.md`. Keyforms are stored in
 *   ms; `evaluateFCurve` is unit-agnostic so the caller's unit must
 *   match the keyform unit. Naming this `timeMs` documents the contract
 *   and prevents the unit-confusion bug pattern that caught the
 *   Phase D-2 FCURVE_EVAL kernel pre-audit-fix.
 * @param {object} [evalContext]
 * @returns {Map<string, number>}
 */
export function evaluateActionFCurves(action, timeMs, evalContext = {}) {
  const out = new Map();
  if (!action || !Array.isArray(action.fcurves)) return out;
  for (const fc of action.fcurves) {
    const v = evaluateFCurve(fc, timeMs, evalContext);
    if (Number.isFinite(v)) out.set(fc.rnaPath, v);
  }
  return out;
}
