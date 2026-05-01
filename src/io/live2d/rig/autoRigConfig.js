/**
 * autoRigConfig — Stage 2 of the native rig refactor.
 *
 * Centralises scattered seeder tunables so per-character overrides have a
 * single home. This stage is **schema + plumbing only** — defaults match
 * today's hardcoded literals bit-for-bit; the diff harness must stay green
 * with no edits to the config.
 *
 * Three top-level sections, one per generator subsystem:
 *
 *   - `bodyWarp` — defaults consumed by `rig/bodyWarp.js` `buildBodyWarpChain`:
 *     fallback HIP/FEET fractions when anatomy can't be measured, canvas
 *     padding fraction, BX/BY/Breath grid margins, upper-body shape
 *     parameters. The measured-anatomy path stays untouched (HIP/FEET are
 *     replaced by anatomy when the silhouette analyzer succeeds).
 *
 *   - `faceParallax` — every magic constant in `cmo3/faceParallax.js`
 *     `emitFaceParallax`: depth model coefficients, virtual head rotation
 *     range, eye parallax amp, far-eye squash amp, per-tag protection
 *     values, super-group memberships, falloff buffer.
 *
 *   - `neckWarp` — `NECK_TILT_FRAC` from `rig/warpDeformers.js`
 *     `buildNeckWarpSpec` (top-row shift fraction at ParamAngleZ=±30).
 *
 *   - `tagWarpMagnitudes` (Stage 9a) — every numeric magnitude that lives
 *     inside the procedural `shiftFn` closures of `rig/tagWarpBindings.js`
 *     `TAG_PARAM_BINDINGS_RULES` (hair sway, clothing sway, brow translate,
 *     iris gaze, mouth open stretch, eye-converge fraction). Stage 9b
 *     (per-mesh keyform baking) will read magnitudes via this section,
 *     then bake them into `project.rigWarps[partId]`; until then they're
 *     consumed at export time by the same closures.
 *
 * **Resolution semantics (per-section).** Each top-level section
 * (`bodyWarp`, `faceParallax`, `neckWarp`) validates as a unit. If a
 * section is missing or malformed, that *one section* falls back to
 * defaults; the other sections are kept as-is. Whole-config fallback
 * (Stage 7/8 pattern) would invalidate every user tuning when one field
 * was wrong — too harsh for a multi-section config that downstream
 * stages will add to.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 2.
 */

/**
 * Frozen defaults. Don't mutate; use `buildAutoRigConfigFromProject` for
 * a mutable copy.
 */
