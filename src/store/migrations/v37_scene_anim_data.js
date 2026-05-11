// @ts-check

/**
 * Schema v37 — Animation Phase 1 Stage 1.D:
 * `__scene__` pseudo-Object carrying project-wide AnimData.
 *
 * # Why this migration exists
 *
 * Per Animation Phase 1 plan §1.D
 * (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md`):
 *
 * > Some Actions animate every Object in the scene (the typical Cubism
 * > character motion). A project-level pseudo-Object (`__scene__`)
 * > carries an `animData` for these "scene" Actions. The exporter
 * > treats a `__scene__` AnimData identically to an Object AnimData —
 * > it walks the FCurves and writes them to motion3.json.
 *
 * Pre-v37, the v36 schema gave every regular Object node (parts + bone
 * groups) a `node.animData` slot, but there was nowhere to bind a
 * project-wide ("scene") action. Consumers picked the active action via
 * the UI store (`useAnimationStore.activeActionId`) — which is fine for
 * "what is the user currently editing" but wrong for "what action does
 * THIS PROJECT have bound." That distinction matters at export time
 * (motion3.json should reflect the bound action, not the UI's last
 * selection) and for save/load round-trips (the UI store doesn't
 * persist).
 *
 * v37 introduces a synthetic `__scene__` node:
 *
 *     {
 *       id:       '__scene__',
 *       type:     'sceneObject',
 *       name:     'Scene',
 *       animData: defaultAnimData(),  // Blender AnimData defaults
 *     }
 *
 * The synthetic-node convention matches `__params__` and `__armature__`
 * (the other double-underscore-prefixed pseudo-Objects). Putting scene
 * AnimData on a node — not on a peer field of `project` — means the
 * existing `actionRegistry` helpers (`getActionUsers`, `assignAction`,
 * `unassignAction`) walk it without modification, closing the read/write
 * asymmetry flagged by Audit-fix D-9 (Stage 1.C audit).
 *
 * # Blender source mirror
 *
 * In Blender, the Scene datablock itself owns AnimData via `Scene.adt`
 * (`reference/blender/source/blender/makesdna/DNA_scene_types.h:2225` —
 * `struct AnimData *adt;`). The animation system addresses scene
 * animation through the same `BKE_animdata_id_*` API as object
 * animation — there is no distinction at the read site, only at the ID
 * type. SS approximates this with the synthetic node convention: the
 * `__scene__` node IS the scene's animation host, and consumers walk
 * `node.animData` uniformly across regular and synthetic Objects.
 *
 * # Idempotent
 *
 * Re-running v37 on a v37+ project is a no-op: a pre-existing
 * `__scene__` node (whatever its current shape) is preserved in place.
 *
 * # Lossless
 *
 * Pre-v37 there was no scene-level animation binding to lose. v36
 * Object slots are untouched.
 *
 * # Cross-references
 *
 * - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1.D (line 546)
 *   — the Stage 1.D spec.
 * - `src/anim/actionRegistry.js` — `getActionUsers` / `assignAction` /
 *   `unassignAction` walk `project.nodes` looking for `node.animData`;
 *   the new `__scene__` node now appears in that walk uniformly.
 * - `src/anim/sceneAction.js` — `getActiveSceneAction(project,
 *   fallbackActionId)` selector; the consumer-side counterpart that
 *   prefers the scene's bound action over the UI store's pointer.
 * - `src/store/migrations/v36_action_datablock.js` — the v36 schema
 *   flip that introduced `node.animData` for regular Objects.
 * - `reference/blender/source/blender/makesdna/DNA_scene_types.h:2225`
 *   — Blender's Scene.adt pointer.
 *
 * @module store/migrations/v37_scene_anim_data
 */

/**
 * Default `node.animData` slot — Blender's `AnimData` defaults.
 *
 * Mirrors the same defaults as the v36 migration's `defaultAnimData()`
 * helper. Inlined here so this migration is self-contained (Rule for
 * migrations: time-locked code that doesn't track app evolution — a
 * future change to v36's defaults must NOT silently change what v37
 * writes for already-migrated projects).
 *
 * Field provenance (Blender source — see v36 migration for the full
 * citation list):
 *   - `actionInfluence = 1.0` (BKE runtime override per
 *     `blenkernel/intern/anim_data.cc:123`)
 *   - `actionBlendmode = 'replace'` (NLASTRIP_MODE_REPLACE = 0)
 *   - `actionExtendmode = 'hold'` (NLASTRIP_EXTEND_HOLD = 0)
 *   - `slotHandle = 0` (Slot::unassigned sentinel)
 *   - `flag = 0` (zero-init bitmask)
 *
 * @returns {object}
 */
function defaultAnimData() {
  return {
    actionId: null,
    actionInfluence: 1,
    actionBlendmode: 'replace',
    actionExtendmode: 'hold',
    slotHandle: 0,
    nlaTracks: [],
    drivers: [],
    flag: 0,
  };
}

/**
 * Build a fresh `__scene__` synthetic node.
 *
 * `type: 'sceneObject'` is a new node-type (peer of 'part', 'group',
 * 'meshData', 'armatureData', 'deformer'). It's the SOLE allowed type
 * for the `__scene__` id; any walker that wants to discriminate the
 * scene from regular Objects can check either the id or the type.
 *
 * `parent: null` because the scene IS the root — there's no
 * higher-level container. `transform` is omitted because the scene
 * doesn't have its own transform (the canvas does); animating
 * `objects['__scene__'].transform.x` would be malformed and is
 * out-of-spec for the rnaPath grammar's scene addresses (which only
 * resolve through `animData.actionId`).
 *
 * @returns {object}
 */
export function makeSceneNode() {
  return {
    id: '__scene__',
    type: 'sceneObject',
    name: 'Scene',
    parent: null,
    animData: defaultAnimData(),
  };
}

/**
 * Predicate: does this node represent the project-wide scene host?
 *
 * Single source of truth for "is this the scene node" so future
 * type-rename or id-rename refactors have one site to chase. Today's
 * answer: id === '__scene__' AND type === 'sceneObject'. Both must
 * match — a regular Object accidentally named `__scene__` (or a future
 * synthetic with type === 'sceneObject' but a different id) does NOT
 * count.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isSceneNode(node) {
  return Boolean(
    node
    && typeof node === 'object'
    && node.id === '__scene__'
    && node.type === 'sceneObject'
  );
}

/**
 * @param {object} project — mutated in place
 * @returns {{ sceneNodeAdded: boolean }}
 */
export function migrateSceneAnimData(project) {
  if (!project) return { sceneNodeAdded: false };
  if (!Array.isArray(project.nodes)) project.nodes = [];

  // Idempotency guard: a pre-existing `__scene__` node (matched by id
  // alone here, NOT `isSceneNode` — pre-v37 saves wouldn't have the new
  // type tag yet, so id is the lookup key for the upgrade decision).
  // If the user somehow has a non-scene node with this id, leave it
  // alone — id collisions with reserved synthetic prefixes are a
  // separate validation concern (v36 already permits `__params__` /
  // `__armature__` ids without policing collisions).
  const existing = project.nodes.find((n) => n && n.id === '__scene__');
  if (existing) {
    // Upgrade pre-v37 saves that somehow had a `__scene__` node already
    // (e.g. a hand-edited project) but lack the v37 shape. animData is
    // the contract; type/name labels are cosmetic and we leave them.
    if (!existing.animData || typeof existing.animData !== 'object') {
      existing.animData = defaultAnimData();
    }
    return { sceneNodeAdded: false };
  }

  project.nodes.push(makeSceneNode());
  return { sceneNodeAdded: true };
}
