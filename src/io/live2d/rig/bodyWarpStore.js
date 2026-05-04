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
import {
  warpSpecToDeformerNode,
  upsertDeformerNode,
  removeBodyWarpChainNodes,
} from '../../../store/deformerNodeSync.js';
import {
  getBodyWarpChainNodes,
  nodeToWarpSpec,
  indexProjectNodes,
} from './deformerNodeReaders.js';

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
 * Resolve a project to its body warp chain, or `null` when the
 * project has no body warp deformer nodes. When `null`, the writer
 * falls back to its inline `buildBodyWarpChain` heuristic (today's
 * path).
 *
 * BFA-006 Phase 6 — reads from `project.nodes` (chain specs) +
 * `project.bodyWarpLayout` (layout/debug metadata; small new sidetable
 * preserved because the canvas→innermost normalizer closures need a
 * persisted bbox + per-axis ranges that can't be recovered from
 * baseGrids alone). The legacy `project.bodyWarp` sidetable is
 * deleted by migration v16.
 *
 * @param {object} project
 * @returns {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain> | null}
 */
export function resolveBodyWarp(project) {
  const chainNodes = getBodyWarpChainNodes(project);
  if (chainNodes.length === 0) return null;
  const layout = project?.bodyWarpLayout?.layout;
  if (!layout || typeof layout !== 'object') return null;

  const byId = indexProjectNodes(project);
  if (!byId) return null;
  const specs = chainNodes.map((n) => nodeToWarpSpec(n, byId));
  const { canvasToBodyXX, canvasToBodyXY } = makeBodyWarpNormalizers(layout);
  const debug = project.bodyWarpLayout.debug ?? {};
  return {
    specs,
    layout: { ...layout },
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
 * Seed `project.bodyWarp` from a pre-computed chain.
 *
 * **Mode semantics (V3 Re-Rig Phase 0):**
 *   - `'replace'` (default, back-compat): destructive — overwrites
 *     any prior stored chain.
 *   - `'merge'`: if the prior value has `_userAuthored: true` at the
 *     top level, preserve it (no UI writes this today; reserved for a
 *     future "Edit Body Warp Keyforms" surface). Otherwise same as
 *     replace.
 *
 * @param {object} project - mutated
 * @param {ReturnType<typeof import('./bodyWarp.js').buildBodyWarpChain>} chain
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {StoredBodyWarpChain|null} the serialized form written to project (null if preserved existing)
 */
export function seedBodyWarpChain(project, chain, mode = 'replace') {
  if (mode === 'merge') {
    // Merge mode: preserve existing chain when ANY of the chain
    // nodes carry `_userAuthored`. Conservative — body warps are
    // chained, so a single hand-edited node implies the chain
    // shouldn't be re-clobbered.
    if (Array.isArray(project.nodes)) {
      const priorChain = getBodyWarpChainNodes(project);
      if (priorChain.some((n) => n._userAuthored === true)) return null;
    }
  }
  const stored = serializeBodyWarpChain(chain);
  // BFA-006 Phase 6 — write deformer nodes + the small layout sidetable.
  // The full `project.bodyWarp` sidetable is gone; layout + debug live
  // in `project.bodyWarpLayout` because the canvas→innermost normaliser
  // closures need persisted ranges that can't be recovered from
  // baseGrids alone.
  if (Array.isArray(project.nodes)) {
    removeBodyWarpChainNodes(project.nodes);
    for (const spec of stored.specs ?? []) {
      if (!spec) continue;
      upsertDeformerNode(project.nodes, warpSpecToDeformerNode(spec));
    }
  }
  project.bodyWarpLayout = {
    layout: stored.layout,
    debug: stored.debug,
  };
  return stored;
}

/**
 * Clear the body warp chain — drops chain deformer nodes and clears
 * `project.bodyWarpLayout`. Used to revert to the heuristic path
 * (e.g., after PSD reimport invalidates stored deltas).
 *
 * @param {object} project - mutated
 */
export function clearBodyWarp(project) {
  if (Array.isArray(project.nodes)) {
    removeBodyWarpChainNodes(project.nodes);
  }
  project.bodyWarpLayout = null;
}
