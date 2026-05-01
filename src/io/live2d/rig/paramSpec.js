/**
 * Parameter specification builder — single source of truth for the parameter
 * list across all Live2D writers (.cmo3, .moc3, .cdi3.json).
 *
 * Replaces the inline parameter generation that used to live in cmo3writer,
 * and the empty `project.parameters ?? []` fallback in moc3writer. Both
 * writers now derive their parameter list from the same builder, so the
 * rig is consistent regardless of the export target.
 *
 * The builder is data-only — it does NOT emit XML or binary. Callers are
 * responsible for translating the spec into their target format.
 *
 * @module io/live2d/rig/paramSpec
 */
import { variantParamId } from '../../psdOrganizer.js';
import { sanitisePartName } from '../../../lib/partId.js';

/**
 * @typedef {Object} ParamSpec
 * @property {string} id              - Live2D parameter id (e.g. "ParamAngleX")
 * @property {string} name            - Display name
 * @property {number} min             - Minimum value
 * @property {number} max             - Maximum value
 * @property {number} default         - Default value (a.k.a. "rest")
 * @property {number} decimalPlaces   - Editor display precision (1 or 3)
 * @property {boolean} repeat         - Whether the parameter wraps (default false)
 * @property {('opacity'|'project'|'variant'|'standard'|'bone')} role
 *   Where the param came from. Lets writers attach role-specific behaviour
 *   (e.g. cmo3writer puts 'bone' params under a separate parameter sub-group).
 * @property {string} [boneId]        - For role==='bone': the source group/bone id
 * @property {string} [variantSuffix] - For role==='variant': the source suffix
 */

/**
 * Standard Live2D parameter ids that face-tracking apps (VTube Studio,
 * FaceForge, Cubism Viewer demo motions) recognize. Emitted only when
 * `generateRig: true` — matches the cmo3 auto-rig behaviour.
 *
 * Each entry may carry `requireTag`: a tag that some mesh in the project
 * must have for the param to be emitted. Same gating pattern as physics
 * rules (`cmo3/physics.js`). Without this, a character without (say) a
 * skirt mesh still got `ParamSkirt` registered, polluting the parameter
 * panel with dial positions that drive nothing — see the user report
 * "ParamSkirt without a skirt layer in shelby" (2026-04-30).
 *
 * Core face/body params (Angle, BodyAngle, Eye, Brow, Mouth, Breath,
 * EyeBall) are unconditional — every character has eyes/brows/mouth.
 * Hair/clothing/bust accessories are gated.
 *
 * Source: cmo3writer.js (was inline at lines 240-269 before this refactor).
 */
const STANDARD_PARAMS = [
  { id: 'ParamAngleX',     name: 'Angle X',       min: -30, max: 30, def: 0 },
  { id: 'ParamAngleY',     name: 'Angle Y',       min: -30, max: 30, def: 0 },
  { id: 'ParamAngleZ',     name: 'Angle Z',       min: -30, max: 30, def: 0 },
  { id: 'ParamBodyAngleX', name: 'Body Angle X',  min: -10, max: 10, def: 0 },
  { id: 'ParamBodyAngleY', name: 'Body Angle Y',  min: -10, max: 10, def: 0 },
  { id: 'ParamBodyAngleZ', name: 'Body Angle Z',  min: -10, max: 10, def: 0 },
  { id: 'ParamBreath',     name: 'Breath',        min: 0,   max: 1,  def: 0 },
  { id: 'ParamEyeLOpen',   name: 'Eye L Open',    min: 0,   max: 1,  def: 1 },
  { id: 'ParamEyeROpen',   name: 'Eye R Open',    min: 0,   max: 1,  def: 1 },
  { id: 'ParamEyeBallX',   name: 'Eyeball X',     min: -1,  max: 1,  def: 0 },
  { id: 'ParamEyeBallY',   name: 'Eyeball Y',     min: -1,  max: 1,  def: 0 },
  { id: 'ParamBrowLY',     name: 'Brow L Y',      min: -1,  max: 1,  def: 0 },
  { id: 'ParamBrowRY',     name: 'Brow R Y',      min: -1,  max: 1,  def: 0 },
  { id: 'ParamMouthForm',  name: 'Mouth Form',    min: -1,  max: 1,  def: 0 },
  { id: 'ParamMouthOpenY', name: 'Mouth Open',    min: 0,   max: 1,  def: 0 },
  { id: 'ParamHairFront',  name: 'Hair Front',    min: -1,  max: 1,  def: 0, requireTag: 'front hair' },
  { id: 'ParamHairBack',   name: 'Hair Back',     min: -1,  max: 1,  def: 0, requireTag: 'back hair'  },
  { id: 'ParamSkirt',      name: 'Skirt',         min: -1,  max: 1,  def: 0, requireTag: 'bottomwear' },
  { id: 'ParamShirt',      name: 'Shirt',         min: -1,  max: 1,  def: 0, requireTag: 'topwear'    },
  { id: 'ParamPants',      name: 'Pants',         min: -1,  max: 1,  def: 0, requireTag: 'legwear'    },
  { id: 'ParamBust',       name: 'Bust',          min: -1,  max: 1,  def: 0, requireTag: 'topwear'    },
  // ParamHairSide intentionally removed — declared in pre-refactor cmo3writer
  // but no warp binding or physics rule ever consumed it, so it surfaced as a
  // dead dial in the Parameters panel.
];

