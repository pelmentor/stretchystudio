/**
 * BFA-006 Phase 6 — read warp / rotation deformers from `project.nodes`.
 *
 * After Phase 6, the three legacy sidetables (`project.faceParallax`,
 * `project.bodyWarp`, `project.rigWarps`) are deleted. The runtime
 * source of truth is `project.nodes` carrying `type:'deformer'`
 * entries. This module is the read-side counterpart to Phase 1's
 * `deformerNodeSync.js` (write-side helpers): given a project, it
 * inflates deformer nodes back into the `WarpDeformerSpec` /
 * `RotationDeformerSpec` shapes that `cmo3writer` and `chainEval`
 * consume.
 *
 * Why a focused module (vs reusing `selectRigSpec`):
 *   - `selectRigSpec` produces the FULL `RigSpec` (including the
 *     lifted-grid rest pass + artMesh derivation). For the cmo3
 *     export pipeline the heuristic generator already runs the rig
 *     synthesis end-to-end; it needs the seeded `WarpDeformerSpec`
 *     shapes verbatim, not the synthesised RigSpec.
 *   - Sidetable consumers (`resolveFaceParallax` / `resolveBodyWarp` /
 *     `resolveRigWarps`) want a narrow API — "give me the
 *     FaceParallax warp", "give me the body warp chain", "give me
 *     the per-mesh rigWarps map" — without paying for unrelated
 *     compute on every call.
 *
 * @module io/live2d/rig/deformerNodeReaders
 */

const FACE_PARALLAX_NODE_ID = 'FaceParallaxWarp';
const BODY_WARP_NODE_IDS = Object.freeze(['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp']);

/**
 * Convert a stored deformer node back into a `RigSpecParent` shape
 * (`{type, id}`). Uses the parent node's discriminator to recover
 * whether it's a part / warp / rotation. Dangling parents collapse
 * to `{type:'root', id:null}` defensively (matches `selectRigSpec`).
 *
 * @param {string|null|undefined} parentId
 * @param {Map<string, object>} nodeById
 * @returns {{type:string, id:string|null}}
 */
export function inflateParentRef(parentId, nodeById) {
  if (!parentId) return { type: 'root', id: null };
  const parent = nodeById.get(parentId);
  if (!parent) return { type: 'root', id: null };
  if (parent.type === 'deformer') {
    if (parent.deformerKind === 'rotation') return { type: 'rotation', id: parentId };
    return { type: 'warp', id: parentId };
  }
  if (parent.type === 'part' || parent.type === 'group') {
    return { type: 'part', id: parentId };
  }
  return { type: 'root', id: null };
}

/**
 * Inflate a `type:'deformer', deformerKind:'warp'` node into a
 * `WarpDeformerSpec` (Float64Array typed buffers, RigSpecParent
 * shape). Mirror image of `deformerNodeSync.warpSpecToDeformerNode`.
 *
 * @param {object} node
 * @param {Map<string, object>} nodeById
 * @returns {object}
 */
