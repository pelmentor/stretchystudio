/**
 * Object / Object-Data accessors.
 *
 * Phase 1 of the Blender Parity Refactor (see
 * `docs/plans/BLENDER_PARITY_REFACTOR.md`). Today's `project.nodes` array
 * conflates the Blender notion of `Object` (transform container) with
 * `ObjectData` (Mesh / Armature payload). Phase 1B introduces a v18 schema
 * where the two are separate node entries linked by `dataId`. To avoid
 * a big-bang rewrite of the ~165 reader sites, callers go through these
 * helpers; the helpers return the right thing on both v17 and v18 shapes.
 *
 * Today every accessor reads v17 fields directly. The v18 path will be a
 * second branch keyed off `node.type === 'object' && node.dataKind`.
 *
 * Optional `project` argument: passed when callers have it handy, used in
 * v18 for `dataId` lookup. If omitted, helpers still work in v17 since
 * v17 holds the data inline. Once Phase 1C ships, callers without a
 * project will get a console warning + best-effort fallback.
 *
 * @module store/objectDataAccess
 */

// ── Type predicates ───────────────────────────────────────────────────────

/**
 * Whether this node is an Object — a transform-bearing container.
 *
 * v17: `part` and `group` nodes are objects; `deformer` is not.
 * v18: `type === 'object'`.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isObject(node) {
  if (!node || typeof node !== 'object') return false;
  return node.type === 'part' || node.type === 'group' || node.type === 'object';
}

/**
 * Whether this object holds mesh data.
 *
 * v17: a `part` node with a non-null `mesh` sub-object.
 * v18: a `part` node with `dataId` resolving to a `meshData` sibling
 *      (the Object/ObjectData split). Falls back to the v17 inline
 *      check when `project` is omitted or no linked data node exists.
 *
 * `requireMesh` (default true) means "has actual vertex data", not just
 * "is the right type" — a part whose PSD layer hasn't been meshed yet
 * returns false.
 *
 * @param {object|null|undefined} node
 * @param {object} [project]
 * @param {object} [opts]
 * @param {boolean} [opts.requireMesh=true]
 * @returns {boolean}
 */
export function isMeshedPart(node, project, { requireMesh = true } = {}) {
  if (!node) return false;
  if (node.type !== 'part') return false;
  if (!requireMesh) return true;
  return !!getMesh(node, project);
}

/**
 * Whether this node is a bone — a group carrying a `boneRole` and
 * pose channel.
 *
 * v17: `type === 'group' && !!boneRole`.
 * v18: an `object` whose data is an Armature, OR a Bone entry inside one.
 * (Resolution path will be settled by Phase 1C.)
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isBoneGroup(node) {
  if (!node) return false;
  return node.type === 'group' && !!node.boneRole;
}

/**
 * Whether this is a plain organisational group (not a bone).
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isPlainGroup(node) {
  if (!node) return false;
  return node.type === 'group' && !node.boneRole;
}

/**
 * Whether this is a deformer entry (warp / rotation).
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isDeformer(node) {
  return !!node && node.type === 'deformer';
}

/**
 * Blender-style data-kind classifier for an Object node. Returns the
 * payload type so `modeCompatTest(dataKind, mode)` can decide which
 * edit modes apply.
 *
 * - `'mesh'`     — meshed parts (the SS data-block holding vertices).
 *                  An unmeshed PSD layer (`type:'part'` with no mesh
 *                  yet) returns `'mesh'` too — Blender's analogue is an
 *                  empty Mesh data block, which still allows Object
 *                  Mode + Edit Mode (the latter just shows zero verts).
 * - `'armature'` — bone-role group (rest pivot + pose channel).
 * - `'empty'`    — plain organisational group (no payload), or any
 *                  unrecognised / data-block-less node.
 * - `'deformer'` — warp / rotation modifier node (not an Object today;
 *                  surfaced for completeness so callers can branch
 *                  cleanly without falling into 'empty').
 * - `null`       — `node` was null/undefined.
 *
 * @param {object|null|undefined} node
 * @param {object} [_project] — reserved for v18 dataKind lookup
 * @returns {('mesh'|'armature'|'empty'|'deformer'|null)}
 */
export function getDataKind(node, _project) {
  if (!node) return null;
  if (node.type === 'part') return 'mesh';
  if (isBoneGroup(node)) return 'armature';
  if (node.type === 'group') return 'empty';
  if (node.type === 'deformer') return 'deformer';
  if (node.type === 'meshData') return 'mesh';
  return 'empty';
}

