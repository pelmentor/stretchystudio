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
 * thunk in `projectStore.js`) is in-place mutation. Immer's `produce`
 * thunks at the call site supply the structural sharing.
 *
 * Return shapes follow the Blender helpers' contract rather than the
 * plan's prose:
 *   - `assignAction` / `unassignAction` → `boolean` (matches Blender's
 *     `assign_action` / `unassign_action`, both `bool` return).
 *   - `cloneAction` → the new action object (Blender's
 *     `bpy.data.actions["X"].copy()` equivalent — caller has full
 *     access to `clone.id` / `clone.fcurves` without an extra
 *     `actions.find(…)` scan).
 *   - `deleteAction` → `{ removed, cascaded }` for caller telemetry.
 *
 * # Stage 1.C scope
 *
 * Stage 1.C ships the five registry helpers, the projectStore
 * `deleteAction` cascade hook-up (with `useAnimationStore.activeActionId`
 * cross-store reset to close Audit-fix G-3), and minimal projectStore
 * thunks for `assignAction` / `unassignAction` / `cloneAction` so the
 * substrate has a callable React-aware path (closes Audit-fix G-4 —
 * a substrate that nothing can call is itself a Rule №2 anti-pattern).
 * Stage 1.E will wire ActionsEditor UI to those thunks; the contract
 * is stable.
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
 * The walk includes `__scene__` (Stage 1.D, schema v37 — `type:
 * 'scene'`), the project-wide animation host. The other
 * double-underscore-prefixed synthetics (`__params__`, `__armature__`)
 * are VIRTUAL — they're never real entries in `project.nodes` (they're
 * constructed on-the-fly by `rnaPath.js` and `getArmature(project)`
 * respectively), so this walk does not see them. `__scene__` is the
 * one synthetic that lives as a real node entry (Audit-fix G-3 / D-15
 * Stage 1.D — convention break is intentional + documented in the v37
 * migration). Audit-fix D-9 (Stage 1.C audit): the read/write
 * asymmetry — `getActionUsers` enumerated `__scene__` here but
 * `assignAction` rejected it for lacking an `animData` slot — is
 * CLOSED by Stage 1.D's v37 migration, which gives `__scene__` the
 * standard `animData` slot.
 *
 * **Mutation warning (Audit-fix G-6):** the returned references are
 * live `project.nodes[i]` pointers. Mutating them OUTSIDE a
 * `useProjectStore.setState(produce(...))` thunk bypasses immer's
 * structural sharing AND the undo history — `hasUnsavedChanges` won't
 * flip and Ctrl+Z won't catch the change. UI callers MUST take ids
 * from this result and route mutations through `assignAction` /
 * `unassignAction` / `useProjectStore` thunks.
 *
 * @param {object} project
 * @param {string} actionId
 * @returns {object[]} Object nodes that hold this action; empty when
 *   none. See mutation warning above.
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
 * **Skipped vs Blender (Audit-fix D-4 from Stage 1.C + D-11 from Stage
 * 1.D):** Blender's `assign_action` delegates to `generic_assign_action`
 * (`:1276-1316`) which ALSO (1) updates `last_slot_identifier` (string
 * mirror), (2) runs the NLA tweak-mode editability guard
 * (`BKE_animdata_action_editable` at `anim_data.cc:148-168` — rejects
 * when `ADT_NLA_EDIT_ON` flag is set OR `actstrip != null` OR
 * `tmpact != null`), and (3) decrements/increments datablock reference
 * counts (`id.us`). SS skips all three: no `last_slot_identifier`
 * field (single-slot system pre-Phase-4 NLA); no NLA tweak-mode
 * editability guard (D-11 Stage 1.D — most relevant for `__scene__`
 * since scene-bound actions are the prime tweak-mode target); no
 * datablock reference counting. Phase 4 must extend this helper for
 * (1) + (2).
 *
 * **Symmetry with unassignAction (Audit-fix G-7):** other animData
 * fields (`actionInfluence`, `actionBlendmode`, `actionExtendmode`)
 * are intentionally PRESERVED across re-assign — they're per-Object
 * policy (e.g. "this Object always plays its action at 0.5
 * influence"), not per-action. Mirrors Blender's contract:
 * `assign_action` writes only `action` + `slot_handle` +
 * `last_slot_identifier`, never the influence/blendmode/extendmode.
 *
 * @param {object} project - mutated in place
 * @param {string} objectId - the target node id
 * @param {string} actionId - the action to assign
 * @param {number} [slot] - slot handle (Blender AnimData.slot_handle),
 *   default 0. Must be a non-negative integer (Audit-fix D-6: matches
 *   Blender's `slot_handle_t` = signed int32 with `Slot::unassigned = 0`
 *   sentinel; non-integer / negative writes would corrupt project
 *   shape).
 * @returns {boolean} true on success, false when objectId / actionId
 *   resolve to nothing OR slot fails the integer guard.
 */
export function assignAction(project, objectId, actionId, slot = 0) {
  if (!project || typeof project !== 'object') return false;
  if (typeof objectId !== 'string' || objectId.length === 0) return false;
  if (typeof actionId !== 'string' || actionId.length === 0) return false;
  // Audit-fix D-6: slot_handle_t is int32 with Slot::unassigned=0 (per
  // `reference/blender/source/blender/animrig/ANIM_action.hh:731`).
  // Reject non-integer / negative writes that would corrupt project
  // shape per Rule №1.
  if (!Number.isInteger(slot) || slot < 0) return false;

  const actions = Array.isArray(project.actions) ? project.actions : [];
  const action = actions.find((a) => a && a.id === actionId);
  if (!action) return false;

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const node = nodes.find((n) => n && n.id === objectId);
  if (!node) return false;

  // v36 guarantees Object nodes (type ∈ {'part','group'}) carry an
  // animData slot; v37 added the `__scene__` synthetic node with the
  // same slot shape (closing Audit-fix D-9). A node without an
  // animData slot here is a project-shape bug — return false to flag.
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
 * **Deviation from Blender (Audit-fix D-5):** Blender's
 * `unassign_action` returns `true` even when the Object had no
 * binding to begin with — both `BKE_animdata_set_action` (anim_data.cc
 * :138) and `generic_assign_action` short-circuit "already null" as
 * success ("the postcondition holds"). SS returns `false` for the
 * already-null case so callers can distinguish no-op from miss in UI
 * feedback (e.g. "no action was assigned" toast vs silent success).
 * The Blender contract is `bool` "did the call leave the slot in the
 * desired state" — SS's contract is `bool` "did the call CHANGE the
 * slot." Net effect on the project shape is identical; only the
 * caller-visible signal differs.
 *
 * @param {object} project - mutated in place
 * @param {string} objectId
 * @returns {boolean} true if a binding existed and was cleared; false
 *   when the Object had no slot or no current action (see deviation
 *   note above).
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
 * fcurves are copied (NOT shared), simple properties are spread.
 * Per-fcurve ids are preserved when they're the deterministic
 * `param:<X>` / `<nodeId>.<prop>` form from the v36 migration (those
 * are derived from the rnaPath and stay stable across clones — a clone
 * targeting the same param IS still that param), regenerated only
 * when missing.
 *
 * The clone is appended to `project.actions[]`; the cloned action
 * object is returned so the caller (Stage 1.E "Duplicate" command,
 * programmatic API) has immediate access to `clone.id` / `clone.name`
 * / `clone.fcurves` without an extra `actions.find(…)` scan
 * (Audit-fix G-5).
 *
 * **Parity scope vs Blender (Audit-fix D-1):** Blender's
 * `action_copy_data` copies `fcurves`, `groups` (action groups),
 * `markers`, `layers`, `slots`, `strip_keyframe_data`, and
 * `last_slot_handle`. SS Action shape today has only `fcurves` +
 * `audioTracks` + `meta`; no `groups`/`markers`/`layers`/`slots`
 * analogs exist yet. When Phase 4 (NLA strips) and Phase 6 (Action
 * groups) ship, this clone helper MUST be revisited — the next dev
 * who adds `action.groups[]` would silently regress without that
 * audit.
 *
 * **`meta.source = 'authored'` is SS-specific (Audit-fix D-7):**
 * Blender's Action has no `meta` field. SS uses `meta.source` to flag
 * the clone as user-derived for the Stage 1.E "Used by" / source
 * filter UI; an imported `motion3.json` clone becomes "authored" the
 * moment the user duplicates it.
 *
 * **Driver deep-clone (Audit-fix G-1/D-2):** `driver.variables[]`
 * (and per-variable `target: {id, rnaPath}`) is deep-cloned so
 * mutating the clone's driver does not bleed into the source. Blender
 * does the equivalent via `fcurve_copy_driver`
 * (`blenkernel/intern/fcurve_driver.cc:1075`) which clears + re-walks
 * the variables listbase.
 *
 * @param {object} project - mutated in place (new action appended)
 * @param {string} actionId - the action to clone
 * @param {string} [newName] - defaults to `<source.name> Copy` when omitted
 * @returns {object|null} the new action object, or null when the
 *   source action is not found. (Audit-fix G-5: changed from string
 *   id to full object so callers don't pay an extra `actions.find(…)`.)
 */
export function cloneAction(project, actionId, newName) {
  if (!project || typeof project !== 'object') return null;
  if (typeof actionId !== 'string' || actionId.length === 0) return null;

  const actions = Array.isArray(project.actions) ? project.actions : null;
  if (!actions) return null;
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
    // Per-fcurve id: deterministic `param:<X>` / `<nodeId>.<prop>` from
    // the v36 migration is preserved (derived from rnaPath, stable
    // across clones); generated when missing.
    id: typeof fc.id === 'string' ? fc.id : uid(),
    // Deep-clone keyforms (point-by-value array; keyform objects
    // contain only primitives in Phase 1).
    keyforms: Array.isArray(fc.keyforms)
      ? fc.keyforms.map((kf) => ({ ...kf }))
      : [],
    // Modifiers: shallow per-entry clone (Phase 1 modifiers are flat
    // objects; Phase 3 may add nested fields — revisit then).
    modifiers: Array.isArray(fc.modifiers)
      ? fc.modifiers.map((m) => ({ ...m }))
      : [],
    // Driver deep-clone: variables[] AND each variable's target are
    // fresh objects so the clone's driver is fully independent of the
    // source. Audit-fix G-1/D-2: a shallow `{...fc.driver}` left
    // `variables` as a shared array reference.
    ...(fc.driver && typeof fc.driver === 'object'
      ? {
          driver: {
            ...fc.driver,
            variables: Array.isArray(fc.driver.variables)
              ? fc.driver.variables.map((v) => ({
                  ...v,
                  ...(v && v.target && typeof v.target === 'object'
                    ? { target: { ...v.target } }
                    : {}),
                }))
              : (fc.driver.variables ?? []),
          },
        }
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
  return clone;
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
 * the deleted action ID. Verified Blender source:
 * `reference/blender/source/blender/blenkernel/intern/anim_data.cc:172`
 * (`BKE_animdata_free`).
 *
 * **Cascade scope (Audit-fix G-2/D-8):** today this walks
 * `node.animData.actionId` only. The full Blender walk also includes:
 *   - `AnimData.tmpact` (NLA tweak-mode backup) — Phase 4 NLA work,
 *     not in Phase 1 scope.
 *   - `NlaTrack[].strips[].act` — Phase 4 NLA strips will store
 *     actionIds; this cascade MUST extend to walk
 *     `node.animData.nlaTracks[].strips[].actionId` when Phase 4
 *     ships. Today `nlaTracks: []` is always empty so the gap is
 *     latent.
 *   - Driver-target action references — Phase 3 driver work; same
 *     Phase-4-deferred concern.
 *
 * **Cross-store cascade (Audit-fix G-3):** the projectStore.deleteAction
 * thunk additionally resets `useAnimationStore.activeActionId` if it
 * matches the deleted id — every UI consumer of `activeActionId`
 * (Timeline / Dopesheet / FCurve / Animations / param row / canvas /
 * gizmo / skeleton overlays / export modal / nodetree area) reads
 * through `proj.actions.find(a => a.id === activeActionId)`, which
 * would silently return `undefined` on a stale id. The registry
 * doesn't know about the animation UI store; the thunk owns the
 * cross-store coordination.
 *
 * @param {object} project - mutated in place
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
