// @ts-check

/**
 * Animation Phase 7 Slice 7.C - insert-keyframe operators.
 *
 * Two operators register here:
 *
 *   `insertKey.menu`     - bound to `KeyI` (Blender's "I" hotkey).
 *                          Always opens the KeyingSetMenu popover with
 *                          the default-picked set highlighted. The menu
 *                          item click dispatches `insertKey.applySet`.
 *
 *   `insertKey.applySet` - invoked by KeyingSetMenu items (and by
 *                          7.D's auto-key infrastructure once landed).
 *                          Wraps `applyKeyingSet` with a live-value
 *                          resolver + an immer recipe via
 *                          `updateProject`.
 *
 * Plan §7.C vs Blender semantic divergence:
 *
 *   Blender binds I to `anim.keyframe_insert` (uses active KS or
 *   user-pref fallback; menu only if no active KS) and K to
 *   `anim.keyframe_insert_menu` with `always_prompt=True` (always
 *   menu). SS plan §7.C/§7.E inverts: I = always menu, K = legacy
 *   "insert all" (`CanvasViewport.jsx:1457-1633`). The K-key
 *   migration is queued for §7.E.
 *
 *   This file ships the plan-faithful "I = always menu" path. The
 *   active-KS storage from 7.A exists but is not read here; clicking
 *   a menu item invokes the set WITHOUT making it active (matches
 *   Blender's `ANIM_OT_keyframe_insert_by_name` semantic at
 *   `editors/animation/keyframing.cc:479-502` which is also non-
 *   sticky).
 *
 * Live-value resolver wiring -- the MED-3 trap from 7.B's audit-fix
 * sweep: `applyKeyingSet`'s default resolver hits `evaluateRnaPath`
 * which returns STATIC parameter defaults for `__params__` paths.
 * Both operators here build a `paramValuesStore`-aware resolver via
 * `buildLiveResolver` so the keyed value is the user's live dial
 * position, not the static default.
 *
 * Rule №2 -- no migration baggage. No legacy-K fallback path; the
 * legacy K-key handler in CanvasViewport stays untouched in Phase
 * 7.C scope (per plan §7.E carve-out).
 *
 * Blender cites (re-OPENED 2026-05-19 per rule 9):
 *
 *   - `editors/animation/keyframing.cc:509-567` -- `insert_key_menu_invoke`
 *     (the actual K-key menu invoker; pre-existing aggregate cite at
 *     `:569-580` pointed at `ANIM_OT_keyframe_insert_menu` which is
 *     only the OT registration that wires `invoke = insert_key_menu_invoke`).
 *   - `editors/animation/keyframing.cc:545-558` -- menu loop that
 *     dispatches per-set items to `ANIM_OT_keyframe_insert_by_name`.
 *   - `editors/animation/keyframing.cc:479-502` -- `ANIM_OT_keyframe_insert_by_name`
 *     (the by-name operator; SS's `insertKey.applySet` mirrors its
 *     non-sticky semantic).
 *   - `editors/animation/keyframing.cc:438-461` -- `ANIM_OT_keyframe_insert`
 *     (the I-key operator; Blender's "use active KS" path).
 *   - `keymap_data/blender_default.py:4561` -- I-key bound to
 *     `anim.keyframe_insert` (Object Mode). SS plan §7.C diverges
 *     here (I = menu, not active-KS direct).
 *   - `keymap_data/blender_default.py:4536` -- K-key bound to
 *     `anim.keyframe_insert_menu` with `always_prompt=True` (Object
 *     Mode). SS plan §7.E migration target.
 *
 * @module v3/operators/insertKey
 */

import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { useParamValuesStore } from '../../store/paramValuesStore.js';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { toast } from '../../hooks/use-toast.js';
import { applyKeyingSet, INSERTKEY_FLAGS } from '../../anim/insertKeyframe.js';
import { getKeyingSet, setActiveKeyingSet } from '../../anim/keyingSets.js';
import { buildLiveResolver } from '../../anim/insertKeyframeResolver.js';