// ── Mesh data ─────────────────────────────────────────────────────────────

/**
 * Mesh sub-record on a part — `{ vertices, uvs, triangles, edgeIndices,
 * boneWeights?, jointBoneId?, weightGroups? }`. Returns null for nodes
 * that aren't meshed parts.
 *
 * Mutating the returned object mutates project state — callers inside
 * `produce` recipes get a draft proxy and can write directly; readers
 * should treat the result as immutable.
 *
 * v17: reads `node.mesh` inline.
 * v18 (planned): if `node.dataId` is set, look up the linked data node
 * in `project.nodes`; falls back to `node.mesh` for unmigrated entries.
 *
 * @param {object|null|undefined} node
 * @param {object} [project] — needed for v18 dataId lookup; optional today
 * @returns {object|null}
 */
export function getMesh(node, project) {
  if (!node) return null;
  if (node.type === 'part') {
    if (typeof node.dataId === 'string' && project && Array.isArray(project.nodes)) {
      const data = project.nodes.find((n) => n?.id === node.dataId);
      if (data && data.type === 'meshData') return data;
    }
    return node.mesh ?? null;
  }
  return null;
}

/**
 * Set or replace a part's mesh data.
 *
 * v17 path: writes `node.mesh = mesh`.
 * v18 path: if `node.dataId` is set and a matching `meshData` node
 * exists in `project.nodes`, replace its body in place. Otherwise (no
 * dataId yet) keep the v17 inline shape — the schema migration handles
 * promotion to v18 lazily on next load.
 *
 * No-op when `node` isn't a part. Caller is responsible for being inside
 * an `updateProject((p) => …)` / Immer `produce` recipe — the helper
 * just mutates the draft.
 *
 * @param {object|null|undefined} node
 * @param {object|null} mesh — the new mesh payload, or null to clear
 * @param {object} [project] — needed for v18 data-node bookkeeping
 */
export function setMesh(node, mesh, project) {
  if (!node || node.type !== 'part') return;
  // v18 path: linked data node.
  if (typeof node.dataId === 'string' && project && Array.isArray(project.nodes)) {
    const idx = project.nodes.findIndex((n) => n?.id === node.dataId);
    if (idx >= 0) {
      if (mesh == null) {
        // Remove the data node entirely + drop the pointer.
        project.nodes.splice(idx, 1);
        delete node.dataId;
        return;
      }
      // Replace the data node body (preserving id + type).
      const existing = project.nodes[idx];
      // Wipe owned fields, then set the new ones. Simpler than diffing.
      for (const k of Object.keys(existing)) {
        if (k === 'id' || k === 'type') continue;
        delete existing[k];
      }
      Object.assign(existing, mesh);
      return;
    }
    // dataId set but data node missing — fall through to v17 inline
    // (caller's chosen shape wins; migration will reconcile on next load).
  }
  // v17 path: inline.
  node.mesh = mesh;
}

/**
 * Remove a part's mesh data. Equivalent to `setMesh(node, null, project)`
 * but explicit about the deletion intent for callers + future v18 cleanup
 * (when the linked data node is also removable).
 *
 * @param {object|null|undefined} node
 * @param {object} [project]
 */
export function clearMesh(node, project) {
  setMesh(node, null, project);
}

/**
 * Mesh-generation options on a part.
 *
 * @param {object|null|undefined} node
 * @param {object} [_project]
 * @returns {object|null}
 */
export function getMeshOpts(node, _project) {
  if (!node) return null;
  if (node.type === 'part') return node.meshOpts ?? null;
  return null;
}

/**
 * Vertices of a part's mesh — flat `[{x,y}, ...]` array, or null.
 * Convenience over `getMesh(node)?.vertices`.
 *
 * @param {object|null|undefined} node
 * @param {object} [project]
 * @returns {Array<{x:number,y:number}>|null}
 */
export function getMeshVertices(node, project) {
  return getMesh(node, project)?.vertices ?? null;
}

/**
 * Triangles index buffer of a part's mesh.
 *
 * @param {object|null|undefined} node
 * @param {object} [project]
 * @returns {number[]|Uint16Array|Uint32Array|null}
 */
export function getMeshTriangles(node, project) {
  return getMesh(node, project)?.triangles ?? null;
}

// ── Blend shapes ──────────────────────────────────────────────────────────