export const DEFAULT_AUTO_RIG_CONFIG = Object.freeze({
  bodyWarp: Object.freeze({
    canvasPadFrac: 0.10,
    hipFracDefault: 0.45,
    feetFracDefault: 0.75,
    feetMarginRf: 0.05,
    bxRange: Object.freeze({ min: 0.10, max: 0.90 }),
    byMargin: 0.065,
    breathMargin: 0.055,
    upperBodyTCap: 0.5,
    upperBodySlope: 1.5,
  }),
  faceParallax: Object.freeze({
    depthK: 0.80,
    edgeDepthK: 0.30,
    maxAngleXDeg: 15,
    maxAngleYDeg: 8,
    depthAmp: 3.0,
    eyeParallaxAmpX: 1.3,
    farEyeSquashAmp: 0.18,
    protectionStrength: 1.0,
    protectionFalloffBuffer: 0.12,
    protectionPerTag: Object.freeze({
      eyelash:     1.00, 'eyelash-l':  1.00, 'eyelash-r':  1.00,
      eyewhite:    1.00, 'eyewhite-l': 1.00, 'eyewhite-r': 1.00,
      irides:      1.00, 'irides-l':   1.00, 'irides-r':   1.00,
      ears:        0.90, 'ears-l':     0.90, 'ears-r':     0.90,
      eyebrow:     0.80, 'eyebrow-l':  0.80, 'eyebrow-r':  0.80,
      mouth:       0.30,
      nose:        0.30,
    }),
    superGroups: Object.freeze({
      'eye-l': Object.freeze(['eyelash-l', 'eyewhite-l', 'irides-l']),
      'eye-r': Object.freeze(['eyelash-r', 'eyewhite-r', 'irides-r']),
    }),
  }),
  neckWarp: Object.freeze({
    tiltFrac: 0.08,
  }),
  // Stage 9a — magnitudes for the procedural per-tag rig warps. Each entry
  // is the literal value lifted from the inline shiftFn closures in
  // cmo3writer.js's TAG_PARAM_BINDINGS map. Defaults are bit-for-bit
  // identical to today's hardcoded constants. See `rig/tagWarpBindings.js`
  // for the shiftFns that consume these.
  tagWarpMagnitudes: Object.freeze({
    // Hair: tips-swing (cubic frac gradient). X dominates, Y curl is small.
    hairFrontXSway: 0.12,
    hairFrontYCurl: 0.03,
    hairBackXSway:  0.10,
    hairBackYCurl:  0.025,
    // Clothing: hem sway (frac^4 — even steeper than hair so middle rows
    // barely move). X-only — Y exposes layer underneath.
    bottomwearXSway: 0.04,
    legwearXSway:    0.008,
    // Topwear: shirt sway (frac²) + bust wobble (interior triangular falloff).
    topwearShirtXSway: 0.02,
    topwearBustY:      0.012,
    // Brows: uniform Y translate (BrowY +1 = up = -Y in canvas).
    eyebrowY: 0.15,
    // Eye open/close: collapse all three layers to lower-eyelid line at
    // 80% of the mesh's Y span.
    eyeConvergeYFrac: 0.80,
    // Iris gaze: uniform translate of the whole grid by EyeBallX/Y * gxS/gyS.
    iridesGazeX: 0.09,
    iridesGazeY: 0.075,
    // Mouth open: Y-stretch from top pivot, quadratic frac gradient.
    mouthYStretch: 0.35,
  }),
});

/**
 * @typedef {Object} AutoRigBodyWarp
 * @property {number} canvasPadFrac
 * @property {number} hipFracDefault
 * @property {number} feetFracDefault
 * @property {number} feetMarginRf
 * @property {{min:number,max:number}} bxRange
 * @property {number} byMargin
 * @property {number} breathMargin
 * @property {number} upperBodyTCap
 * @property {number} upperBodySlope
 *
 * @typedef {Object} AutoRigFaceParallax
 * @property {number} depthK
 * @property {number} edgeDepthK
 * @property {number} maxAngleXDeg
 * @property {number} maxAngleYDeg
 * @property {number} depthAmp
 * @property {number} eyeParallaxAmpX
 * @property {number} farEyeSquashAmp
 * @property {number} protectionStrength
 * @property {number} protectionFalloffBuffer
 * @property {Record<string,number>} protectionPerTag
 * @property {Record<string,string[]>} superGroups
 *
 * @typedef {Object} AutoRigNeckWarp
 * @property {number} tiltFrac
 *
 * @typedef {Object} AutoRigConfig
 * @property {AutoRigBodyWarp}     bodyWarp
 * @property {AutoRigFaceParallax} faceParallax
 * @property {AutoRigNeckWarp}     neckWarp
 */

function cloneBodyWarp(src) {
  return {
    canvasPadFrac:    src.canvasPadFrac,
    hipFracDefault:   src.hipFracDefault,
    feetFracDefault:  src.feetFracDefault,
    feetMarginRf:     src.feetMarginRf,
    bxRange:          { min: src.bxRange.min, max: src.bxRange.max },
    byMargin:         src.byMargin,
    breathMargin:     src.breathMargin,
    upperBodyTCap:    src.upperBodyTCap,
    upperBodySlope:   src.upperBodySlope,
  };
}

