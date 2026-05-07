// @ts-check

/**
 * v28 — BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.A.
 *
 * Folds deformer-node state INTO `Object.modifiers[i].data`.
 *
 * Pre-v28:
 *   - `node.type === 'deformer'` entries in `project.nodes[]` carry
 *     all the deformer state: `keyforms[], bindings[], gridSize,
 *     baseGrid, baseAngle, ...`.
 *   - `Object.modifiers[i]` only carries `{type, deformerId, enabled,
 *     mode, showInEditor}` — a parent-chain INDEX, no data.
 *
 * Post-v28:
 *   - Each `Object.modifiers[i]` gains a `.data` sub-object copying
 *     the deformer node's state. The deformer node itself stays for
 *     backward-compat (Phase 3.A is a scaffold; Phase 3.C deletes
 *     the nodes after Phase 3.B switches the export pipeline).
 *
 * The fold is **idempotent**: re-running on already-migrated data is
 * a no-op (existing `modifier.data` is overwritten with the current
 * deformer-node state, which is identical when the data hasn't drifted
 * — and during the dual-write window we WANT them to stay in sync, so
 * even drifted data gets re-anchored to the deformer-node truth).
 *
 * Idempotence on a clean v28 project where deformer nodes have already
 * been deleted (Phase 3.C state): the lookup returns null and the
 * existing `modifier.data` is preserved (we don't clobber with an
 * empty fallback).
 *
 * @module store/migrations/v28_modifier_data_fold
 */

/** Fields copied from `node.type === 'deformer'` entries into
 *  `modifier.data`. The list mirrors what `selectRigSpec.js` reads via
 *  `_warpNodeToSpec` / `_rotationNodeToSpec` plus the UI-visible state
 *  the Properties panel reads (`isVisible`, `isLocked`, `_userAuthored`). */
const COPIED_WARP_FIELDS = /** @type {const} */ ([
  'name', 'visible', 'gridSize', 'baseGrid', 'localFrame',
  'bindings', 'keyforms',
  'isLocked', 'isQuadTransform',
  'targetPartId', 'canvasBbox',
  '_userAuthored',
]);

const COPIED_ROTATION_FIELDS = /** @type {const} */ ([
  'name', 'visible',
  'bindings', 'keyforms',
  'baseAngle', 'handleLengthOnCanvas', 'circleRadiusOnCanvas',
  'isLocked', 'useBoneUiTestImpl',
  '_userAuthored',
]);

/**
 * @param {object} project
 */
export function migrateModifierDataFold(project) {
  if (!project || !Array.isArray(project.nodes)) return;

  const deformerById = new Map();
  for (const n of project.nodes) {
    if (n && n.type === 'deformer' && typeof n.id === 'string') {
      deformerById.set(n.id, n);
    }
  }

  for (const node of project.nodes) {
    if (!node) continue;
    if (!Array.isArray(node.modifiers)) continue;
    for (const mod of node.modifiers) {
      if (!mod || typeof mod.deformerId !== 'string') continue;
      const def = deformerById.get(mod.deformerId);
      if (!def) {
        // Phase 3.C state: deformer node already deleted. Preserve
        // any pre-existing `mod.data` and skip.
        if (!mod.data) {
          // No source AND no existing data — leave `data` undefined so
          // a subsequent re-migration after re-syntheses can populate it.
        }
        continue;
      }
      const data = {};
      const fields = def.deformerKind === 'rotation'
        ? COPIED_ROTATION_FIELDS : COPIED_WARP_FIELDS;
      for (const key of fields) {
        if (key in def) {
          data[key] = def[key];
        }
      }
      mod.data = data;
    }
  }
}
