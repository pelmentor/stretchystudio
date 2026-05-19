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
 * # SS deviations (numbered for the deviation registry)
 *
 * **DEVIATION 1 — No action refcount / Slot-user-map updates.**
 * Blender (nla.cc:2542-2563) calls `animrig::generic_assign_action`
 * which manipulates per-`ActionSlot` user-count refs (`users_add` /
 * `users_remove`) for purge logic. SS doesn't model action
 * refcounts at all — Slice 1.E `actionRegistry.js` handles "delete
 * action" via cascade walk instead. Adding a refcount system later
 * MUST grep this module + `actionRegistry.js` to wire all sites.
 *
 * **DEVIATION 2 — No RNA notification.** Blender posts an RNA
 * "Action changed" notification at swap-in (line 2420) for the
 * outliner / properties panel to re-render. SS reactivity (Zustand
 * subscribers + the project store action) handles this naturally
 * when the caller persists the mutation — no equivalent needed at
 * the substrate level.
 *
 * **DEVIATION 3 — Slot validation skipped.** Blender's
 * `assign_action_and_slot` validates the slot is compatible with
 * the owner ID. SS's `slotHandle` is a plain int; if a project
 * carries a slotHandle that doesn't exist on the swapped-in action,
 * `evaluateAction` will silently no-op. Acceptable for the SS
 * use case (slotHandle is always 0 in Phase 4 per plan §4.A).
 *
 * **DEVIATION 4 — Explicit `(trackId, stripId)` API vs Blender's
 * active-discovery.** Blender's `BKE_nla_tweakmode_enter` discovers
 * the active track + strip via `nla_tweakmode_find_active`
 * (nla.cc:2296-2350) reading `NLATRACK_ACTIVE` + `NLASTRIP_FLAG_ACTIVE`
 * / `SELECT` bits. SS takes the IDs explicitly — Slice 4.D NLAEditor
 * is the de-facto caller and knows the clicked strip directly. If
 * SS later needs a "multi-strip-selected → enter on last selected"
 * fallback (Blender does this), 4.D-side discovery is the right
 * layer, not this module.
 *
 * **DEVIATION 5 — `tmpSlotHandle` cleared to `0` not Blender's
 * `Slot::unassigned` sentinel.** SS has no Slot system, so `0` is
 * the sentinel. If a Slot subsystem ever lands, the collision with
 * "legitimately slot 0" needs a distinct sentinel.
 *
 * **NO DEVIATION on length sync** (audit-fix Slice 4.C HIGH-F5):
 * SYNC_LENGTH-flagged strip `end` re-derivation IS implemented; see
 * `syncStripBoundsToAction` below. The pre-audit-fix doc claimed
 * SS skipped this; the auditor correctly identified it as buildable
 * today (action shape carries `frameStart` / `frameEnd` / `duration`
 * per v36 schema), and silently miscomputing strip bounds would be
 * a Rule №1 silent fallback.
 *
 * **PROTECTED gate** (audit-fix Slice 4.D.3 HIGH-A1): Blender's
 * NLA_OT_tweakmode_enter operator goes through `nlaop_poll_tweakmode_off`
 * (`nla_edit.cc:195`) at poll time + `BKE_nla_tweakmode_enter` at
 * exec time. The editor-layer poll DOES NOT check PROTECTED, but the
 * NLAEditor channel-edit toggle UI surfaces only allow track-level
 * operations when the track is NOT protected (via the channel-filter
 * `do_protected` flag). SS places `enterTweakMode` at the BKE-equivalent
 * level and previously had no PROTECTED check at any layer. The UI
 * (NLAEditor.jsx StripPropertiesPanel) gates the button on
 * `track.protected_`, but per Rule №1 the substrate MUST enforce the
 * invariant — UI is a hint, not a contract. Adding the gate here so
 * any caller (test, future automated path, accessibility bypass) gets
 * a consistent refusal. SS-original: Blender's BKE layer doesn't
 * gate on PROTECTED either; SS shifts the editor-layer filter into
 * the substrate to make it bypass-proof.
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
 * Action-frame-range duration helper. Reads the action's frame range
 * with precedence: explicit `frameStart`/`frameEnd` > `duration` > 0.
 *
 * Used by `syncStripBoundsToAction` to recompute SYNC_LENGTH-flagged
 * strips' `end` at tweak-mode exit. Returns 0 if the action has no
 * length signal — caller MUST guard against propagating a zero-length
 * sync to a strip's `end` (a zero-length strip would deactivate).
 *
 * Note: SS uses ms canonical time (`feedback_ms_canonical_animation_time`)
 * but `frameStart`/`frameEnd` were authored as frames in pre-v36
 * legacy data. For Phase 4 we treat them as ms since v36's
 * `animationToAction` migrates `duration` (which is ms) as-is and
 * leaves `frameStart`/`frameEnd` as-is (also ms in the live store).
 * If a Phase-3-or-earlier legacy frame-based value sneaks through,
 * the resulting strip end will be wrong — but no test fixture or
 * production project today carries that shape post-v36 migration.
 *
 * @param {object|null|undefined} action
 * @returns {number} ms
 */
