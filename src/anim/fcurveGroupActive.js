// @ts-check

/**
 * Animation Phase 5 Slice 5.LL (Path #50) — Per-FCurveGroup ACTIVE flag.
 *
 * Pure mutation helpers for the per-FCurveGroup `active` boolean —
 * Blender's `AGRP_ACTIVE` bit
 * (`reference/blender/source/blender/makesdna/DNA_action_types.h:350` —
 * `AGRP_ACTIVE = (1 << 1)` inside the `eActionGroup_Flag` enum at
 * `:346-370`; cite corrected per audit-fix fidelity HIGH-1 Slice 5.LL
 * dual-audit 2026-05-18 — earlier draft cited `:347` which is a
 * comment line). Sister to:
 *   - Slice 5.V `selected` on groups (group-selection, view state)
 *   - Slice 5.X `active` on fcurves (per-fcurve ACTIVE, sister substrate)
 *
 * # Why this slice exists
 *
 * Slice 5.BB shipped children_only group-children-select (Shift+Ctrl+click).
 * Slice 5.KK shipped plain/Ctrl group-header click (SELECT_REPLACE +
 * SELECT_INVERT). Both deferred AGRP_ACTIVE elevation as an inherited
 * Slice 5.V deviation:
 *
 *   - Slice 5.BB Deviation 3 / MED-3: Blender's children_only branch
 *     calls `ANIM_set_active_channel(..., ANIMTYPE_GROUP)` at
 *     `anim_channels_edit.cc:4191-4204` after the per-fcurve selection
 *     cascade.
 *   - Slice 5.KK Deviation 1: Blender's SELECT_REPLACE elevates the
 *     clicked group to AGRP_ACTIVE at `:4194-4204`; SELECT_INVERT
 *     toggles it at `:4194-4218` (active-group set or cleared based on
 *     whether the group ends up AGRP_SELECTED).
 *   - Slice 5.KK Deviation 4: Shift+group-click (SELECT_EXTEND_RANGE)
 *     deferred entirely because Blender's `animchannel_select_range`
 *     walker requires an active group of matching type
 *     (`ANIM_is_active_channel` at `:3997` walks AGRP_ACTIVE via the
 *     `:449` accessor).
 *
 * This slice ships the persisted bit + helpers so all three deviations
 * close. Shift+group-click range-select is queued for the slice
 * immediately downstream of this one (path #58 in the close-out queue).
 *
 * # Blender semantics ported
 *
 * **Set / Clear walk** — `ANIM_set_active_channel` at
 * `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:237-339`.
 * EXCLUSIVE flag: clears `AGRP_ACTIVE` on every same-type channel first
 * (per-type switch ANIMTYPE_GROUP case at `:264-269` via
 * `ACHANNEL_SET_FLAG(agrp, ACHANNEL_SETFLAG_CLEAR, AGRP_ACTIVE)`), then
 * sets it on the target group (post-clear switch ANIMTYPE_GROUP case at
 * `:344-348` via `agrp->flag |= AGRP_ACTIVE`; audit-fix fidelity LOW-1
 * Slice 5.LL — earlier cite `:343-348` included the outer `switch`
 * line at `:343`). The same-type filter
 * at `:255-260` ("only clear the 'active' flag for the channels of the
 * same type") matters in Blender's heterogeneous channel list where
 * groups, fcurves, NLA tracks, etc. coexist. SS's `action.groups[]` is
 * monotyped (groups only), so the same-type filter collapses to a
 * no-op — the helper walks every `action.groups[i]` because every entry
 * is by construction the right type. Sister situation to Slice 5.X's
 * `setActiveFCurve` walking `action.fcurves` directly.
 *
 * **Read** — `ANIM_is_active_channel` at `anim_channels_edit.cc:447-450`:
 *
 *   ```c
 *   case ANIMTYPE_GROUP: {
 *     bActionGroup *argp = static_cast<bActionGroup *>(ale->data);
 *     return argp->flag & AGRP_ACTIVE;
 *   }
 *   ```
 *
 * **Implicit clear on bulk-select deselect** — `anim_channels_select_set`
 * ANIMTYPE_GROUP case at `:714-722`. When `change_active=true` (always
 * true except for SELECT_EXTEND_RANGE per `:683`), the function clears
 * AGRP_ACTIVE on every visible group via `agrp->flag &= ~AGRP_ACTIVE`
 * at `:719`. SS port: when `applyChannelSelectAll` clears the
 * channel-region selection (Alt+A), it should also walk `action.groups`
 * clearing each group's `active` field. That cross-helper wire-in is
 * scoped to a future "groups join the bulk-select-all scope" slice
 * (currently `applyChannelSelectAll` operates only on `action.fcurves`)
 * — documented as Deviation 3 below.
 *
 * **Implicit clear on box-select** — `box_select_anim_channels` at
 * `:3625-3632`. After a box-select touches an ANIMTYPE_GROUP row,
 * `agrp->flag &= ~AGRP_ACTIVE` runs unconditionally. SS port: Slice 5.Y
 * box-select operates only on fcurves today (sidebar rows are
 * fcurve-keyed `data-fcurve-id`); group-row box-select coverage is a
 * future extension. Documented as Deviation 4.
 *
 * **Implicit set on auto-elevation** — `click_select_channel_group`
 * (defined `:4120-4221`) post-branch elevation at `:4191-4218` calls
 * `ANIM_set_active_channel` after every selectmode branch (replace,
 * invert, children_only) EXCEPT SELECT_EXTEND_RANGE (the `:4194`
 * `selectmode != SELECT_EXTEND_RANGE` gate). The post-branch
 * elevation flips between elevate-target (when AGRP_SELECTED after
 * the branch) and clear-active (when AGRP_SELECTED is now off after
 * the branch's XOR). This slice ships the `setActiveFCurveGroup`
 * primitive; Slices 5.KK + 5.BB consume it (see
 * `applyGroupHeaderSelect` + `applyGroupChildrenSelect` post-branch
 * elevation calls landed in the same commit as this substrate).
 * (Audit-fix fidelity HIGH-2 Slice 5.LL dual-audit 2026-05-18:
 * function-name attribution corrected from `mouse_anim_channels` —
 * those line ranges live inside `click_select_channel_group`, with
 * `mouse_anim_channels` (`:4475`) being the per-type dispatcher.)
 *
 * # Write semantics — view-state-or-data?
 *
 * Blender's `ANIM_OT_channels_click` carries `OPTYPE_UNDO` per
 * `:4686`. SS deviation (deliberate, inherited from Slice 5.X / 5.F
 * convention): ACTIVE writes use `skipHistory: true` at the dispatcher.
 * Sister-UX to selection — toggled by the same click, kept coherent.
 * Documented as Deviation 2 (inherited).
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `group.active` is a sparse
 * boolean: missing in v40-and-older saves, treated as `false` by
 * `isFCurveGroupActive`. Per `feedback_no_migration_baggage_rule_two`,
 * a migration writing `active: false` onto every group would be pure
 * noise — the reader collapses tri-state (`true`/`false`/missing) into
 * a clean boolean. Sister to Slice 5.X's no-migration stance for
 * `fc.active`.
 *
 * Legacy saves load with no active group. The first user click on a
 * group header then promotes that group to `active: true` via
 * `setActiveFCurveGroup`. Until that click, no group surfaces as
 * active in the sidebar tint.
 *
 * # SS deviations (cumulative — closes when conditions met)
 *
 * 1. **No range-select walker.** Closure: Shift+group-click slice
 *    downstream of this substrate (path #58). The walker calls
 *    `getActiveFCurveGroup(action)` as the `is_active_elem` bound and
 *    the clicked group as the `is_cursor_elem` bound, then walks
 *    `action.groups` in display order between them.
 * 2. **ACTIVE writes use `skipHistory: true`** at the dispatcher
 *    (inherited from Slice 5.X / 5.F's view-state UX choice; not a
 *    5.LL-original divergence).
 * 3. **Bulk select-all (Slice 5.K) does NOT clear group actives.**
 *    Currently `applyChannelSelectAll` operates only on `action.fcurves`.
 *    Blender's `anim_channels_select_set` cascade at `:719` clears
 *    AGRP_ACTIVE on every visible group when `change_active=true`.
 *    Closure: when bulk select-all is extended to include groups in
 *    its scope (queued as a future slice; not strictly required by
 *    any consumer today since groups aren't in the select-all loop).
 * 4. **Box-select (Slice 5.Y) does NOT touch group rows.** Sidebar
 *    rows are fcurve-keyed; group-row box-select coverage is a future
 *    extension. Blender's `box_select_anim_channels` clears AGRP_ACTIVE
 *    at `:3625-3632`. Closure: when box-select hit-tests group rows.
 *
 * @module anim/fcurveGroupActive
 */

