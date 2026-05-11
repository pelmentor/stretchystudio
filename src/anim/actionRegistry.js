// @ts-check

/**
 * Action registry helpers — Animation Phase 1 Stage 1.C.
 *
 * # What this module is
 *
 * Pure-function helpers that operate on a `project` value (mutating it
 * in place — same convention as `objectDataAccess.js` and the v36
 * migration). They cover the lifecycle operations that touch BOTH
 * `project.actions[]` AND `node.animData` per-Object slots, so the two
 * stay in sync without callers having to remember the cascade.
 *
 * The five helpers cover the Blender `Action` ↔ `AnimData` lifecycle:
 *
 *   - `getActionUsers(project, actionId)` — scan `node.animData` slots
 *     for any Object that has this action assigned. Used by Stage 1.E's
 *     "Used by: …" UI surface.
 *   - `assignAction(project, objectId, actionId, slot=0)` — set
 *     `node.animData.actionId` (and `slotHandle`) on one Object.
 *     Mirrors Blender `assign_action` (animrig/intern/action.cc:1166).
 *   - `unassignAction(project, objectId)` — clear an Object's slot.
 *     Mirrors Blender `unassign_action` (animrig/intern/action.cc:1199),
 *     which is `assign_action(nullptr, …)` under the hood.
 *   - `cloneAction(project, actionId, newName)` — deep-copy an action
 *     with a fresh id (and fresh per-fcurve ids). Mirrors Blender's
 *     `action_copy_data` (blenkernel/intern/action.cc:119).
 *   - `deleteAction(project, actionId)` — remove the action AND cascade
 *     to every Object that pointed at it (`animData.actionId === id`
 *     → null + `slotHandle` → 0). Without the cascade, Object slots
 *     would carry dangling-pointer references that the runtime would
 *     have to defensively skip — exactly the kind of crutch Rule №1
 *     prohibits.
 *
 * # Why this lives outside `projectStore.js`
 *
 * The store's `createAction` / `renameAction` / `deleteAction` thunks
 * pre-date this module and only mutate `project.actions[]`. The cascade
 * the registry implements (deleteAction → animData.actionId nulling,
 * assignAction → animData.actionId setting) needs to walk
 * `project.nodes` too. Putting that walk in a pure helper makes it
 * testable without immer/zustand and lets future callers (Stage 1.E
 * UI dispatchers, programmatic API surface) reuse the same primitive
 * without going through the store.
 *
 * `projectStore.deleteAction` delegates to `deleteAction` here so the
 * cascade kicks in whether the user deletes via the (current) Actions
 * panel or via a future programmatic path.
 *
 * # Convention: in-place mutation
 *
 * All five helpers mutate `project` in place. The plan signature
 * `→ newProject` in
 * `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1.C is JSDoc
 * shorthand for "the project state after the call"; the codebase
 * convention (migrations, `objectDataAccess.js`, every `produce(…)`
 * thunk in `projectStore.js`) is in-place mutation. Functions return
 * metadata (counts, the new id for `cloneAction`) instead of cloning.
 * Immer's `produce` thunks at the call site supply the structural
 * sharing.
 *
 * # Stage 1.C scope
 *
 * Stage 1.C ships only the five registry helpers + the projectStore
 * `deleteAction` cascade hook-up. No new UI thunks for `assignAction`
 * / `unassignAction` / `cloneAction` are added to projectStore in this
 * sub-session — those land in Stage 1.E when the ActionsEditor UI is
 * the caller. (Per Rule №2: a registered-but-unused thunk would be
 * the same dead-code crutch as a no-op shim.)
 *
 * # Cross-references
 *
 *   - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1.C
 *   - `src/store/migrations/v36_action_datablock.js` — the v36 schema
 *     flip that introduced `project.actions[]` + `node.animData`.
 *   - `reference/blender/source/blender/animrig/intern/action.cc:1166`
 *     (`assign_action`) and `:1199` (`unassign_action`) — the Blender
 *     equivalents.
 *   - `reference/blender/source/blender/blenkernel/intern/action.cc:119`
 *     (`action_copy_data`) — the Blender clone callback.
 *
 * @module anim/actionRegistry
 */

import { uid } from '../lib/ids.js';

/**
 * Find every Object node whose `animData.actionId` points at the given
 * action.
 *
 * This is the read side of the assign/unassign relationship. Stage 1.E
 * surfaces it as "Used by: <object names>" beside each row in the
 * Actions panel.
 *
 * Synthetic Objects (`__params__`, `__armature__`, `__scene__`) are
 * scanned along with regular Objects — `__scene__` (Stage 1.D) is the
 * typical project-wide animation host so it MUST appear in this list
 * when applicable.
 *
 * @param {object} project
 * @param {string} actionId
 * @returns {object[]} Object nodes that hold this action; empty when
 *   none. Returns the live node references (no clone) — callers that
 *   only need ids can map afterwards.
 */
