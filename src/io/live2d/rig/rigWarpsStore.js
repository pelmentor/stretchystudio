/**
 * Per-mesh rig warp keyform storage — Stage 9b of the native rig refactor.
 *
 * Stage 9a lifted the procedural shiftFn rules out of `cmo3writer.js`
 * into `rig/tagWarpBindings.js` and bumped magnitudes into
 * `autoRigConfig.tagWarpMagnitudes`. The shiftFns still ran at every
 * export. Stage 9b takes the next step: bake the shiftFn output into
 * per-mesh keyform position arrays and store them in
 * `project.rigWarps[partId]`. At export time the writer reads the stored
 * positions instead of invoking the shiftFn — the runtime export path is
 * pure serialization, no procedural deformation.
 *
 * **Storage format:** plain JSON keyed by `partId`. Each entry mirrors
 * the `rigWarpSpec` produced inside the per-mesh emission loop in
 * `cmo3writer.js` (id / name / parent / targetPartId / canvasBbox /
 * gridSize / baseGrid / localFrame / bindings / keyforms / isVisible /
 * isLocked / isQuadTransform). Float64Array → `number[]` for JSON
 * survival (same shape as Stages 4 + 10).
 *
 * **Reader fork (writer side).** `cmo3writer.js`'s per-keyform position
 * loop checks `project.rigWarps?.[m.partId]?.keyforms?.[ki]?.positions`
 * and uses the stored array verbatim if present. When absent or shorter
 * than the cartesian-product keyform count the writer falls back to the
 * inline shiftFn invocation — preserves today's path for any mesh not
 * yet seeded.
 *
 * **Seeder semantics.** `seedRigWarps(project, rigWarps)` is destructive
 * — overwrites the entire map. The caller (today: a rig-init flow that
 * runs the export pipeline once and harvests `rigSpec.warpDeformers`)
 * is responsible for filtering to per-mesh entries (those with
 * `targetPartId` set) and indexing them by partId. v1 keeps this
 * caller-driven; the eventual "Initialize Rig" UI button (Stage 1b) will
 * package the build+seed.
 *
 * **Staleness invariant.** Stage 9b v1 does NOT track mesh signatures.
 * If the user reimports PSD with re-meshed silhouettes (different vertex
 * count / canvas position), the stored positions silently become stale.
 * Same v1 footgun documented for Stages 4 + 10. Full `signatureHash`
 * tracking is deferred (see "Cross-cutting invariants → ID stability"
 * in NATIVE_RIG_REFACTOR_PLAN.md). Mitigation: the reader fork validates
 * `keyforms.length` matches the cartesian-product `numKf`, falling back
 * to inline shiftFn when they differ — so a save with stale binding
 * counts at least produces a valid export rather than a misindexed one.
 *
 * @module io/live2d/rig/rigWarpsStore
 */

import {
  warpSpecToDeformerNode,
  upsertDeformerNode,
  removeRigWarpNodes,
  removeDeformerNodesByPredicate,
} from '../../../store/deformerNodeSync.js';

/**
 * @typedef {Object} StoredRigWarpSpec
 *   Per-mesh rig warp keyform record. Shape mirrors the `rigWarpSpec`
 *   produced inline in `cmo3writer.js`'s per-mesh loop, with typed
 *   arrays converted to plain `number[]`.
 * @property {string} id
 * @property {string} name
 * @property {{type:string, id:string|null}} parent
 * @property {string} targetPartId
 * @property {{minX:number, minY:number, W:number, H:number}} canvasBbox
 * @property {{rows:number, cols:number}} gridSize
 * @property {number[]} baseGrid - flat (rows+1)*(cols+1)*2 array
 * @property {string} localFrame
 * @property {{parameterId:string, keys:number[], interpolation:string}[]} bindings
 * @property {{keyTuple:number[], positions:number[], opacity:number}[]} keyforms
 * @property {boolean} isVisible
 * @property {boolean} isLocked
 * @property {boolean} isQuadTransform
 */