/**
 * Read the currently-displayed scrubber position (canonical ms).
 * Mirrors the legacy K-key handler at `CanvasViewport.jsx:1498`.
 */
function currentTimeMs() {
  return useAnimationStore.getState().currentTime;
}

/**
 * Read the current selection node ids. The keying-set collectors
 * accept an empty array (AllParams ignores `objectIds`); the operator
 * defers the "empty selection on a selection-scoped set" warning to
 * `applyKeyingSet`'s result counters.
 *
 * @returns {string[]}
 */
function currentSelectionIds() {
  const sel = useEditorStore.getState().selection;
  return Array.isArray(sel) ? sel : [];
}

/**
 * Format the per-channel results into a toast description.
 *
 * @param {{count:number, results:Array<{path:string,status:string}>}} res
 */
function summariseResult(res, setId) {
  if (res.count === 0) {
    // Distinguish "nothing to do" from "everything skipped" for
    // operator feedback (Rule №1 -- explicit empty-result handling).
    if (res.results.length === 0) {
      // The "Available" set only emits paths for fcurves that ALREADY
      // exist for the selected objects. For a first rest keyframe there
      // ARE no fcurves yet, so Available is the wrong set. Mirrors
      // Blender's silent-no-op behaviour but with a discoverability
      // pointer, since SS users land on the I-menu fresh.
      if (setId === 'Available') {
        return 'no existing fcurves for the selection — pick "Location, Rotation & Scale" (or similar) for the first keyframe';
      }
      return 'nothing selected, or selection has no animatable channels — click a part / bone first';
    }
    const statuses = new Set(res.results.map((r) => r.status));
    if (statuses.size === 1) {
      const only = res.results[0].status;
      if (only === 'skipped-needed') return 'all channels already match (NEEDED skip)';
      if (only === 'skipped-no-action') return 'no actions exist for selection -- pick an action first';
      if (only === 'skipped-replace') return 'all channels already have keys at this time';
      if (only === 'skipped-available') return 'no existing fcurves to write into';
      if (only === 'skipped-non-finite') return 'resolved values were not finite';
    }
    return `0 of ${res.results.length} channels written`;
  }
  return `${res.count} key${res.count === 1 ? '' : 's'} inserted`;
}

/**
 * Invoke a specific keying set. Built outside of registerInsertKeyOperators
 * so the menu component can dispatch via this exec-equivalent without a
 * round-trip through registry lookup (the operator id requires a
 * per-set id which we don't pre-register; the menu fires one operator
 * with the chosen `setId` packed into the ctx -- see KeyingSetMenu).
 *
 * @param {string} setId
 */
export function execApplyKeyingSet(setId) {
  if (typeof setId !== 'string' || setId.length === 0) {
    toast({ title: 'Insert Keyframe', description: 'no keying set selected' });
    return;
  }
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;
  if (!project) {
    toast({ title: 'Insert Keyframe', description: 'no project loaded' });
    return;
  }
  // Resolve the set up-front for a cleaner error than applyKeyingSet's
  // throw (matches Blender's `keyingset_get_from_op_with_error` at
  // `keyframing.cc:472`).
  const set = getKeyingSet(project, setId);
  if (!set) {
    toast({ title: 'Insert Keyframe', description: `unknown keying set: ${setId}` });
    return;
  }
  const objectIds = currentSelectionIds();
  const time = currentTimeMs();
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    toast({ title: 'Insert Keyframe', description: 'scrubber time invalid' });
    return;
  }
  const paramValues = useParamValuesStore.getState().values;
  // Stage 1.E fallback: when no node carries `animData.actionId` (the
  // v36 default) AND no `__scene__` binding exists yet, applyKeyingSet
  // routes through the UI's current `activeActionId` so I-key picks up
  // whatever the user is editing in the Footer action picker. Without
  // this, fresh projects where the user hasn't formally bound an action
  // to the scene get `skipped-no-action` for every channel.
  const fallbackActionId = useAnimationStore.getState().activeActionId ?? null;
  /** @type {{count:number, results:Array<{path:string,status:string}>, skippedNoAction:number, skippedInvalidPath:number}} */
  let result = { count: 0, results: [], skippedNoAction: 0, skippedInvalidPath: 0 };
  projectStore.updateProject((draft) => {
    // Build the resolver against the DRAFT so reads see the same
    // mutation surface applyKeyingSet writes to. paramValues snapshot
    // is fine to capture once (the recipe is sync and short).
    const resolver = buildLiveResolver(draft, paramValues);
    result = applyKeyingSet(
      draft,
      setId,
      objectIds,
      time,
      INSERTKEY_FLAGS.NOFLAGS,
      { resolveValue: resolver, fallbackActionId },
    );
  });
  toast({
    title: `Insert Keyframe -- ${set.label ?? set.id}`,
    description: summariseResult(result, setId),
  });
}