/**
 * Read accessor for `AGRP_ACTIVE`.
 *
 * Strict `=== true` check — defensive against accidental writes of
 * `1`/`"yes"`/non-boolean truthy values that aren't part of the
 * contract. Mirrors `isFCurveActive`, `isFCurveGroupSelected`.
 *
 * @param {object|null|undefined} group
 * @returns {boolean}
 */
export function isFCurveGroupActive(group) {
  return !!(group && group.active === true);
}

/**
 * Return the single group in `action.groups` with `active === true`,
 * or null if none. The Blender invariant is that AT MOST ONE group
 * carries the flag; SS enforces this at write time
 * (`setActiveFCurveGroup` clears every other entry before setting the
 * target). If a corrupt project carries multiple `active: true`
 * groups, this returns the FIRST one in array order — same as
 * Blender's per-type `ANIM_is_active_channel` iteration finding the
 * first match.
 *
 * @param {object|null|undefined} action
 * @returns {object|null}
 */
export function getActiveFCurveGroup(action) {
  if (!action || !Array.isArray(action.groups)) return null;
  for (const g of action.groups) {
    if (g && g.active === true) return g;
  }
  return null;
}

/**
 * Set the active group in an action.
 *
 * Mirrors `ANIM_set_active_channel` at
 * `anim_channels_edit.cc:237-339`. EXCLUSIVE: clears `AGRP_ACTIVE` on
 * every group first (per-type clear at `:264-269`) then re-sets the
 * target via `:344-348` (`agrp->flag |= AGRP_ACTIVE`). At most one
 * group in the action ends up active.
 *
 * Sparse-write convention: every other group's `active` field is
 * DELETED (not set to false) per Rule №2. The target's field is set
 * to `true`. If `groupId` is null/empty/no-match, all active flags
 * are cleared (equivalent to `clearActiveFCurveGroups`). Sister to
 * Slice 5.X's `setActiveFCurve` semantics.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @param {string|null|undefined} groupId — group to activate, or null/missing to clear
 * @returns {{ activeNow: string|null, changed: boolean }}
 *   `activeNow` = id of the newly-active group (or null if cleared).
 *   `changed` = any `active` field was written or deleted.
 */
