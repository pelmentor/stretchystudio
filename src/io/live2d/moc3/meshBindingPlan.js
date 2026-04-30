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

/**
 * @typedef {Object} MeshBindingPlanEntry
 * @property {string} paramId
 * @property {number[]} keys
 * @property {number[]} keyformOpacities
 * @property {Float32Array[] | null} perVertexPositions
 */

/**
 * @param {Object} opts
 * @param {Array} opts.meshParts
 * @param {Array} opts.groups
 * @param {*} opts.rigSpec
 * @param {number[]} opts.bakedKeyformAngles
 * @param {Set<string>} opts.backdropTagsSet
 * @returns {{
 *   meshBindingPlan: MeshBindingPlanEntry[],
 *   meshKeyformBeginIndex: number[],
 *   meshKeyformCount: number[],
 *   totalArtMeshKeyforms: number,
 * }}
 */
export function buildMeshBindingPlan(opts) {
  const { meshParts, groups, rigSpec, bakedKeyformAngles, backdropTagsSet } = opts;

  // Build base.partId → [variantSuffix] map for the base-fade-out branch.
  /** @type {Map<string, string[]>} */
  const variantSuffixesByBasePartId = new Map();
  for (const p of meshParts) {
    if (!p.variantOf) continue;
    const sfx = p.variantSuffix ?? p.variantRole ?? null;
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
        keyformOpacities: BONE_KEYFORM_ANGLES.map(() => part.opacity ?? 1),
        perVertexPositions: perKeyformPositions,
      };
    }
    // Mesh-level eye closure: shared with cmo3writer via rigSpec.eyeClosure.
    const eyeClosureMap = rigSpec?.eyeClosure ?? null;
    const eyeClosure = eyeClosureMap ? eyeClosureMap.get(part.id) : null;
    if (eyeClosure && eyeClosure.closureSide && !part.variantSuffix) {
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
        keyformOpacities: [part.opacity ?? 1, part.opacity ?? 1],
        perVertexPositions: [closedPositions, restPositions],
      };
    }
    // Variant mesh fade-in: opacity 0 at Param<Suffix>=0, recorded at =1.
    const variantSuffix = part.variantSuffix ?? null;
    if (variantSuffix) {
      const pid = variantParamId(variantSuffix);
      if (pid) {
        return {
          paramId: pid,
          keys: [0, 1],
          keyformOpacities: [0, part.opacity ?? 1],
          perVertexPositions: null,
        };
      }
    }
    // Base mesh with paired variant sibling — fade out 1→0 on the
    // variant's param. Backdrop tags skip this (substrate guarantee).
    const tag = matchTag(part.name || part.id);
    const isBackdrop = tag ? backdropTagsSet.has(tag) : false;
    const baseSuffixes = variantSuffixesByBasePartId.get(part.id);
    const baseFadeSuffix = baseSuffixes && baseSuffixes.length > 0 ? baseSuffixes[0] : null;
    if (baseFadeSuffix && !isBackdrop) {
      const pid = variantParamId(baseFadeSuffix);
      if (pid) {
        return {
          paramId: pid,
          keys: [0, 1],
          keyformOpacities: [part.opacity ?? 1, 0],
          perVertexPositions: null,
        };
      }
    }
    // Default: 1 keyform on ParamOpacity[1.0] at recorded opacity.
    return {
      paramId: 'ParamOpacity',
      keys: [1],
      keyformOpacities: [part.opacity ?? 1],
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
