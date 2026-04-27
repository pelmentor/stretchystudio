/**
 * Body warp chain storage helpers — Stage 10 of the native rig refactor.
 *
 * `buildBodyWarpChain(...)` (in `./bodyWarp.js`) returns
 * `{ specs, layout, canvasToBodyXX, canvasToBodyXY, debug }` where the
 * specs hold `Float64Array` baseGrid + per-keyform positions, and the
 * normalisers are closures derived from `layout`. Neither typed arrays
 * nor closures survive `JSON.stringify`; this module wraps the chain
 * ↔ JSON conversion and provides the resolve/seed/clear actions
 * established by Stages 3 / 4 / 5 / 6 / 7 / 8 / 2.
 *
 * **Storage format:** plain JSON tree mirroring the chain. Each spec
 * loses Float64Array → number[]; the layout is plain numbers; the
 * `hasParamBodyAngleX` flag is recovered at read time from the spec
 * count (3 entries → no BX, 4 entries → BX present); debug is preserved
 * verbatim so `rigDebugLog` shows the same `bodyFracSource` /
 * `spineCfShifts` whether the chain came from heuristic or storage.
 *
 * **Seeder semantics.** `seedBodyWarpChain(project, chain)` is
 * **destructive** — overwrites whatever was stored. The chain is
 * computed externally (caller runs `buildBodyWarpChain(...)` against
 * current project state, e.g. via a rig-init action). v1 keeps this
 * caller-driven; the eventual "Initialize Body Warp" UI button (Stage
 * 1b territory) will package build+seed.
 *
 * **Staleness invariant.** Stage 10 v1 does NOT track mesh signatures
 * or body anatomy hashes. If the user reimports PSD with a re-meshed
 * body silhouette, the stored layout / per-row spine drift / hip-feet
 * fractions silently become stale. Documented as a known footgun;
 * full `signatureHash` tracking is deferred (see "Cross-cutting
 * invariants → ID stability" in NATIVE_RIG_REFACTOR_PLAN.md).
 *
 * @module io/live2d/rig/bodyWarpStore
 */

import { makeBodyWarpNormalizers } from './bodyWarp.js';

/**
 * @typedef {Object} BodyWarpLayout
 * @property {number} BZ_MIN_X
 * @property {number} BZ_MIN_Y
 * @property {number} BZ_W
 * @property {number} BZ_H
 * @property {number} BY_MIN
 * @property {number} BY_MAX
 * @property {number} BR_MIN
 * @property {number} BR_MAX
 * @property {number} BX_MIN
 * @property {number} BX_MAX
 */

/**
 * @typedef {Object} StoredBodyWarpChain
 * @property {Array<object>} specs
 * @property {BodyWarpLayout} layout
 * @property {boolean} hasParamBodyAngleX
 * @property {{HIP_FRAC:number, FEET_FRAC:number, bodyFracSource:string, spineCfShifts:number[]}} debug
 */

function _serializeSpec(spec) {
  return {
    id: spec.id,
    name: spec.name,
    parent: { type: spec.parent.type, id: spec.parent.id ?? null },
    gridSize: { rows: spec.gridSize.rows, cols: spec.gridSize.cols },
    baseGrid: Array.from(spec.baseGrid),
    localFrame: spec.localFrame,
    bindings: spec.bindings.map(b => ({
      parameterId: b.parameterId,
      keys: b.keys.slice(),
      interpolation: b.interpolation,
    })),
    keyforms: spec.keyforms.map(k => ({
      keyTuple: k.keyTuple.slice(),
      positions: Array.from(k.positions),
      opacity: k.opacity,
    })),
    isVisible: spec.isVisible,
    isLocked: spec.isLocked,
    isQuadTransform: spec.isQuadTransform,
  };
}

