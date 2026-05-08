// @ts-check

/**
 * Bone post-chain composition decision helper.
 *
 * After `chainEval` produces canvas-space art-mesh verts, the renderer
 * has THREE possible composition paths to apply on top:
 *
 *   1. **Two-bone LBS** (Armature modifier path) — per-vertex weighted
 *      skinning via `applyTwoBoneSkinningObj`. Applies when the part
 *      has an enabled Armature modifier in `node.modifiers[]` AND the
 *      mesh carries `boneWeights` + `jointBoneId`. Mirrors Blender's
 *      `pchan_bone_deform`.
 *
 *   2. **Rigid overlay matrix** (PAROBJECT_BONE path) — applies the
 *      nearest bone-group ancestor's world matrix to every vert via
 *      `applyOverlayMatrixObj`. Used by parts that have NEVER been
 *      bound to the armature (no `boneWeights`). Mirrors Blender's
 *      object-parented-to-bone semantic where the mesh follows the
 *      bone rigidly without any modifier.
 *
 *   3. **None** (post-Apply) — the part has bone weights but no
 *      enabled Armature modifier. This means the user ran "Apply
 *      Modifier" — Blender bakes the deformation into mesh.vertices /
 *      keyforms and removes the modifier; vertex groups stay on the
 *      mesh datablock. The part is decoupled from the armature; bone
 *      gestures don't influence it. Re-bind via "Add Modifier →
 *      Armature" to resume bone-follow.
 *
 * # Why this matters (BUG-028)
 *
 * Pre-2026-05-08 the render loop used a binary if/else: `armatureMod
 * present` → LBS, otherwise → overlay matrix. After Apply Modifier on
 * a bone-weighted part (e.g. handwear), `armatureMod` was null but the
 * else-branch still applied the overlay matrix — rigidly rotating the
 * post-Apply baked keyform geometry by the bone's world matrix. With
 * the bone still posed, this produced a visible double-application
 * ("Apply didn't decouple from armature"). The fix is the third case:
 * has weights AND no modifier → no composition.
 *
 * @module renderer/bonePostChainComposition
 */

/**
 * Modifier mode bitmask — REALTIME bit (per Blender's
 * `DNA_modifier_types.h:131-144` / SS migration `v21_modifier_mode_flags`).
 */
const MODE_REALTIME_BIT = 1;

/**
 * @typedef {{
 *   kind: 'lbs',
 *   jointBoneId: string,
 *   parentBoneId: string|null,
 * }} CompositionLBS
 *
 * @typedef {{ kind: 'overlay' }} CompositionOverlay
 *
 * @typedef {{ kind: 'none', reason: 'applied' | 'no-bone-context' }} CompositionNone
 *
 * @typedef {CompositionLBS|CompositionOverlay|CompositionNone} BoneCompositionDecision
 */

/**
 * Pick which post-chainEval composition to apply for a part. Pure
 * function over `node` + its inflated mesh — no rAF / WebGL dependency
 * so the decision is fully unit-testable.
 *
 * @param {object} node                      — `project.nodes[i]` for the part
 * @param {object|null} partMesh             — resolved mesh datablock (typically `node.mesh`)
 * @returns {BoneCompositionDecision}
 */
export function pickBonePostChainComposition(node, partMesh) {
  const armatureMod = Array.isArray(node?.modifiers)
    ? node.modifiers.find((m) => m
        && m.type === 'armature'
        && m.enabled !== false
        && ((typeof m.mode === 'number' ? m.mode : MODE_REALTIME_BIT | 2) & MODE_REALTIME_BIT) !== 0)
    : null;
  const partBoneId = armatureMod?.data?.jointBoneId
    ?? partMesh?.jointBoneId
    ?? null;
  const partWeights = partMesh?.boneWeights;
  const hasWeights = Array.isArray(partWeights) && partWeights.length > 0;

  if (armatureMod && partBoneId && hasWeights) {
    return {
      kind: 'lbs',
      jointBoneId: partBoneId,
      parentBoneId: armatureMod.data?.parentBoneId ?? null,
    };
  }
  if (hasWeights) {
    // Has vertex groups but no enabled Armature modifier — Apply
    // Modifier was used. Mirrors Blender semantics: vertex groups
    // stay on the mesh, the modifier-removal ends the bone influence.
    return { kind: 'none', reason: 'applied' };
  }
  // No vertex groups — the part has never been bound. Use the
  // PAROBJECT_BONE rigid-follow overlay. The overlay matrix itself is
  // resolved by `boneOverlayMatrix.computeBoneOverlayMatrices`; this
  // function only signals which path to take.
  return { kind: 'overlay' };
}
