// @ts-check

/**
 * Eye-closure parabola substrate (RULE №4 follow-up Leak #2).
 *
 * # Why this exists
 *
 * Pre-Slice-2 (2026-05-23) the eye-closure parabola fit ran fresh on
 * every `generateCmo3` call — the fit-then-bake pipeline lived
 * entirely in cmo3writer's prepass, with the parabola coefficients
 * existing only as in-memory Maps for the duration of one export
 * call. The 2026-05-23 RULE-№4 audit identified this as Leak #2
 * (HIGH severity): the parabola is the upstream Blender-faithful
 * SOURCE of the closure shape, while the keyform-bake stored on
 * `mesh.runtime.keyforms` is the Cubism adapter. The source data
 * being hidden from the user (no edit surface) was the leak.
 *
 * This module stores the parabola as first-class persistent data on
 * `project.eyeClosureParabolas`, with the cmo3writer prepass consuming it
 * when present (skip the fresh fit). Init Rig is the canonical
 * re-fit moment; pure export reads stored data and re-bakes the
 * keyforms from the stored parabola. A future UI can edit
 * `project.eyeClosureParabolas.baseParabolaPerSide` directly and rely on the
 * baker picking it up.
 *
 * # Storage shape
 *
 * The field is named `eyeClosureParabolas` (not `eyeClosure`) to keep
 * a clean naming split with the pre-existing `rigCollector.eyeClosure`
 * per-part closed-vert MAP (consumed by `moc3/meshBindingPlan.js`).
 * The bake output and the source-of-bake data live in distinct fields
 * with distinct shapes — collision-proof from each other.
 *
 *   project.eyeClosureParabolas = {
 *     baseParabolaPerSide: {
 *       'l': { a, b, c, xMid, xScale, sourceTag, sampleSource, xMin, xMax, sampleCount },
 *       'r': { ... }
 *     },
 *     variantParabolaPerSideAndSuffix: {
 *       'l|smile': { a, b, c, ... },
 *       'r|smile': { ... }
 *     }
 *   }
 *
 * Plain objects (JSON-friendly) on disk; Maps in memory at writer
 * time. `seedEyeClosure` converts Maps → objects; `resolveEyeClosure`
 * converts objects → Maps.
 *
 * # Why not put parabolas on the eyewhite mesh node
 *
 * Tried that shape first. Two reasons it lives at the project root
 * instead:
 *
 *   1. Variant parabolas key by `(side, suffix)`, with the suffix
 *      coming from a variant mesh that's a sibling of the base
 *      eyewhite — there's no single node that owns the variant
 *      curve. A project-level map keeps base + variant in one
 *      consistent table.
 *   2. The fit consumes the eyewhite's PNG alpha contour OR
 *      mesh-bin-max samples and has fallbacks to eyelash; the curve
 *      isn't a property of the eyewhite per se, it's the closure
 *      target for the whole eye region (eyelash + eyewhite + irides
 *      all collapse onto it). Owner = the eye region = the project.
 *
 * Mirrors existing top-level `project.bodyWarp` / `project.faceParallax`
 * / `project.physics_groups` patterns.
 *
 * @module io/live2d/rig/eyeClosure
 */

/**
 * @typedef {Object} EyeClosureParabola
 * @property {number} a
 * @property {number} b
 * @property {number} c
 * @property {number} xMid
 * @property {number} xScale
 * @property {string} [sourceTag]
 * @property {string} [sampleSource]
 * @property {number} [xMin]
 * @property {number} [xMax]
 * @property {number} [sampleCount]
 */

/**
 * @typedef {Object} EyeClosureStored
 * @property {Record<string, EyeClosureParabola>} baseParabolaPerSide
 * @property {Record<string, EyeClosureParabola>} variantParabolaPerSideAndSuffix
 */

/**
 * @typedef {Object} EyeClosureResolved
 * @property {Map<string, EyeClosureParabola>} baseParabolaPerSide
 * @property {Map<string, EyeClosureParabola>} variantParabolaPerSideAndSuffix
 */

/**
 * Curve fields the storage keeps verbatim. Any field outside this
 * allowlist gets dropped during serialise — keeps the storage
 * forward-compatible with diagnostic fields added to the fit later
 * (the diagnostics ride along in-memory but don't pollute persisted
 * project files).
 */