/**
 * Set (or toggle off) the project's active keying set. Mirrors Blender's
 * `ANIM_OT_keying_set_active_set` (`keyingsets.cc:443-454`, which writes
 * `scene->active_keyingset` and notifies `ND_KEYINGSET`). Blender exposes
 * it from the Scene-properties keying-set UIList / a dedicated popup;
 * SS surfaces it from the existing I-menu's per-row indicator instead
 * (SS has no keying-set list panel — §7.I).
 *
 * DEV: SS TOGGLES (clicking the already-active set clears it to `null`),
 * whereas Blender's operator only SETS — its `type == 0` enum entry is
 * the separate clear path (`keyingsets.cc:448-449`). Toggle is the
 * ergonomic single-affordance for the per-row dot button; clearing is
 * otherwise unreachable from this surface.
 *
 * The active set drives auto-key's `'activeSet'` mode via
 * `pickActiveSetIdForAutoKey` → `getActiveKeyingSet`.
 *
 * @param {string} setId
 */
export function execSetActiveKeyingSet(setId) {
  if (typeof setId !== 'string' || setId.length === 0) {
    toast({ title: 'Active Keying Set', description: 'no keying set selected' });
    return;
  }
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;
  if (!project) {
    toast({ title: 'Active Keying Set', description: 'no project loaded' });
    return;
  }
  const set = getKeyingSet(project, setId);
  if (!set) {
    toast({ title: 'Active Keying Set', description: `unknown keying set: ${setId}` });
    return;
  }
  // Decide toggle direction against the DRAFT, not the pre-recipe
  // snapshot, so the write + the toast both reflect the authoritative
  // state even if two clicks land in the same tick (Rule №1 -- no
  // reliance on coincidental sync ordering). Hoist the flag for the toast.
  let wasActive = false;
  projectStore.updateProject((draft) => {
    wasActive = draft.activeKeyingSetId === setId;
    setActiveKeyingSet(draft, wasActive ? null : setId);
  });
  toast({
    title: 'Active Keying Set',
    description: wasActive
      ? `cleared (was ${set.label ?? set.id})`
      : `${set.label ?? set.id} -- used by auto-key 'Active Set' mode`,
  });
}

/**
 * Register `insertKey.menu` + `insertKey.applySet` with the operator
 * registry. Called from `registry.js#registerBuiltins`.
 *
 * @param {(def: {id:string, label:string, available?:(ctx:any)=>boolean, exec:(ctx:any)=>void}) => void} registerOperator
 * @param {() => {x:number, y:number}} lastMousePos
 */
export function registerInsertKeyOperators(registerOperator, lastMousePos) {
  registerOperator({
    id: 'insertKey.menu',
    label: 'Insert Keyframe… (I)',
    available: () => {
      // Plan §7.C ships the menu globally so the user can discover
      // keying sets even with empty selection (AllParams works on
      // every project parameter). Rule №1 -- no synthetic gate.
      return true;
    },
    exec: () => {
      useEditMenuStore.getState().openKeyingSet({ cursor: lastMousePos() });
    },
  });

  registerOperator({
    id: 'insertKey.applySet',
    label: 'Insert Keyframe with Set',
    available: ({ setId } = {}) => typeof setId === 'string' && setId.length > 0,
    exec: ({ setId } = {}) => {
      execApplyKeyingSet(setId);
    },
  });
}