function getActionLengthMs(action) {
  if (!action || typeof action !== 'object') return 0;
  const fs = typeof action.frameStart === 'number' ? action.frameStart : null;
  const fe = typeof action.frameEnd === 'number' ? action.frameEnd : null;
  if (fs !== null && fe !== null) return Math.max(0, fe - fs);
  if (typeof action.duration === 'number') return Math.max(0, action.duration);
  return 0;
}

/**
 * Re-derive a strip's `end` from the tweaked action's frame range.
 * Ports Blender's `BKE_nlastrip_recalculate_bounds_sync_action`
 * (`nla.cc:530-540` approximate — Blender's helper is more involved
 * because it also handles reverse + scale gracefully; SS uses the
 * canonical formula).
 *
 * Formula: `end = start + actlength * scale / repeat`
 *
 * Why `/ repeat` and not `* repeat`? The strip's timeline length is
 * `(actlength * scale)` for ONE play-through; the strip plays
 * `repeat` times within that timeline span. Inverting: total =
 * actlength * scale / repeat ... wait, that's wrong direction.
 *
 * Actually re-read: per Blender `nlastrip_recalculate_bounds`
 * (`nla.cc:535`): `nlastrip_length = actlength * abs(scale) * repeat`.
 * So `end = start + actlength * abs(scale) * repeat`. Strip plays
 * `repeat` copies of the action, each scaled by `scale`. SS matches
 * that formula.
 *
 * Skips no-op cases:
 *   - actlength == 0 (no length signal — Blender does the same guard
 *     via `IS_EQF`)
 *   - strip has no action (defensive — shouldn't happen post-validation)
 *
 * @param {object} strip — mutated in place
 * @param {object|null|undefined} action — strip's bound action
 */
function syncStripBoundsToAction(strip, action) {
  const actlen = getActionLengthMs(action);
  if (actlen <= 1e-10) return;   // no length signal — preserve current end

  let scale = typeof strip.scale === 'number' ? strip.scale : 1;
  if (Math.abs(scale) < 1e-10) scale = 1;
  scale = Math.abs(scale);

  let repeat = typeof strip.repeat === 'number' ? strip.repeat : 1;
  if (Math.abs(repeat) < 1e-10) repeat = 1;

  const start = typeof strip.start === 'number' ? strip.start : 0;
  strip.end = start + actlen * scale * repeat;
}

/**
 * Find a project's action by id. Returns the action object or null.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} actionId
 * @returns {object|null}
 */
function findAction(project, actionId) {
  if (!project || !actionId) return null;
  const actions = Array.isArray(project.actions) ? project.actions : null;
  if (!actions) return null;
  for (const a of actions) {
    if (a && a.id === actionId) return a;
  }
  return null;
}

