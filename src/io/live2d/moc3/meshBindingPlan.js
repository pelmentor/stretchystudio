// @ts-check

/**
 * Per-mesh keyform branch resolver for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #35).
 *
 * Mirrors cmo3writer's per-mesh keyform branches (cmo3writer Section 2 +
 * Section 4, around the per-mesh emission loops). Order of checks matches
 * cmo3writer:
 *
 *   1. **Bone-baked** — 5 keyforms on `ParamRotation_<bone>` (arms/legs).
 *      Each angle in `bakedKeyformAngles` produces a rotated vertex array
 *      via the weighted blend `vertex * (1 - w) + rotated * w` against
 *      the bone group's pivot. Same math as cmo3 baked-keyform emission.
 *
 *   2. **Mesh-level eye closure** — 2 keyforms on `ParamEye{L,R}Open`
 *      with closed-eye vertex positions at key=0 and rest at key=1.
 *      Source: `rigSpec.eyeClosure` Map (populated by cmo3writer's
 *      eyewhite parabola fit + lash-strip compression). Skipped for
 *      variant siblings (variants get their own fade branch instead).
 *
 *   3. **Variant fade-in** — 2 keyforms on `Param<Suffix>`, opacity
 *      0 → recorded.
 *
 *   4. **Base fade-out** — 2 keyforms on the variant sibling's param,
 *      opacity recorded → 0. Skipped for backdrop tags (face, ears,
 *      hair) which must stay at opacity=1 always (substrate for the
 *      variant overlay; without this skip the eye area would go
 *      translucent at midpoint).
 *
 *   5. **Default** — 1 keyform on `ParamOpacity[1.0]`. Cubism's "rest
 *      only" single-CFormGuid pattern.
 *
 * Verified by binary diff against cubism native export of shelby.cmo3:
 *   - ArtMesh10 (face = backdrop)            → 1 kf, ParamOpacity[1]
 *   - ArtMesh9  (face_smile = variant)       → 2 kf, ParamSmile[0,1]
 *   - ArtMesh18 (arm = bone-baked)           → 5 kf, ParamRotation_*Elbow
 *
 * Also returns the flatten metadata (`meshKeyformBeginIndex`,
 * `meshKeyformCount`, `totalArtMeshKeyforms`) consumed by
 * `art_mesh.keyform_begin_indices/_counts`.
 *
 * @module io/live2d/moc3/meshBindingPlan
 */

import { variantParamId } from '../../psdOrganizer.js';
import { matchTag } from '../../armatureOrganizer.js';
import { sanitisePartName } from '../../../lib/partId.js';
import { buildVariantProductGridCorners, buildEyeCompoundBaseGridCorners } from '../rig/variantFadeGrid.js';

/**
 * @typedef {Object} MeshBindingPlanEntry
 * @property {string} paramId - back-compat first-binding mirror for callers
 *   that haven't moved to `bindings`
 * @property {number[]} keys - back-compat first-binding mirror
 * @property {number[]} keyformOpacities
 * @property {Float32Array[] | null} perVertexPositions
 * @property {Array<{paramId: string, keys: number[]}>} [bindings] -
 *   present when the mesh needs MULTI-PARAM keyforms (e.g. compound eye
 *   closure × variant). Keyforms are stored in row-major over bindings,
 *   first-binding-varies-fastest, same convention as cmo3
 *   keyformsOnGrid. When absent, callers treat the plan as a 1D binding
 *   `[{paramId, keys}]`.
 */

/**
 * @param {Object} opts
 * @param {Array} opts.meshParts
 * @param {Array} opts.groups
 * @param {*} opts.rigSpec
 * @param {number[]} opts.bakedKeyformAngles
 * @param {Set<string>} opts.backdropTagsSet
 * @param {object} [opts.project]
 *   The full project (for `extractMeshExportStruct` — needs `byId` index
 *   to resolve the part's structural-parent bone for the rigid-intent
 *   guard). When omitted, the bone-baked branch reads `mesh.boneWeights`
 *   raw — used only by tests that don't carry a project.
 * @returns {{
 *   meshBindingPlan: MeshBindingPlanEntry[],
 *   meshKeyformBeginIndex: number[],
 *   meshKeyformCount: number[],
 *   totalArtMeshKeyforms: number,
 * }}
 */
