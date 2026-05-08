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

import { DEFAULT_MIGRATED_MODE } from './migrations/v21_modifier_mode_flags.js';
import { coerceNumberArray } from '../lib/numberArrayCoerce.js';

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
    bindings: (spec.bindings ?? []).map((b, i) => ({
      parameterId: b.parameterId,
      keys: coerceNumberArray(b.keys, `rotationSpec.bindings[${i}].keys`),
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (spec.keyforms ?? []).map((k, i) => ({
      keyTuple: coerceNumberArray(k.keyTuple, `rotationSpec.keyforms[${i}].keyTuple`),
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
    baseGrid: coerceNumberArray(stored.baseGrid, `warpSpec[${stored.id}].baseGrid`),
    localFrame: stored.localFrame ?? 'canvas-px',
    bindings: (stored.bindings ?? []).map((b, i) => ({
      parameterId: b.parameterId,
      keys: coerceNumberArray(b.keys, `warpSpec[${stored.id}].bindings[${i}].keys`),
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (stored.keyforms ?? []).map((k, i) => ({
      keyTuple: coerceNumberArray(k.keyTuple, `warpSpec[${stored.id}].keyforms[${i}].keyTuple`),
      positions: coerceNumberArray(k.positions, `warpSpec[${stored.id}].keyforms[${i}].positions`),
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

/**
 * Phase 3 storage flip — derive each part's `Object.modifiers[]` stack
 * from the existing deformer-node tree. Pure derivation: reads only
 * `project.nodes` (deformer parent links + part.rigParent), writes to
 * `part.modifiers`.
 *
 * V2 Phase 0.3 update — modifier stacks are now CANONICAL; parent-link
 * shape (`deformer.parent` + `part.rigParent`) is a derived mirror.
 * `synthesizeModifierStacks` is called wherever the parent-link shape
 * has been freshly mutated (today's seed pipeline still mutates parent
 * links first because the harvest produces parent-keyed specs); the
 * companion `synthesizeDeformerParents` mirrors back. Future callers
 * should mutate stacks directly and trust the inverse synth to
 * maintain the parent-link mirror.
 *
 * The Blender modifier stack is a per-Object ordered list. SS today
 * encodes the equivalent via implicit chain traversal: a part's
 * `rigParent` points at the leaf deformer, which carries `parent` up to
 * the next deformer, up to root. Walking that chain in leaf-to-root
 * order yields the part's modifier stack.
 *
 * Each modifier record carries:
 *   - `type`: matches `deformer.deformerKind` ('warp' | 'rotation')
 *   - `deformerId`: pointer to the deformer node holding the actual data
 *   - `enabled`: true (Blender ModifierData has a per-modifier disable;
 *     reserved for future use — chainEval evaluates unconditionally)
 *   - `mode`: bitmask mirroring `ModifierData.mode` from
 *     `reference/blender/source/blender/makesdna/DNA_modifier_types.h:131-144`.
 *     Default `MODE_REALTIME | MODE_RENDER` — visible in viewport and
 *     included in export, matching today's always-on behaviour.
 *     Schema v21+.
 *   - `showInEditor`: true. Reserved for the v21+ Properties panel
 *     modifier-stack section to gate UI expansion.
 *
 * Today's chainEval path still reads `deformer.parent` directly — this
 * derivation is dual-write storage so future readers (e.g. a `Cycles`-
 * style stack-evaluator, or the modifier-stack UI) can iterate the
 * stack without re-walking the tree. When parent links change, callers
 * (rigWarpsStore.seedRigWarps, clearRigWarps, etc.) re-run this to
 * keep the stacks fresh.
 *
 * Idempotent and lossless: a missing rigParent yields an empty stack;
 * an empty stack drops the field entirely so the JSON stays compact.
 *
 * # Parts without rigParent
 *
 * A part without rigWarps coverage (no per-part rigWarp seeded → no
 * `rigParent`) ends up with an empty stack. At evaluation time today
 * (`selectRigSpec._buildArtMeshes`) such a part falls back to the
 * `innermostBodyWarpId` derived from the body warp chain. This implicit
 * fallback is NOT mirrored into `Object.modifiers[]` because:
 *   - `innermostBodyWarpId` is computed dynamically per chain shape;
 *     storing it would duplicate state that the chain already
 *     authoritatively carries.
 *   - Blender's modifier stack convention treats parent transforms +
 *     armature chains separately from modifiers — modifiers are the
 *     PER-OBJECT geometry transformations; "this object lives under
 *     the body rig" is parent/armature relationship, not a modifier.
 * Future readers iterating `Object.modifiers[]` should treat the empty
 * stack as "no per-part modifiers; rig flow handles deformation."
 *
 * @param {object} project - mutated in place
 */

/** Field lists for `_packModifierData` — must mirror the v28 migration
 *  in `migrations/v28_modifier_data_fold.js`. Phase 3.B will read from
 *  `modifier.data.<field>` instead of the deformer node, so the lists
 *  need to be synchronised. */
const _PACK_WARP_FIELDS = /** @type {const} */ ([
  'name', 'visible', 'gridSize', 'baseGrid', 'localFrame',
  'bindings', 'keyforms',
  'isLocked', 'isQuadTransform',
  'targetPartId', 'canvasBbox',
  '_userAuthored',
]);
const _PACK_ROTATION_FIELDS = /** @type {const} */ ([
  'name', 'visible',
  'bindings', 'keyforms',
  'baseAngle', 'handleLengthOnCanvas', 'circleRadiusOnCanvas',
  'isLocked', 'useBoneUiTestImpl',
  '_userAuthored',
]);

/**
 * Pack a deformer node's state into the `modifier.data` shape v28+
 * expects. Used by `synthesizeModifierStacks` so every rebuild
 * carries fresh data (the dual-write window).
 *
 * @param {object} def - a `type:'deformer'` node
 * @returns {object}
 */
function _packModifierData(def) {
  const fields = def.deformerKind === 'rotation'
    ? _PACK_ROTATION_FIELDS : _PACK_WARP_FIELDS;
  const data = {};
  for (const key of fields) {
    if (key in def) {
      data[key] = def[key];
    }
  }
  return data;
}

export function synthesizeModifierStacks(project) {
  if (!project) return;
  if (!Array.isArray(project.nodes)) return;
  const byId = new Map();
  for (const n of project.nodes) {
    if (n?.id) byId.set(n.id, n);
  }
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    const stack = [];
    const seen = new Set();
    let cur = typeof part.rigParent === 'string' && part.rigParent.length > 0
      ? part.rigParent
      : null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const def = byId.get(cur);
      if (!def || def.type !== 'deformer') break;
      stack.push({
        type: def.deformerKind ?? 'warp',
        deformerId: def.id,
        enabled: true,
        mode: DEFAULT_MIGRATED_MODE,
        showInEditor: true,
        // BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.A: dual-write the
        // deformer-node state into modifier.data so the per-part stack
        // becomes self-contained. Phase 3.B switches readers to this
        // path; Phase 3.C deletes the deformer node. Built via
        // `_packModifierData(def)` so the field list stays in sync
        // with the v28 migration.
        data: _packModifierData(def),
      });
      cur = typeof def.parent === 'string' && def.parent.length > 0
        ? def.parent
        : null;
    }
    if (stack.length > 0) {
      part.modifiers = stack;
    } else if ('modifiers' in part) {
      delete part.modifiers;
    }
  }
}

/**
 * Inverse synth — derive `deformer.parent` and `part.rigParent` from
 * the per-part `Object.modifiers[]` stacks. Counterpart to
 * `synthesizeModifierStacks`.
 *
 * Phase 0.2 of the V2 plan. Once Init Rig writes modifier stacks
 * directly (Phase 0.3), `cmo3writer.js` still reads `node.parent` for
 * the deformer chain; this function maintains that mirror as a derived
 * view of the canonical stack.
 *
 * # Contract
 *
 * For every part with a non-empty `modifiers[]`:
 *   - `part.rigParent` = `modifiers[0].deformerId` (the leaf deformer).
 *   - For every consecutive `(modifiers[i], modifiers[i+1])` pair, set
 *     `nodes[modifiers[i].deformerId].parent = modifiers[i+1].deformerId`.
 *   - The last modifier's deformer parent is NOT touched — what comes
 *     above the modifier stack (a non-deformer, root, or null) cannot
 *     be derived from the stack alone, so it stays as the project's
 *     existing value.
 *
 * For parts with empty / missing `modifiers[]`, this function is a
 * no-op — `part.rigParent` and any deformer parent links are left
 * exactly as they were.
 *
 * # Round-trip invariant (test-pinned)
 *
 *   `synthesizeModifierStacks(p)` then
 *   `synthesizeDeformerParents(p)` →
 *   identical `node.parent` and `part.rigParent` to the original
 *   (modulo synthetic body-warp inserts produced by v21).
 *
 * # Conflicting stacks
 *
 * Two parts may share a deformer leaf but have different upstream
 * parent chains; this is malformed input — the deformer parent is
 * single-valued. Last-write-wins; no validation is performed here. A
 * future audit can add a divergence detector if the malformed-input
 * case becomes load-bearing.
 *
 * @param {object} project - mutated in place
 */
export function synthesizeDeformerParents(project) {
  if (!project) return;
  if (!Array.isArray(project.nodes)) return;
  const byId = new Map();
  for (const n of project.nodes) {
    if (n?.id) byId.set(n.id, n);
  }
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    const stack = Array.isArray(part.modifiers) ? part.modifiers : null;
    if (!stack || stack.length === 0) continue;

    const leafId = stack[0]?.deformerId;
    if (typeof leafId === 'string' && leafId.length > 0) {
      part.rigParent = leafId;
    }

    for (let i = 0; i < stack.length - 1; i++) {
      const curId = stack[i]?.deformerId;
      const nextId = stack[i + 1]?.deformerId;
      if (typeof curId !== 'string' || typeof nextId !== 'string') continue;
      const def = byId.get(curId);
      if (!def || def.type !== 'deformer') continue;
      def.parent = nextId;
    }
  }
}