/**
 * Blend-shape spec array on a part. Sparse arrays aren't normalised to
 * `[]` — null means "not applicable" (non-part) and `[]` means "part
 * with zero shapes".
 *
 * @param {object|null|undefined} node
 * @param {object} [_project]
 * @returns {Array<object>|null}
 */
export function getBlendShapes(node, _project) {
  if (!node) return null;
  if (node.type === 'part') return node.blendShapes ?? null;
  return null;
}

/**
 * Staging-mode blend-shape influence map on a part: `{ [shapeId]: 0..1 }`.
 *
 * @param {object|null|undefined} node
 * @param {object} [_project]
 * @returns {object|null}
 */
export function getBlendShapeValues(node, _project) {
  if (!node) return null;
  if (node.type === 'part') return node.blendShapeValues ?? null;
  return null;
}

// ── Bone / armature ───────────────────────────────────────────────────────

/**
 * Bone role string for a bone group, or null for non-bones.
 *
 * @param {object|null|undefined} node
 * @returns {string|null}
 */
export function getBoneRole(node) {
  if (!isBoneGroup(node)) return null;
  return node.boneRole ?? null;
}

/**
 * Bone rest pivot — `{ x, y }` in image-space. v17: lives on
 * `node.transform.{pivotX, pivotY}` (the only `transform` fields that
 * stay live on bones post-v17). Phase 1C will move this onto the
 * Bone struct inside the Armature data block.
 *
 * @param {object|null|undefined} node
 * @returns {{x:number, y:number}|null}
 */
export function getBoneRestPivot(node) {
  if (!isBoneGroup(node)) return null;
  const t = node.transform;
  if (!t) return null;
  return { x: t.pivotX ?? 0, y: t.pivotY ?? 0 };
}

/**
 * Bone pose deltas -- `{ rotation, x, y, scaleX, scaleY }`.
 *
 * v17/v18: lives on `node.pose` directly (flat shape).
 * v19+ (Phase 1C): lives on `node.pose.channels[node.id]` (the
 * Blender PoseChannel pattern, where each Object's `pose.channels` is
 * a map keyed by bone id; today's bone-group-IS-Object collapses that
 * to a single self-keyed channel per node).
 *
 * Returns null for non-bones; returns identity-pose for bones missing
 * a pose object (legacy projects mid-migration).
 *
 * # Audit-fix D-6 (Phase 8 sweep) — null-vs-identity contract
 *
 * Returning identity-pose for "no authored pose" conflates two
 * semantically distinct states: (1) the bone is at rest because the
 * user hasn't posed it; (2) the bone is at rest because the user
 * explicitly cleared its pose to identity. Render paths don't care —
 * both states produce the same visual output. Driver / FCurve
 * evaluators that need to distinguish "no value yet" from "value 0"
 * should call `node.pose` directly (and handle both shapes), or
 * convert this contract to nullable with a separate audit pass. Today
 * no caller cares, so the simpler "always return a pose" contract
 * stays.
 *
 * @param {object|null|undefined} node
 * @returns {{rotation:number,x:number,y:number,scaleX:number,scaleY:number}|null}
 */
export function getBonePose(node) {
  if (!isBoneGroup(node)) return null;
  const raw = node.pose;
  // v19 shape: `pose.channels[boneId]` is the per-bone PoseChannel.
  // Audit-fix G-5/G-6 (Phase 8 sweep): tightened typeof checks with
  // `!Array.isArray(...)` — a malformed array on `pose` or
  // `pose.channels` previously slipped through the `typeof === 'object'`
  // guard and masked the corruption.
  let p = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)
      && raw.channels && typeof raw.channels === 'object' && !Array.isArray(raw.channels)) {
    p = raw.channels[node.id];
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  }
  return {
    rotation: typeof p.rotation === 'number' ? p.rotation : 0,
    x:        typeof p.x        === 'number' ? p.x        : 0,
    y:        typeof p.y        === 'number' ? p.y        : 0,
    scaleX:   typeof p.scaleX   === 'number' ? p.scaleX   : 1,
    scaleY:   typeof p.scaleY   === 'number' ? p.scaleY   : 1,
  };
}

/** Pose-channel field names — strict guard for `setBonePoseField`. */
const POSE_CHANNEL_FIELDS = new Set(['rotation', 'x', 'y', 'scaleX', 'scaleY']);