export function buildMeshBindingPlan(opts) {
  const { meshParts, groups, rigSpec, bakedKeyformAngles, backdropTagsSet } = opts;
  // 2026-05-09 (afternoon): Cubism Adapter strip removed when the
  // adapter pattern was reverted toward Blender parity (see
  // `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`). Post-revert
  // rigid-follow parts have NO vertex groups (the v32 migration
  // strips contamination from any v31 saves), so reaching the bone-
  // baked branch below means the part has truly skinned weights or
  // bone-routing intent — both legitimately require 5 baked keyforms.

  // Build base.partId → [variantSuffix] map for the base-fade-out branch.
  /** @type {Map<string, string[]>} */
  const variantSuffixesByBasePartId = new Map();
  for (const p of meshParts) {
    if (!p.variantOf) continue;
    const sfx = p.variantSuffix ?? null;
    if (!sfx) continue;
    const list = variantSuffixesByBasePartId.get(p.variantOf) ?? [];
    if (!list.includes(sfx)) list.push(sfx);
    variantSuffixesByBasePartId.set(p.variantOf, list);
  }

  const BONE_KEYFORM_ANGLES = bakedKeyformAngles;
  /** @type {MeshBindingPlanEntry[]} */
  const meshBindingPlan = meshParts.map(part => {
    const mesh = part.mesh;
    const boneWeights = mesh?.boneWeights ?? null;
    const jointBoneId = mesh?.jointBoneId ?? null;
    // Keyform opacity values are hardcoded per branch to match cmo3 emit
    // (artMeshSourceEmit.js — bone-baked / eye-closure / default all emit
    // opacity 1.0; variant fade-in emits 0→1; base fade-out emits 1→0).
    // Reading `part.opacity` here would break the variant fade ramp: v49
    // sets `variant.opacity = 0` as a runtime-rest marker (so depgraph
    // blends correctly at slider=0), but the FADE ENDPOINT at slider=1
    // must be 1.0 — same authored peak as cmo3 ships.
    if (boneWeights && jointBoneId) {
      // Bone-baked keyforms.
      const boneGroup = groups.find(g => g.id === jointBoneId);
      const sanitizedBoneName = sanitisePartName(boneGroup?.name ?? jointBoneId);
      const pivotX = boneGroup?.transform?.pivotX ?? 0;
      const pivotY = boneGroup?.transform?.pivotY ?? 0;
      const verts = mesh.vertices;
      const perKeyformPositions = BONE_KEYFORM_ANGLES.map(angleDeg => {
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const out = new Float32Array(verts.length * 2);
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i];
          const w = boneWeights[i] ?? 0;
          const dx = v.x - pivotX;
          const dy = v.y - pivotY;
          const rx = pivotX + dx * cos - dy * sin;
          const ry = pivotY + dx * sin + dy * cos;
          out[i * 2]     = v.x * (1 - w) + rx * w;
          out[i * 2 + 1] = v.y * (1 - w) + ry * w;
        }
        return out;
      });
      return {
        paramId: `ParamRotation_${sanitizedBoneName}`,
        keys: BONE_KEYFORM_ANGLES.slice(),
        keyformOpacities: BONE_KEYFORM_ANGLES.map(() => 1),
        perVertexPositions: perKeyformPositions,
      };
    }
    // Tag + variant pairing (used by closure / variant / base-fade
    // branches below). Hoisted so the COMPOUND branch can inspect them
    // without duplicating the lookups.
    const tag = matchTag(part.name || part.id);
    const isBackdrop = tag ? backdropTagsSet.has(tag) : false;
    const variantSuffix = part.variantSuffix ?? null;
    const baseSuffixes = variantSuffixesByBasePartId.get(part.id);
    const baseFadeSuffix = baseSuffixes && baseSuffixes.length > 0 ? baseSuffixes[0] : null;

    // Mesh-level eye closure: shared with cmo3writer via rigSpec.eyeClosure.
    const eyeClosureMap = rigSpec?.eyeClosure ?? null;
    const eyeClosure = eyeClosureMap ? eyeClosureMap.get(part.id) : null;

    // ── COMPOUND 2D: eye closure × variant ───────────────────────────────
    // Eye part that ALSO participates in a variant axis (either IS a
    // variant, or is a base with a paired variant sibling AND non-
    // backdrop tag) emits a 4-keyform grid bound to BOTH ParamEye{L,R}
    // Open and Param<Suffix>. Mirrors the cmo3 emit's `hasEyeVariantCompound`
    // branch (artMeshSourceEmit.js + meshLayerKeyform.js): first
    // binding (closure) varies fastest in row-major keyform order.
    //
    // Without this branch, the legacy code-path returned the closure-only
    // plan for the BASE eye (keyformOpacities=[1,1]) and the variant-fade
    // plan for the VARIANT eye (no closure). Net effect in Cubism Viewer:
    // at ParamSmile=1 both sets fully visible → overlay. Reported by user
    // ("In cubism viewer when I set smile = 1, the main eye layers are
    // still VISIBLE"). Compound branch fixes both: base alpha goes to 0
    // at variant=1 AND variant still blinks via its own closed verts.
    if (eyeClosure && eyeClosure.closureSide) {
      const closureParam = eyeClosure.closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';
      const verts = mesh.vertices;
      const restPositions = new Float32Array(verts.length * 2);
      const closedPositions = new Float32Array(verts.length * 2);
      const closedCanvas = eyeClosure.closedCanvasVerts;
      for (let i = 0; i < verts.length; i++) {
        restPositions[i * 2]     = verts[i].x;
        restPositions[i * 2 + 1] = verts[i].y;
        closedPositions[i * 2]     = closedCanvas[i * 2];
        closedPositions[i * 2 + 1] = closedCanvas[i * 2 + 1];
      }
      if (variantSuffix) {
        // VARIANT eye: 2D (closure × ownSuffix). αN=0 (hidden at variant=0),
        // αV=1 (visible at variant=1). Row-major, closure fastest. Unchanged.
        const variantParam = variantParamId(variantSuffix);
        if (variantParam) {
          return {
            bindings: [
              { paramId: closureParam, keys: [0, 1] },
              { paramId: variantParam, keys: [0, 1] },
            ],
            paramId: closureParam,
            keys: [0, 1],
            keyformOpacities: [0, 0, 1, 1],
            perVertexPositions: [
              closedPositions, restPositions,
              closedPositions, restPositions,
            ],
          };
        }
      } else if (!isBackdrop && baseSuffixes && baseSuffixes.length > 0) {
        // BASE eye: (closure × N-variant) product grid. Geometry varies on
        // closure only; opacity = ∏(1 - Param<Suffix>), so the base hides for
        // EVERY paired variant — not just baseSuffixes[0] (the pre-fix bug
        // that left 2nd+ variants overlaying the base eye in Cubism). N=1 ⇒
        // legacy 4-corner 2D. See `feedback_variant_base_fade_multi_suffix`.
        const fadeSuffixes = baseSuffixes.filter((s) => !!variantParamId(s));
        if (fadeSuffixes.length > 0) {
          const corners = buildEyeCompoundBaseGridCorners(fadeSuffixes.length);
          return {
            bindings: [
              { paramId: closureParam, keys: [0, 1] },
              ...fadeSuffixes.map((s) => ({ paramId: variantParamId(s), keys: [0, 1] })),
            ],
            paramId: closureParam,
            keys: [0, 1],
            keyformOpacities: corners.map((c) => c.opacity),
            perVertexPositions: corners.map((c) =>
              c.geometry === 'closed' ? closedPositions : restPositions),
          };
        }
      }
    }

    // Standalone closure (no variant pairing, or variant pairing missing
    // the suffix's param def): 2 keyforms on ParamEye{L,R}Open with
    // closed verts at key=0 and rest verts at key=1.
    if (eyeClosure && eyeClosure.closureSide && !variantSuffix) {
      const closureParam = eyeClosure.closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';
      const verts = mesh.vertices;
      const restPositions = new Float32Array(verts.length * 2);
      const closedPositions = new Float32Array(verts.length * 2);
      const closedCanvas = eyeClosure.closedCanvasVerts;
      for (let i = 0; i < verts.length; i++) {
        restPositions[i * 2]     = verts[i].x;
        restPositions[i * 2 + 1] = verts[i].y;
        closedPositions[i * 2]     = closedCanvas[i * 2];
        closedPositions[i * 2 + 1] = closedCanvas[i * 2 + 1];
      }
      return {
        paramId: closureParam,
        keys: [0, 1],
        keyformOpacities: [1, 1],
        perVertexPositions: [closedPositions, restPositions],
      };
    }
    // Variant mesh fade-in (variant without closure data): opacity 0 at
    // Param<Suffix>=0, 1 at =1. The runtime rest opacity (v49 sets
    // variant.opacity=0 to make it invisible at slider=0) is recreated
    // by THIS keyform plan at runtime — not by leaking part.opacity
    // into the peak.
    if (variantSuffix) {
      const pid = variantParamId(variantSuffix);
      if (pid) {
        return {
          paramId: pid,
          keys: [0, 1],
          keyformOpacities: [0, 1],
          perVertexPositions: null,
        };
      }
    }
    // Base mesh with one or more paired variant siblings but no closure
    // data — fade out on ALL of them via an N-D product grid (opacity 1
    // only when every Param<Suffix>=0). Multilinear interp gives
    // opacity = ∏(1 - Param<Suffix>), so the base hides whenever ANY
    // variant is active — not just the first (the pre-fix `[0]` bug that
    // left 2nd+ variants overlaying the base in Cubism). Backdrop tags
    // skip this (substrate guarantee). N=1 ⇒ legacy [1,0] 1-D fade.
    // See `feedback_variant_base_fade_multi_suffix`.
    if (baseSuffixes && baseSuffixes.length > 0 && !isBackdrop) {
      const fadeSuffixes = baseSuffixes.filter((s) => !!variantParamId(s));
      if (fadeSuffixes.length > 0) {
        const corners = buildVariantProductGridCorners(fadeSuffixes.length);
        return {
          bindings: fadeSuffixes.map((s) => ({ paramId: variantParamId(s), keys: [0, 1] })),
          paramId: variantParamId(fadeSuffixes[0]), // back-compat first-binding mirror
          keys: [0, 1],
          keyformOpacities: corners.map((c) => c.opacity),
          perVertexPositions: null,
        };
      }
    }
    // Default: 1 keyform on ParamOpacity[1.0].
    return {
      paramId: 'ParamOpacity',
      keys: [1],
      keyformOpacities: [1],
      perVertexPositions: null,
    };
  });

  // Flatten per-mesh keyform offsets (consumed by
  // art_mesh.keyform_begin_indices / _counts).
  let totalArtMeshKeyforms = 0;
  const meshKeyformBeginIndex = [];
  const meshKeyformCount = [];
  for (const plan of meshBindingPlan) {
    meshKeyformBeginIndex.push(totalArtMeshKeyforms);
    meshKeyformCount.push(plan.keyformOpacities.length);
    totalArtMeshKeyforms += plan.keyformOpacities.length;
  }

  return { meshBindingPlan, meshKeyformBeginIndex, meshKeyformCount, totalArtMeshKeyforms };
}