const CURVE_FIELDS = Object.freeze([
  'a', 'b', 'c', 'xMid', 'xScale',
  'sourceTag', 'sampleSource', 'xMin', 'xMax', 'sampleCount',
]);

/**
 * Serialise one parabola to a JSON-friendly plain object. Drops
 * non-allowlisted fields.
 *
 * @param {Record<string, unknown>} curve
 * @returns {EyeClosureParabola}
 */
function _serialiseParabola(curve) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of CURVE_FIELDS) {
    if (curve[k] !== undefined) out[k] = curve[k];
  }
  return /** @type {EyeClosureParabola} */ (out);
}

/**
 * Deserialise one stored parabola object back into a curve. Today
 * this is the identity (the stored shape == the curve shape), but
 * keeping the conversion explicit means future stored-format
 * evolution stays scoped to this module.
 *
 * @param {EyeClosureParabola} stored
 * @returns {EyeClosureParabola}
 */
function _deserialiseParabola(stored) {
  return { ...stored };
}

/**
 * Resolve `project.eyeClosureParabolas` into the Map-shaped form consumers
 * (cmo3writer prepass, meshLayerKeyform) expect. Returns empty
 * Maps when nothing is stored — the cmo3writer treats empty maps
 * as the signal to fit fresh.
 *
 * @param {object|null|undefined} project
 * @returns {EyeClosureResolved}
 */
export function resolveEyeClosure(project) {
  /** @type {Map<string, EyeClosureParabola>} */
  const baseParabolaPerSide = new Map();
  /** @type {Map<string, EyeClosureParabola>} */
  const variantParabolaPerSideAndSuffix = new Map();
  const stored = project?.eyeClosureParabolas;
  if (!stored || typeof stored !== 'object') {
    return { baseParabolaPerSide, variantParabolaPerSideAndSuffix };
  }
  const baseObj = stored.baseParabolaPerSide;
  if (baseObj && typeof baseObj === 'object') {
    for (const [side, curve] of Object.entries(baseObj)) {
      if (curve && typeof curve === 'object') {
        baseParabolaPerSide.set(side, _deserialiseParabola(/** @type {EyeClosureParabola} */ (curve)));
      }
    }
  }
  const variantObj = stored.variantParabolaPerSideAndSuffix;
  if (variantObj && typeof variantObj === 'object') {
    for (const [key, curve] of Object.entries(variantObj)) {
      if (curve && typeof curve === 'object') {
        variantParabolaPerSideAndSuffix.set(key, _deserialiseParabola(/** @type {EyeClosureParabola} */ (curve)));
      }
    }
  }
  return { baseParabolaPerSide, variantParabolaPerSideAndSuffix };
}

/**
 * Persist parabola Maps into `project.eyeClosureParabolas` as JSON-friendly
 * objects. Mutates `project` in place. When both maps are empty the
 * field is left untouched — only call this after a successful fit
 * pass.
 *
 * Accepts either Maps (the cmo3writer in-memory shape) or plain
 * iterables of `[key, curve]` pairs.
 *
 * # Variant suffix lifecycle (RULE №2 + RULE №4)
 *
 * `seedEyeClosure` performs a full REPLACE of `project.eyeClosureParabolas`
 * (not a merge) when at least one parabola is produced — so on every
 * Init Rig the stored variant map exactly mirrors the variant meshes
 * that are CURRENTLY present in the project. Stale entries from a
 * removed variant (e.g. user deleted an `eyewhite-l.smile` mesh) are
 * dropped on the next Init Rig + persist cycle. Between deletion and
 * the next Init Rig the stale key sits in storage but doesn't
 * influence emission (the cmo3writer prepass only consumes a parabola
 * if there's an active variant mesh at that suffix).
 *
 * Pre-existing variant-suffix gap (not introduced by Slice 2): there
 * is no reference-counting or `deleteNode` hook that prunes stale
 * variant parabolas eagerly. The audit (2026-05-23 Blender-fidelity
 * HIGH-5) tracked this as a follow-up — see
 * [[rule4-leak2-eye-closure-parabola-substrate-shipped]] in memory.
 *
 * @param {object} project - mutated
 * @param {Map<string, EyeClosureParabola> | Iterable<[string, EyeClosureParabola]> | null | undefined} baseParabolaPerSide
 * @param {Map<string, EyeClosureParabola> | Iterable<[string, EyeClosureParabola]> | null | undefined} variantParabolaPerSideAndSuffix
 */
