// @ts-check

/**
 * NLA tweak-mode helpers — Slice 4.C of Animation Phase 4 Blender-
 * Parity Plan.
 *
 * Ports Blender's `BKE_nla_tweakmode_enter` / `BKE_nla_tweakmode_exit` /
 * `BKE_nla_tweakmode_clear_flags` (`reference/blender/source/blender/
 * blenkernel/intern/nla.cc:2352-2577`, declared in
 * `BKE_nla.hh:524-549`).
 *
 * # What tweak mode does
 *
 * When the user clicks "Edit Action" on a selected NLA strip in the
 * NLAEditor (Slice 4.D will surface this), Blender enters tweak mode:
 *
 *   1. The bound Action of the strip becomes the AnimData's "active"
 *      action — edits in the Graph Editor / Dopesheet write directly
 *      to that Action.
 *   2. The strip's track (and, by default, every track above it) is
 *      flagged DISABLED so the NLA evaluator skips them — the active
 *      action layer would otherwise double-blend with the strip's
 *      contribution.
 *   3. All strips referencing the same action as the tweak strip are
 *      tagged TWEAKUSER (UI rendering hint — those strips visually
 *      indicate they share the action being edited; the active strip
 *      itself is excluded from this tagging).
 *   4. The pre-tweak action + slot handle are saved to
 *      `animData.tmpActionId` / `tmpSlotHandle` so `exitTweakMode`
 *      can restore them.
 *
 * # Exit semantics
 *
 * Blender's tweak mode has NO "cancel" path — edits go directly to
 * the Action while in tweak mode, so exit always "accepts". This
 * matches Blender; SS does not add a Cancel pseudo-semantic that
 * would require snapshotting the action on entry.
 *
 * # Length sync — SS DEVIATION (documented)
 *
 * Blender's `BKE_nla_tweakmode_exit` (nla.cc:2516-2565) calls
 * `nla_tweakmode_exit_sync_strip_lengths` which uses
 * `BKE_nlastrip_recalculate_bounds_sync_action` to re-derive each
 * SYNC_LENGTH-flagged strip's `end` from the action's frame range.
 * SS doesn't ship an action-frame-range helper at substrate level
 * (action length lives in `action.frameStart` / `action.frameEnd` or
 * implicitly in `action.duration` — not yet authoritatively pinned;
 * Phase 4.D NLAEditor will need to make this decision). For now SS
 * `exitTweakMode` skips length-sync entirely; SYNC_LENGTH-flagged
 * strips keep their pre-tweak `end` values. Documented as
 * `feature/4.D` follow-up.
 *
 * @module anim/nlaTweakMode
 */

import {
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  isTweakModeOn,
} from './nla.js';

/**
 * Find a track + strip pair by id within an animData. Returns
 * `{ track, strip }` or `{ track: null, strip: null }` on miss.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @returns {{ track: object|null, strip: object|null }}
 */
function findTrackAndStrip(animData, trackId, stripId) {
  const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : null;
  if (!tracks) return { track: null, strip: null };
  for (const t of tracks) {
    if (!t || t.id !== trackId) continue;
    const strips = Array.isArray(t.strips) ? t.strips : null;
    if (!strips) return { track: t, strip: null };
    for (const s of strips) {
      if (s && s.id === stripId) return { track: t, strip: s };
    }
    return { track: t, strip: null };
  }
  return { track: null, strip: null };
}