/**
 * Bone rotation params (`ParamRotation_<boneName>`) cover the angle range
 * specified by `project.boneConfig.bakedKeyformAngles` (Stage 7). Default
 * is `[-90, -45, 0, 45, 90]` — exported for back-compat callers that
 * don't pass boneConfig yet.
 */
export const BAKED_BONE_ANGLES = [-90, -45, 0, 45, 90];

/**
 * @typedef {Object} BuildParamSpecInput
 * @property {ParamSpec[]} [baseParameters]
 *   Parameters loaded from a saved project file (`project.parameters`).
 *   Two modes:
 *     - Empty array: today's generator path. The builder synthesizes
 *       opacity + variants + (when `generateRig`) standard 22 + bone +
 *       group rotation params from `meshes`/`groups`.
 *     - Non-empty array: native rig path. The builder treats the entries
 *       as the canonical spec — no synthesis. Order is preserved as-is.
 *       ParamOpacity is prepended if missing; otherwise the array is
 *       authoritative.
 *   Items with a partial shape (no `role`, no `decimalPlaces`) are still
 *   accepted in the empty-array fallback — defaults are filled.
 * @property {Array<{variantSuffix?:string|null, variantRole?:string|null, jointBoneId?:string|null, boneWeights?:any}>} [meshes]
 *   Visible art meshes from the project. Used to discover variant suffixes (smile/sad/...) and
 *   bone-driven meshes that need a `ParamRotation_<bone>`. Ignored on the native rig path.
 * @property {Array<{id:string, name?:string}>} [groups]
 *   Group/part nodes — used to look up display names for bone params. Ignored on the native rig path.
 * @property {boolean} [generateRig=false]
 *   When true, emit the 22 SDK-standard params (ParamAngleX/Y/Z, ParamEyeL/ROpen, ...).
 *   Only applies on the generator path; the native rig path returns
 *   baseParameters verbatim regardless.
 * @property {number[]} [bakedKeyformAngles]
 *   Stage 7 — bone-rotation param min/max range (and writer's baked
 *   keyform stops). Default `BAKED_BONE_ANGLES = [-90, -45, 0, 45, 90]`.
 * @property {Object} [rotationDeformerConfig]
 *   Stage 8 — paramAngleRange + groupRotation/faceRotation paramKeys
 *   passed through to the writer's deformer emission. Builder reads
 *   only `.paramAngleRange.{min,max}` for the group-rotation param spec.
 */

/**
 * The ParamOpacity entry is always emitted at index 0. Mesh keyform
 * bindings reference it.
 */
const PARAM_OPACITY = Object.freeze({
  id: 'ParamOpacity',
  name: 'Opacity',
  min: 0, max: 1, default: 1, decimalPlaces: 1, repeat: false,
  role: 'opacity',
});

/**
 * Normalise a parameter loaded from `project.parameters` into a full
 * ParamSpec. Fills sensible defaults for fields that may be absent on
 * legacy partial-shape entries.
 */
function normaliseStoredParameter(p) {
  const out = {
    id: p.id,
    name: p.name ?? p.id,
    min: p.min ?? 0,
    max: p.max ?? 1,
    default: p.default ?? 0,
    decimalPlaces: p.decimalPlaces ?? 3,
    repeat: p.repeat ?? false,
    role: p.role ?? 'project',
  };
  if (p.boneId) out.boneId = p.boneId;
  if (p.variantSuffix) out.variantSuffix = p.variantSuffix;
  if (p.groupId) out.groupId = p.groupId;
  return out;
}

