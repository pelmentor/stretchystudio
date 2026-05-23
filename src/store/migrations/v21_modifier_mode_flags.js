// @ts-check

/**
 * v21 — Blender Parity V2 Phase 0.1: modifier mode flags + body-warp fallback.
 *
 * Pre-v21 the modifier records produced by `synthesizeModifierStacks`
 * carried only `{type, deformerId, enabled}` — sufficient for chain
 * walks but missing Blender's `ModifierData.mode` bitmask
 * (`reference/blender/source/blender/makesdna/DNA_modifier_types.h:131-144`).
 * The DepGraph eval kernel (V2 Phase D-3a) needs the mode flags to gate
 * realtime / render / editmode visibility per-modifier; without them,
 * MODE_RENDER-only modifiers (a heavy export-time warp, say) cannot be
 * skipped during viewport tick.
 *
 * v21 also writes a synthetic body-warp modifier into every part that
 * today rides the body-warp chain implicitly — i.e. parts with no
 * `rigParent` and therefore no entry in `Object.modifiers[]`. Today's
 * `chainEval` / `selectRigSpec._buildArtMeshes` falls back to
 * `innermostBodyWarpId` for such parts, but the V2 depgraph kernel
 * iterates `Object.modifiers[]` and would silently drop them.
 * Materialising the body-warp into the modifier list closes that gap
 * before Refactor 1 ships.
 *
 * # Mode bitmask values (mirrored from DNA)
 *
 * `DNA_modifier_types.h:131-144`:
 *   - `MODE_REALTIME = 1 << 0`  → eval in viewport
 *   - `MODE_RENDER   = 1 << 1`  → eval on export
 *   - `MODE_EDITMODE = 1 << 2`  → eval while in edit mode
 *   - `MODE_ONCAGE   = 1 << 3`  → eval when cage display active
 *
 * Default for migrated stacks: `MODE_REALTIME | MODE_RENDER` — modifiers
 * are visible in viewport AND included in export, matching today's
 * always-on behaviour. EDITMODE is intentionally OFF: pre-v21 SS never
 * evaluated the modifier stack while in mesh-edit; honouring that, only
 * Refactor-1 work that explicitly opts in via the new flag will eval
 * during edit.
 *
 * # Idempotency
 *
 * Re-running the migration is safe:
 *   - A modifier that already carries numeric `mode` is left alone.
 *   - The synthetic body-warp insertion is gated on empty
 *     `part.modifiers[]` AND a `synthetic`-marked entry; once inserted,
 *     the stack is non-empty so the gate fails.
 *
 * @module store/migrations/v21_modifier_mode_flags
 */

import {
  isWarpLatticeNode,
  isChainDeformerNode,
  findInnermostBodyWarpId as sharedFindInnermostBodyWarpId,
} from '../warpLatticeAccess.js';

export const MODIFIER_MODE_REALTIME = 1 << 0;
export const MODIFIER_MODE_RENDER   = 1 << 1;
export const MODIFIER_MODE_EDITMODE = 1 << 2;
export const MODIFIER_MODE_ONCAGE   = 1 << 3;

/** Default mode bitmask for v21-migrated modifier records. */
export const DEFAULT_MIGRATED_MODE = MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER;

/**
 * Find the innermost body-warp id (chain leaf) — thin wrapper over the
 * shared helper in `warpLatticeAccess.js`. The shared helper handles
 * BOTH chain-shape eras (`{type:'deformer', deformerKind:'warp'}`
 * pre-v43 + `{type:'object', objectKind:'lattice'}` post-v43) via
 * `isWarpLatticeNode`, so this wrapper works correctly whether the
 * migration is invoked at v21 (pre-v43) or after the lattice substrate
 * flip (e.g., when a test or dev call uses a post-v43 fixture).
 *
 * Pre-M4 follow-on (2026-05-23): the private body-warp-ids-only
 * implementation here had a latent bug — it filtered on
 * `n.type === 'deformer'`, which silently misses post-v43 lattice
 * objects. Re-pointed to the shared helper that the M3.2 +
 * `selectRigSpec._deriveInnermostBodyClosures` already use.
 *
 * @param {object} project
 * @returns {string|null}
 */
export function findInnermostBodyWarpId(project) {
  if (!project || !Array.isArray(project.nodes)) return null;
  const warpNodes = project.nodes.filter(isWarpLatticeNode);
  const allDeformerNodes = project.nodes.filter(isChainDeformerNode);
  return sharedFindInnermostBodyWarpId(warpNodes, allDeformerNodes);
}

/**
 * v21 migration body. Walks every part:
 *   - Existing modifier records get `{mode, enabled, showInEditor}`
 *     extended (idempotent — pre-existing values win).
 *   - Empty `modifiers[]` on a part WITH a non-null
 *     `innermostBodyWarpId` → write a synthetic body-warp modifier.
 *
 * @param {object} project - mutated in place
 * @returns {object} - the same project
 */
export function migrateModifierModeFlags(project) {
  if (!project) return project;
  if (!Array.isArray(project.nodes)) return project;

  const innermost = findInnermostBodyWarpId(project);

  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    const stack = Array.isArray(part.modifiers) ? part.modifiers : null;
    if (stack && stack.length > 0) {
      for (const mod of stack) {
        if (!mod || typeof mod !== 'object') continue;
        if (typeof mod.mode !== 'number') mod.mode = DEFAULT_MIGRATED_MODE;
        if (typeof mod.enabled !== 'boolean') mod.enabled = true;
        if (typeof mod.showInEditor !== 'boolean') mod.showInEditor = true;
      }
      continue;
    }
    if (innermost) {
      part.modifiers = [{
        type: 'warp',
        deformerId: innermost,
        enabled: true,
        mode: DEFAULT_MIGRATED_MODE,
        showInEditor: true,
        synthetic: true,
      }];
    }
  }

  return project;
}