/**
 * Enter NLA tweak mode for the given track + strip.
 *
 * Byte-faithful port of `BKE_nla_tweakmode_enter`
 * (`nla.cc:2352-2456`). Returns `true` on success (also when already
 * in tweak mode — that branch is short-circuit per nla.cc:2365-2367),
 * `false` if the requested track + strip can't be found OR the strip
 * has no `actionId` (Blender treats that as
 * `BLI_assert_unreachable` + return false).
 *
 * Side effects on `animData` (all mutating in place — caller controls
 * persistence to the project store):
 *   1. Tags strips referencing the tweak strip's action with
 *      `NLASTRIP_FLAG.TWEAKUSER`; untags all others.
 *   2. Untags the active strip itself (Blender :2397).
 *   3. Sets `NLATRACK_FLAG.DISABLED` on the active track AND every
 *      track ABOVE it (higher `index`) — UNLESS
 *      `ADT_FLAG.NLA_EVAL_UPPER_TRACKS` is set, in which case ONLY
 *      the active track is disabled.
 *   4. Saves `animData.actionId` → `tmpActionId` and `slotHandle` →
 *      `tmpSlotHandle`.
 *   5. Swaps `animData.actionId` / `slotHandle` to the tweak strip's
 *      `actionId` / `slotHandle` so consumers reading "active action"
 *      see the tweaked one.
 *   6. Sets `tweakTrackId` / `tweakStripId` for evaluator routing.
 *   7. Sets `ADT_FLAG.NLA_EDIT_ON` flag.
 *
 * @param {object} animData       — mutated in place
 * @param {string} trackId
 * @param {string} stripId
 * @returns {boolean} true on success or already-in-tweak; false on miss
 */
export function enterTweakMode(animData, trackId, stripId) {
  if (!animData || typeof animData !== 'object') return false;

  // Already in tweak mode → short-circuit success (Blender nla.cc:2365-2367)
  if (isTweakModeOn(animData)) return true;

  const { track: activeTrack, strip: activeStrip } = findTrackAndStrip(
    animData, trackId, stripId);
  if (!activeTrack || !activeStrip) return false;

  // Blender nla.cc:2371: activeStrip->act must be non-null
  if (typeof activeStrip.actionId !== 'string' || activeStrip.actionId.length === 0) {
    return false;
  }

  const tracks = /** @type {object[]} */ (animData.nlaTracks);

  // Step 1 + 2: Tag TWEAKUSER on strips sharing the tweak strip's
  // action; untag everything else; untag the active strip itself
  // (Blender :2384-2397).
  const tweakActionId = activeStrip.actionId;
  for (const t of tracks) {
    if (!t || !Array.isArray(t.strips)) continue;
    for (const s of t.strips) {
      if (!s || typeof s !== 'object') continue;
      const flag = typeof s.flag === 'number' ? s.flag : 0;
      if (s.actionId === tweakActionId) {
        s.flag = flag | NLASTRIP_FLAG.TWEAKUSER;
      } else {
        s.flag = flag & ~NLASTRIP_FLAG.TWEAKUSER;
      }
    }
  }
  // Active strip itself: explicit untag (so renderer can distinguish
  // "this is the one being edited" from "these share its action")
  activeStrip.flag = (typeof activeStrip.flag === 'number' ? activeStrip.flag : 0)
    & ~NLASTRIP_FLAG.TWEAKUSER;

  // Step 3: DISABLED cascade (Blender :2399-2408).
  const activeIdx = typeof activeTrack.index === 'number' ? activeTrack.index : 0;
  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  const evalUpper = (adtFlag & ADT_FLAG.NLA_EVAL_UPPER_TRACKS) !== 0;

  activeTrack.flag = (typeof activeTrack.flag === 'number' ? activeTrack.flag : 0)
    | NLATRACK_FLAG.DISABLED;
  if (!evalUpper) {
    for (const t of tracks) {
      if (!t || t === activeTrack) continue;
      const tIdx = typeof t.index === 'number' ? t.index : 0;
      if (tIdx > activeIdx) {
        t.flag = (typeof t.flag === 'number' ? t.flag : 0) | NLATRACK_FLAG.DISABLED;
      }
    }
  }

  // Step 4: Save pre-tweak action + slot (Blender :2414-2415).
  animData.tmpActionId = animData.actionId ?? null;
  animData.tmpSlotHandle = typeof animData.slotHandle === 'number' ? animData.slotHandle : 0;

  // Step 5: Swap in tweak strip's action (Blender :2417-2433 +
  // :2445-2450 — Blender does this via the high-level
  // animrig::assign_action_and_slot which has reference-counting
  // side effects; SS just sets the string id since we don't
  // ref-count actions).
  animData.actionId = activeStrip.actionId;
  animData.slotHandle = typeof activeStrip.slotHandle === 'number' ? activeStrip.slotHandle : 0;

  // Step 6 + 7: Set runtime pointers + flag (Blender :2451-2453).
  animData.tweakTrackId = activeTrack.id;
  animData.tweakStripId = activeStrip.id;
  animData.flag = adtFlag | ADT_FLAG.NLA_EDIT_ON;

  return true;
}