export function seedEyeClosure(project, baseParabolaPerSide, variantParabolaPerSideAndSuffix) {
  if (!project || typeof project !== 'object') return;
  /** @type {Record<string, EyeClosureParabola>} */
  const baseOut = {};
  if (baseParabolaPerSide) {
    for (const [side, curve] of baseParabolaPerSide) {
      if (curve && typeof curve === 'object') {
        baseOut[side] = _serialiseParabola(/** @type {Record<string, unknown>} */ (curve));
      }
    }
  }
  /** @type {Record<string, EyeClosureParabola>} */
  const variantOut = {};
  if (variantParabolaPerSideAndSuffix) {
    for (const [key, curve] of variantParabolaPerSideAndSuffix) {
      if (curve && typeof curve === 'object') {
        variantOut[key] = _serialiseParabola(/** @type {Record<string, unknown>} */ (curve));
      }
    }
  }
  // Skip the write when nothing was fit (preserves any pre-existing
  // stored data; a no-op call mustn't clobber a populated field).
  if (Object.keys(baseOut).length === 0 && Object.keys(variantOut).length === 0) {
    return;
  }
  project.eyeClosureParabolas = {
    baseParabolaPerSide: baseOut,
    variantParabolaPerSideAndSuffix: variantOut,
  };
}

/**
 * Eagerly drop stored variant parabolas whose suffix is no longer
 * referenced by any part node in the project (RULE №4 Slice 3,
 * 2026-05-23; Blender-fidelity HIGH-5 follow-up to Slice 2).
 *
 * Closes the reference-counting integrity gap: pre-Slice-3,
 * `seedEyeClosure`'s next-Init-Rig REPLACE was the only cleanup —
 * a deleted variant's parabola sat in `mesh.eyeClosureParabolas.
 * variantParabolaPerSideAndSuffix['<side>|<suffix>']` until the
 * user re-Init-Rig'd. Now `deleteNode` calls this helper right
 * after pruning the node, so the variant map mirrors the live
 * suffix population moment-to-moment.
 *
 * # Orphaned-suffix detection
 *
 * A suffix is orphaned iff NO remaining part node carries either
 * `variantSuffix === <suffix>` OR `variantRole === <suffix>` (the
 * older alias kept by the cmo3writer prepass — see
 * `io/live2d/cmo3writer.js` variant-suffix discovery loop). Both
 * sides of the orphaned suffix (`l|<suffix>` AND `r|<suffix>`)
 * are pruned — the suffix is the lookup key, the side is
 * granularity-only.
 *
 * `baseParabolaPerSide` is NEVER touched here — it represents the
 * base eye geometry per side, orthogonal to variants.
 *
 * Pure + idempotent: running twice is identical to running once.
 *
 * @param {object|null|undefined} project - mutated in place
 */
export function pruneOrphanedVariantParabolas(project) {
  if (!project || typeof project !== 'object') return;
  const stored = project.eyeClosureParabolas;
  if (!stored || typeof stored !== 'object') return;
  const variantMap = stored.variantParabolaPerSideAndSuffix;
  if (!variantMap || typeof variantMap !== 'object') return;

  // Active-suffix set = union of (variantSuffix, variantRole) across
  // every part node. variantRole is the pre-2026-04-26 alias kept by
  // the cmo3writer for back-compat.
  const activeSuffixes = new Set();
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  for (const n of nodes) {
    if (!n || n.type !== 'part') continue;
    if (typeof n.variantSuffix === 'string' && n.variantSuffix.length > 0) {
      activeSuffixes.add(n.variantSuffix);
    }
    if (typeof n.variantRole === 'string' && n.variantRole.length > 0) {
      activeSuffixes.add(n.variantRole);
    }
  }

  for (const key of Object.keys(variantMap)) {
    // Keys are `<side>|<suffix>`; split on the FIRST '|' so suffixes
    // containing '|' (not expected, but defensive) survive intact.
    const sepIdx = key.indexOf('|');
    if (sepIdx < 0) continue;
    const suffix = key.slice(sepIdx + 1);
    if (!activeSuffixes.has(suffix)) {
      delete variantMap[key];
    }
  }
}