export function getActionUsers(project, actionId) {
  if (!project || typeof project !== 'object') return [];
  if (typeof actionId !== 'string' || actionId.length === 0) return [];
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  /** @type {object[]} */
  const users = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const ad = node.animData;
    if (!ad || typeof ad !== 'object') continue;
    if (ad.actionId === actionId) users.push(node);
  }
  return users;
}

/**
 * Assign an action to an Object's animData slot.
 *
 * Mirrors Blender's `assign_action`
 * (`reference/blender/source/blender/animrig/intern/action.cc:1166`),
 * which calls through to `BKE_animdata_ensure_id` + a slot-handle
 * write. SS's `node.animData` slot is created by the v36 migration for
 * every Object node, so this helper does NOT lazily create one — a
 * missing slot is a project-shape bug, not a runtime contingency, and
 * the assertion fires through the return value.
 *
 * The action MUST exist in `project.actions[]`; assigning a stale id
 * would create the same dangling-pointer state the cascade in
 * `deleteAction` exists to prevent. Returns false to flag the bad call
 * (caller's bug — not a silent no-op per Rule №1).
 *
 * @param {object} project — mutated in place
 * @param {string} objectId — the target node id
 * @param {string} actionId — the action to assign
 * @param {number} [slot] - slot handle (Blender AnimData.slot_handle), default 0.
 *   Phase 1's slot system is "always 0 sentinel"; the parameter is here
 *   so the signature matches the Blender helper and Stage 4+ NLA work
 *   doesn't need a breaking signature bump.
 * @returns {boolean} true on success, false when objectId / actionId
 *   resolve to nothing.
 */
export function assignAction(project, objectId, actionId, slot = 0) {
  if (!project || typeof project !== 'object') return false;
  if (typeof objectId !== 'string' || objectId.length === 0) return false;
  if (typeof actionId !== 'string' || actionId.length === 0) return false;

  const actions = Array.isArray(project.actions) ? project.actions : [];
  const action = actions.find((a) => a && a.id === actionId);
  if (!action) return false;

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const node = nodes.find((n) => n && n.id === objectId);
  if (!node) return false;

  // v36 guarantees Object nodes (type ∈ {'part','group'}) carry an
  // animData slot. If the caller is binding to a synthetic node
  // (`__scene__`, Stage 1.D) the slot may not exist yet — defer to that
  // stage's introduction code; for now, only Objects with an existing
  // slot are valid targets.
  if (!node.animData || typeof node.animData !== 'object') return false;

  node.animData.actionId = actionId;
  node.animData.slotHandle = slot;
  return true;
}

/**
 * Clear an Object's animData action binding.
 *
 * Mirrors Blender's `unassign_action`
 * (`reference/blender/source/blender/animrig/intern/action.cc:1199`),
 * which is literally `assign_action(nullptr, animated_id)`. The slot
 * itself stays (Blender frees AnimData lazily via
 * `BKE_animdata_free`); SS keeps the same lazy contract — the slot
 * remains so future re-binding is a write, not a re-creation.
 *
 * @param {object} project — mutated in place
 * @param {string} objectId
 * @returns {boolean} true if a binding existed and was cleared; false
 *   when the Object had no slot or no current action (no-op
 *   distinguishable from miss for callers that want to surface "no
 *   action assigned" UI feedback).
 */
export function unassignAction(project, objectId) {
  if (!project || typeof project !== 'object') return false;
  if (typeof objectId !== 'string' || objectId.length === 0) return false;

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const node = nodes.find((n) => n && n.id === objectId);
  if (!node) return false;
  if (!node.animData || typeof node.animData !== 'object') return false;
  if (node.animData.actionId === null) return false;

  node.animData.actionId = null;
  node.animData.slotHandle = 0;
  return true;
}

/**
 * Deep-copy an action with a fresh id.
 *
 * Mirrors Blender's `action_copy_data`
 * (`reference/blender/source/blender/blenkernel/intern/action.cc:119`):
 * fcurves are copied (NOT shared), simple properties are spread,
 * meta.source flips to 'authored' (the clone is a new authored thing,
 * not an import / generator output). Per-fcurve ids are also
 * regenerated — sharing fcurve ids across actions would break any
 * future "find fcurve by id" lookup.
 *
 * The clone is appended to `project.actions[]`; the new id is
 * returned so the caller (Stage 1.E "Duplicate" command, programmatic
 * API) can immediately make it active.
 *
 * @param {object} project — mutated in place (new action appended)
 * @param {string} actionId — the action to clone
 * @param {string} [newName] - defaults to `<source.name> Copy` when omitted
 * @returns {string|null} new action id, or null when source action not found
 */