/**
 * Clear all NLA tweak-mode flags on the animData, its tracks, and
 * its strips. Byte-faithful port of `BKE_nla_tweakmode_clear_flags`
 * (`nla.cc:2567-2577`).
 *
 * Side effects:
 *   - Every track: clear `NLATRACK_FLAG.DISABLED`
 *   - Every strip: clear `NLASTRIP_FLAG.TWEAKUSER`
 *   - animData: clear `ADT_FLAG.NLA_EDIT_ON`
 *
 * Does NOT touch backup pointers (`tmpActionId` etc) or the
 * runtime tweak pointers (`tweakTrackId` / `tweakStripId`) — that's
 * `exitTweakMode`'s job. This helper is for state-cleanup
 * scenarios where the action restore isn't wanted (recovery paths,
 * file-load cleanup).
 *
 * @param {object|null|undefined} animData
 */
export function clearTweakFlags(animData) {
  if (!animData || typeof animData !== 'object') return;
  const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : null;
  if (tracks) {
    for (const t of tracks) {
      if (!t || typeof t !== 'object') continue;
      if (typeof t.flag === 'number') t.flag = t.flag & ~NLATRACK_FLAG.DISABLED;
      const strips = Array.isArray(t.strips) ? t.strips : null;
      if (!strips) continue;
      for (const s of strips) {
        if (!s || typeof s !== 'object') continue;
        if (typeof s.flag === 'number') s.flag = s.flag & ~NLASTRIP_FLAG.TWEAKUSER;
      }
    }
  }
  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  animData.flag = adtFlag & ~ADT_FLAG.NLA_EDIT_ON;
}

/**
 * Exit NLA tweak mode — restores the pre-tweak active action + clears
 * all tweak-mode runtime state.
 *
 * Combines Blender's `BKE_nla_tweakmode_exit` + the internal
 * `nla_tweakmode_exit_nofollowptr` (nla.cc:2492-2565). Differences
 * from Blender:
 *
 *   - **No length sync**: Blender re-derives SYNC_LENGTH-flagged
 *     strips' `end` from the (potentially-edited) action's frame
 *     range. SS doesn't have an action-length helper at substrate
 *     level; documented as `feature/4.D` follow-up. SYNC_LENGTH
 *     flag bit is still cleared per nla.cc:2567 semantics.
 *   - **No slot-user-map updates**: Blender maintains a refcount of
 *     which Object IDs use each ActionSlot for purge logic; SS
 *     doesn't have an Action refcount system at all (Slice 1.E
 *     ActionsEditor handles "delete action" via cascade walk).
 *   - **No-op when not in tweak mode**: matches Blender :2509-2511.
 *
 * Side effects on `animData`:
 *   1. `clearTweakFlags` (DISABLED on tracks, TWEAKUSER on strips,
 *      NLA_EDIT_ON on adt)
 *   2. Restore `animData.actionId` from `tmpActionId`
 *   3. Restore `animData.slotHandle` from `tmpSlotHandle`
 *   4. Clear backup pointers: `tmpActionId = null`,
 *      `tmpSlotHandle = 0`
 *   5. Clear runtime pointers: `tweakTrackId = null`,
 *      `tweakStripId = null`
 *
 * @param {object|null|undefined} animData — mutated in place
 */
export function exitTweakMode(animData) {
  if (!animData || typeof animData !== 'object') return;
  if (!isTweakModeOn(animData)) return;

  clearTweakFlags(animData);

  // Restore action + slot from backup (Blender nla.cc:2496-2501)
  animData.actionId = animData.tmpActionId ?? null;
  animData.slotHandle = typeof animData.tmpSlotHandle === 'number'
    ? animData.tmpSlotHandle : 0;

  // Clear backup pointers (Blender :2499-2501)
  animData.tmpActionId = null;
  animData.tmpSlotHandle = 0;

  // Clear runtime tweak pointers (Blender :2503-2504)
  animData.tweakTrackId = null;
  animData.tweakStripId = null;
}
