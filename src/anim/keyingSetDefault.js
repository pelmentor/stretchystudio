// @ts-check

/**
 * Animation Phase 7 Slice 7.C - default keying-set picker.
 *
 * Pure helper that decides which built-in keying set the I-key menu
 * should highlight given the current edit-mode + selection. Plan
 * §7.C specifies:
 *
 *   "Default visible set: pick the first applicable from the active
 *    object type (Object → LocRotScale; Bone → Rotation; Mesh in
 *    BlendShape mode → BlendShape; etc.)."
 *
 * Returns the BUILTIN id (one of {@link BUILTIN_KEYING_SET_IDS}) or
 * `null` when no built-in is applicable (e.g. empty selection +
 * non-BlendShape mode -- caller falls back to a sensible default).
 *
 * Mode-detection rules (mirror SS edit-mode state, not Blender's
 * mode enum -- the SS mode lattice was collapsed in BVR-008):
 *
 *   1. `activeBlendShapeId` set on a meshed part           → BlendShape
 *   2. selection's last item is a bone-role group           → Rotation
 *   3. selection's last item is a meshed part (no shapes)   → LocRotScale
 *   4. selection's last item is a meshed part w/ shapes     → LocRotScale
 *      (BlendShape only the active-shape branch, per rule 1)
 *   5. selection is empty                                   → null
 *
 * Rule №2 -- the picker reads project + selection + editor state but
 * NEVER writes. Active-keying-set storage is touched by 7.E only.
 *
 * Test coverage: `scripts/test/test_keyingSetMenu.mjs` §1 enumerates
 * every branch including degenerate inputs.
 *
 * Blender mirror: `_keyingsets_utils.py:42-67` is the closest analog,
 * but Blender's "default set" is the user's `scene.active_keyingset`
 * preference rather than a selection-derived suggestion. SS adds the
 * selection-aware picker because SS users haven't built keying-set
 * muscle memory yet and the menu serves as the discovery surface.
 *
 * @module anim/keyingSetDefault
 */

import { isBoneGroup } from '../store/objectDataAccess.js';

/**
 * Pick the default-highlighted built-in keying-set id for the I-menu.
 *
 * @param {Object} ctx
 * @param {object|null|undefined} ctx.project        -- project draft / snapshot
 * @param {string[]|null|undefined} ctx.selection    -- array of selected node ids
 * @param {string|null|undefined} [ctx.editMode]     -- editorStore.editMode (null/'edit'/'pose'/'weightPaint')
 * @param {string|null|undefined} [ctx.activeBlendShapeId] -- when set, BlendShape wins
 * @returns {string|null}
 */
export function pickDefaultKeyingSet(ctx) {
  if (!ctx || !ctx.project) return null;
  const { project, selection, activeBlendShapeId } = ctx;
  const ids = Array.isArray(selection) ? selection : [];

  // Rule 1 -- BlendShape mode wins outright. The active shape's owner
  // part must exist in the project and own the shape (a stale
  // activeBlendShapeId without a matching part falls through to the
  // selection-based rules).
  if (activeBlendShapeId && Array.isArray(project.nodes)) {
    const owner = project.nodes.find((n) => {
      if (!n || n.type !== 'part' || !Array.isArray(n.blendShapes)) return false;
      return n.blendShapes.some((s) => s?.id === activeBlendShapeId);
    });
    if (owner) return 'BlendShape';
  }

  if (ids.length === 0) return null;

  // Walk LAST→FIRST -- the "active" item in SS is the most-recently
  // added selection entry (Blender's last-clicked semantic).
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const node = nodes.find((n) => n?.id === ids[i]);
    if (!node) continue;
    if (isBoneGroup(node)) return 'Rotation';
    if (node.type === 'part') return 'LocRotScale';
    // Non-bone groups + other node types fall through to next selected.
  }
  return null;
}