export function nodeToWarpSpec(node, nodeById) {
  const spec = {
    id: node.id,
    name: node.name ?? node.id,
    parent: inflateParentRef(node.parent, nodeById),
    gridSize: {
      rows: node.gridSize?.rows ?? 5,
      cols: node.gridSize?.cols ?? 5,
    },
    baseGrid: _toFloat64(node.baseGrid),
    localFrame: node.localFrame ?? 'canvas-px',
    bindings: (node.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      positions: _toFloat64(k.positions),
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    isVisible: node.visible !== false,
    isLocked: node.isLocked === true,
    isQuadTransform: node.isQuadTransform === true,
  };
  if (typeof node.targetPartId === 'string' && node.targetPartId.length > 0) {
    spec.targetPartId = node.targetPartId;
  }
  if (node.canvasBbox && typeof node.canvasBbox === 'object') {
    spec.canvasBbox = {
      minX: node.canvasBbox.minX ?? 0,
      minY: node.canvasBbox.minY ?? 0,
      W: node.canvasBbox.W ?? 0,
      H: node.canvasBbox.H ?? 0,
    };
  }
  if (node._userAuthored === true) spec._userAuthored = true;
  return spec;
}

/**
 * Inflate a `type:'deformer', deformerKind:'rotation'` node into a
 * `RotationDeformerSpec`.
 *
 * @param {object} node
 * @param {Map<string, object>} nodeById
 * @returns {object}
 */
export function nodeToRotationSpec(node, nodeById) {
  return {
    id: node.id,
    name: node.name ?? node.id,
    parent: inflateParentRef(node.parent, nodeById),
    bindings: (node.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      angle: typeof k.angle === 'number' ? k.angle : 0,
      originX: typeof k.originX === 'number' ? k.originX : 0,
      originY: typeof k.originY === 'number' ? k.originY : 0,
      scale: typeof k.scale === 'number' ? k.scale : 1,
      reflectX: k.reflectX === true,
      reflectY: k.reflectY === true,
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    baseAngle: typeof node.baseAngle === 'number' ? node.baseAngle : 0,
    handleLengthOnCanvas:
      typeof node.handleLengthOnCanvas === 'number' ? node.handleLengthOnCanvas : 200,
    circleRadiusOnCanvas:
      typeof node.circleRadiusOnCanvas === 'number' ? node.circleRadiusOnCanvas : 100,
    isVisible: node.visible !== false,
    isLocked: node.isLocked === true,
    useBoneUiTestImpl: node.useBoneUiTestImpl !== false,
  };
}

/**
 * Index `project.nodes` by id for O(1) parent lookup. Returns null
 * when the project lacks a nodes array.
 *
 * @param {object} project
 * @returns {Map<string, object>|null}
 */
export function indexProjectNodes(project) {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : null;
  if (!nodes) return null;
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }
  return byId;
}

/**
 * Find the FaceParallax warp deformer node in `project.nodes`.
 *
 * @param {object} project
 * @returns {object|null}
 */
export function getFaceParallaxNode(project) {
  const byId = indexProjectNodes(project);
  if (!byId) return null;
  const n = byId.get(FACE_PARALLAX_NODE_ID);
  return n && n.type === 'deformer' && n.deformerKind === 'warp' ? n : null;
}

/**
 * Return the body warp chain nodes (BZ → BY → Breath → BX) in order,
 * skipping any that don't exist in the project. Used by
 * `resolveBodyWarp` to rebuild the chain shape from `project.nodes`.
 *
 * @param {object} project
 * @returns {Array<object>}
 */
export function getBodyWarpChainNodes(project) {
  const byId = indexProjectNodes(project);
  if (!byId) return [];
  /** @type {Array<object>} */
  const out = [];
  for (const id of BODY_WARP_NODE_IDS) {
    const n = byId.get(id);
    if (n && n.type === 'deformer' && n.deformerKind === 'warp') out.push(n);
  }
  return out;
}

/**
 * Return per-mesh rigWarp deformer nodes as `Map<targetPartId, node>`.
 * Skips nodes without a `targetPartId` (= face parallax / body chain).
 *
 * @param {object} project
 * @returns {Map<string, object>}
 */
export function getRigWarpNodes(project) {
  const out = new Map();
  if (!Array.isArray(project?.nodes)) return out;
  for (const n of project.nodes) {
    if (!n || n.type !== 'deformer' || n.deformerKind !== 'warp') continue;
    if (typeof n.targetPartId !== 'string' || n.targetPartId.length === 0) continue;
    out.set(n.targetPartId, n);
  }
  return out;
}

function _toFloat64(arr) {
  if (arr instanceof Float64Array) return arr;
  if (Array.isArray(arr)) return new Float64Array(arr);
  return new Float64Array(0);
}