function cloneFaceParallax(src) {
  const protectionPerTag = {};
  for (const [tag, val] of Object.entries(src.protectionPerTag)) {
    protectionPerTag[tag] = val;
  }
  const superGroups = {};
  for (const [groupTag, members] of Object.entries(src.superGroups)) {
    superGroups[groupTag] = [...members];
  }
  return {
    depthK:                   src.depthK,
    edgeDepthK:               src.edgeDepthK,
    maxAngleXDeg:             src.maxAngleXDeg,
    maxAngleYDeg:             src.maxAngleYDeg,
    depthAmp:                 src.depthAmp,
    eyeParallaxAmpX:          src.eyeParallaxAmpX,
    farEyeSquashAmp:          src.farEyeSquashAmp,
    protectionStrength:       src.protectionStrength,
    protectionFalloffBuffer:  src.protectionFalloffBuffer,
    protectionPerTag,
    superGroups,
  };
}

function cloneNeckWarp(src) {
  return { tiltFrac: src.tiltFrac };
}

function cloneTagWarpMagnitudes(src) {
  return { ...src };
}

/**
 * Build a mutable deep copy of the defaults. No project-level inputs
 * today; reserved for future per-character overrides (e.g. chibi with
 * smaller body warp shape, large-character with different protection
 * mappings).
 *
 * @param {object} _project - reserved for future use
 * @returns {AutoRigConfig}
 */
export function buildAutoRigConfigFromProject(_project) {
  return {
    bodyWarp:          cloneBodyWarp(DEFAULT_AUTO_RIG_CONFIG.bodyWarp),
    faceParallax:      cloneFaceParallax(DEFAULT_AUTO_RIG_CONFIG.faceParallax),
    neckWarp:          cloneNeckWarp(DEFAULT_AUTO_RIG_CONFIG.neckWarp),
    tagWarpMagnitudes: cloneTagWarpMagnitudes(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes),
  };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isWellFormedBodyWarp(s) {
  return (
    s &&
    isFiniteNumber(s.canvasPadFrac) &&
    isFiniteNumber(s.hipFracDefault) &&
    isFiniteNumber(s.feetFracDefault) &&
    isFiniteNumber(s.feetMarginRf) &&
    s.bxRange &&
    isFiniteNumber(s.bxRange.min) && isFiniteNumber(s.bxRange.max) &&
    isFiniteNumber(s.byMargin) &&
    isFiniteNumber(s.breathMargin) &&
    isFiniteNumber(s.upperBodyTCap) &&
    isFiniteNumber(s.upperBodySlope)
  );
}

function isWellFormedFaceParallax(s) {
  if (!s) return false;
  for (const k of [
    'depthK', 'edgeDepthK', 'maxAngleXDeg', 'maxAngleYDeg',
    'depthAmp', 'eyeParallaxAmpX', 'farEyeSquashAmp',
    'protectionStrength', 'protectionFalloffBuffer',
  ]) {
    if (!isFiniteNumber(s[k])) return false;
  }
  if (!s.protectionPerTag || typeof s.protectionPerTag !== 'object') return false;
  for (const v of Object.values(s.protectionPerTag)) {
    if (!isFiniteNumber(v)) return false;
  }
  if (!s.superGroups || typeof s.superGroups !== 'object') return false;
  for (const members of Object.values(s.superGroups)) {
    if (!Array.isArray(members)) return false;
  }
  return true;
}

function isWellFormedNeckWarp(s) {
  return s && isFiniteNumber(s.tiltFrac);
}

function isWellFormedTagWarpMagnitudes(s) {
  if (!s || typeof s !== 'object') return false;
  // Every key in DEFAULT must be present and finite. Extra keys are tolerated
  // (forward-compatible — future tags can add entries without breaking older
  // saves).
  for (const k of Object.keys(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes)) {
    if (!isFiniteNumber(s[k])) return false;
  }
  return true;
}

/**
 * Per-field merge of stored over defaults. Semantics mirror the
 * `{ ...DEFAULTS, ...stored }` pattern recommended by the data-layer
 * audit (Hole I-7): every default key gets a value, stored values
 * override, unknown fields in stored are preserved (forward-compat
 * with future schema versions). Recurses into nested objects.
 *
 * The case this exists to handle: schema adds a new field in v8
 * (e.g. `autoRigConfig.faceParallax.someNewKnob`). A v7-seeded save
 * doesn't have it. With `mergeOverDefaults`, the v8 default fills in
 * for the missing field; the user's other tunings stay intact.
 *
 * @template {object} T
 * @param {T} defaults
 * @param {object|null|undefined} stored
 * @returns {T}
 */
function mergeOverDefaults(defaults, stored) {
  if (!stored || typeof stored !== 'object') return /** @type {T} */ (cloneDeep(defaults));
  /** @type {Record<string, any>} */
  const out = /** @type {any} */ (cloneDeep(defaults));
  // Walk stored keys so unknown-future fields survive the merge.
  for (const key of Object.keys(stored)) {
    const sv = /** @type {any} */ (stored)[key];
    if (sv === undefined) continue;
    const dv = out[key];
    if (typeof dv === 'object' && dv !== null && !Array.isArray(dv)
        && typeof sv === 'object' && sv !== null && !Array.isArray(sv)) {
      out[key] = mergeOverDefaults(dv, sv);
    } else if (Array.isArray(sv)) {
      // Stored arrays replace defaults wholesale.
      out[key] = sv.slice();
    } else {
      out[key] = sv;
    }
  }
  return /** @type {T} */ (out);
}

function cloneDeep(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cloneDeep);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = cloneDeep(obj[k]);
  return out;
}

