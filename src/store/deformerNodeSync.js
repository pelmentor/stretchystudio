/**
 * BFA-006 Phase 1 — sidetable ↔ deformer-node sync.
 *
 * Phase 1 promotes warp deformers from three persisted sidetables
 * (`project.faceParallax`, `project.bodyWarp.specs[]`, `project.rigWarps`)
 * into first-class entries on `project.nodes` carrying `type:'deformer'`.
 *
 * In this phase the sidetables stay populated (they're still the source
 * of truth that `cmo3writer` and `chainEval` read). The deformer nodes
 * are SHADOW DATA — kept in sync via:
 *
 *   1. **Schema migration v15** — populates nodes from sidetables on
 *      first load of an old project (`projectMigrations.js`).
 *   2. **Dual-write seeders** — `seedFaceParallax` /
 *      `seedBodyWarpChain` / `seedRigWarps` (and their `clearXxx`
 *      counterparts) upsert / remove deformer nodes alongside their
 *      sidetable writes (faceParallaxStore.js / bodyWarpStore.js /
 *      rigWarpsStore.js).
 *
 * Phase 2 introduces `selectRigSpec` reading from these nodes; Phase 3
 * flips the seeders so deformer nodes become the source of truth and
 * the sidetables are dual-write shadows for one release; Phase 6 deletes
 * the sidetables entirely.
 *
 * **Stable ids.** A deformer node's `id` is the same string the spec
 * carries (`'FaceParallaxWarp'`, `'BodyWarpZ'`, the per-mesh rigWarp's
 * id, etc.). This means the migration is idempotent if re-run, and
 * dual-write upserts replace existing entries by id.
 *
 * **Parent flattening.** RigSpec parents are `{type, id}` discriminated
 * pairs (`{type:'rotation', id:'FaceRotation'}`). Project nodes use a
 * flat `parent: string|null` (the parent's node id; null for root).
 * `parentSpecToNodeId` flattens; the type is recoverable in Phase 2 via
 * looking up `project.nodes` by id.
 *
 * @module store/deformerNodeSync
 */

const FACE_PARALLAX_NODE_ID = 'FaceParallaxWarp';
const BODY_WARP_IDS = ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp'];

/**
 * Set of deformer-node ids that mirror the bodyWarp chain. Used by
 * `removeBodyWarpChainNodes` to scrub stale entries when the chain is
 * cleared or re-seeded with a different shape.
 */
const BODY_WARP_NODE_ID_SET = new Set(BODY_WARP_IDS);

/**
 * Flatten a `{type, id}` RigSpecParent into a node-id-or-null.
 *
 *   `{type:'root', id:null}`              → null
 *   `{type:'rotation', id:'FaceRotation'}` → 'FaceRotation'
 *   `{type:'warp', id:'BodyXWarp'}`        → 'BodyXWarp'
 *   `{type:'part', id:'<partId>'}`         → '<partId>'
 *
 * Phase-1 dangling pointers (e.g. 'FaceRotation' before rotation
 * deformers are synthesized — that's Phase 3) are accepted: the
 * selector resolves them at read time, missing parents fall through to
 * `parent:null`.
 *
 * @param {{type?:string, id?:string|null}|null|undefined} parent
 * @returns {string|null}
 */
export function parentSpecToNodeId(parent) {
  if (!parent) return null;
  if (parent.type === 'root') return null;
  if (typeof parent.id === 'string' && parent.id.length > 0) return parent.id;
  return null;
}

/**
 * Convert a `RotationDeformerSpec` (from a rigSpec.rotationDeformers
 * entry) into a `type:'deformer', deformerKind:'rotation'` node. The
 * spec shape uses RigSpec parent `{type,id}` discriminators — we
 * flatten to `parent: nodeId|null` so the node looks the same in
 * `project.nodes` as a part / group / warp deformer.
 *
 * BFA-006 Phase 3 — used by `seedAllRig`'s rotation dual-write to
 * mirror `harvest.rigSpec.rotationDeformers` into `project.nodes`.
 *
 * @param {import('../io/live2d/rig/rigSpec.js').RotationDeformerSpec} spec
 * @returns {object} - a `type:'deformer', deformerKind:'rotation'` node
 */
