// @ts-check

/**
 * Parameter sub-group taxonomy for the .cmo3 generator.
 *
 * Cubism's Random Pose Setting dialog renders parameters nested under
 * folders, not as a flat list — without sub-groups the dialog opens
 * empty. We mirror Hiyori's 12-category tree: every paramDef gets
 * tagged with one of the keys below, then the writer emits a
 * `CParameterGroup` only for keys with ≥1 member.
 *
 * The two pieces here:
 *
 *   - `CATEGORY_DEFS` — display tree shape: 10 categories with their
 *     editor-facing `idstr`. Order matters; it's the order folders
 *     appear in the dialog.
 *   - `categorizeParam(id)` — pure regex/string-table classifier.
 *     Lives next to `CATEGORY_DEFS` so taxonomy edits stay together.
 *
 * Lifted out of `cmo3writer.js` (Phase 6 god-class breakup); pure,
 * no closure dependencies, no I/O.
 *
 * @module io/live2d/cmo3/paramCategories
 */

/**
 * @typedef {Object} CategoryDef
 * @property {'face'|'eye'|'eyeball'|'brow'|'mouth'|'body'|'hair'|'clothing'|'bone'|'custom'} key
 * @property {string} name   Display label (Hiyori-style title-cased).
 * @property {string} idstr  CParameterGroupId.idstr for this category.
 */

/**
 * Display tree for parameter sub-groups. The Editor's Random Pose
 * dialog reads `CParameterGroupId.idstr` to label folders, so these
 * names must match Hiyori's reference values.
 *
 * @type {ReadonlyArray<CategoryDef>}
 */
export const CATEGORY_DEFS = Object.freeze([
  { key: 'face',     name: 'Face',     idstr: 'ParamGroupFace' },
  { key: 'eye',      name: 'Eye',      idstr: 'ParamGroupEyes' },
  { key: 'eyeball',  name: 'Eyeball',  idstr: 'ParamGroupEyeballs' },
  { key: 'brow',     name: 'Brow',     idstr: 'ParamGroupBrows' },
  { key: 'mouth',    name: 'Mouth',    idstr: 'ParamGroupMouth' },
  { key: 'body',     name: 'Body',     idstr: 'ParamGroupBody' },
  { key: 'hair',     name: 'Hair',     idstr: 'ParamGroupHair' },
  { key: 'clothing', name: 'Clothing', idstr: 'ParamGroupClothing' },
  { key: 'bone',     name: 'Bone',     idstr: 'ParamGroupBone' },
  { key: 'custom',   name: 'Custom',   idstr: 'ParamGroupCustom' },
]);

/**
 * Classify a parameter id into one of `CATEGORY_DEFS.key`.
 *
 * Falsy / unknown ids fall into `custom`. Bone params follow the
 * `ParamRotation_<boneId>` convention emitted by `paramSpec.js`;
 * shoulder/elbow/wrist sway params are grouped with body angles
 * since they drive torso-level orientation.
 *
 * @param {string|null|undefined} id
 * @returns {'face'|'eye'|'eyeball'|'brow'|'mouth'|'body'|'hair'|'clothing'|'bone'|'custom'}
 */
export function categorizeParam(id) {
  if (!id) return 'custom';
  if (/^ParamAngle[XYZ]$/.test(id) || id === 'ParamCheek') return 'face';
  if (/^ParamEye[LR](Open|Smile)$/.test(id)) return 'eye';
  if (/^ParamEyeBall[XY]$/.test(id)) return 'eyeball';
  if (/^ParamBrow/.test(id)) return 'brow';
  if (/^ParamMouth/.test(id)) return 'mouth';
  if (/^ParamBodyAngle[XYZ]$/.test(id) || id === 'ParamBreath') return 'body';
  if (/^Param(Shoulder|Elbow|Wrist)Sway/.test(id)) return 'body';
  if (/^ParamHair/.test(id)) return 'hair';
  if (id === 'ParamSkirt' || id === 'ParamShirt' || id === 'ParamPants' || id === 'ParamBust') return 'clothing';
  if (/^ParamRotation_/.test(id)) return 'bone';
  return 'custom';
}
