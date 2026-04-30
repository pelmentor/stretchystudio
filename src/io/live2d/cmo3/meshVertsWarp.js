// @ts-check

import { uuid } from '../xmlbuilder.js';
import { sanitisePartName } from '../../../lib/partId.js';

/**
 * Section 3b CWarpDeformerSource (per mesh with mesh_verts animation).
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #31).
 *
 * For every mesh that has an animated `mesh_verts` track in any of
 * the project animations, emit a `CWarpDeformerSource` whose grid
 * keyforms are computed from the per-vertex deltas via Inverse
 * Distance Weighting. The deformer is bound to a per-mesh
 * `ParamDeform_<sanitisedName>` ranging `[0, numKf-1]`.
 *
 * Algorithm summary:
 *   1. Build rest-pose grid: regular (col+1)×(row+1) over the mesh's
 *      bounding box (10% padded) in deformer-local space.
 *   2. For each keyframe: compute per-vertex deltas vs rest pose,
 *      then propagate to grid points by IDW with `w = 1 / (dist² + ε)`.
 *      Returns a fresh grid position array per keyframe.
 *   3. Emit XML: CDeformerGuid + CFormGuid per keyframe + per-mesh
 *      CParameterGuid + CoordType="Canvas" + KeyformBindingSource +
 *      KeyformGridSource + CWarpDeformerSource with one
 *      CWarpDeformerForm per keyframe.
 *   4. Hook the deformer guid into its parent group part's
 *      `_childGuids` carray_list.
 *
 * Mutates `paramDefs` (pushes each new ParamDeform_*),
 * `deformerParamMap` (records the binding for animation export),
 * `allDeformerSources` (CDeformerSourceSet roster), and the
 * `groupParts` / `rootPart` `_childGuids` count attrs. Returns
 * `meshWarpDeformerGuids` (partId → pid) so section 4 can route
 * meshes to their own warp deformer when present.
 *
 * @module io/live2d/cmo3/meshVertsWarp
 */

const WARP_COL = 3;
const WARP_ROW = 3;
const WARP_GRID_POINTS = (WARP_COL + 1) * (WARP_ROW + 1); // 16

/**
 * Build a regular (col+1)×(row+1) rest grid covering a 10%-padded
 * bounding box of the mesh's rest vertices (deformer-local space).
 *
 * @param {ArrayLike<number>} restVerts        Flat [x,y, ...].
 * @returns {{ restGrid: Float64Array, gridW: number, gridH: number }}
 */
function buildRestGrid(restVerts) {
  const numVerts = restVerts.length / 2;
  let bboxMinX = Infinity, bboxMinY = Infinity, bboxMaxX = -Infinity, bboxMaxY = -Infinity;
  for (let i = 0; i < numVerts; i++) {
    const vx = restVerts[i * 2], vy = restVerts[i * 2 + 1];
    if (vx < bboxMinX) bboxMinX = vx; if (vy < bboxMinY) bboxMinY = vy;
    if (vx > bboxMaxX) bboxMaxX = vx; if (vy > bboxMaxY) bboxMaxY = vy;
  }
  const padX = (bboxMaxX - bboxMinX) * 0.1 || 10;
  const padY = (bboxMaxY - bboxMinY) * 0.1 || 10;
  bboxMinX -= padX; bboxMinY -= padY; bboxMaxX += padX; bboxMaxY += padY;
  const bboxW = bboxMaxX - bboxMinX;
  const bboxH = bboxMaxY - bboxMinY;

  const gridW = WARP_COL + 1;
  const gridH = WARP_ROW + 1;
  const restGrid = new Float64Array(WARP_GRID_POINTS * 2);
  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const idx = (r * gridW + c) * 2;
      restGrid[idx] = bboxMinX + c * bboxW / WARP_COL;
      restGrid[idx + 1] = bboxMinY + r * bboxH / WARP_ROW;
    }
  }
  return { restGrid, gridW, gridH };
}

/**
 * IDW propagation: for each grid point, weighted average of vertex
 * deltas with weight = 1 / (dist² + ε). Applied additively on top of
 * the rest grid.
 *
 * @param {Float64Array} restGrid
 * @param {ArrayLike<number>} restVerts
 * @param {Float64Array} deltas      Per-vertex (kfLocalVerts - restVerts).
 * @returns {Float64Array}           Grid positions for this keyform.
 */
function propagateDeltasToGrid(restGrid, restVerts, deltas) {
  const numVerts = restVerts.length / 2;
  const gridPositions = new Float64Array(WARP_GRID_POINTS * 2);
  const epsilon = 1e-6;
  for (let gi = 0; gi < WARP_GRID_POINTS; gi++) {
    const gx = restGrid[gi * 2];
    const gy = restGrid[gi * 2 + 1];
    let sumWx = 0, sumWy = 0, sumW = 0;
    for (let vi = 0; vi < numVerts; vi++) {
      const dx = gx - restVerts[vi * 2];
      const dy = gy - restVerts[vi * 2 + 1];
      const distSq = dx * dx + dy * dy + epsilon;
      const w = 1 / distSq;
      sumWx += w * deltas[vi * 2];
      sumWy += w * deltas[vi * 2 + 1];
      sumW += w;
    }
    gridPositions[gi * 2] = gx + sumWx / sumW;
    gridPositions[gi * 2 + 1] = gy + sumWy / sumW;
  }
  return gridPositions;
}

