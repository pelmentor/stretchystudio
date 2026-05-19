// @ts-check

/**
 * Animation Phase 7 Slice 7.D - Auto-keyframe mode dispatcher.
 *
 * Plan §7.D ships three auto-key modes (matches Blender's
 * `eKeying_Flag` flag bits at `DNA_userdef_types.h:278-293`):
 *
 *   `'all'`       (default; matches current SS behaviour) - every
 *                 property of the selection is keyed at the playhead
 *                 (rotate/translate/scale/opacity + bone pose + mesh
 *                 verts + blend-shape values). Maps to Blender's
 *                 "neither AUTOKEY_FLAG_ONLYKEYINGSET nor
 *                 AUTOKEY_FLAG_INSERTAVAILABLE" path at
 *                 `keyframing_auto.cc:139-150` (`insert_keyframes`
 *                 with full `rna_paths` span).
 *
 *   `'activeSet'` - only the active keying set is keyed. If no active
 *                 set, fall back to `LocRotScale` (the most common
 *                 SS default). Maps to Blender's
 *                 `AUTOKEY_FLAG_ONLYKEYINGSET && active_ks` branch at
 *                 `keyframing_auto.cc:126-133` which dispatches to
 *                 `apply_keyingset(... active_ks ...)`.
 *
 *   `'available'` - only existing fcurves get a new keyform. Maps to
 *                 Blender's `AUTOKEY_FLAG_INSERTAVAILABLE` flag at
 *                 `DNA_userdef_types.h:285`. SS implements this by
 *                 dispatching to the `'Available'` built-in keying
 *                 set (whose collector at `keyingSets.js:226-250`
 *                 already filters to existing fcurves -- equivalent
 *                 to setting `INSERTKEY_AVAILABLE` on an unfiltered
 *                 emit).
 *
 * **Synthetic K-key dispatch (Rule №1 caveat).** The `'all'` mode
 * dispatches a synthetic `KeyboardEvent('keydown', {key:'K'})` to
 * route through the legacy K-key handler at
 * `CanvasViewport.jsx:1457-1633`. This is PRE-EXISTING technical
 * debt -- the legacy K-key handler owns the full property fan-out
 * (KEYFRAME_PROPS + mesh_verts + blend-shape values + auto-rest-
 * keyform at startFrame + JS-skinning expansion), and extracting it
 * into a pure helper is a 7.E+ refactor risk. 7.D's scope is mode
 * dispatch; the crutch is documented honestly here rather than
 * silently preserved. Plan §7.E's "K-key migration" includes the
 * extraction.
 *
 * For `'activeSet'` and `'available'` we DO bypass the synthetic
 * dispatch and call `execApplyKeyingSet` directly -- those modes
 * have no legacy-handler counterpart to preserve.
 *
 * Rule №2 compliance: `project.autoKeyMode` is a SPARSE field. Read
 * sites coalesce `?? 'all'`. No migration; no schema bump. Adding
 * the mode to an existing project takes effect on next auto-key
 * trigger without any data shape change.
 *
 * @module anim/autoKeyDispatch
 */

import { execApplyKeyingSet } from '../v3/operators/insertKey.js';
import { getActiveKeyingSet } from './keyingSets.js';

/** @type {ReadonlyArray<'all' | 'activeSet' | 'available'>} */
export const AUTOKEY_MODES = Object.freeze(['all', 'activeSet', 'available']);

/**
 * Resolve the effective auto-key mode for a project. Coalesces the
 * sparse `project.autoKeyMode` field to the `'all'` default; unknown
 * values fall back to `'all'` with a console warning (Rule №1 --
 * unrecognised string is a developer bug, not silent corruption).
 *
 * @param {object|null|undefined} project
 * @returns {'all' | 'activeSet' | 'available'}
 */
