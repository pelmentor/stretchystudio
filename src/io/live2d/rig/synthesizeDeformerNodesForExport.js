// @ts-check

/**
 * BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.B — synthetic deformer-node
 * export pipeline.
 *
 * Inflates each part's `Object.modifiers[]` (with `modifier.data`
 * sub-object populated by Phase 3.A's v28 migration + the
 * `synthesizeModifierStacks` dual-write) into a transient
 * deformer-node tree structurally identical to today's
 * `project.nodes.filter(n => n.type === 'deformer')` result.
 *
 * Why: post-Phase-3.C `project.nodes` will no longer carry deformer
 * entries — the data lives only on `modifier.data`. The export
 * pipeline (`selectRigSpec` → `cmo3writer` / `moc3writer`) needs the
 * old node-shaped tree to keep working byte-identically. This synth
 * provides that view on demand.
 *
 * # Output shape
 *
 * Each synthesised node carries:
 *   - `type: 'deformer'`, `deformerKind: 'warp' | 'rotation'`
 *   - `id` — the modifier's `deformerId`
 *   - `parent` — id of the next modifier up the part's stack (the
 *     leaf-first stack convention means modifiers[i+1] is the parent
 *     of modifiers[i]). `null` for outermost.
 *   - All `modifier.data.*` fields spread in (`name`, `gridSize`,
 *     `keyforms`, `bindings`, …).
 *
 * Multiple parts can share a deformer (a body warp parents many
 * parts). The synth emits each unique deformer once, taking the
 * parent edge from the first part stack that referenced it. The
 * stacks built by `synthesizeModifierStacks` are consistent across
 * parts (they walk the same `node.parent` chain), so any part's
 * stack yields the same parent edges.
 *
 * # Pre-Phase-3.C compatibility
 *
 * While `node.type === 'deformer'` entries still exist in
 * `project.nodes` (Phase 3.A / 3.B state), this synth optionally
 * emits orphan deformer nodes that are NOT in any part's modifier
 * stack (so callers like `selectRigSpec` don't lose data on a
 * partially-rigged project).
 *
 * @module io/live2d/rig/synthesizeDeformerNodesForExport
 */

import { logger } from '../../../lib/logger.js';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
} from '../../../store/migrations/v21_modifier_mode_flags.js';
import { getWarpRestGrid } from '../../../store/warpLatticeAccess.js';

/**
 * The id a modifier references. Lattice modifiers (v43) reference a cage
 * OBJECT via `objectId`; warp/rotation modifiers reference a deformer node
 * via `deformerId`.
 *
 * @param {object|null|undefined} mod
 * @returns {string|null}
 */
function _modRefId(mod) {
  if (!mod || typeof mod !== 'object') return null;
  if (mod.type === 'lattice') {
    return typeof mod.objectId === 'string' ? mod.objectId : null;
  }
  return typeof mod.deformerId === 'string' ? mod.deformerId : null;
}

/**
 * Inflate a `{type:'object', objectKind:'lattice'}` cage object into the
 * transient `{type:'deformer', deformerKind:'warp', ...}` shape the
 * selectRigSpec / export pipeline consumes. The rest cage (`baseGrid`)
 * comes from the linked `meshData` (via `getWarpRestGrid`); all other warp
 * fields are object metadata. Mirrors the field set the v28 data-fold
 * produced, so `_warpNodeToSpec` sees identical data => identical warpSpecs.
 *
 * `parent` is intentionally omitted — the caller sets it from the modifier
 * stack edge (or the object's own parent in the orphan pass), exactly as
 * the data-fold path does.
 *
 * @param {object} obj - a lattice cage object
 * @param {object} project - for the cage meshData lookup
 * @returns {object}
 */
