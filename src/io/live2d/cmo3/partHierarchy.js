// @ts-check

import { uuid } from '../xmlbuilder.js';
import { sanitisePartName } from '../../../lib/partId.js';

/**
 * Section 3 — Part hierarchy emission. Lifted out of cmo3writer.js
 * (Phase 6 god-class breakup, sweep #28).
 *
 * Hiyori pattern:
 *   Root Part._childGuids → CPartGuid refs (child groups)
 *   Each group._childGuids → CDrawableGuid refs (meshes in that group)
 *   Meshes without a group parent go directly under Root Part.
 *
 * Two pieces in this module:
 *
 *   - `makePartSource` — boilerplate CPartSource node (with
 *     KeyformGridSource + CFormGuid + CPartForm). Used for both Root
 *     Part and per-group parts.
 *   - `buildPartHierarchy` — orchestrates: builds the root + all
 *     group parts, wires their _childGuids (meshes routed by
 *     parentGroupId, sub-groups routed by parent group), and updates
 *     the count attr on each carray_list at the end.
 *
 * Returns the array of allPartSources (consumed by section 6's
 * CPartSourceSet emission) plus the rootPart record (its pid is
 * referenced as `model.rootPart`).
 *
 * @module io/live2d/cmo3/partHierarchy
 */

/**
 * @typedef {{ node: Object, pid: string|number, childGuidsNode: Object }} PartSourceRecord
 */

/**
 * Create a CPartSource node + its CPartForm/KeyformGridSource
 * boilerplate. The returned `childGuidsNode` is empty; the caller is
 * responsible for pushing CPartGuid/CDrawableGuid refs into it and
 * updating its `count` attr afterward.
 *
 * @param {Object} x
 * @param {string} partName
 * @param {string} partIdStr
 * @param {string|number} partGuidPid
 * @param {string|number|null} parentGuidPid
 * @param {string|number} pidDeformerNull
 * @returns {PartSourceRecord}
 */