/**
 * Resolve a writable PoseChannel object on a bone-group node, mirroring
 * `getBonePose`'s shape detection. Initialises missing fields to identity
 * (`rotation:0, x:0, y:0, scaleX:1, scaleY:1`) so callers can always
 * write into the returned object directly.
 *
 * Shape rules:
 *   - v17/v18 flat shape (`node.pose = {rotation, x, ...}`): returns
 *     `node.pose` itself.
 *   - v19+ channels shape (`node.pose = { channels: { [boneId]: {...} } }`):
 *     returns `node.pose.channels[node.id]`, creating the inner channel
 *     entry if missing (preserves the channels-shape envelope intact).
 *   - Missing pose entirely: creates flat shape (the safer default —
 *     never spontaneously creates channels-shape, since that's the
 *     v19 migration's job).
 *
 * Returns null for non-bone nodes — callers should treat that as a
 * silent no-op (consistent with `getBonePose`'s null contract).
 *
 * # Audit-fix D-5 (Phase 8 sweep) — foreign channels untouched
 *
 * If a bone's `pose.channels` carries entries for OTHER bones (`{[other.id]:
 * {...}}`), this helper reads/creates only the self-keyed channel
 * (`channels[node.id]`) and leaves foreign entries alone. Today no code
 * path produces foreign channels (bone-group IS Object → 1:1), so this
 * is purely defensive for the eventual Phase 1C-flip where one armature
 * Object may own N bone channels. Pruning would be premature
 * canonicalisation that breaks 1C-flip's intent.
 *
 * @param {object|null|undefined} node
 * @returns {{rotation:number,x:number,y:number,scaleX:number,scaleY:number}|null}
 */
export function ensureBonePoseChannel(node) {
  if (!isBoneGroup(node)) return null;

  // No pose at all → init flat (matches today's bone-group-IS-Object
  // reality; v19 migration channelises on next save+load if needed).
  // Audit-fix G-5/G-6 (Phase 8 sweep): tightened the typeof check
  // with `!Array.isArray(...)` so a malformed `node.pose = []` (or
  // any array) doesn't slip past the guard and get decorated with
  // named pose fields.
  if (!node.pose || typeof node.pose !== 'object' || Array.isArray(node.pose)) {
    node.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    return node.pose;
  }

  // v19+ channels shape — drill into channels[node.id], creating if
  // missing. Preserves the channels envelope so the v19 reader path
  // stays valid.
  if (node.pose.channels && typeof node.pose.channels === 'object' && !Array.isArray(node.pose.channels)) {
    let ch = node.pose.channels[node.id];
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) {
      ch = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
      node.pose.channels[node.id] = ch;
      return ch;
    }
    if (typeof ch.rotation !== 'number') ch.rotation = 0;
    if (typeof ch.x        !== 'number') ch.x        = 0;
    if (typeof ch.y        !== 'number') ch.y        = 0;
    if (typeof ch.scaleX   !== 'number') ch.scaleX   = 1;
    if (typeof ch.scaleY   !== 'number') ch.scaleY   = 1;
    return ch;
  }

  // v17/v18 flat shape — fill missing fields, return the pose object
  // itself.
  const p = node.pose;
  if (typeof p.rotation !== 'number') p.rotation = 0;
  if (typeof p.x        !== 'number') p.x        = 0;
  if (typeof p.y        !== 'number') p.y        = 0;
  if (typeof p.scaleX   !== 'number') p.scaleX   = 1;
  if (typeof p.scaleY   !== 'number') p.scaleY   = 1;
  return p;
}

/**
 * Write a single pose-channel field on a bone-group node, routing
 * through the shape-aware writer. Silent no-op for non-bones or for
 * unknown field names (strict guard against typos like `'rot'` or
 * `'translateX'`).
 *
 * Field names: `'rotation' | 'x' | 'y' | 'scaleX' | 'scaleY'`.
 *
 * @param {object|null|undefined} node
 * @param {string} field
 * @param {number} value
 */
export function setBonePoseField(node, field, value) {
  if (!POSE_CHANNEL_FIELDS.has(field)) return;
  if (typeof value !== 'number') return;
  const ch = ensureBonePoseChannel(node);
  if (!ch) return;
  ch[field] = value;
}

/**
 * Atomic multi-field write — sets every numeric field on `partialPose`
 * onto the bone's PoseChannel. Unset fields keep their current values
 * (so a `{x: 10, y: 5}` write doesn't accidentally zero rotation).
 *
 * @param {object|null|undefined} node
 * @param {Partial<{rotation:number,x:number,y:number,scaleX:number,scaleY:number}>} partialPose
 */