/**
 * Extract `mesh_verts` keyframe tracks per partId from the project
 * animations array. First animation wins when multiple animations
 * touch the same part.
 *
 * @param {Array} animations
 * @returns {Map<string, Array<{time:number, value:Array<{x:number,y:number}>}>>}
 */
function buildMeshVertsMap(animations) {
  const meshVertsMap = new Map();
  for (const anim of animations) {
    for (const track of (anim.tracks ?? [])) {
      if (track.property === 'mesh_verts' && track.keyframes?.length >= 2) {
        if (!meshVertsMap.has(track.nodeId)) {
          meshVertsMap.set(track.nodeId, track.keyframes);
        }
      }
    }
  }
  return meshVertsMap;
}

/**
 * Emit per-mesh CWarpDeformerSource for every mesh with mesh_verts
 * animation. Returns the partId → pidWarpDfGuid map.
 *
 * @param {Object} x
 * @param {Object} opts
 * @param {Array} opts.animations
 * @param {Array} opts.meshes
 * @param {Array} opts.perMesh
 * @param {Map<string, {x:number, y:number}>} opts.deformerWorldOrigins
 * @param {Map<string, string|number>} opts.groupDeformerGuids
 * @param {Map<string, string|number>} opts.groupPartGuids
 * @param {Map<string, {childGuidsNode:Object}>} opts.groupParts
 * @param {{childGuidsNode:Object}} opts.rootPart
 * @param {Array<{pid:string|number, tag:string}>} opts.allDeformerSources
 * @param {Array} opts.paramDefs
 * @param {Map<string, Object>} opts.deformerParamMap
 * @param {string|number} opts.pidPartGuid
 * @param {string|number} opts.pidDeformerRoot
 * @returns {{ meshWarpDeformerGuids: Map<string, string|number> }}
 */