function _latticeObjectToSynthNode(obj, project) {
  const node = {
    type: 'deformer',
    deformerKind: 'warp',
    id: obj.id,
    name: obj.name ?? obj.id,
    visible: obj.visible !== false,
    gridSize: { rows: obj.gridSize?.rows ?? 5, cols: obj.gridSize?.cols ?? 5 },
    baseGrid: getWarpRestGrid(obj, project),
    localFrame: obj.localFrame ?? 'canvas-px',
    bindings: Array.isArray(obj.bindings) ? obj.bindings : [],
    keyforms: Array.isArray(obj.keyforms) ? obj.keyforms : [],
    isLocked: obj.isLocked === true,
    isQuadTransform: obj.isQuadTransform === true,
  };
  if (typeof obj.targetPartId === 'string' && obj.targetPartId.length > 0) {
    node.targetPartId = obj.targetPartId;
  }
  if (obj.canvasBbox && typeof obj.canvasBbox === 'object') {
    node.canvasBbox = obj.canvasBbox;
  }
  if (obj._userAuthored === true) node._userAuthored = true;
  return node;
}

/**
 * Build a transient deformer node from a modifier entry, resolving the
 * lattice-object reference (v43) or the legacy warp/rotation data-fold.
 * Returns null when the modifier can't yield a deformer (no data / dangling
 * object ref / armature).
 *
 * @param {object} mod
 * @param {Map<string, object>} nodesById
 * @param {object} project
 * @returns {object|null}
 */
function _synthFromModifier(mod, nodesById, project) {
  if (mod.type === 'lattice') {
    const obj = nodesById.get(mod.objectId);
    if (!obj || obj.type !== 'object' || obj.objectKind !== 'lattice') return null;
    return _latticeObjectToSynthNode(obj, project);
  }
  if (mod.type !== 'warp' && mod.type !== 'rotation') return null; // e.g. armature
  const data = mod.data;
  if (!data || typeof data !== 'object') return null;
  return {
    type: 'deformer',
    deformerKind: mod.type === 'rotation' ? 'rotation' : 'warp',
    id: mod.deformerId,
    ...data,
  };
}

/** Mode bitmask check — Blender's `BKE_modifier_is_enabled` semantic
 *  (`reference/blender/source/blender/blenkernel/BKE_modifier.hh:480`).
 *  A modifier is enabled iff `enabled !== false` AND
 *  `(mode & requiredMode) !== 0`.
 *
 *  Default modifier mode (per v21 migration) is REALTIME | RENDER. So
 *  modifiers carrying no explicit mode pass both REALTIME and RENDER
 *  filters but fail EDITMODE — matching Blender's defaults.
 *
 *  @param {object} mod
 *  @param {number} requiredMode
 *  @returns {boolean}
 */
function _modifierActiveInMode(mod, requiredMode) {
  if (!mod) return false;
  if (mod.enabled === false) return false;
  const mode = typeof mod.mode === 'number'
    ? mod.mode
    : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
  return (mode & requiredMode) !== 0;
}

/**
 * Module-scoped flare bookkeeping for the orphan-fallback diagnostic.
 * Tracks the set of deformer ids that have been flared this session so
 * a steady-state divergence doesn't spam the Logs panel. Reset by
 * project identity change — first synth pass on a freshly-loaded
 * project gets a clean flare opportunity, subsequent passes dedupe.
 */
let _lastFlaredProject = null;
/** @type {Set<string>} */
let _flaredOrphanIds = new Set();

/**
 * Reset the orphan-fallback flare state. Useful in tests; production
 * code shouldn't need to call it (project-identity tracking does it
 * automatically).
 */
export function resetSynthFlare() {
  _lastFlaredProject = null;
  _flaredOrphanIds = new Set();
}

