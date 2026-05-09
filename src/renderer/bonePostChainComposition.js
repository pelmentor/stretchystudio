// @ts-check

/**
 * Bone post-chain composition decision helper.
 *
 * After `chainEval` produces canvas-space art-mesh verts, the renderer
 * has THREE composition paths to apply on top:
 *
 *   1. **Two-bone LBS** (Armature modifier path) — per-vertex weighted
 *      skinning via `applyTwoBoneSkinningObj`. Applies when the part
 *      has an enabled Armature modifier in `node.modifiers[]` AND the
 *      mesh carries `boneWeights` + `jointBoneId`. Mirrors Blender's
 *      `pchan_bone_deform`. This is the per-vertex skinning case
 *      (limb blend zones with variable weights from
 *      `computeSkinWeights`).
 *
 *   2. **Overlay matrix** (rigid-follow path) — uniform world-matrix
 *      multiplication via `applyOverlayMatrixObj`. Applies when the
 *      part has NO Armature modifier and NO vertex groups, but its
 *      nearest ancestor is a bone group. Mirrors Blender's "child of
 *      bone, no Armature modifier" semantics: the mesh follows the
 *      bone via parent-chain transform, no per-vertex variation. The
 *      Cubism analogue: child of `GroupRotation_<bone>` rotation
 *      deformer, but bone-pose rotation isn't carried by the
 *      deformer chain (chainEval reads slider params, not bone
 *      pose), so the renderer applies the bone's world matrix
 *      uniformly post-chainEval.
 *
 *   3. **None** — the part has been Apply-Modified (vertex groups
 *      remain but the modifier is gone — Blender's `Apply` semantics)
 *      OR the part has no bone-group ancestor at all. Either way,
 *      no bone-pose composition runs.
 *
 * # 2026-05-09 (afternoon) — 3-state restored from 2-state
 *
 * Cubism Adapter Phase 2 (commit `3c08290`) collapsed this to 2-state
 * under the assumption that `seedDefaultRigidWeights` would put
 * vertex groups on EVERY meshed part with a bone-group ancestor —
 * folding the rigid-follow case into LBS with all-1.0 weights. That
 * conflated "follows bone" with "is per-vertex skinned" (anti-Blender)
 * and produced three regression bugs in two days. The revert plan
 * (`docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`) restores the
 * Blender-correct split: LBS for true skinning, overlay for rigid
 * follow. The two paths are now deterministically gated by the
 * presence/absence of vertex groups + modifier, so BUG-028's
 * double-composition can't recur.
 *
 * # Why this matters (BUG-028)
 *
 * Pre-2026-05-08 the render loop used a binary if/else: `armatureMod
 * present` → LBS, otherwise → overlay matrix. A part with vertex
 * groups but no modifier (post-Apply) hit the else-branch and
 * applied overlay matrix on top of geometry that already absorbed
 * the bone pose via the LBS-baked rest. The fix gates explicitly
 * on `hasWeights` — overlay only fires when there are NO weights at
 * all. Post-Apply parts (weights present, modifier removed) get
 * `kind: 'none'` (reason `'applied'`); they don't get overlay.
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
 * @typedef {{ kind: 'none', reason: 'applied' | 'unbound' }} CompositionNone
 *
 * @typedef {CompositionLBS|CompositionOverlay|CompositionNone} BoneCompositionDecision
 */

/**
 * Pick which post-chainEval composition to apply for a part. Pure
 * function over `node` + its inflated mesh — no rAF / WebGL dependency
 * so the decision is fully unit-testable.
 *
 * Render-loop callers use the result like:
 *   - `kind: 'lbs'`     → `applyTwoBoneSkinningObj(verts, parent, child, weights)`
 *   - `kind: 'overlay'` → `applyOverlayMatrixObj(verts, boneOverlayMatrix)`
 *   - `kind: 'none'`    → no-op
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
  // No vertex groups. The render-loop caller decides whether to walk
  // the part-tree to find a nearest bone-group ancestor and consult
  // `computeBoneOverlayMatrices` for an overlay matrix. We return
  // `kind: 'overlay'` to signal "look for a bone ancestor"; if there
  // is none, the overlay map will simply not contain this part's id
  // and the caller's `Map.get(id)` returns undefined → no-op overlay.
  // This sidesteps the need to walk the parent chain twice.
  return { kind: 'overlay' };
}