export function emitMeshVertsWarpDeformers(x, opts) {
  const {
    animations, meshes, perMesh,
    deformerWorldOrigins, groupDeformerGuids, groupPartGuids,
    groupParts, rootPart,
    allDeformerSources, paramDefs, deformerParamMap,
    pidPartGuid, pidDeformerRoot,
  } = opts;

  const meshVertsMap = buildMeshVertsMap(animations);
  const meshWarpDeformerGuids = new Map();

  for (const pm of perMesh) {
    const partId = meshes[pm.mi].partId;
    const keyframes = meshVertsMap.get(partId);
    if (!keyframes) continue;

    const meshParentGroup = meshes[pm.mi].parentGroupId;
    const sanitizedMeshName = sanitisePartName(pm.meshName || partId);
    const numKf = keyframes.length;

    // Rest-pose vertices in deformer-local space
    const canvasVerts = pm.vertices;
    const dfOrigin = meshParentGroup && deformerWorldOrigins.has(meshParentGroup)
      ? deformerWorldOrigins.get(meshParentGroup)
      : null;
    const restVerts = dfOrigin
      ? canvasVerts.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y))
      : [...canvasVerts];

    const numVerts = restVerts.length / 2;
    const { restGrid } = buildRestGrid(restVerts);

    // Compute grid positions for each keyframe via IDW
    const gridKeyforms = [];
    for (const kf of keyframes) {
      const kfLocalVerts = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts; i++) {
        const v = kf.value[i];
        if (!v) {
          kfLocalVerts[i * 2] = restVerts[i * 2];
          kfLocalVerts[i * 2 + 1] = restVerts[i * 2 + 1];
          continue;
        }
        kfLocalVerts[i * 2] = v.x - (dfOrigin ? dfOrigin.x : 0);
        kfLocalVerts[i * 2 + 1] = v.y - (dfOrigin ? dfOrigin.y : 0);
      }
      const deltas = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts * 2; i++) deltas[i] = kfLocalVerts[i] - restVerts[i];
      gridKeyforms.push(propagateDeltasToGrid(restGrid, restVerts, deltas));
    }

    // ── Create CWarpDeformerSource XML ──
    const [, pidWarpDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Warp_${sanitizedMeshName}` });
    meshWarpDeformerGuids.set(partId, pidWarpDfGuid);

    const warpFormGuids = [];
    for (let ki = 0; ki < numKf; ki++) {
      const [, pidWarpForm] = x.shared('CFormGuid', { uuid: uuid(), note: `WarpForm_${sanitizedMeshName}_${ki}` });
      warpFormGuids.push(pidWarpForm);
    }

    // ParamDeform_<MeshName> [0, numKf-1]
    const warpParamId = `ParamDeform_${sanitizedMeshName}`;
    const [, pidWarpParam] = x.shared('CParameterGuid', { uuid: uuid(), note: warpParamId });
    paramDefs.push({
      pid: pidWarpParam, id: warpParamId, name: `Deform ${pm.meshName}`,
      min: 0, max: numKf - 1, defaultVal: 0,
      decimalPlaces: 1,
    });
    deformerParamMap.set(partId, {
      paramId: warpParamId, type: 'warp', min: 0, max: numKf - 1,
      keyframeTimes: keyframes.map(kf => kf.time),
    });

    // CoordType (Canvas — vertex space same as cmo3 mesh keyforms)
    const [coordWarp, pidCoordWarp] = x.shared('CoordType');
    x.sub(coordWarp, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource → param ↔ grid wiring
    const [warpKfBinding, pidWarpKfBinding] = x.shared('KeyformBindingSource');

    // KeyformGridSource (numKf keyforms × 1 binding)
    const [warpKfg, pidWarpKfg] = x.shared('KeyformGridSource');
    const warpKfogList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(numKf) });
    for (let ki = 0; ki < numKf; ki++) {
      const kog = x.sub(warpKfogList, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidWarpKfBinding, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(ki);
      x.subRef(kog, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'keyformGuid' });
    }
    const warpKfbList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(warpKfbList, 'KeyformBindingSource', pidWarpKfBinding);

    // Fill KeyformBindingSource
    x.subRef(warpKfBinding, 'KeyformGridSource', pidWarpKfg, { 'xs.n': '_gridSource' });
    x.subRef(warpKfBinding, 'CParameterGuid', pidWarpParam, { 'xs.n': 'parameterGuid' });
    const warpKeysArr = x.sub(warpKfBinding, 'array_list', { 'xs.n': 'keys', count: String(numKf) });
    for (let ki = 0; ki < numKf; ki++) x.sub(warpKeysArr, 'f').text = ki.toFixed(1);
    x.sub(warpKfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(warpKfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(warpKfBinding, 's', { 'xs.n': 'description' }).text = warpParamId;

    // Parent: group's rotation deformer or ROOT
    const warpParentDfGuid = meshParentGroup && groupDeformerGuids.has(meshParentGroup)
      ? groupDeformerGuids.get(meshParentGroup) : pidDeformerRoot;
    const warpParentPartGuid = meshParentGroup && groupPartGuids.has(meshParentGroup)
      ? groupPartGuids.get(meshParentGroup) : pidPartGuid;

    // CWarpDeformerSource node
    const [warpDf, pidWarpDf] = x.shared('CWarpDeformerSource');
    allDeformerSources.push({ pid: pidWarpDf, tag: 'CWarpDeformerSource' });

    const warpAcdfs = x.sub(warpDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const warpAcpcs = x.sub(warpAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(warpAcpcs, 's', { 'xs.n': 'localName' }).text = `${pm.meshName} Warp`;
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(warpAcpcs, 'CPartGuid', warpParentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(warpAcpcs, 'KeyformGridSource', pidWarpKfg, { 'xs.n': 'keyformGridSource' });
    const warpMft = x.sub(warpAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(warpMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const warpBwc = x.sub(warpMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(warpBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(warpAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(warpAcdfs, 'CDeformerGuid', pidWarpDfGuid, { 'xs.n': 'guid' });
    x.sub(warpAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `Warp_${sanitizedMeshName}` });
    x.subRef(warpAcdfs, 'CDeformerGuid', warpParentDfGuid, { 'xs.n': 'targetDeformerGuid' });

    x.sub(warpDf, 'i', { 'xs.n': 'col' }).text = String(WARP_COL);
    x.sub(warpDf, 'i', { 'xs.n': 'row' }).text = String(WARP_ROW);
    x.sub(warpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

    // Keyforms — one CWarpDeformerForm per keyframe.
    const warpKfsList = x.sub(warpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });
    for (let ki = 0; ki < numKf; ki++) {
      const wdf = x.sub(warpKfsList, 'CWarpDeformerForm');
      const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(wdfAcf, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'guid' });
      x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(wdfAcf, 'CWarpDeformerSource', pidWarpDf, { 'xs.n': '_source' });
      x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
      x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(wdfAdf, 'CoordType', pidCoordWarp, { 'xs.n': 'coordType' });

      const posArr = gridKeyforms[ki];
      x.sub(wdf, 'float-array', {
        'xs.n': 'positions', count: String(WARP_GRID_POINTS * 2),
      }).text = Array.from(posArr).map(v => v.toFixed(1)).join(' ');
    }

    // Hook deformer guid into parent part's _childGuids
    const warpPartSource = groupParts.has(meshParentGroup) ? groupParts.get(meshParentGroup) : rootPart;
    warpPartSource.childGuidsNode.children.push(x.ref('CDeformerGuid', pidWarpDfGuid));
    warpPartSource.childGuidsNode.attrs.count = String(warpPartSource.childGuidsNode.children.length);
  }

  return { meshWarpDeformerGuids };
}