export function setActiveFCurveGroup(action, groupId) {
  const result = { activeNow: /** @type {string|null} */ (null), changed: false };
  if (!action || !Array.isArray(action.groups)) return result;

  // ID-based compare per Slice 5.X audit-fix MED-1 pattern: don't
  // pre-resolve target via `.find(...)` + identity check; compare by
  // `g.id === groupId` directly inside the loop so the helper survives
  // call sites that resolve the target from a different array slice.
  const hasValidId = typeof groupId === 'string' && groupId.length > 0;
  let foundTarget = false;

  for (const g of action.groups) {
    if (!g) continue;
    const isTarget = hasValidId && g.id === groupId;
    if (isTarget) {
      foundTarget = true;
      if (g.active !== true) {
        g.active = true;
        result.changed = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(g, 'active')) {
      // Sparse-write convention: covers both `active: true` siblings
      // (the exclusive-clear pass) AND stale `active: false` carried
      // by legacy data (sparse normalisation). Either case → delete.
      delete g.active;
      result.changed = true;
    }
  }

  if (foundTarget) result.activeNow = groupId ?? null;
  return result;
}

/**
 * Clear every group's `active` flag in an action.
 *
 * Sparse-write convention: deletes the field rather than setting to
 * false. Returns the count of cleared entries so the dispatcher can
 * skip the undo write when the action was already clean. Sister to
 * Slice 5.X's `clearActiveFCurves`.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @returns {{ cleared: number }}
 */
export function clearActiveFCurveGroups(action) {
  let cleared = 0;
  if (!action || !Array.isArray(action.groups)) return { cleared: 0 };
  for (const g of action.groups) {
    if (!g) continue;
    if (Object.prototype.hasOwnProperty.call(g, 'active')) {
      delete g.active;
      cleared++;
    }
  }
  return { cleared };
}

/**
 * Preflight for {@link setActiveFCurveGroup}: returns true iff calling
 * the setter would mutate any field. Mirrors Slice 5.X's
 * `wouldSetActiveFCurveChange` for phantom-undo prevention.
 *
 * Per Deviation 2, ACTIVE writes use `skipHistory: true` today, so the
 * phantom-undo concern is muted — but the preflight is kept for sister
 * symmetry with the other channel-flag helpers + to insulate against
 * a future flip back to undo-tracked writes.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} groupId
 * @returns {boolean}
 */
export function wouldSetActiveFCurveGroupChange(action, groupId) {
  if (!action || !Array.isArray(action.groups)) return false;

  let target = null;
  if (typeof groupId === 'string' && groupId.length > 0) {
    target = action.groups.find((g) => g && g.id === groupId) ?? null;
  }

  for (const g of action.groups) {
    if (!g) continue;
    if (g === target) {
      if (g.active !== true) return true;
    } else if (Object.prototype.hasOwnProperty.call(g, 'active')) {
      return true;
    }
  }
  return false;
}
