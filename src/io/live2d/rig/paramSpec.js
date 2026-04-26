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
 * 22 standard Live2D parameter ids that face-tracking apps (VTube Studio,
 * FaceForge, Cubism Viewer demo motions) recognize. Emitted only when
 * `generateRig: true` — matches the cmo3 auto-rig behaviour.
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
  { id: 'ParamHairFront',  name: 'Hair Front',    min: -1,  max: 1,  def: 0 },
  { id: 'ParamHairSide',   name: 'Hair Side',     min: -1,  max: 1,  def: 0 },
  { id: 'ParamHairBack',   name: 'Hair Back',     min: -1,  max: 1,  def: 0 },
  { id: 'ParamSkirt',      name: 'Skirt',         min: -1,  max: 1,  def: 0 },
  { id: 'ParamShirt',      name: 'Shirt',         min: -1,  max: 1,  def: 0 },
  { id: 'ParamPants',      name: 'Pants',         min: -1,  max: 1,  def: 0 },
  { id: 'ParamBust',       name: 'Bust',          min: -1,  max: 1,  def: 0 },
];

/**
 * Bone rotation params (`ParamRotation_<boneName>`) cover ±90°. The five
 * baked sample angles (-90/-45/0/45/90) live in cmo3writer as `BAKED_ANGLES`.
 * Keeping these constants here so moc3writer doesn't have to import from cmo3.
 */
export const BAKED_BONE_ANGLES = [-90, -45, 0, 45, 90];
const BONE_PARAM_MIN = BAKED_BONE_ANGLES[0];
const BONE_PARAM_MAX = BAKED_BONE_ANGLES[BAKED_BONE_ANGLES.length - 1];

/**
 * @typedef {Object} BuildParamSpecInput
 * @property {Array<{id?:string, name?:string, min?:number, max?:number, default?:number}>} [baseParameters]
 *   Parameters loaded from a saved project file (`project.parameters`). Usually empty for
 *   freshly-imported PSDs — the rig is generated rather than persisted.
 * @property {Array<{variantSuffix?:string|null, variantRole?:string|null, jointBoneId?:string|null, boneWeights?:any}>} [meshes]
 *   Visible art meshes from the project. Used to discover variant suffixes (smile/sad/...) and
 *   bone-driven meshes that need a `ParamRotation_<bone>`.
 * @property {Array<{id:string, name?:string}>} [groups]
 *   Group/part nodes — used to look up display names for bone params.
 * @property {boolean} [generateRig=false]
 *   When true, emit the 22 SDK-standard params (ParamAngleX/Y/Z, ParamEyeL/ROpen, ...).
 */

/**
 * Build the canonical parameter list for a project.
 *
 * @param {BuildParamSpecInput} input
 * @returns {ParamSpec[]} Ordered list of parameter specs. Order matches the
 *   layout cmo3writer used pre-refactor:
 *     1. ParamOpacity (always)
 *     2. project.parameters (saved-file params, if any)
 *     3. Variant params (one per used suffix)
 *     4. Standard Live2D params (when generateRig)
 *     5. Bone rotation params (one per jointBoneId)
 *
 *   The list is deduplicated by `id` — later entries with a duplicate id are skipped.
 */
export function buildParameterSpec(input = {}) {
  const {
    baseParameters = [],
    meshes = [],
    groups = [],
    generateRig = false,
  } = input;

  /** @type {ParamSpec[]} */
  const out = [];
  const seen = new Set();
  const push = (spec) => {
    if (!spec.id || seen.has(spec.id)) return;
    seen.add(spec.id);
    out.push(spec);
  };

  // 1. ParamOpacity — always present. Required by mesh keyform bindings.
  push({
    id: 'ParamOpacity',
    name: 'Opacity',
    min: 0, max: 1, default: 1, decimalPlaces: 1, repeat: false,
    role: 'opacity',
  });

  // 2. Project parameters — params loaded from a saved .ss project file.
  for (const p of baseParameters) {
    if (!p?.id) continue;
    push({
      id: p.id,
      name: p.name ?? p.id,
      min: p.min ?? 0,
      max: p.max ?? 1,
      default: p.default ?? 0,
      decimalPlaces: 3,
      repeat: false,
      role: 'project',
    });
  }

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
  if (generateRig) {
    for (const sp of STANDARD_PARAMS) {
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
    const boneName = (boneGroup?.name || m.jointBoneId).replace(/[^a-zA-Z0-9_]/g, '_');
    const id = `ParamRotation_${boneName}`;
    push({
      id,
      name: `Rotation ${boneGroup?.name ?? m.jointBoneId}`,
      min: BONE_PARAM_MIN, max: BONE_PARAM_MAX, default: 0,
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
    const SKIP_ROTATION_ROLES = new Set(['torso', 'eyes', 'neck']);
    for (const g of groups) {
      if (!g?.id) continue;
      if (seenBones.has(g.id)) continue;       // bones got bone params above
      if (g.boneRole && SKIP_ROTATION_ROLES.has(g.boneRole)) continue;
      const sanitized = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
      const id = `ParamRotation_${sanitized}`;
      push({
        id,
        name: `Rotation ${g.name ?? g.id}`,
        min: -30, max: 30, default: 0,
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