export function setBonePose(node, partialPose) {
  // Audit-fix G-4 (Phase 8 sweep): early-return BEFORE
  // `ensureBonePoseChannel` if `partialPose` carries no numeric pose
  // fields. The previous version would init `node.pose = {identity}`
  // on a pose-less bone for an empty/null/junk write — surprising
  // mutation that masked caller bugs. Now: only mutate when there's
  // actually something to write.
  if (!partialPose || typeof partialPose !== 'object' || Array.isArray(partialPose)) return;
  const hasAnyField =
       typeof partialPose.rotation === 'number'
    || typeof partialPose.x        === 'number'
    || typeof partialPose.y        === 'number'
    || typeof partialPose.scaleX   === 'number'
    || typeof partialPose.scaleY   === 'number';
  if (!hasAnyField) return;
  const ch = ensureBonePoseChannel(node);
  if (!ch) return;
  if (typeof partialPose.rotation === 'number') ch.rotation = partialPose.rotation;
  if (typeof partialPose.x        === 'number') ch.x        = partialPose.x;
  if (typeof partialPose.y        === 'number') ch.y        = partialPose.y;
  if (typeof partialPose.scaleX   === 'number') ch.scaleX   = partialPose.scaleX;
  if (typeof partialPose.scaleY   === 'number') ch.scaleY   = partialPose.scaleY;
}

// ── Armature data ─────────────────────────────────────────────────────────

/**
 * Phase 1C scaffolding — Blender's `bArmature` (defined in
 * `reference/blender/source/blender/makesdna/DNA_armature_types.h:403`)
 * is an ObjectData block whose `bonebase` is a `ListBase<Bone>` of root
 * bones; each `Bone` (line :302) has `name`, `parent`, child list,
 * `head`/`tail` (bone-space), `arm_head`/`arm_tail` (armature-space),
 * `arm_mat[4][4]`, plus B-bone, envelope, and curve fields. SS today
 * still has flat `group + boneRole` nodes in `project.nodes`; this
 * helper presents that flat list as a synthetic Armature view so future
 * callers (constraint editors, Outliner armature drill-down, FCurve RNA
 * paths like `objects["armature"].pose.channels[0].rotation_euler`) can
 * be authored against the eventual Phase 1C-flip schema without breaking
 * today's reader contract.
 *
 * The `Armature` view today is `{ id, bones }` where `bones[]` is a list
 * of `{ id, name, role, parent, restPivot, pose }`. There's exactly ONE
 * synthetic armature per project today (`__armature__`); when the schema
 * flips, this becomes one armature data node per top-level bone tree
 * (multiple armatures supported).
 *
 * # Deviations from Blender's `Bone`
 *
 * - SS bones are 2D (canvas-space) and have no length — `restPivot`
 *   is the analog of Blender's 2D-projected `arm_head`, but there's
 *   no `arm_tail` because joint positions are points, not segments,
 *   in the current SS model.
 * - No B-bone settings, no envelope deformer, no roll.
 * - `pose` here is the per-bone pose delta (`pose.{rotation, x, y,
 *   scaleX, scaleY}`) which Blender models in `bPoseChannel` (a
 *   parallel struct living on the Object, not the Armature). SS
 *   inlines this on the bone view today; Phase 1C will split them.
 *
 * @typedef {Object} BoneRecord
 * @property {string} id
 * @property {string} name
 * @property {string|null} role
 * @property {string|null} parent           parent bone id (or null at root)
 * @property {{x:number, y:number}} restPivot
 * @property {{rotation:number,x:number,y:number,scaleX:number,scaleY:number}} pose
 *
 * @typedef {Object} ArmatureView
 * @property {string} id
 * @property {BoneRecord[]} bones
 */

/**
 * Resolve an ArmatureView for the project.
 *
 * v17/v18: synthesises a single armature view aggregating every
 * bone-role group in the project (one synthetic `__armature__` block).
 * v19+: prefers `armatureData` nodes when present; their `bones[]`
 * already carry rest data, and the helper threads pose data from each
 * bone-group node's `pose.channels[boneId]` per the Phase 1C migration.
 *
 * Returns null when no bones exist in the project.
 *
 * @param {object|null|undefined} project
 * @returns {ArmatureView|null}
 */