/**
 * Find a track + strip pair by id within an animData. Returns
 * `{ track, strip }` or `{ track: null, strip: null }` on miss.
 *
 * Stops searching at the first track-id match (strip ids are unique
 * within their track; a strip only ever belongs to one track per the
 * NLA shape contract from Slice 4.A). If the trackId matches but the
 * stripId does not, returns `{ track: t, strip: null }` rather than
 * continuing to other tracks — caller treats either-null as failure.
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
 * (`nla.cc:2352-2456`). Returns:
 *   - `true` on successful enter
 *   - `true` if already in tweak mode AND the requested (trackId,
 *     stripId) matches the current tweak strip (idempotent re-call)
 *   - **`false` if already in tweak mode on a DIFFERENT strip**
 *     (audit-fix Slice 4.C HIGH-A2 — caller must `exitTweakMode`
 *     first; silently keeping the old tweak strip while the caller
 *     thinks they entered a new one was a Rule №1 violation. Blender's
 *     operator layer always paired enter with explicit exit, so the
 *     `return true` at nla.cc:2365-2367 was never hit on a different
 *     strip in practice — SS's explicit-IDs API surfaces the gap.)
 *   - **`false` if the requested track is PROTECTED** (audit-fix
 *     Slice 4.D.3 HIGH-A1 — UI-level gate in NLAEditor moved into
 *     the substrate per Rule №1; see module-level "PROTECTED gate"
 *     deviation note above).
 *   - `false` if the requested track + strip can't be found OR the
 *     strip has no `actionId` (Blender treats that as
 *     `BLI_assert_unreachable` + return false at nla.cc:2371-2379).
 *
 * **Index contract** (audit-fix MED-A3): the DISABLED cascade
 * disables every track with `t.index > activeTrack.index`. SS
 * authoritatively stores `index` on the track object (set by the
 * caller / UI); evaluator + this helper read it. If `index` drifts
 * from the track's actual position in `animData.nlaTracks[]` (e.g.
 * UI reorder forgot to re-stamp), the cascade disables the WRONG
 * tracks. Slice 4.D NLAEditor MUST re-stamp `index` on every reorder.
 *
 * **Blender listbase head = BOTTOM layer** (verified
 * `anim_sys.cc:3448` evaluator iterates `first → next` and blends each
 * strip on top of the accumulator). SS's `index > activeIdx` maps to
 * Blender's `activeTrack->next` linked-list walk because SS sorts
 * tracks bottom-to-top by ascending index in the evaluator
 * (`nlaEval.js` `tracksBottomToTop`).
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
 * @returns {boolean} true on success or idempotent re-enter; false on
 *   miss OR on different-strip-while-already-in-tweak.
 */