export function getAutoKeyMode(project) {
  const raw = project?.autoKeyMode;
  if (raw === undefined || raw === null) return 'all';
  // Audit-fix M-1 (Phase 7.D sweep): membership check derives from the
  // exported `AUTOKEY_MODES` tuple rather than a parallel literal list,
  // so adding a new mode requires updating one source of truth instead
  // of three (the constant + this guard + runAutoKey's switch).
  if (AUTOKEY_MODES.includes(/** @type {'all'|'activeSet'|'available'} */ (raw))) {
    return /** @type {'all'|'activeSet'|'available'} */ (raw);
  }
  if (typeof console !== 'undefined') {
    console.warn(`[autoKey] unknown autoKeyMode '${raw}' on project; coalescing to 'all'.`);
  }
  return 'all';
}

/**
 * Pick the keying-set id to use for `'activeSet'` mode. Falls back
 * to `'LocRotScale'` when no active set is configured -- matches
 * Blender's "no active KS → use scene default" implicit behavior
 * (Blender's fallback is the user-pref keying mode, not a hardcoded
 * set; SS's hardcoded fallback is the most-common case for live2D
 * animation auto-key sessions).
 *
 * @param {object|null|undefined} project
 * @returns {string}
 */
export function pickActiveSetIdForAutoKey(project) {
  const active = getActiveKeyingSet(project);
  if (active?.id) return active.id;
  return 'LocRotScale';
}

/**
 * Dispatch an auto-key tick. Called from drag-end commit sites in
 * SkeletonOverlay + GizmoOverlay when `editorStore.autoKeyframe` is
 * on and the editor is in animation mode (caller checks the gate
 * before invoking -- this helper is unconditional).
 *
 * @param {object|null|undefined} project -- project snapshot (NOT a
 *   draft; this function reads metadata only and dispatches to
 *   handlers that take their own draft via updateProject)
 * @returns {{ mode: 'all'|'activeSet'|'available', dispatched: string }}
 *   diagnostic record for logging (caller decides whether to log)
 */
export function runAutoKey(project) {
  const mode = getAutoKeyMode(project);
  switch (mode) {
    case 'all': {
      // Legacy path -- see module header. Synthetic event routes
      // through the K-key handler at CanvasViewport.jsx:1457-1633.
      //
      // Phase 7 Slice 7.E: tag the synthetic event with a sentinel
      // (`__ssAutoKey`) so the K-key handler can distinguish auto-key
      // triggered K-presses (user dragged a bone) from manual K-presses
      // (user pressed K intentionally) and suppress the first-use
      // pointer toast on the auto-key path. Without the sentinel, a
      // user with auto-key on would see the "Press I to pick a keying
      // set" toast after their first bone drag -- confusing because
      // they did not press K.
      //
      // Audit-fix MED-2 (sweep #82): use plain assignment instead of
      // `Object.defineProperty`. Older WebKit (Safari ≤14) and some
      // embedded WebViews treat native DOM event properties as non-
      // configurable and throw `TypeError: Cannot define property`
      // when `Object.defineProperty` is called on them. Direct expando
      // assignment works universally on dispatched-and-consumed-in-
      // same-tick events. The `__` prefix is the SS-internal naming
      // convention; no enumeration-tooling concern in practice since
      // the event is consumed synchronously and never serialized.
      if (typeof window !== 'undefined') {
        const ev = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' });
        /** @type {any} */ (ev).__ssAutoKey = true;
        window.dispatchEvent(ev);
      }
      return { mode: 'all', dispatched: 'synthetic-K-keydown' };
    }
    case 'activeSet': {
      const setId = pickActiveSetIdForAutoKey(project);
      execApplyKeyingSet(setId);
      return { mode: 'activeSet', dispatched: setId };
    }
    case 'available': {
      execApplyKeyingSet('Available');
      return { mode: 'available', dispatched: 'Available' };
    }
    default: {
      // Unreachable per getAutoKeyMode's enum guard, but TS exhaustiveness:
      const exhaustive = /** @type {never} */ (mode);
      return { mode: exhaustive, dispatched: 'noop' };
    }
  }
}