/**
 * @param {object} project
 * @param {{ includeOrphans?: boolean, suppressFlare?: boolean, requiredMode?: number }} [opts]
 * @returns {Array<object>}  Array of synthetic `type:'deformer'` nodes.
 *
 * `requiredMode` is the eval-context bitmask used to gate per-modifier
 * visibility, mirroring Blender's `BKE_modifier_is_enabled`:
 *   - `MODIFIER_MODE_REALTIME` (default) — viewport / Live Preview tick
 *   - `MODIFIER_MODE_RENDER`              — export bake
 *   - `MODIFIER_MODE_EDITMODE`            — eval while in mesh edit mode
 *
 * The default is `REALTIME` because the live render path
 * (`selectRigSpec` → `chainEval`) is the dominant caller; export
 * pipelines that need RENDER semantics pass the flag explicitly.
 */
export function synthesizeDeformerNodesForExport(project, opts = {}) {
  if (!project || !Array.isArray(project.nodes)) return [];
  const includeOrphans = opts.includeOrphans !== false; // default true
  const requiredMode = typeof opts.requiredMode === 'number'
    ? opts.requiredMode
    : MODIFIER_MODE_REALTIME;

  /** @type {Map<string, object>} */
  const byId = new Map();
  /** @type {Map<string, string|null>} */
  const parentEdges = new Map();

  // Index every node by id so lattice modifiers (`{type:'lattice',
  // objectId}`, v43) can resolve their referenced cage object.
  /** @type {Map<string, object>} */
  const nodesById = new Map();
  for (const n of project.nodes) {
    if (n && typeof n.id === 'string') nodesById.set(n.id, n);
  }

  // A modifier yields a transient deformer node iff it's enabled in the
  // required mode AND resolves to data (lattice → cage object; warp/rotation
  // → `mod.data`). Armature mods + dangling refs yield nothing.
  const _modYieldsSynth = (m) =>
    m
    && _modifierActiveInMode(m, requiredMode)
    && _synthFromModifier(m, nodesById, project) !== null;

  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    const stack = part.modifiers;
    for (let i = 0; i < stack.length; i++) {
      const mod = stack[i];
      const refId = _modRefId(mod);
      if (!refId) continue;
      // Modifier visibility — Blender's `BKE_modifier_is_enabled`
      // (`enabled !== false` AND `(mode & requiredMode) !== 0`). A
      // modifier hidden by either gate is invisible to downstream
      // consumers: don't emit a deformer entry for it via this part's
      // stack, and don't establish a parent edge that points AT it
      // (the next-enabled walk below skips past). Other parts where
      // the same deformer IS active under `requiredMode` will still
      // emit it; if no part has it active, it falls through to the
      // orphan-fallback pass — harmless because no artMesh's parent
      // will reference it.
      if (!_modifierActiveInMode(mod, requiredMode)) continue;
      const synthNode = _synthFromModifier(mod, nodesById, project);
      // Can't synthesise (no data / dangling object ref / armature) —
      // fall back to the orphan pass for any standalone node.
      if (!synthNode) continue;
      if (!byId.has(refId)) byId.set(refId, synthNode);
      // Parent edge — taken from the FIRST stack we see the deformer
      // in (subsequent stacks should agree per `synthesizeModifierStacks`).
      // Walk forward past disabled modifiers so a middle-of-stack
      // disable collapses the chain for parts that filter out that
      // entry. Per-mesh leaf modifiers are part-specific in SS, so
      // the parent edge each X-specific leaf advertises mirrors X's
      // filtered stack. Shared deformers (body warps etc.) take
      // their parent edge from any part that has them enabled —
      // consistent with the global authored topology.
      if (!parentEdges.has(refId)) {
        let nextEnabledId = null;
        for (let j = i + 1; j < stack.length; j++) {
          if (_modYieldsSynth(stack[j])) {
            nextEnabledId = _modRefId(stack[j]);
            break;
          }
        }
        parentEdges.set(refId, nextEnabledId);
      }
    }
  }

  // Pre-Phase-3.C orphan pass: emit any deformer node that nobody
  // referenced in their stack (e.g. body warps not yet wired into a
  // part because the rigging isn't complete, or partially-stripped
  // re-rig states).
  /** @type {Array<{id: string, deformerKind: string, reason: string}>} */
  const orphanFallbacks = [];
  if (includeOrphans) {
    for (const n of project.nodes) {
      if (!n || typeof n.id !== 'string') continue;
      if (byId.has(n.id)) continue;
      // Orphan = a standalone deformer this pass would otherwise miss:
      //   - rotation deformer / un-flipped legacy warp node → copy verbatim;
      //   - lattice cage object (v43) → inflate to the transient warp shape.
      // A lattice cage typically reaches parts via hierarchy ancestry
      // (e.g. body warps) rather than an explicit per-part modifier, so it
      // legitimately lands here. Parent stays as authored.
      let synthNode = null;
      if (n.type === 'deformer') {
        synthNode = { ...n };
      } else if (n.type === 'object' && n.objectKind === 'lattice') {
        synthNode = _latticeObjectToSynthNode(n, project);
      } else {
        continue;
      }
      byId.set(n.id, synthNode);
      parentEdges.set(n.id,
        typeof n.parent === 'string' ? n.parent : null);
      // Detect WHY this deformer hit the orphan path: was it referenced
      // in a modifier stack but with empty .data, or was it not in any
      // modifier stack at all? Phase 3.C deletes the orphan-fallback
      // safety net, so any deformer reaching output via this path is
      // at risk of disappearing post-3.C.
      let referencedWithoutData = false;
      let referencedAtAll = false;
      for (const part of project.nodes) {
        if (!part || part.type !== 'part') continue;
        if (!Array.isArray(part.modifiers)) continue;
        for (const mod of part.modifiers) {
          if (_modRefId(mod) === n.id) {
            referencedAtAll = true;
            // Lattice mods carry no `data` by design (object is the source),
            // so "data-missing" only flags legacy warp/rotation mods.
            if (mod.type !== 'lattice' && (!mod.data || typeof mod.data !== 'object')) {
              referencedWithoutData = true;
            }
          }
        }
      }
      const isLatticeObject = n.type === 'object' && n.objectKind === 'lattice';
      orphanFallbacks.push({
        id: n.id,
        deformerKind: synthNode.deformerKind ?? 'unknown',
        reason: referencedWithoutData
          ? 'modifier-data-missing'   // in stack but .data empty — stale state
          : referencedAtAll
            ? 'in-stack-with-data'    // shouldn't happen if main pass worked
            : isLatticeObject
              ? 'lattice-via-hierarchy' // EXPECTED — body warps reach parts via ancestry, not an explicit modifier (not a stale state)
              : 'never-in-stack',       // truly orphaned, no part renders it
      });
    }
  }

  // Diagnostic flare: log the first time we see orphan-fallback
  // emissions for a given project. After Phase 3.C deletes the
  // orphan-fallback safety net, any deformer that reached output
  // via this path will silently disappear from the rig — surfacing
  // it now lets the user notice and re-init before it bites.
  if (
    !opts.suppressFlare
    && orphanFallbacks.length > 0
    && project !== _lastFlaredProject
  ) {
    _lastFlaredProject = project;
    _flaredOrphanIds = new Set();
    const firstNew = [];
    for (const o of orphanFallbacks) {
      if (!_flaredOrphanIds.has(o.id)) {
        _flaredOrphanIds.add(o.id);
        firstNew.push(o);
      }
    }
    if (firstNew.length > 0) {
      logger.warn(
        'synthOrphanFallback',
        `${firstNew.length} deformer(s) only present via orphan-fallback. After Phase 3.C they will disappear unless modifier.data is repaired (Re-initialize Rig refreshes it).`,
        {
          orphans: firstNew.slice(0, 10),
          totalCount: orphanFallbacks.length,
        },
      );
    }
  }

  const synth = [];
  for (const [id, node] of byId) {
    node.parent = parentEdges.get(id) ?? null;
    synth.push(node);
  }
  return synth;
}