export function enterTweakMode(animData, trackId, stripId) {
  if (!animData || typeof animData !== 'object') return false;

  // Already in tweak mode: idempotent on same (track, strip);
  // REJECT a request to enter a different strip — audit-fix HIGH-A2.
  // Blender's call sites always paired with an explicit exit, so this
  // branch was effectively unreachable in Blender; SS's explicit-IDs
  // API would otherwise silently retain the old tweak strip while
  // returning `true`, masking caller intent.
  if (isTweakModeOn(animData)) {
    if (animData.tweakTrackId === trackId && animData.tweakStripId === stripId) {
      return true;
    }
    return false;
  }

  const { track: activeTrack, strip: activeStrip } = findTrackAndStrip(
    animData, trackId, stripId);
  if (!activeTrack || !activeStrip) return false;

  // Audit-fix Slice 4.D.3 HIGH-A1: refuse PROTECTED tracks at the
  // substrate. Per Rule №1 the UI gate in NLAEditor's StripPropertiesPanel
  // is a hint, not a contract — the invariant must live with the
  // function that owns the semantic. Blender enforces this at the
  // editor layer; SS folds it into the BKE-equivalent so no caller
  // path can bypass.
  const trackFlag = typeof activeTrack.flag === 'number' ? activeTrack.flag : 0;
  if ((trackFlag & NLATRACK_FLAG.PROTECTED) !== 0) {
    return false;
  }

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
 * all tweak-mode runtime state. **SYNC_LENGTH-flagged strips have
 * their `end` re-derived from the tweaked action's frame range**
 * (audit-fix Slice 4.C HIGH-F5).
 *
 * Combines Blender's `BKE_nla_tweakmode_exit` + the internal
 * `nla_tweakmode_exit_nofollowptr` + `nla_tweakmode_exit_sync_strip_lengths`
 * (nla.cc:2492-2565 + 2463-2486). See module-level "SS deviations"
 * for what SS skips (refcount, RNA notify, slot validation).
 *
 * **No-op when not in tweak mode** (matches Blender :2509-2511).
 *
 * Side effects on `animData`:
 *   1. **Length sync first**, BEFORE flag clear: every SYNC_LENGTH-
 *      flagged strip referencing the tweaked action gets its `end`
 *      re-derived via `syncStripBoundsToAction`. Order matters: the
 *      sync needs `animData.actionId` to still point at the tweaked
 *      action (clearTweakFlags clears NLA_EDIT_ON, not the action
 *      pointer, but doing sync first keeps the semantic clear).
 *      Skipped silently if `project` is not provided (defensive for
 *      legacy callers; production caller chain MUST pass it).
 *   2. `clearTweakFlags` (DISABLED on tracks, TWEAKUSER on strips,
 *      NLA_EDIT_ON on adt)
 *   3. Restore `animData.actionId` from `tmpActionId`
 *   4. Restore `animData.slotHandle` from `tmpSlotHandle`
 *   5. Clear backup pointers: `tmpActionId = null`,
 *      `tmpSlotHandle = 0`
 *   6. Clear runtime pointers: `tweakTrackId = null`,
 *      `tweakStripId = null`
 *
 * @param {object|null|undefined} animData - mutated in place
 * @param {object|null} [project] - for SYNC_LENGTH action-lookup; if
 *   omitted, length-sync is skipped (defensive - production callers
 *   MUST pass it to honor SYNC_LENGTH semantics)
 */
export function exitTweakMode(animData, project = null) {
  if (!animData || typeof animData !== 'object') return;
  if (!isTweakModeOn(animData)) return;

  // Step 1: Length-sync BEFORE clearing flags. Blender does this in
  // `nla_tweakmode_exit_sync_strip_lengths` (nla.cc:2463-2486): the
  // active tweak strip + every strip sharing the same action both
  // get re-bound if SYNC_LENGTH is set. We need `animData.actionId`
  // to still point at the tweaked action here so we know WHICH action
  // to re-derive bounds against.
  if (project) {
    const tweakedActionId = animData.actionId;
    const tweakedAction = findAction(project, tweakedActionId);
    if (tweakedAction) {
      const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : null;
      if (tracks) {
        for (const t of tracks) {
          if (!t || !Array.isArray(t.strips)) continue;
          for (const s of t.strips) {
            if (!s || typeof s !== 'object') continue;
            const flag = typeof s.flag === 'number' ? s.flag : 0;
            if ((flag & NLASTRIP_FLAG.SYNC_LENGTH) !== 0
                && s.actionId === tweakedActionId) {
              syncStripBoundsToAction(s, tweakedAction);
            }
          }
        }
      }
    }
  }

  // Step 2: Clear flag bits (track DISABLED + strip TWEAKUSER + adt
  // NLA_EDIT_ON).
  clearTweakFlags(animData);

  // Step 3 + 4: Restore action + slot from backup (Blender :2496-2501)
  animData.actionId = animData.tmpActionId ?? null;
  animData.slotHandle = typeof animData.tmpSlotHandle === 'number'
    ? animData.tmpSlotHandle : 0;

  // Step 5: Clear backup pointers (Blender :2499-2501)
  animData.tmpActionId = null;
  animData.tmpSlotHandle = 0;

  // Step 6: Clear runtime tweak pointers (Blender :2503-2504)
  animData.tweakTrackId = null;
  animData.tweakStripId = null;
}
