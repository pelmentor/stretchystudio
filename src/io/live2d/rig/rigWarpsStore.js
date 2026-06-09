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
  upsertWarpAsLattice,
  removeRigWarpNodes,
  removeDeformerNodesByPredicate,
  synthesizeModifierStacks,
  synthesizeDeformerParents,
} from '../../../store/deformerNodeSync.js';
import { DEFAULT_MIGRATED_MODE } from '../../../store/migrations/v21_modifier_mode_flags.js';
import { coerceNumberArray } from '../../../lib/numberArrayCoerce.js';
import {
  getRigWarpNodes,
  nodeToWarpSpec,
  indexProjectNodes,
} from './deformerNodeReaders.js';

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
    bindings: (stored.bindings ?? []).map((b, i) => ({
      parameterId: b.parameterId,
      keys: coerceNumberArray(b.keys, `rigWarpStored[${stored.id}].bindings[${i}].keys`),
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (stored.keyforms ?? []).map((k, i) => ({
      keyTuple: coerceNumberArray(k.keyTuple, `rigWarpStored[${stored.id}].keyforms[${i}].keyTuple`),
      positions: new Float64Array(coerceNumberArray(k.positions, `rigWarpStored[${stored.id}].keyforms[${i}].positions`)),
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
 * Resolve a project to its `partId → rigWarp spec` map by walking
 * `project.nodes` for per-mesh rigWarp deformer nodes (those with a
 * `targetPartId`). The cmo3 writer threads this through and reads
 * `map.get(partId)` per mesh; missing entries fall through to the
 * inline shiftFn path.
 *
 * BFA-006 Phase 6 — reads from `project.nodes` exclusively. The
 * legacy `project.rigWarps` sidetable is deleted by migration v16.
 *
 * @param {object} project
 * @returns {Map<string, object>}
 */
export function resolveRigWarps(project) {
  const out = new Map();
  const nodes = getRigWarpNodes(project);
  if (nodes.size === 0) return out;
  const byId = indexProjectNodes(project);
  if (!byId) return out;
  for (const [partId, node] of nodes) {
    out.set(partId, nodeToWarpSpec(node, byId, project));
  }
  return out;
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
 * **Subsystem opt-out (2026-06-08).** `opts.disabledTargetPartIds` lists
 * partIds whose owning Init-Rig subsystem (`hairRig`, `clothingRig`,
 * `eyeRig`, `mouthRig`) is flagged false. Their rigWarp spec is still
 * upserted (so `synthesizeModifierStacks` produces a non-empty stack and
 * the part renders at its authored position), but the leaf modifier
 * `enabled` flag is forced to `false` — the renderer's per-modifier gate
 * (`isModifierEnabled`) routes through the rest-grid pass-through, no
 * sway. This is Blender's `BKE_modifier_is_enabled` semantic — the
 * disable is a per-modifier toggle, not a "drop the modifier" strip.
 * Pre-revision (GAP-008) the harvest stripped these from the map; that
 * left `part.modifiers[]` empty → renderer placed the part at canvas
 * origin (`rigInvariantCheck` I-1/I-21).
 *
 * Override semantic: subsystem opt-out at Init Rig time WINS over any
 * `priorEnabled` carry-forward — re-clicking Init Rig with a subsystem
 * still off resets the modifier to disabled, even if the user manually
 * toggled it on via the UI between Init Rigs. To re-enable, toggle the
 * subsystem on in the popover and re-Init.
 *
 * @param {object} project - mutated
 * @param {Map<string,object>|Iterable<object>} rigWarps
 * @param {'replace'|'merge'} [mode='replace']
 * @param {{ disabledTargetPartIds?: Set<string>|null }} [opts]
 * @returns {Record<string, StoredRigWarpSpec>} the serialized form written
 */
export function seedRigWarps(project, rigWarps, mode = 'replace', opts = {}) {
  const disabledTargetPartIds = opts?.disabledTargetPartIds instanceof Set
    ? opts.disabledTargetPartIds
    : null;
  let specs;
  if (rigWarps instanceof Map) {
    specs = Array.from(rigWarps.values());
  } else {
    specs = Array.from(rigWarps);
  }
  const stored = serializeRigWarps(specs);
  let finalMap = stored;
  if (mode === 'merge' && Array.isArray(project.nodes)) {
    // Merge: per-partId. Preserve any existing rigWarp deformer node
    // whose `_userAuthored:true` flag is set; reseed the rest.
    const priorNodes = getRigWarpNodes(project);
    const merged = { ...stored };
    const byId = indexProjectNodes(project);
    if (byId) {
      for (const [partId, priorNode] of priorNodes) {
        if (priorNode._userAuthored === true) {
          merged[partId] = nodeToWarpSpec(priorNode, byId, project);
        }
      }
    }
    finalMap = merged;
  }
  // BFA-006 Phase 6 — single-write to `project.nodes`. Drop prior
  // rigWarp nodes (preserving _userAuthored survivors in merge mode
  // already pre-collected into `merged`), upsert the final map.
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
      // Phase 5 — emit Blender-Lattice objects (+ cage), not legacy nodes.
      upsertWarpAsLattice(project.nodes, spec);
    }
    // M1 (RULE-№4 modifier-stack flip, 2026-05-23): write the leaf modifier
    // entry directly into `part.modifiers[0]`. This seam is the authoring
    // source-of-truth, mirroring Blender's `Object.modifiers` as the
    // per-Object stack the user authors against. Pre-M1 this site wrote
    // `partNode.rigParent = spec.id` and let `synthesizeModifierStacks`
    // walk up from there; M4 (2026-05-23) completed the retirement —
    // `rigParent` is no longer persisted (v48 strips it), and the synth
    // uses `modifiers[0]` as the sole authoring leaf signal.
    for (const [partId, spec] of Object.entries(finalMap)) {
      if (!spec || typeof spec.id !== 'string') continue;
      const partNode = project.nodes.find((n) => n && n.id === partId && n.type === 'part');
      if (!partNode) continue;
      // Audit-fix MED (2026-05-23): on a same-id re-rig (spec.id stable
      // across re-runs of Init Rig — the common case for a project that
      // re-fits its own rigWarps), the user's leaf flags (eye-off / ✓-off
      // on the rigWarp) live ONLY on the prior `modifiers[0]` record. A
      // blind overwrite resets them to defaults BEFORE
      // `synthesizeModifierStacks` builds its priorFlags map, so the
      // synth's carry-forward sees the just-written defaults rather than
      // the user state. Capture the prior leaf flags here when the
      // outgoing leaf matches the incoming spec id, then thread them onto
      // the new entry. Same-shaped logic as `_flags` in the synth, but
      // pulled ahead to the write site.
      let priorEnabled = true;
      let priorMode = DEFAULT_MIGRATED_MODE;
      let priorShowInEditor = true;
      if (Array.isArray(partNode.modifiers) && partNode.modifiers.length > 0) {
        const prior = partNode.modifiers[0];
        if (prior && prior.type === 'lattice' && prior.objectId === spec.id) {
          if (typeof prior.enabled === 'boolean') priorEnabled = prior.enabled;
          if (typeof prior.mode === 'number') priorMode = prior.mode;
          if (typeof prior.showInEditor === 'boolean') priorShowInEditor = prior.showInEditor;
        }
      }
      // Subsystem opt-out (2026-06-09): KEEP the leaf modifier enabled.
      //
      // The earlier Phase 1 fix (b485b52, 2026-06-08) set `enabled: false`
      // here for subsystem-opted-out parts. That looked semantically
      // correct ("subsystem off → modifier off") but routed the chain
      // through `_resolveModifierChain`'s skip-disabled branch, which
      // promoted the chain leaf to the rigwarp's PARENT (e.g.
      // FaceParallaxWarp). The runtime then re-projected the cached UV
      // verts (in rigwarp's frame) into the new parent's frame via
      // `_reprojectKeyformVerts` — and that round-trip had a 153 px drift
      // for hair on real models. User-reported bug 2026-06-09.
      //
      // The correct semantic was already achieved by the OTHER half of
      // the subsystem opt-out: `paramSpec.subsystems` filters
      // ParamHairFront / ParamHairBack out of `project.parameters`. The
      // rigwarp's bindings to those params become ORPHAN; the depgraph
      // resolves an orphan param to its default (0), which lands on
      // `keyform[0] = restGrid` of the rigwarp — IDENTITY deformation.
      // Visual result: hair at rest position, exactly what the user
      // wants when hairRig is off. No reprojection needed; no drift.
      //
      // `disabledTargetPartIds` retained on the API surface but unused
      // here — the harvest-side flag is still useful for downstream UI
      // surfaces (e.g. a modifier-stack badge "param missing"); the seed
      // itself just preserves `priorEnabled`.
      void disabledTargetPartIds;
      const leafEntry = {
        type: 'lattice',
        objectId: spec.id,
        enabled: priorEnabled,
        mode: priorMode,
        showInEditor: priorShowInEditor,
      };
      if (!Array.isArray(partNode.modifiers)) partNode.modifiers = [];
      // Replace just the leaf — preserve modifiers[1..] so the synth's
      // priorFlags carry-forward keeps user enable/mode toggles on
      // ancestor chain modifiers (BodyXWarp, BreathWarp, etc.) across
      // the re-rig.
      partNode.modifiers[0] = leafEntry;
    }
    // Walk up `def.parent` from each part's pinned leaf to materialise
    // the full per-part stack.
    synthesizeModifierStacks(project);
    // Mirror the canonical stack back onto the legacy parent-link shape
    // (`deformer.parent`) so cmo3writer's chain walk stays consistent.
    // (Post-M4 RULE-№4, 2026-05-23, the `part.rigParent` mirror is
    // retired; this function maintains only the deformer-side chain
    // pointers.)
    synthesizeDeformerParents(project);
  }
  return finalMap;
}

/**
 * Drop all rigWarp deformer nodes from `project.nodes` and the
 * matching `modifiers[0]` leaf entry on every covered part. Used to
 * revert to the heuristic path (e.g., after PSD reimport invalidates
 * stored per-vertex deltas).
 *
 * @param {object} project - mutated
 */
export function clearRigWarps(project) {
  if (Array.isArray(project.nodes)) {
    removeRigWarpNodes(project.nodes);
    // M1 (RULE-№4 modifier-stack flip, 2026-05-23): authoring writes go to
    // `part.modifiers[]`. Dropping the field is the authoritative "no rig
    // warp" signal — the synth's leaf-resolution then either derives the
    // body-warp chain seed via `findInnermostBodyWarpId` (bone-baked path,
    // post-M3.2) or produces an empty stack. Pre-M1 this site nulled
    // `n.rigParent` directly; post-M4 (2026-05-23) the field is retired
    // entirely (v48 strips it from persisted saves).
    //
    // Audit-fix HIGH (2026-05-23): bone-baked parts carry an Armature
    // modifier whose user flags (enabled / mode / showInEditor) live ONLY
    // on the modifier record — a blind `delete n.modifiers` would wipe
    // them. Preserve armature entries so `synthesizeModifierStacks`'
    // priorFlags map can carry the user's armature flags into the rebuilt
    // stack. The synth's leaf-resolution explicitly skips a leading
    // armature entry so the warp chain is re-derived from the
    // `findInnermostBodyWarpId` helper (post-M3.2; was: runtime.parent).
    for (const n of project.nodes) {
      if (n && n.type === 'part' && Array.isArray(n.modifiers)) {
        const armatureEntries = n.modifiers.filter((m) => m && m.type === 'armature');
        if (armatureEntries.length > 0) {
          n.modifiers = armatureEntries;
        } else {
          delete n.modifiers;
        }
      }
    }
    synthesizeModifierStacks(project);
    synthesizeDeformerParents(project);
  }
}
