// @ts-check

/**
 * v3 Phase 1D — Parameters editor group builder.
 *
 * Pure: takes the project's flat parameter list and bins entries
 * into ordered, named groups for the UI. Order matches the v2
 * Parameters panel + the auto-rig seeder's emission order so
 * users see the same visual layout when they switch shells.
 *
 * Group rules:
 *   - 'Opacity'   → entries with role === 'opacity'
 *   - 'Standard'  → role === 'standard' (Cubism canonical params)
 *   - 'Variants'  → role === 'variant' OR variantSuffix set
 *   - 'Bones'     → role === 'bone' OR boneId set
 *   - 'Groups'    → role === 'group' OR groupId set (rotation deformer params)
 *   - 'Project'   → everything else (custom user params, role === 'project')
 *
 * Empty groups are dropped so the editor's accordion has no
 * always-collapsed dead headers.
 *
 * @module v3/editors/parameters/groupBuilder
 */

/**
 * @typedef {Object} ParamSpecLike
 * @property {string}            id
 * @property {string=}           name
 * @property {number=}           min
 * @property {number=}           max
 * @property {number=}           default
 * @property {string=}           role
 * @property {string=}           boneId
 * @property {string=}           groupId
 * @property {string=}           variantSuffix
 *
 * @typedef {Object} ParamGroup
 * @property {string} key
 * @property {string} label
 * @property {ParamSpecLike[]} params
 */

const ORDER = ['opacity', 'standard', 'variants', 'bones', 'groups', 'project'];

const LABELS = {
  opacity: 'Opacity',
  standard: 'Standard',
  variants: 'Variants',
  bones: 'Bones',
  groups: 'Groups',
  project: 'Project',
};

/** @param {ParamSpecLike} p */
function classify(p) {
  if (p.role === 'opacity') return 'opacity';
  if (p.role === 'standard') return 'standard';
  if (p.role === 'variant' || p.variantSuffix) return 'variants';
  if (p.role === 'bone'    || p.boneId)        return 'bones';
  if (p.role === 'group'   || p.groupId)       return 'groups';
  return 'project';
}

/**
 * @param {ParamSpecLike[]} parameters
 * @returns {ParamGroup[]}
 */
export function buildParamGroups(parameters) {
  if (!Array.isArray(parameters) || parameters.length === 0) return [];
  /** @type {Record<string, ParamSpecLike[]>} */
  const buckets = { opacity: [], standard: [], variants: [], bones: [], groups: [], project: [] };
  for (const p of parameters) {
    if (!p || typeof p.id !== 'string' || p.id === '') continue;
    buckets[classify(p)].push(p);
  }
  const out = [];
  for (const key of ORDER) {
    if (buckets[key].length > 0) {
      out.push({ key, label: LABELS[key], params: buckets[key] });
    }
  }
  return out;
}