/**
 * Resolve the autoRigConfig the seeder/writers should use. Per-section
 * fallback: each of `bodyWarp` / `faceParallax` / `neckWarp` is validated
 * as a unit. A wholly malformed section falls back to defaults; a
 * partially-populated section gets per-field spread-merge over defaults
 * (Hole I-7) so a stored config saved at v7 of the section schema
 * still works when downstream code expects a v8 field.
 *
 * @param {object} project
 * @returns {AutoRigConfig}
 */
export function resolveAutoRigConfig(project) {
  const cfg = project?.autoRigConfig;
  return {
    bodyWarp: isWellFormedBodyWarp(cfg?.bodyWarp)
      ? mergeOverDefaults(DEFAULT_AUTO_RIG_CONFIG.bodyWarp, cfg.bodyWarp)
      : cloneBodyWarp(DEFAULT_AUTO_RIG_CONFIG.bodyWarp),
    faceParallax: isWellFormedFaceParallax(cfg?.faceParallax)
      ? mergeOverDefaults(DEFAULT_AUTO_RIG_CONFIG.faceParallax, cfg.faceParallax)
      : cloneFaceParallax(DEFAULT_AUTO_RIG_CONFIG.faceParallax),
    neckWarp: isWellFormedNeckWarp(cfg?.neckWarp)
      ? mergeOverDefaults(DEFAULT_AUTO_RIG_CONFIG.neckWarp, cfg.neckWarp)
      : cloneNeckWarp(DEFAULT_AUTO_RIG_CONFIG.neckWarp),
    tagWarpMagnitudes: isWellFormedTagWarpMagnitudes(cfg?.tagWarpMagnitudes)
      ? mergeOverDefaults(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes, cfg.tagWarpMagnitudes)
      : cloneTagWarpMagnitudes(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes),
  };
}

/**
 * Seed `project.autoRigConfig` from defaults. Destructive — overwrites
 * any prior config (which is the point: re-seed = reset to canonical
 * defaults).
 *
 * @param {object} project - mutated
 * @returns {AutoRigConfig} the seeded config
 */
export function seedAutoRigConfig(project) {
  const cfg = buildAutoRigConfigFromProject(project);
  project.autoRigConfig = cfg;
  return cfg;
}