export function getArmature(project) {
  if (!project || !Array.isArray(project.nodes)) return null;
  // v19 path: an `armatureData` node lifts rest hierarchy out of the
  // flat bone-group nodes. Use it when present.
  for (const n of project.nodes) {
    if (n?.type !== 'armatureData' || !Array.isArray(n.bones)) continue;
    const bones = [];
    for (const b of n.bones) {
      if (!b?.id) continue;
      const ownerNode = project.nodes.find((nn) => nn.id === b.id);
      bones.push({
        id: b.id,
        name: b.name ?? b.id,
        role: b.role ?? null,
        parent: b.parent ?? null,
        restPivot: b.restPivot ?? { x: 0, y: 0 },
        // Pose lives on the underlying bone-group Object via
        // `getBonePose` (which already reads v19 `pose.channels` shape).
        pose: ownerNode ? getBonePose(ownerNode) : { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
      });
    }
    if (bones.length > 0) return { id: n.id, bones };
  }

  // v17/v18 fallback: synthesise from flat bone-group nodes.
  const bones = [];
  for (const n of project.nodes) {
    if (!isBoneGroup(n)) continue;
    bones.push({
      id: n.id,
      name: n.name ?? n.id,
      role: getBoneRole(n),
      parent: n.parent ?? null,
      restPivot: getBoneRestPivot(n) ?? { x: 0, y: 0 },
      pose: getBonePose(n) ?? { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    });
  }
  if (bones.length === 0) return null;
  return { id: '__armature__', bones };
}

/**
 * Find a bone by role string. Helper for the common
 * `nodes.find(n => n.boneRole === 'leftElbow')` pattern.
 *
 * @param {object|null|undefined} project
 * @param {string} role
 * @returns {object|null} the underlying bone-group node, or null
 */
export function getBoneByRole(project, role) {
  if (!project || !Array.isArray(project.nodes)) return null;
  for (const n of project.nodes) {
    if (isBoneGroup(n) && getBoneRole(n) === role) return n;
  }
  return null;
}

/**
 * Find a bone by the group's display name.
 *
 * @param {object|null|undefined} project
 * @param {string} name
 * @returns {object|null}
 */
export function getBoneByName(project, name) {
  if (!project || !Array.isArray(project.nodes)) return null;
  for (const n of project.nodes) {
    if (isBoneGroup(n) && (n.name ?? n.id) === name) return n;
  }
  return null;
}

/**
 * List every bone-group node in the project.
 *
 * @param {object|null|undefined} project
 * @returns {Array<object>}
 */
export function getBonesIn(project) {
  if (!project || !Array.isArray(project.nodes)) return [];
  return project.nodes.filter((n) => isBoneGroup(n));
}

// ── Per-object mode (Phase 2b scaffold) ───────────────────────────────────

/**
 * Phase 2b scaffold — Blender stores the active edit mode on each
 * Object (`Object.mode`) so two armatures can be in different modes
 * simultaneously. SS today has one global `editorStore.editMode` slot
 * driving every reader; flipping that to per-object storage is medium-
 * blast-radius work (every reader needs migration).
 *
 * For now: `Object.mode` is an OPTIONAL field. When set, it's the
 * "remembered last mode" for that object, used by future selection-
 * change logic to restore mode on re-select. The global slot remains
 * the read source-of-truth; helpers below let writers populate the
 * field opportunistically so the storage migration in Phase 2b-flip
 * inherits warm data.
 *
 * Mode value contract: matches `src/modes/modeCompat.js` constants
 * (`null` = Object Mode, `'mesh'`, `'skeleton'`, `'weightPaint'`,
 * `'blendShape'`, ...).
 *
 * @param {object|null|undefined} node
 * @returns {*} the stored mode, or `null` (= Object Mode) if absent
 */
export function getObjectMode(node) {
  if (!node) return null;
  // `mode` is optional; absent = Object Mode (the universal default).
  return node.mode ?? null;
}

/**
 * Set the per-object mode. Caller is inside an `updateProject`
 * recipe; this just mutates the draft.
 *
 * Pass `null` (or `MODE_OBJECT`) to clear the field — equivalent to
 * "this object is in Object Mode," which is the default. Empty fields
 * keep the JSON small.
 *
 * @param {object|null|undefined} node
 * @param {*} mode
 */
export function setObjectMode(node, mode) {
  if (!node) return;
  if (mode === null || mode === undefined) {
    if ('mode' in node) delete node.mode;
    return;
  }
  node.mode = mode;
}

// ── Modifier stack (Phase 3 scaffold) ─────────────────────────────────────

/**
 * Phase 3 scaffold — Blender stores per-Object modifier stacks as a
 * `ListBase<ModifierData>` (defined in
 * `reference/blender/source/blender/makesdna/DNA_modifier_types.h:169`)
 * iterated top-to-bottom in eval order. SS today expresses the same
 * chain via parent-link relationships in the flat `project.nodes` array
 * (deformer nodes parented to their downstream targets). The flip moves
 * them into a real stack on each Object so eval order is intentional,
 * not derivable from topology.
 *
 * Today's helpers: `getModifiers(node)` returns the `modifiers[]` array
 * (empty by default); `addModifier`/`removeModifier`/`reorderModifier`
 * let writers populate it opportunistically. The chainEval pipeline
 * still walks parent links — modifiers[] is shadow data until Phase 3-flip.
 *
 * # Deviations from Blender's `ModifierData`
 *
 * - Blender's `mode` field (`ModifierMode`) is a bitmask covering render
 *   visibility, realtime visibility, edit-mode visibility, and cage
 *   editing on top of "enabled". SS uses a single `enabled` boolean —
 *   the SS Live2D pipeline doesn't distinguish render vs realtime vs
 *   edit-cage, so the extra bits would be inert.
 * - Blender's `ui_expand_flag` (per-panel UI expansion state) lives in
 *   editor state in SS, not on the modifier itself.
 * - Blender's `execution_time` (per-modifier eval cost telemetry) isn't
 *   ported.
 *
 * @typedef {Object} ModifierData
 * @property {string} id                  — unique within object's modifiers[]
 * @property {string} type                — 'WARP_DEFORMER' | 'ROTATION_DEFORMER' | 'BLEND_SHAPE' | 'WEIGHT_GROUP_BIND' | future kinds
 * @property {string} name                — user-facing label
 * @property {boolean} [enabled]          — defaults true; false skips eval
 * @property {string} [persistentUid]     — stable id across re-creations (Blender's `persistent_uid`)
 * @property {object} payload             — type-specific data
 *
 * @param {object|null|undefined} node
 * @returns {ModifierData[]} — empty array if unset; never null
 */
export function getModifiers(node) {
  if (!node) return [];
  return Array.isArray(node.modifiers) ? node.modifiers : [];
}

/**
 * Append a modifier to an object's stack. Auto-creates the array if
 * absent. Returns the appended modifier (callers may want the auto-
 * assigned index for follow-up edits).
 *
 * @param {object} node
 * @param {ModifierData} mod
 * @returns {ModifierData}
 */
export function addModifier(node, mod) {
  if (!node) return mod;
  if (!Array.isArray(node.modifiers)) node.modifiers = [];
  node.modifiers.push(mod);
  return mod;
}

/**
 * Remove a modifier by id. Returns true if removed, false if not
 * found.
 *
 * @param {object} node
 * @param {string} modifierId
 * @returns {boolean}
 */
export function removeModifier(node, modifierId) {
  if (!node || !Array.isArray(node.modifiers)) return false;
  const idx = node.modifiers.findIndex((m) => m?.id === modifierId);
  if (idx < 0) return false;
  node.modifiers.splice(idx, 1);
  return true;
}

/**
 * Move a modifier to a new index in the stack. Negative `newIndex` or
 * indices past the end clamp to the valid range. No-op if `modifierId`
 * isn't found.
 *
 * @param {object} node
 * @param {string} modifierId
 * @param {number} newIndex
 * @returns {boolean} true if a move happened
 */
export function reorderModifier(node, modifierId, newIndex) {
  if (!node || !Array.isArray(node.modifiers)) return false;
  const arr = node.modifiers;
  const fromIdx = arr.findIndex((m) => m?.id === modifierId);
  if (fromIdx < 0) return false;
  const clamped = Math.max(0, Math.min(arr.length - 1, newIndex | 0));
  if (clamped === fromIdx) return false;
  const [m] = arr.splice(fromIdx, 1);
  arr.splice(clamped, 0, m);
  return true;
}

/**
 * Resolve a modifier entry's deformer state. Returns the modifier's
 * own `data` sub-object if present (post-v28); falls back to looking
 * up the matching `node.type === 'deformer'` entry in `project.nodes`
 * (pre-v28 / Phase 3.A backward-compat).
 *
 * Phase 3.A scaffold (BLENDER_DEVIATION_AUDIT Fix 3):
 *   - Pre-v28 readers walked `project.nodes` filter for the deformer.
 *   - Post-v28 the v28 migration copies that data into
 *     `modifier.data`.
 *   - Phase 3.B switches the export pipeline + UI editors to read
 *     through this helper so they see the modifier-data path.
 *   - Phase 3.C deletes the standalone deformer nodes.
 *
 * Always returns a plain object (or null on miss). Mutate at your
 * own risk during the dual-write window — modifier.data is a copy of
 * the deformer node's state, not a reference.
 *
 * @param {object|null|undefined} modifier  — entry from `node.modifiers[]`
 * @param {object|null|undefined} project   — project for fallback lookup
 * @returns {object|null}
 */
export function getModifierData(modifier, project) {
  if (!modifier || typeof modifier !== 'object') return null;
  if (modifier.data && typeof modifier.data === 'object') {
    return modifier.data;
  }
  // Pre-v28 fallback: look up the deformer node by id.
  if (typeof modifier.deformerId !== 'string') return null;
  if (!project || !Array.isArray(project.nodes)) return null;
  const node = project.nodes.find((n) =>
    n && n.type === 'deformer' && n.id === modifier.deformerId);
  return node ?? null;
}

// ── Constraint stack (Phase 4 scaffold) ───────────────────────────────────

/**
 * Phase 4 scaffold — Blender stores per-Object constraints and per-
 * PoseChannel constraints as `ListBase<bConstraint>` (defined in
 * `reference/blender/source/blender/makesdna/DNA_constraint_types.h:668`).
 * Constraints transform transforms (rather than geometry, which is what
 * modifiers do); they're the natural sibling abstraction.
 *
 * Initial constraint types per the plan: `COPY_LOCATION`,
 * `COPY_ROTATION`, `LIMIT_ROTATION`, `TRACK_TO`. IK is deferred (large;
 * needs solver — Blender uses the iTaSC IK solver).
 *
 * # Deviations from Blender's `bConstraint`
 *
 * - Blender's `ownspace` / `tarspace` (`eBConstraint_SpaceTypes`:
 *   WORLD / LOCAL / POSE / LOCAL_WITH_PARENT / OWNLOCAL) parametrise
 *   which coordinate frame the owner and target are evaluated in. SS's
 *   single 2D canvas + flat-canvas world space collapses these to a
 *   single space, so the fields aren't ported.
 * - Blender's panel-expansion state lives on the constraint
 *   (`ui_expand_flag`); SS keeps it in editor state.
 *
 * @typedef {Object} ConstraintData
 * @property {string} id
 * @property {string} type      — 'COPY_LOCATION' | 'COPY_ROTATION' | 'LIMIT_ROTATION' | 'TRACK_TO'
 * @property {string} name
 * @property {boolean} [enabled]
 * @property {number} [influence] — 0..1 mix amount; defaults 1
 * @property {object} payload   — type-specific (e.g. `{ targetId, headTail, ... }`)
 *
 * @param {object|null|undefined} node
 * @returns {ConstraintData[]}
 */
export function getConstraints(node) {
  if (!node) return [];
  return Array.isArray(node.constraints) ? node.constraints : [];
}

/**
 * Append a constraint to an object's stack.
 *
 * @param {object} node
 * @param {ConstraintData} con
 * @returns {ConstraintData}
 */
export function addConstraint(node, con) {
  if (!node) return con;
  if (!Array.isArray(node.constraints)) node.constraints = [];
  node.constraints.push(con);
  return con;
}

/**
 * Remove a constraint by id.
 *
 * @param {object} node
 * @param {string} constraintId
 * @returns {boolean}
 */
export function removeConstraint(node, constraintId) {
  if (!node || !Array.isArray(node.constraints)) return false;
  const idx = node.constraints.findIndex((c) => c?.id === constraintId);
  if (idx < 0) return false;
  node.constraints.splice(idx, 1);
  return true;
}

// ── Generic transform ─────────────────────────────────────────────────────

/**
 * Transform record on any object node — `{ x, y, rotation, scaleX,
 * scaleY, pivotX, pivotY }`.
 *
 * Note: for bones (v17+) the rotation/x/y/scale fields are RESERVED
 * at identity and do not represent the bone's pose. Pose lives in
 * `getBonePose(node)`. This helper returns the raw transform record
 * regardless.
 *
 * @param {object|null|undefined} node
 * @returns {{x:number,y:number,rotation:number,scaleX:number,scaleY:number,pivotX:number,pivotY:number}|null}
 */
export function getTransform(node) {
  if (!node) return null;
  return node.transform ?? null;
}
