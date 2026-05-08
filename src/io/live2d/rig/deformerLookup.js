// @ts-check

/**
 * BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.C — single-source-of-truth
 * deformer lookup helpers.
 *
 * Post-Phase-3.C, `project.nodes` no longer carries `type:'deformer'`
 * entries. Deformer state lives entirely on `Object.modifiers[i].data`.
 * Every reader/writer that previously did
 * `project.nodes.find(n => n?.type === 'deformer' && n.id === X)`
 * routes through this module instead.
 *
 * The shape returned by `findDeformerById` mirrors the legacy
 * `project.nodes` deformer-node shape exactly, so UI surfaces that
 * read fields like `node.gridSize`, `node.keyforms`, `node.baseGrid`,
 * `node.deformerKind`, etc. continue to work without change.
 *
 * # Shared deformers (FaceParallax, BodyWarp_*)
 *
 * A single deformer can appear in many parts' modifier stacks. The
 * Phase 3.A v28 migration + the synth dual-write keep `modifier.data`
 * identical across every part referencing the same `deformerId`. Reads
 * take any one (first hit wins). Writes go through
 * `updateDeformerInProject`, which fans out the same edit to every
 * referencing part — preserving the cross-part consistency invariant.
 *
 * @module io/live2d/rig/deformerLookup
 */

import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
} from '../../../store/migrations/v21_modifier_mode_flags.js';

/**
 * Inflate a `(modifier, partStack, partStackIdx)` triple into the
 * legacy deformer-node shape: `{type:'deformer', deformerKind, id,
 * parent, ...modifier.data}`. The `parent` edge is derived from the
 * next active modifier up the stack (mirrors the synth in
 * `synthesizeDeformerNodesForExport`).
 *
 * @param {object} mod
 * @param {Array<object>} partStack
 * @param {number} fromIdx
 * @param {number} requiredMode
 * @returns {object|null}
 */
function _inflateModifier(mod, partStack, fromIdx, requiredMode) {
  if (!mod || typeof mod.deformerId !== 'string') return null;
  if (mod.type !== 'warp' && mod.type !== 'rotation') return null;
  const data = mod.data;
  if (!data || typeof data !== 'object') return null;
  let parentId = null;
  for (let j = fromIdx + 1; j < partStack.length; j++) {
    const m = partStack[j];
    if (!m) continue;
    if (m.type !== 'warp' && m.type !== 'rotation') continue;
    if (m.enabled === false) continue;
    const mode = typeof m.mode === 'number'
      ? m.mode
      : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
    if ((mode & requiredMode) === 0) continue;
    if (typeof m.deformerId !== 'string') continue;
    if (!m.data || typeof m.data !== 'object') continue;
    parentId = m.deformerId;
    break;
  }
  return {
    type: 'deformer',
    deformerKind: mod.type,
    id: mod.deformerId,
    parent: parentId,
    ...data,
  };
}

/**
 * Find a deformer by id across all parts' modifier stacks. Returns
 * the inflated deformer-node shape, or `null` if no part references
 * this id.
 *
 * @param {object} project
 * @param {string} deformerId
 * @param {{ requiredMode?: number }} [opts]
 * @returns {object|null}
 */
export function findDeformerById(project, deformerId, opts = {}) {
  if (!project || typeof deformerId !== 'string' || deformerId.length === 0) return null;
  if (!Array.isArray(project.nodes)) return null;
  const requiredMode = typeof opts.requiredMode === 'number'
    ? opts.requiredMode
    : MODIFIER_MODE_REALTIME;
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    for (let i = 0; i < part.modifiers.length; i++) {
      const mod = part.modifiers[i];
      if (mod?.deformerId !== deformerId) continue;
      const inflated = _inflateModifier(mod, part.modifiers, i, requiredMode);
      if (inflated) return inflated;
    }
  }
  return null;
}

/**
 * List every distinct deformer in the project as inflated deformer-node
 * shapes. First occurrence (in any part's stack) wins for the data
 * snapshot; the parent edge is taken from that occurrence.
 *
 * Equivalent to `synthesizeDeformerNodesForExport(project)` minus the
 * orphan fallback — pure modifier.data read.
 *
 * @param {object} project
 * @param {{ requiredMode?: number }} [opts]
 * @returns {Array<object>}
 */
export function listDeformers(project, opts = {}) {
  if (!project || !Array.isArray(project.nodes)) return [];
  const requiredMode = typeof opts.requiredMode === 'number'
    ? opts.requiredMode
    : MODIFIER_MODE_REALTIME;
  /** @type {Map<string, object>} */
  const out = new Map();
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    for (let i = 0; i < part.modifiers.length; i++) {
      const mod = part.modifiers[i];
      if (!mod || typeof mod.deformerId !== 'string') continue;
      if (out.has(mod.deformerId)) continue;
      const inflated = _inflateModifier(mod, part.modifiers, i, requiredMode);
      if (inflated) out.set(mod.deformerId, inflated);
    }
  }
  return Array.from(out.values());
}

/**
 * Mutate `modifier.data` for every part whose stack references the
 * given deformerId. The mutator receives the modifier's `data` object
 * (you get the actual reference; mutate in place, no return). Returns
 * the count of parts mutated.
 *
 * Used by UI editors (DeformerKeyformsSection, DeformerBindingsSection,
 * DeformerInfoSection) and store mutators that previously wrote to a
 * single deformer node — the fanout to every referencing part keeps
 * shared-deformer data consistent.
 *
 * @param {object} project - mutated in place
 * @param {string} deformerId
 * @param {(data: object, modifier: object, part: object) => void} mutator
 * @returns {number}
 */
export function updateDeformerData(project, deformerId, mutator) {
  if (!project || typeof deformerId !== 'string' || deformerId.length === 0) return 0;
  if (!Array.isArray(project.nodes)) return 0;
  if (typeof mutator !== 'function') return 0;
  let count = 0;
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    for (const mod of part.modifiers) {
      if (mod?.deformerId !== deformerId) continue;
      if (!mod.data || typeof mod.data !== 'object') {
        mod.data = {};
      }
      mutator(mod.data, mod, part);
      count++;
    }
  }
  return count;
}

/**
 * Find a per-mesh rigWarp deformer by its target part id. Returns the
 * inflated deformer-node shape for the rigWarp whose `data.targetPartId`
 * matches, or `null`. The lookup goes through the target part's own
 * stack (rigWarps are leaf modifiers on their target part).
 *
 * @param {object} project
 * @param {string} targetPartId
 * @returns {object|null}
 */
export function findRigWarpForPart(project, targetPartId) {
  if (!project || !Array.isArray(project.nodes)) return null;
  const part = project.nodes.find((n) => n && n.id === targetPartId && n.type === 'part');
  if (!part || !Array.isArray(part.modifiers)) return null;
  for (let i = 0; i < part.modifiers.length; i++) {
    const mod = part.modifiers[i];
    if (!mod || mod.type !== 'warp') continue;
    const data = mod.data;
    if (!data || typeof data !== 'object') continue;
    if (data.targetPartId !== targetPartId) continue;
    return _inflateModifier(mod, part.modifiers, i, MODIFIER_MODE_REALTIME);
  }
  return null;
}