/**
 * Build the canonical parameter list for a project.
 *
 * @param {BuildParamSpecInput} input
 * @returns {ParamSpec[]} Ordered list of parameter specs.
 *
 *   Generator path (baseParameters empty):
 *     1. ParamOpacity (always)
 *     2. Variant params (one per used suffix)
 *     3. Standard Live2D params (when generateRig)
 *     4. Bone rotation params (one per jointBoneId)
 *     5. Group rotation params (when generateRig)
 *
 *   Native rig path (baseParameters non-empty):
 *     1. ParamOpacity (prepended if not in baseParameters)
 *     2. baseParameters in their stored order, normalised
 *
 *   The list is deduplicated by `id` — later entries with a duplicate id are skipped.
 */
export function buildParameterSpec(input = {}) {
  const {
    baseParameters = [],
    meshes = [],
    groups = [],
    generateRig = false,
    bakedKeyformAngles = BAKED_BONE_ANGLES,
    // Stage 8: rotation deformer config (skipRotationRoles + paramAngleRange).
    // When absent, falls back to today's hardcoded constants.
    rotationDeformerConfig = null,
  } = input;

  // Resolve Stage 8 constants used in the group-rotation pass below.
  const _SKIP_ROT_ROLES = (rotationDeformerConfig
    && Array.isArray(rotationDeformerConfig.skipRotationRoles))
    ? rotationDeformerConfig.skipRotationRoles
    : ['torso', 'eyes', 'neck'];
  const _ROT_PARAM_MIN = Number.isFinite(rotationDeformerConfig?.paramAngleRange?.min)
    ? rotationDeformerConfig.paramAngleRange.min : -30;
  const _ROT_PARAM_MAX = Number.isFinite(rotationDeformerConfig?.paramAngleRange?.max)
    ? rotationDeformerConfig.paramAngleRange.max : 30;

  /** @type {ParamSpec[]} */
  const out = [];
  const seen = new Set();
  const push = (spec) => {
    if (!spec.id || seen.has(spec.id)) return;
    seen.add(spec.id);
    out.push(spec);
  };

  // Native rig path: baseParameters is authoritative. Skip all synthesis.
  // This is the post-Stage-1 path — `seedParameters()` populated the
  // project's parameter list once, so we just emit it verbatim.
  if (baseParameters.length > 0) {
    push({ ...PARAM_OPACITY });
    for (const p of baseParameters) {
      if (!p?.id) continue;
      push(normaliseStoredParameter(p));
    }
    return out;
  }

  // Generator path: synthesise from PSD tags + heuristics.
  push({ ...PARAM_OPACITY });

  // 3. Variant params — one per `.suffix` actually used by a mesh.
  // Variant base/overlay meshes pair on shared tag (see variantNormalizer).
  // A used suffix `.smile` → ParamSmile (default 0, 0..1, decimal 1).
  const usedVariantSuffixes = new Set();
  for (const m of meshes) {
    const suffix = m?.variantSuffix ?? m?.variantRole;
    if (suffix) usedVariantSuffixes.add(suffix);
  }
  for (const suffix of usedVariantSuffixes) {
    const id = variantParamId(suffix);
    if (!id) continue;
    push({
      id,
      name: suffix.charAt(0).toUpperCase() + suffix.slice(1),
      min: 0, max: 1, default: 0, decimalPlaces: 1, repeat: false,
      role: 'variant',
      variantSuffix: suffix,
    });
  }

  // 4. Standard Live2D params (only with generateRig).
  // Per-param `requireTag` gating skips accessory params (hair, skirt,
  // shirt, pants, bust) when no mesh in the project carries the source
  // tag — same gating pattern physics rules already use (see
  // `cmo3/physics.js`). Core face/body params (Angle, Eye, Brow, etc.)
  // have no `requireTag` so they always emit.
  if (generateRig) {
    const tagsPresent = new Set();
    for (const m of meshes) {
      if (m?.tag) tagsPresent.add(m.tag);
    }
    for (const sp of STANDARD_PARAMS) {
      if (sp.requireTag && !tagsPresent.has(sp.requireTag)) continue;
      push({
        id: sp.id, name: sp.name,
        min: sp.min, max: sp.max, default: sp.def,
        decimalPlaces: 1, repeat: false,
        role: 'standard',
      });
    }
  }

  // 5. Bone rotation params — needed by baked-keyform meshes (arms, etc).
  // Keyed by jointBoneId so a mesh weighted to multiple bones doesn't double up.
  const seenBones = new Set();
  for (const m of meshes) {
    if (!m?.jointBoneId || !m?.boneWeights || seenBones.has(m.jointBoneId)) continue;
    seenBones.add(m.jointBoneId);
    const boneGroup = groups.find(g => g.id === m.jointBoneId);
    const boneName = sanitisePartName(boneGroup?.name || m.jointBoneId);
    const id = `ParamRotation_${boneName}`;
    push({
      id,
      name: `Rotation ${boneGroup?.name ?? m.jointBoneId}`,
      min: bakedKeyformAngles[0],
      max: bakedKeyformAngles[bakedKeyformAngles.length - 1],
      default: 0,
      decimalPlaces: 1, repeat: false,
      role: 'bone',
      boneId: m.jointBoneId,
    });
  }

  // 6. Group rotation params — `ParamRotation_<groupName>` for every non-bone
  // group that gets a rotation deformer. cmo3writer's deferred deformer pass
  // (see line ~1605) skips bones (they get baked keyforms instead) and a
  // few roles handled by warps; the rest emit a rotation deformer driven
  // by this param. Mirrored here so moc3writer's bindings can resolve the
  // param ids without referencing a missing entry.
  if (generateRig) {
    const SKIP_ROTATION_ROLES = new Set(_SKIP_ROT_ROLES);
    for (const g of groups) {
      if (!g?.id) continue;
      if (seenBones.has(g.id)) continue;       // bones got bone params above
      if (g.boneRole && SKIP_ROTATION_ROLES.has(g.boneRole)) continue;
      const sanitized = sanitisePartName(g.name || g.id);
      const id = `ParamRotation_${sanitized}`;
      push({
        id,
        name: `Rotation ${g.name ?? g.id}`,
        min: _ROT_PARAM_MIN, max: _ROT_PARAM_MAX, default: 0,
        decimalPlaces: 1, repeat: false,
        role: 'rotation_deformer',
        groupId: g.id,
      });
    }
  }

  return out;
}