export function makePartSource(x, partName, partIdStr, partGuidPid, parentGuidPid, pidDeformerNull) {
  const [, pidForm] = x.shared('CFormGuid', { uuid: uuid(), note: `${partIdStr}_form` });

  const [kfg, pidKfg] = x.shared('KeyformGridSource');
  const kfogN = x.sub(kfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
  const kogN = x.sub(kfogN, 'KeyformOnGrid');
  const akN = x.sub(kogN, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
  x.sub(akN, 'array_list', { 'xs.n': '_keyOnParameterList', count: '0' });
  x.subRef(kogN, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
  x.sub(kfg, 'array_list', { 'xs.n': 'keyformBindings', count: '0' });

  const [ps, pidPs] = x.shared('CPartSource');
  const ctrl = x.sub(ps, 'ACParameterControllableSource', { 'xs.n': 'super' });
  x.sub(ctrl, 's', { 'xs.n': 'localName' }).text = partName;
  x.sub(ctrl, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(ctrl, 'b', { 'xs.n': 'isLocked' }).text = 'false';
  if (parentGuidPid) {
    x.subRef(ctrl, 'CPartGuid', parentGuidPid, { 'xs.n': 'parentGuid' });
  } else {
    x.sub(ctrl, 'null', { 'xs.n': 'parentGuid' });
  }
  x.subRef(ctrl, 'KeyformGridSource', pidKfg, { 'xs.n': 'keyformGridSource' });
  const mft = x.sub(ctrl, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
  x.sub(mft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
  const bwc = x.sub(mft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
  x.sub(bwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
  x.sub(ctrl, 'carray_list', { 'xs.n': '_extensions', count: '0' });
  x.sub(ctrl, 'null', { 'xs.n': 'internalColor_direct_argb' });
  x.subRef(ps, 'CPartGuid', partGuidPid, { 'xs.n': 'guid' });
  x.sub(ps, 'CPartId', { 'xs.n': 'id', idstr: partIdStr });
  x.sub(ps, 'b', { 'xs.n': 'enableDrawOrderGroup' }).text = 'false';
  x.sub(ps, 'i', { 'xs.n': 'defaultOrder_forEditor' }).text = '500';
  x.sub(ps, 'b', { 'xs.n': 'isSketch' }).text = 'false';
  x.sub(ps, 'CColor', { 'xs.n': 'partsEditColor' });
  // _childGuids placeholder — caller fills this
  const cg = x.sub(ps, 'carray_list', { 'xs.n': '_childGuids', count: '0' });
  x.subRef(ps, 'CDeformerGuid', pidDeformerNull, { 'xs.n': 'targetDeformerGuid' });
  const kfl = x.sub(ps, 'carray_list', { 'xs.n': 'keyforms', count: '1' });
  const pf = x.sub(kfl, 'CPartForm');
  const acf = x.sub(pf, 'ACForm', { 'xs.n': 'super' });
  x.subRef(acf, 'CFormGuid', pidForm, { 'xs.n': 'guid' });
  x.sub(acf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
  x.sub(acf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
  x.subRef(acf, 'CPartSource', pidPs, { 'xs.n': '_source' }); // self-reference
  x.sub(acf, 'null', { 'xs.n': 'name' });
  x.sub(acf, 's', { 'xs.n': 'notes' }).text = '';
  x.sub(pf, 'i', { 'xs.n': 'drawOrder' }).text = '500';

  return { node: ps, pid: pidPs, childGuidsNode: cg };
}

/**
 * Build the full Part-Source hierarchy: root + groups + child wiring.
 *
 * @param {Object} x
 * @param {Object} opts
 * @param {Array<{id:string, name?:string, parent?:string|null}>} opts.groups
 * @param {Array<{parentGroupId?:string|null}>} opts.meshes
 * @param {Array<{pidDrawable:string|number}>} opts.perMesh
 * @param {string|number} opts.pidPartGuid    Root part's CPartGuid pid.
 * @param {Map<string, string|number>} opts.groupPartGuids
 * @param {string|number} opts.pidDeformerNull
 * @returns {{
 *   rootPart: PartSourceRecord,
 *   allPartSources: PartSourceRecord[],
 *   groupParts: Map<string, PartSourceRecord>,
 * }}
 */
export function buildPartHierarchy(x, opts) {
  const { groups, meshes, perMesh, pidPartGuid, groupPartGuids, pidDeformerNull } = opts;

  // Build mesh→parentGroupId lookup
  const meshParentMap = new Map();
  for (let i = 0; i < perMesh.length; i++) {
    meshParentMap.set(i, meshes[i].parentGroupId ?? null);
  }

  // Create Root Part
  const rootPart = makePartSource(x, 'Root Part', '__RootPart__', pidPartGuid, null, pidDeformerNull);
  const allPartSources = [rootPart];

  // Create group parts
  /** @type {Map<string, PartSourceRecord>} */
  const groupParts = new Map();
  for (const g of groups) {
    const gpid = groupPartGuids.get(g.id);
    const parentPid = g.parent && groupPartGuids.has(g.parent)
      ? groupPartGuids.get(g.parent) : pidPartGuid;
    const sanitizedId = `Part_${sanitisePartName(g.name || g.id)}`;
    const gp = makePartSource(x, g.name || g.id, sanitizedId, gpid, parentPid, pidDeformerNull);
    groupParts.set(g.id, gp);
    allPartSources.push(gp);
  }

  // Fill _childGuids — Root Part children = top-level groups + orphan meshes
  /** @type {Array<{type:string, pid:string|number}>} */
  const rootChildren = [];
  for (const g of groups) {
    if (!g.parent || !groupPartGuids.has(g.parent)) {
      rootChildren.push({ type: 'CPartGuid', pid: groupPartGuids.get(g.id) });
    }
  }
  // Meshes: assign to their parent group, or root if no group
  for (let i = 0; i < perMesh.length; i++) {
    const parentId = meshParentMap.get(i);
    const target = parentId && groupParts.has(parentId) ? groupParts.get(parentId) : null;
    if (target) {
      target.childGuidsNode.children.push(x.ref('CDrawableGuid', perMesh[i].pidDrawable));
    } else {
      rootChildren.push({ type: 'CDrawableGuid', pid: perMesh[i].pidDrawable });
    }
  }

  // Sub-groups: groups whose parent is another group (not root)
  for (const g of groups) {
    if (g.parent && groupParts.has(g.parent)) {
      const parentGp = groupParts.get(g.parent);
      parentGp.childGuidsNode.children.push(x.ref('CPartGuid', groupPartGuids.get(g.id)));
    }
  }

  // Write root children
  for (const c of rootChildren) {
    rootPart.childGuidsNode.children.push(x.ref(c.type, c.pid));
  }

  // Update count attrs on all _childGuids nodes
  for (const ps of allPartSources) {
    ps.childGuidsNode.attrs.count = String(ps.childGuidsNode.children.length);
  }

  return { rootPart, allPartSources, groupParts };
}