export function cloneAction(project, actionId, newName) {
  if (!project || typeof project !== 'object') return null;
  if (typeof actionId !== 'string' || actionId.length === 0) return null;

  const actions = Array.isArray(project.actions) ? project.actions : [];
  const src = actions.find((a) => a && a.id === actionId);
  if (!src) return null;

  const newId = uid();
  const name =
    typeof newName === 'string' && newName.length > 0
      ? newName
      : `${src.name ?? 'Action'} Copy`;

  const fcurves = Array.isArray(src.fcurves) ? src.fcurves : [];
  /** @type {object[]} */
  const clonedFcurves = fcurves.map((fc) => ({
    ...fc,
    // Fresh per-fcurve id (Rule №1: shared ids across actions would be
    // a latent collision waiting for the first id-keyed lookup).
    // The deterministic `param:<X>` / `<nodeId>.<prop>` shape from the
    // v36 migration is preserved as-is — those are derived from the
    // rnaPath and stay stable across clones (a clone targeting the
    // same param IS still that param).
    id: typeof fc.id === 'string' ? fc.id : uid(),
    // Deep-clone keyforms (point-by-value array; the keyform objects
    // contain only primitives in Phase 1).
    keyforms: Array.isArray(fc.keyforms)
      ? fc.keyforms.map((kf) => ({ ...kf }))
      : [],
    // Modifiers are array of plain objects in Phase 1 (Phase 3 fills
    // them in). Shallow per-modifier clone is enough.
    modifiers: Array.isArray(fc.modifiers)
      ? fc.modifiers.map((m) => ({ ...m }))
      : [],
    // Driver is an optional object pointer; clone it shallowly so the
    // clone gets its own driver state (Phase 1 drivers are flat
    // structures — no nested object references that need deep clone).
    ...(fc.driver && typeof fc.driver === 'object'
      ? { driver: { ...fc.driver } }
      : {}),
  }));

  /** @type {Record<string, *>} */
  const clone = {
    ...src,
    id: newId,
    name,
    fcurves: clonedFcurves,
    audioTracks: Array.isArray(src.audioTracks)
      ? src.audioTracks.map((a) => ({ ...a }))
      : [],
    meta: {
      ...(src.meta ?? {}),
      createdAt: null,
      modifiedAt: null,
      source: 'authored',
    },
  };

  actions.push(clone);
  // Re-bind in case `actions` was a fresh array (defensive — when
  // `project.actions` was missing, the local `actions` started as
  // [] and never got assigned back).
  if (!Array.isArray(project.actions)) project.actions = actions;
  return newId;
}

/**
 * Delete an action and cascade to every Object that pointed at it.
 *
 * The cascade is the non-trivial bit: without it, Object slots would
 * carry dangling-pointer references (`animData.actionId = "<deleted>"`)
 * that the runtime would have to defensively skip. Per Rule №1, that
 * defensive skip is a crutch for a fixable invariant — every reference
 * gets nulled at the deletion site instead.
 *
 * Mirrors the Blender pattern where `BKE_id_free(action)` triggers
 * `BKE_libblock_relink` to null-out every AnimData.action pointing at
 * the deleted action ID.
 *
 * @param {object} project — mutated in place
 * @param {string} actionId
 * @returns {{ removed: boolean, cascaded: number }} removed=true when
 *   the action was found and deleted; cascaded=count of Object slots
 *   whose binding was nulled.
 */
export function deleteAction(project, actionId) {
  if (!project || typeof project !== 'object') return { removed: false, cascaded: 0 };
  if (typeof actionId !== 'string' || actionId.length === 0) return { removed: false, cascaded: 0 };

  const actions = Array.isArray(project.actions) ? project.actions : [];
  const before = actions.length;
  const filtered = actions.filter((a) => !a || a.id !== actionId);
  if (filtered.length === before) return { removed: false, cascaded: 0 };

  project.actions = filtered;

  let cascaded = 0;
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const ad = node.animData;
    if (!ad || typeof ad !== 'object') continue;
    if (ad.actionId !== actionId) continue;
    ad.actionId = null;
    ad.slotHandle = 0;
    cascaded++;
  }

  return { removed: true, cascaded };
}
