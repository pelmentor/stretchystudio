// @ts-check

/**
 * Bone post-chain composition decision helper.
 *
 * After `chainEval` produces canvas-space art-mesh verts, the renderer
 * has TWO composition paths to apply on top:
 *
 *   1. **Two-bone LBS** (Armature modifier path) — per-vertex weighted
 *      skinning via `applyTwoBoneSkinningObj`. Applies when the part
 *      has an enabled Armature modifier in `node.modifiers[]` AND the
 *      mesh carries `boneWeights` + `jointBoneId`. Mirrors Blender's
 *      `pchan_bone_deform`.
 *
 *   2. **None** (post-Apply / unbound) — the part has bone weights but
 *      no enabled Armature modifier (Blender's Apply Modifier removed
 *      the binding; vertex groups persist on the mesh datablock), OR
 *      the part has no bone-group ancestor at all. Either way, no
 *      bone-pose composition runs.
 *
 * # Cubism Adapter Phase 2 (2026-05-09): no more overlay-matrix branch
 *
 * Pre-Phase-2 a third "rigid overlay matrix" branch existed for parts
 * with no `boneWeights` whose nearest ancestor was a bone group. Phase
 * 1 (`seedDefaultRigidWeights` + v31 migration) ensures every meshed
 * part with a bone-group ancestor has weights, so the overlay branch
 * is unreachable on properly-migrated projects. Removing it collapses
 * the renderer to a single uniform LBS composition path.
 *
 * Pre-Phase-1 projects that haven't been migrated AND haven't been re-
 * Init-Rigged would hit this case — the helper logs a warning so the
 * regression is visible rather than silent. The v31 migration runs
 * `seedDefaultRigidWeights` on load, so this should never fire on a
 * project loaded through the normal pipeline.
 *
 * # Why this matters (BUG-028)
 *
 * Pre-2026-05-08 the render loop used a binary if/else: `armatureMod
 * present` → LBS, otherwise → overlay matrix. After Apply Modifier on
 * a bone-weighted part (e.g. handwear), `armatureMod` was null but the
 * else-branch still applied the overlay matrix — rigidly rotating the
 * post-Apply baked keyform geometry by the bone's world matrix. With
 * the bone still posed, this produced a visible double-application
 * ("Apply didn't decouple from armature"). Phase 1 + Phase 2 together
 * eliminate the bug-class structurally rather than per-case.
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
 * @typedef {{ kind: 'none', reason: 'applied' | 'unbound' | 'pre-migration' }} CompositionNone
 *
 * @typedef {CompositionLBS|CompositionNone} BoneCompositionDecision
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
  // No vertex groups. Post-v31 every meshed part with a bone-group
  // ancestor has weights from `seedDefaultRigidWeights`, so reaching
  // this branch means either:
  //   - The part has no bone-group ancestor (legitimately unbound, e.g.
  //     a UI overlay element). No composition needed.
  //   - The project predates v31 AND hasn't been re-Init-Rigged. The
  //     v31 migration runs `seedDefaultRigidWeights` on load, so this
  //     should not fire in normal flow. Caller may log a warning.
  return { kind: 'none', reason: 'unbound' };
}