function _deserializeSpec(stored) {
  return {
    id: stored.id,
    name: stored.name,
    parent: stored.parent ?? { type: 'root', id: null },
    gridSize: stored.gridSize ?? { rows: 5, cols: 5 },
    baseGrid: new Float64Array(stored.baseGrid),
    localFrame: stored.localFrame,
    bindings: (stored.bindings ?? []).map(b => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (stored.keyforms ?? []).map(k => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      positions: new Float64Array(k.positions ?? []),
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    isVisible: stored.isVisible ?? true,
    isLocked: stored.isLocked ?? false,
    isQuadTransform: stored.isQuadTransform ?? false,
  };
}

/**
 * Convert a `buildBodyWarpChain(...)` result to a JSON-friendly value.
 * Pure; doesn't mutate input. Drops the closures (`canvasToBodyXX/Y`)
 * — they're rebuilt from `layout` at deserialize time.
 *
 * @param {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain>} chain
 * @returns {StoredBodyWarpChain}
 */
export function serializeBodyWarpChain(chain) {
  const layout = chain.layout;
  return {
    specs: chain.specs.map(_serializeSpec),
    layout: {
      BZ_MIN_X: layout.BZ_MIN_X, BZ_MIN_Y: layout.BZ_MIN_Y,
      BZ_W:     layout.BZ_W,     BZ_H:     layout.BZ_H,
      BY_MIN:   layout.BY_MIN,   BY_MAX:   layout.BY_MAX,
      BR_MIN:   layout.BR_MIN,   BR_MAX:   layout.BR_MAX,
      BX_MIN:   layout.BX_MIN,   BX_MAX:   layout.BX_MAX,
    },
    hasParamBodyAngleX: chain.specs.some(s => s.id === 'BodyXWarp'),
    debug: {
      HIP_FRAC: chain.debug.HIP_FRAC,
      FEET_FRAC: chain.debug.FEET_FRAC,
      bodyFracSource: chain.debug.bodyFracSource,
      spineCfShifts: Array.from(chain.debug.spineCfShifts ?? []),
    },
  };
}

/**
 * Convert stored JSON back to a usable chain. Returns `null` when the
 * stored value is fundamentally malformed (e.g., not an object, missing
 * specs/layout). Lenient on missing optional fields.
 *
 * @param {object} stored
 * @returns {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain> | null}
 */
export function deserializeBodyWarpChain(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (!Array.isArray(stored.specs) || stored.specs.length === 0) return null;
  if (!stored.layout || typeof stored.layout !== 'object') return null;
  const specs = stored.specs.map(_deserializeSpec);
  const layout = { ...stored.layout };
  const { canvasToBodyXX, canvasToBodyXY } = makeBodyWarpNormalizers(layout);
  const debug = stored.debug ?? {};
  return {
    specs,
    layout,
    canvasToBodyXX,
    canvasToBodyXY,
    debug: {
      HIP_FRAC: typeof debug.HIP_FRAC === 'number' ? debug.HIP_FRAC : 0.45,
      FEET_FRAC: typeof debug.FEET_FRAC === 'number' ? debug.FEET_FRAC : 0.75,
      bodyFracSource: debug.bodyFracSource ?? 'stored',
      spineCfShifts: Array.isArray(debug.spineCfShifts) ? debug.spineCfShifts.slice() : [],
    },
  };
}

/**
 * Resolve `project.bodyWarp` to a usable chain, or `null` when the
 * field is absent / malformed. When `null`, the writer falls back to
 * its inline `buildBodyWarpChain` heuristic (today's path).
 *
 * @param {object} project
 * @returns {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain> | null}
 */
export function resolveBodyWarp(project) {
  const stored = project?.bodyWarp;
  if (!stored) return null;
  return deserializeBodyWarpChain(stored);
}

/**
 * Seed `project.bodyWarp` from a pre-computed chain. Destructive —
 * overwrites whatever was stored. Caller is responsible for computing
 * the chain via `buildBodyWarpChain(...)` with current mesh / canvas /
 * body-anatomy inputs.
 *
 * @param {object} project - mutated
 * @param {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain>} chain
 * @returns {StoredBodyWarpChain} the serialized form written to project
 */
export function seedBodyWarpChain(project, chain) {
  const stored = serializeBodyWarpChain(chain);
  project.bodyWarp = stored;
  return stored;
}

/**
 * Clear `project.bodyWarp`. Used to revert to the heuristic path
 * (e.g., after PSD reimport invalidates stored deltas).
 *
 * @param {object} project - mutated
 */
export function clearBodyWarp(project) {
  project.bodyWarp = null;
}