function _serializeRigWarpSpec(spec) {
  return {
    id: spec.id,
    name: spec.name,
    parent: { type: spec.parent.type, id: spec.parent.id ?? null },
    targetPartId: spec.targetPartId,
    canvasBbox: {
      minX: spec.canvasBbox.minX,
      minY: spec.canvasBbox.minY,
      W: spec.canvasBbox.W,
      H: spec.canvasBbox.H,
    },
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

function _deserializeRigWarpSpec(stored) {
  return {
    id: stored.id,
    name: stored.name,
    parent: stored.parent ?? { type: 'warp', id: 'BodyXWarp' },
    targetPartId: stored.targetPartId,
    canvasBbox: stored.canvasBbox ?? { minX: 0, minY: 0, W: 0, H: 0 },
    gridSize: stored.gridSize ?? { rows: 2, cols: 2 },
    baseGrid: new Float64Array(stored.baseGrid ?? []),
    localFrame: stored.localFrame ?? 'normalized-0to1',
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
 * Validate a single stored rig-warp record. Used internally by the
 * resolver to drop obviously broken entries. Currently checks for
 * presence of mandatory fields; explicit signatureHash matching is
 * deferred to a later hardening pass.
 *
 * @param {unknown} stored
 * @returns {boolean}
 */
function _isWellFormedSpec(stored) {
  if (!stored || typeof stored !== 'object') return false;
  if (typeof stored.targetPartId !== 'string') return false;
  if (!Array.isArray(stored.baseGrid) || stored.baseGrid.length === 0) return false;
  if (!Array.isArray(stored.keyforms) || stored.keyforms.length === 0) return false;
  for (const k of stored.keyforms) {
    if (!k || typeof k !== 'object') return false;
    if (!Array.isArray(k.positions)) return false;
  }
  return true;
}

/**
 * Convert an iterable of rigWarpSpec entries (typically harvested from
 * `rigSpec.warpDeformers` and filtered to per-mesh entries via
 * `targetPartId`) into the JSON-friendly `{ [partId]: StoredRigWarpSpec }`
 * map. Pure; doesn't mutate input.
 *
 * @param {Iterable<object>} specs
 * @returns {Record<string, StoredRigWarpSpec>}
 */
export function serializeRigWarps(specs) {
  const out = {};
  for (const spec of specs) {
    if (!spec || typeof spec.targetPartId !== 'string') continue;
    out[spec.targetPartId] = _serializeRigWarpSpec(spec);
  }
  return out;
}

/**
 * Convert stored JSON map back to a runtime map of rig-warp specs
 * (with Float64Array baseGrid + per-keyform positions). Drops malformed
 * entries silently. Returns an empty Map when the input is fundamentally
 * unusable (not an object).
 *
 * @param {Record<string, unknown>|null|undefined} stored
 * @returns {Map<string, object>}  partId → spec
 */
export function deserializeRigWarps(stored) {
  const out = new Map();
  if (!stored || typeof stored !== 'object') return out;
  for (const [partId, entry] of Object.entries(stored)) {
    if (!_isWellFormedSpec(entry)) continue;
    out.set(partId, _deserializeRigWarpSpec(entry));
  }
  return out;
}

/**
 * Resolve `project.rigWarps` to a `partId → spec` Map, or an empty
 * Map when the field is absent / empty. The cmo3 writer threads this
 * through and reads `map.get(partId)` per mesh; missing entries
 * fall through to the inline shiftFn path.
 *
 * @param {object} project
 * @returns {Map<string, object>}
 */
export function resolveRigWarps(project) {
  return deserializeRigWarps(project?.rigWarps);
}

/**
 * Seed `project.rigWarps` from a pre-computed `partId → spec` map (or
 * iterable of specs with `targetPartId` set).
 *
 * **Mode semantics (V3 Re-Rig Phase 0):**
 *   - `'replace'` (default, back-compat): destructive — overwrites
 *     the entire stored map.
 *   - `'merge'`: per-partId — preserve any stored entry with
 *     `_userAuthored: true` (no UI writes this today; reserved for a
 *     future per-mesh keyform editor); reseed the rest.
 *
 * Caller is responsible for harvesting specs from a one-shot rig-init
 * pass (e.g., calling `generateCmo3` once and filtering
 * `rigSpec.warpDeformers` to entries with `targetPartId`).
 *
 * @param {object} project - mutated
 * @param {Map<string,object>|Iterable<object>} rigWarps
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {Record<string, StoredRigWarpSpec>} the serialized form written
 */
export function seedRigWarps(project, rigWarps, mode = 'replace') {
  let specs;
  if (rigWarps instanceof Map) {
    specs = Array.from(rigWarps.values());
  } else {
    specs = Array.from(rigWarps);
  }
  const stored = serializeRigWarps(specs);
  let finalMap;
  if (mode === 'merge') {
    const prior = (project.rigWarps && typeof project.rigWarps === 'object') ? project.rigWarps : {};
    const merged = { ...stored };
    for (const [partId, entry] of Object.entries(prior)) {
      if (entry && typeof entry === 'object' && entry._userAuthored === true) {
        merged[partId] = entry;
      }
    }
    project.rigWarps = merged;
    finalMap = merged;
  } else {
    project.rigWarps = stored;
    finalMap = stored;
  }
  // BFA-006 Phase 1 — dual-write deformer nodes for the final map.
  // In replace mode we drop ALL prior rigWarp nodes first; in merge mode
  // we drop only nodes whose targetPartId is being overwritten by this
  // pass (preserves _userAuthored entries that were preserved above).
  if (Array.isArray(project.nodes)) {
    if (mode === 'merge') {
      const incomingPartIds = new Set(Object.keys(stored));
      removeDeformerNodesByPredicate(project.nodes, (n) =>
        typeof n.targetPartId === 'string' && incomingPartIds.has(n.targetPartId)
      );
    } else {
      removeRigWarpNodes(project.nodes);
    }
    for (const spec of Object.values(finalMap)) {
      if (!spec) continue;
      upsertDeformerNode(project.nodes, warpSpecToDeformerNode(spec));
    }
    // Sync parts[i].rigParent: every part covered by the map gets
    // pointed at its rigWarp deformer's id.
    for (const [partId, spec] of Object.entries(finalMap)) {
      if (!spec || typeof spec.id !== 'string') continue;
      const partNode = project.nodes.find((n) => n && n.id === partId && n.type === 'part');
      if (partNode) partNode.rigParent = spec.id;
    }
  }
  return finalMap;
}

/**
 * Clear `project.rigWarps`. Used to revert to the heuristic path
 * (e.g., after PSD reimport invalidates stored per-vertex deltas).
 *
 * @param {object} project - mutated
 */
export function clearRigWarps(project) {
  project.rigWarps = {};
  // BFA-006 Phase 1 — drop the shadow rigWarp nodes; clear part
  // rigParent pointers that referenced them so dangling refs don't
  // confuse Phase 2's selectRigSpec.
  if (Array.isArray(project.nodes)) {
    removeRigWarpNodes(project.nodes);
    for (const n of project.nodes) {
      if (n && n.type === 'part' && n.rigParent !== undefined) {
        n.rigParent = null;
      }
    }
  }
}
