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
 *       type:     'scene',  // matches Blender's Scene ID type (peer of Object,
                       // not a kind of Object) per `DNA_scene_types.h`.
 *       name:     'Scene',
 *       animData: defaultAnimData(),  // Blender AnimData defaults
 *     }
 *
 * The double-underscore id convention follows `__params__` and
 * `__armature__` cosmetically, but DEVIATES in implementation:
 * `__params__` is virtual (constructed on-the-fly by `rnaPath.js` —
 * never enters `project.nodes`) and `__armature__` is virtual (returned
 * by `getArmature(project)` from synthesised data — also never in
 * `project.nodes`). v37's `__scene__` is the FIRST double-underscore
 * synthetic that lives as a REAL entry in `project.nodes`. This was
 * deliberate: putting scene AnimData on a real node means the existing
 * `actionRegistry` helpers (`getActionUsers`, `assignAction`,
 * `unassignAction`) walk it without modification, closing the
 * read/write asymmetry flagged by Audit-fix D-9 (Stage 1.C audit).
 * Audit-fix D-15 (Stage 1.D audit): the convention break is documented
 * here so future contributors don't assume "all `__name__` ids are
 * virtual."
 *
 * # Blender source mirror
 *
 * In Blender, the Scene datablock itself owns AnimData via `Scene.adt`
 * (`reference/blender/source/blender/makesdna/DNA_scene_types.h:2813` —
 * `struct AnimData *adt = nullptr;`). The animation system addresses
 * scene animation through the same `BKE_animdata_from_id` API as
 * object animation (`anim_data.cc:91`) — there is no distinction at
 * the read site, only at the ID type. SS approximates this with the
 * synthetic node convention: the `__scene__` node IS the scene's
 * animation host, and consumers walk `node.animData` uniformly across
 * regular and synthetic Objects.
 *
 * **Lazy-vs-eager AnimData (Audit-fix D-6 deviation):** Blender Scene
 * starts with `adt == nullptr` (`scene_init_data` at
 * `blenkernel/intern/scene.cc` does NOT call `BKE_animdata_ensure_id`).
 * AnimData is created lazily on first action assignment via
 * `BKE_animdata_ensure_id` (`anim_data.cc:105-129`). SS PRE-CREATES
 * the scene's animData on every project (fresh + migrated) so the
 * `__scene__` node is immediately usable as an `assignAction` target
 * without a side-channel "ensure" step. Net effect: SS scenes always
 * appear in `getActionUsers` walks (with `actionId === null` until
 * bound), Blender scenes are absent from the equivalent walk until
 * the user binds an action.
 *
 * **`actionInfluence = 1` (Audit-fix D-5 deviation):** Blender's
 * `AnimData` struct DNA defaults `act_influence = 0.0f`
 * (`DNA_anim_types.h:737`); the runtime `BKE_animdata_ensure_id`
 * overrides to `1.0f` at creation time (`anim_data.cc:123`). SS
 * adopts the BKE-runtime override directly because we eagerly create
 * AnimData (see D-6 above) — without the override SS scenes would
 * default to "no influence" rather than "fully influencing," which
 * is wrong for the user-facing semantic ("a bound action plays").
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
 * - `reference/blender/source/blender/makesdna/DNA_scene_types.h:2813`
 *   — Blender's Scene.adt pointer.
 * - `reference/blender/source/blender/blenkernel/intern/anim_data.cc:91`
 *   — `BKE_animdata_from_id` (the AnimData getter; the analog of
 *   `getSceneNode(project).animData`).
 * - `reference/blender/source/blender/blenkernel/intern/anim_data.cc:105`
 *   — `BKE_animdata_ensure_id` (the lazy-create function we deviate
 *   from by pre-creating; see D-6 deviation above).
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
 * `type: 'scene'` is a new node-type (peer of 'part', 'group',
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
 * **DEVIATION FROM BLENDER (Audit-fix D-3 Stage 1.F):** Blender's
 * Scene datablock (`reference/blender/source/blender/makesdna/DNA_scene_types.h`)
 * has NO `parent` field at all — Scene is a root datablock, peer of
 * Object via the ID system. The closest analog is `Scene *set` (the
 * "background scene" pointer used for compositing inheritance), but
 * that's not a parent in the tree-traversal sense. SS adds the
 * explicit `parent: null` field here to make `__scene__` walkable by
 * the tree-traversal helpers in `actionRegistry.js` /
 * `outlinerTreeBuilder.js` etc. that expect every node to declare its
 * parent. The migration's repair branch (below) force-corrects
 * `parent` to null because a hand-edited project might set
 * `parent: 'someNode'` and that would break those cascade walks. Net
 * effect: Blender Scene has no parent field at all, SS bridges this
 * with the explicit-null convention used by other root-level
 * synthetics.
 *
 * @returns {object}
 */
export function makeSceneNode() {
  return {
    id: '__scene__',
    type: 'scene',
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
 * answer: id === '__scene__' AND type === 'scene'. Both must
 * match — a regular Object accidentally named `__scene__` (or a future
 * synthetic with type === 'scene' but a different id) does NOT
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
    && node.type === 'scene'
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
  // Audit-fix D-12 (Stage 1.D): force-correct the type so the read/write
  // asymmetry CAN'T reopen via a hand-edited `{id: '__scene__',
  // type: 'group'}` collision. Without this, `assignAction` would
  // succeed (id-only match) but `getSceneAction` would silently return
  // null (predicate fails on type) — the same gap audit-fix D-9 from
  // Stage 1.C closed in the standard case. Type is the canonical scene
  // discriminator; if the user named another node `__scene__`, it WAS
  // a name collision and the migration's repair is the correct outcome.
  const existing = project.nodes.find((n) => n && n.id === '__scene__');
  if (existing) {
    // Upgrade pre-v37 saves that had a `__scene__` node already (e.g.
    // a hand-edited project) but lack the v37 shape. animData is the
    // contract; type is now part of the contract too (D-12).
    // Audit-fix D-16 (Stage 1.D): only repair animData when fully
    // missing — fail loud if it's a non-object truthy value (e.g.
    // `animData = "broken"` from a corrupted save). Mirrors Blender's
    // strict `BKE_animdata_ensure_id` contract (`anim_data.cc:115` —
    // only sets `iat->adt` when `iat->adt == nullptr`).
    if (existing.type !== 'scene') existing.type = 'scene';
    if (existing.name == null) existing.name = 'Scene';
    if (existing.parent !== null) existing.parent = null;
    if (existing.animData == null) {
      existing.animData = defaultAnimData();
    } else if (typeof existing.animData !== 'object') {
      throw new Error(
        `v37 migration: __scene__ node has corrupt animData (got ${typeof existing.animData}: ${String(existing.animData)}); refusing to silently overwrite`
      );
    }
    return { sceneNodeAdded: false };
  }

  project.nodes.push(makeSceneNode());
  return { sceneNodeAdded: true };
}