export function rotationSpecToDeformerNode(spec) {
  return {
    type: 'deformer',
    deformerKind: 'rotation',
    id: spec.id,
    name: spec.name ?? spec.id,
    parent: parentSpecToNodeId(spec.parent),
    visible: spec.isVisible !== false,
    bindings: (spec.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (spec.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      angle: typeof k.angle === 'number' ? k.angle : 0,
      originX: typeof k.originX === 'number' ? k.originX : 0,
      originY: typeof k.originY === 'number' ? k.originY : 0,
      scale: typeof k.scale === 'number' ? k.scale : 1,
      reflectX: k.reflectX === true,
      reflectY: k.reflectY === true,
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    baseAngle: typeof spec.baseAngle === 'number' ? spec.baseAngle : 0,
    handleLengthOnCanvas:
      typeof spec.handleLengthOnCanvas === 'number' ? spec.handleLengthOnCanvas : 200,
    circleRadiusOnCanvas:
      typeof spec.circleRadiusOnCanvas === 'number' ? spec.circleRadiusOnCanvas : 100,
    isLocked: spec.isLocked === true,
    useBoneUiTestImpl: spec.useBoneUiTestImpl !== false,
  };
}

/**
 * Remove every rotation deformer node, if present. Used by
 * `seedAllRig` (replace mode) to wipe stale rotation entries before
 * upserting fresh ones from the new harvest.
 *
 * @param {Array<object>} nodes
 */
export function removeAllRotationDeformerNodes(nodes) {
  removeDeformerNodesByPredicate(nodes, (n) => n.deformerKind === 'rotation');
}

/**
 * Convert a stored warp spec (faceParallax / bodyWarp[i] / rigWarps[partId])
 * into a deformer node. The spec shape matches what
 * `faceParallaxStore.serializeFaceParallaxSpec` / `bodyWarpStore._serializeSpec`
 * / `rigWarpsStore._serializeRigWarpSpec` produce — i.e. JSON-friendly
 * (Float64Array → number[]).
 *
 * @param {object} stored - a serialized warp spec (Float64Array → number[])
 * @returns {object} - a `type:'deformer', deformerKind:'warp'` node
 */
export function warpSpecToDeformerNode(stored) {
  const node = {
    type: 'deformer',
    deformerKind: 'warp',
    id: stored.id,
    name: stored.name,
    parent: parentSpecToNodeId(stored.parent),
    visible: stored.isVisible !== false,
    gridSize: {
      rows: stored.gridSize?.rows ?? 5,
      cols: stored.gridSize?.cols ?? 5,
    },
    baseGrid: Array.isArray(stored.baseGrid) ? stored.baseGrid.slice() : [],
    localFrame: stored.localFrame ?? 'canvas-px',
    bindings: (stored.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (stored.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      positions: Array.isArray(k.positions) ? k.positions.slice() : [],
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    isLocked: stored.isLocked === true,
    isQuadTransform: stored.isQuadTransform === true,
  };
  // Per-mesh rigWarps carry `targetPartId` + `canvasBbox`; preserve them.
  if (typeof stored.targetPartId === 'string' && stored.targetPartId.length > 0) {
    node.targetPartId = stored.targetPartId;
  }
  if (stored.canvasBbox && typeof stored.canvasBbox === 'object') {
    node.canvasBbox = {
      minX: stored.canvasBbox.minX ?? 0,
      minY: stored.canvasBbox.minY ?? 0,
      W: stored.canvasBbox.W ?? 0,
      H: stored.canvasBbox.H ?? 0,
    };
  }
  // V3 Re-Rig — top-level _userAuthored carried through.
  if (stored._userAuthored === true) {
    node._userAuthored = true;
  }
  return node;
}

/**
 * Upsert a deformer node into a `project.nodes` array, keyed by id.
 * Mutates the array in place (matches the immer-friendly callsites in
 * the seeders).
 *
 * @param {Array<object>} nodes
 * @param {object} node - a deformer node (from `warpSpecToDeformerNode`)
 */
export function upsertDeformerNode(nodes, node) {
  if (!Array.isArray(nodes) || !node || !node.id) return;
  const existing = nodes.findIndex((n) => n && n.id === node.id);
  if (existing >= 0) {
    nodes[existing] = node;
  } else {
    nodes.push(node);
  }
}

/**
 * Remove every deformer node matching a predicate from
 * `project.nodes`. Mutates the array in place.
 *
 * @param {Array<object>} nodes
 * @param {(node: object) => boolean} predicate
 */
export function removeDeformerNodesByPredicate(nodes, predicate) {
  if (!Array.isArray(nodes)) return;
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < nodes.length; readIdx++) {
    const n = nodes[readIdx];
    const drop = n && n.type === 'deformer' && predicate(n);
    if (!drop) {
      if (writeIdx !== readIdx) nodes[writeIdx] = n;
      writeIdx++;
    }
  }
  nodes.length = writeIdx;
}

/**
 * Remove the FaceParallax deformer node, if present.
 * @param {Array<object>} nodes
 */
export function removeFaceParallaxNode(nodes) {
  removeDeformerNodesByPredicate(nodes, (n) => n.id === FACE_PARALLAX_NODE_ID);
}

/**
 * Remove every body-warp chain deformer node (BodyZWarp / BodyYWarp /
 * BreathWarp / BodyXWarp), if present. Used by `clearBodyWarp` and by
 * `seedBodyWarpChain` before a fresh chain is upserted (so a 4-spec
 * chain replacing a 3-spec chain doesn't leave a stale BX node).
 *
 * @param {Array<object>} nodes
 */
export function removeBodyWarpChainNodes(nodes) {
  removeDeformerNodesByPredicate(nodes, (n) => BODY_WARP_NODE_ID_SET.has(n.id));
}

/**
 * Remove every per-part rigWarp deformer node (those with
 * `targetPartId` set). Used by `clearRigWarps` and by `seedRigWarps`
 * (`mode:'replace'`) before a fresh map is upserted.
 *
 * @param {Array<object>} nodes
 */
export function removeRigWarpNodes(nodes) {
  removeDeformerNodesByPredicate(nodes, (n) => typeof n.targetPartId === 'string' && n.targetPartId.length > 0);
}

/**
 * Migration v15 helper — synthesise deformer nodes from the legacy
 * sidetables and append them to `project.nodes`. Also writes
 * `parts[i].rigParent` for every part referenced by `project.rigWarps`.
 *
 * Idempotent: existing deformer nodes with matching ids are upserted in
 * place rather than duplicated. Safe to call on a project that already
 * carries deformer nodes (e.g. the migration is rerun against a
 * partially-migrated fixture).
 *
 * @param {object} project - mutated in place
 */
export function synthesizeDeformerNodesFromSidetables(project) {
  if (!project) return;
  if (!Array.isArray(project.nodes)) project.nodes = [];

  // 1. FaceParallax
  if (project.faceParallax && typeof project.faceParallax === 'object') {
    upsertDeformerNode(project.nodes, warpSpecToDeformerNode(project.faceParallax));
  }

  // 2. Body warp chain — keep BZ→BY→Breath→BX order so the array order
  //    matches the chain's parent-before-child invariant for the Phase 2
  //    selector.
  if (project.bodyWarp && typeof project.bodyWarp === 'object'
      && Array.isArray(project.bodyWarp.specs)) {
    for (const spec of project.bodyWarp.specs) {
      if (!spec) continue;
      upsertDeformerNode(project.nodes, warpSpecToDeformerNode(spec));
    }
  }

  // 3. Per-mesh rigWarps. Also write `parts[partId].rigParent` so the
  //    Phase 2 selector can resolve parent without walking rigSpec.
  if (project.rigWarps && typeof project.rigWarps === 'object') {
    for (const [partId, spec] of Object.entries(project.rigWarps)) {
      if (!spec || typeof spec !== 'object') continue;
      upsertDeformerNode(project.nodes, warpSpecToDeformerNode(spec));
      const partNode = project.nodes.find((n) => n && n.id === partId && n.type === 'part');
      if (partNode && typeof spec.id === 'string') {
        partNode.rigParent = spec.id;
      }
    }
  }
}