/**
 * Index a ParamSpec list by id for O(1) lookup. Matches the access patterns
 * cmo3writer and moc3writer use when emitting keyform bindings.
 *
 * @param {ParamSpec[]} specs
 * @returns {Map<string, ParamSpec>}
 */
export function indexParamSpec(specs) {
  const m = new Map();
  for (const s of specs) m.set(s.id, s);
  return m;
}

/**
 * Seed `project.parameters` from the auto-rig generator. After this runs,
 * the project owns its parameter list — exports become deterministic for
 * this subsystem, and the user can edit the list (Stage 1+ UI).
 *
 * Destructive: overwrites the existing `project.parameters`. The plan's
 * "Seeder semantics" section is the contract — caller is responsible for
 * any confirmation prompt before calling.
 *
 * Idempotent in the sense that calling twice with the same project state
 * produces the same result. Different from re-seeding after the user has
 * tweaked the list — that's destructive (intentional).
 *
 * @param {object} project - the live project object (mutated)
 * @returns {ParamSpec[]} the seeded list (also written to project.parameters)
 */
export function seedParameters(project) {
  const meshNodes = (project.nodes ?? []).filter(
    (n) => n.type === 'part' && n.mesh && n.visible !== false
  );
  const groupNodes = (project.nodes ?? []).filter((n) => n.type === 'group');

  // Run the generator with empty baseParameters — forces synthesis of the
  // full standard + variant + bone + rotation list. Then store the result
  // verbatim. After this, future `buildParameterSpec({ baseParameters: project.parameters })`
  // calls take the native rig path and return the seed unchanged.
  const spec = buildParameterSpec({
    baseParameters: [],
    meshes: meshNodes.map((n) => ({
      tag: n.tag ?? null,
      variantSuffix: n.variantSuffix ?? null,
      variantRole: n.variantRole ?? null,
      jointBoneId: n.mesh?.jointBoneId ?? null,
      boneWeights: n.mesh?.boneWeights ?? null,
    })),
    groups: groupNodes,
    generateRig: true,
  });

  project.parameters = spec;
  return spec;
}
