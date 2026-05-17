// @ts-check

/**
 * Animation Phase 5 Slice 5.V — FCurveGroup datablock + helpers.
 *
 * Pure module backing the new `action.groups[]` field and the
 * `fcurve.groupId` pointer. Ports Blender's `bActionGroup`
 * (`reference/blender/source/blender/makesdna/DNA_action_types.h:993-1044`)
 * to SS's sparse-boolean idiom.
 *
 * # Blender provenance
 *
 * Blender's `bActionGroup.flag` is a bitfield over `eActionGroup_Flag`
 * (`reference/blender/source/blender/makesdna/DNA_action_types.h:346-370`):
 *
 *   - `AGRP_SELECTED              = (1 << 0)`  — group is selected
 *   - `AGRP_ACTIVE                = (1 << 1)`  — last-selected group
 *   - `AGRP_PROTECTED             = (1 << 2)`  — channels not editable
 *   - `AGRP_EXPANDED              = (1 << 3)`  — DopeSheet sub-channels visible
 *   - `AGRP_MUTED                 = (1 << 4)`  — sub-channels NOT EVALUATED
 *   - `AGRP_NOTVISIBLE            = (1 << 5)`  — sub-channels not visible in Graph Editor
 *   - `AGRP_EXPANDED_G            = (1 << 6)`  — Graph Editor sub-channels visible
 *   - `AGRP_MODIFIERS_OFF         = (1 << 7)`  — group-modifier disable (not ported — 5.V deviation)
 *   - `AGRP_CURVES_ALWAYS_VISIBLE = (1 << 17)` — pin (not ported — 5.V deviation)
 *
 * SS adopts the sparse-boolean convention: each flag is a separate
 * optional field, missing-equals-default. All defaults are FALSE
 * (matches Blender's WRITE-time behavior at
 * `reference/blender/source/blender/animrig/intern/action.cc:2316-2334`
 * — `Channelbag::channel_group_create` sets `flag = AGRP_SELECTED`
 * only; new groups carry no EXPANDED bit and render collapsed). SS
 * collapses Blender's two expand bits (`AGRP_EXPANDED` for DopeSheet
 * + `AGRP_EXPANDED_G` for Graph Editor) into ONE `expanded` field —
 * deliberate deviation since SS doesn't have a separate DopeSheet
 * editor as of 5.V.
 *
 * # Group ID provenance + auto-population
 *
 * `action.groups[i].id` is a stable string. Auto-derived from fcurve
 * target ONLY by the v40 migration (and by explicit re-runs of
 * [[groupFCurvesByTarget]]):
 *
 *   - node-targeting fcurves → group id `g_node_${nodeId}`,
 *     name = node display name (resolved by caller — keeps this module
 *     project-state-free)
 *   - param-targeting fcurves → NO group (groupId stays undefined)
 *
 * SS deviation: subsequent fcurve adds (`buildNodeFCurve` from
 * `motion3jsonImport`, future live-record paths) do NOT auto-call
 * `groupFCurvesByTarget` — the new fcurve lands ungrouped until the
 * user reloads the project (which re-runs the migration's idempotent
 * pass). Closure tied to a future "auto-group on add" hook (queued
 * as path #33 in the close-out doc).
 *
 * Param fcurves are intentionally left ungrouped: in Blender, params
 * are typically one-fcurve-per-target and grouping each alone adds
 * sidebar noise without isolation benefit. Mirrors Blender's
 * "Ungrouped" tail bucket in `ANIM_animfilter_action_slot` at
 * `reference/blender/source/blender/editors/animation/anim_filter.cc:1585`
 * (grouped channels emit first via the `for (bActionGroup *group :
 * channelbag->channel_groups())` loop at line 1659, then ungrouped
 * fcurves via the `drop_front(first_ungrouped_fcurve_index)` span
 * at line 1673).
 *
 * # Mute + hide cascade (closes Slice 5.G dual-audit MED-B2)
 *
 * Blender's `is_fcurve_evaluatable` at
 * `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:347-352`
 * short-circuits eval when EITHER the fcurve OR its parent group is
 * muted. The full Blender check is `fcu->flag & (FCURVE_MUTED |
 * FCURVE_DISABLED)` for the per-curve gate; SS omits the
 * `FCURVE_DISABLED` branch by design (SS has no concept of a "broken"
 * fcurve to disable). SS mirrors the group cascade via
 * [[isFCurveEffectivelyMuted]] called from `evaluateActionFCurves`
 * (animationFCurve.js) and `kernelFCurveEval`
 * (depgraph/kernels/fcurve.js). Per-fcurve mute still works on its
 * own; the cascade is purely additive (group muted → all members
 * effectively muted regardless of their per-fcurve bit).
 *
 * Hide cascade is the sister: a group with `hide:true` makes every
 * member fcurve effectively hidden from the sidebar + plot. Read via
 * [[isFCurveEffectivelyHidden]] from FCurveEditor.jsx's sidebar +
 * plot decode passes.
 *
 * # Rule №1 + Rule №2 compliance
 *
 * No silent fallbacks: every read helper returns a defined boolean
 * (defensive on bad input). Mutators return the post-write value so
 * callers can avoid an extra read.
 *
 * No migration baggage: per Slice 5.G's pattern, the sparse-boolean
 * convention means no v40 write of `false` onto every group is needed
 * — `false`/missing/undefined collapse cleanly. The v40 migration
 * DOES explicitly write `expanded: true` on every auto-created group
 * so the migrated user's existing fcurves remain visible (default-
 * collapsed groups would silently hide every channel until the user
 * clicked each header). This is the ONLY explicit-write the migration
 * does and is documented as a deliberate Slice 5.V deviation.
 *
 * @module anim/fcurveGroups
 */

import { decodeFCurveTarget } from './animationFCurve.js';

/**
 * @typedef {Object} FCurveGroup
 * @property {string} id - stable string, unique within action
 * @property {string} name - display name
 * @property {boolean} [mute] - sub-channels NOT EVALUATED (AGRP_MUTED)
 * @property {boolean} [hide] - sub-channels hidden in Graph Editor (negative of AGRP_NOTVISIBLE)
 * @property {boolean} [expanded] - Graph Editor sub-channels visible (AGRP_EXPANDED_G)
 * @property {boolean} [selected] - group is selected (AGRP_SELECTED)
 *
 * @typedef {Object} FCurveLike
 * @property {string} id
 * @property {string} [rnaPath]
 * @property {string} [groupId]
 * @property {boolean} [mute]
 * @property {boolean} [hide]
 *
 * @typedef {Object} ActionLike
 * @property {string} [id]
 * @property {FCurveLike[]} fcurves
 * @property {FCurveGroup[]} [groups]
 */

// ── Read helpers (defensive on bad input) ──────────────────────────────

/**
 * Find a group by id. Returns `null` when the group is missing or
 * the action has no groups array yet.
 *
 * @param {ActionLike|null|undefined} action
 * @param {string|null|undefined} groupId
 * @returns {FCurveGroup|null}
 */
export function getFCurveGroupById(action, groupId) {
  if (!action || !groupId || typeof groupId !== 'string') return null;
  const groups = action.groups;
  if (!Array.isArray(groups)) return null;
  for (const g of groups) {
    if (g && g.id === groupId) return g;
  }
  return null;
}

/**
 * Strict `=== true` read for group mute. Defensive against accidental
 * truthy writes. Returns false when group is null/missing. Sister to
 * `isFCurveMuted` from fcurveMute.js.
 *
 * @param {FCurveGroup|null|undefined} group
 * @returns {boolean}
 */
export function isFCurveGroupMuted(group) {
  return !!(group && group.mute === true);
}

/**
 * Strict `=== true` read for group hide. Sister to `isFCurveHidden`
 * from fcurveVisible.js. Note: SS uses `hide:true === hidden` (Blender's
 * AGRP_NOTVISIBLE convention) — the field name matches the boolean
 * value rather than the inverse "visible" naming.
 *
 * @param {FCurveGroup|null|undefined} group
 * @returns {boolean}
 */
export function isFCurveGroupHidden(group) {
  return !!(group && group.hide === true);
}

/**
 * Read group expand state. Defaults to FALSE when the field is missing
 * — matches Blender's WRITE-time default at
 * `reference/blender/source/blender/animrig/intern/action.cc:2316-2334`
 * (`Channelbag::channel_group_create` sets `flag = AGRP_SELECTED`
 * only; no EXPANDED bit). A null/missing group also resolves to false
 * for consistency — caller's bucket-by-groupId logic should treat
 * groupless rows as ungrouped (which means flat-render, not collapsed).
 *
 * Audit-fix HIGH-B FAB-2 (Slice 5.V dual-audit 2026-05-17): previous
 * default was TRUE on the (incorrect) claim that Blender groups carry
 * `AGRP_EXPANDED | AGRP_EXPANDED_G` at creation — verified false by
 * reading the real `channel_group_create` body. Flipped to match
 * Blender; the v40 migration writes `expanded: true` explicitly on
 * auto-created groups so existing user data stays visible.
 *
 * @param {FCurveGroup|null|undefined} group
 * @returns {boolean}
 */
export function isFCurveGroupExpanded(group) {
  if (!group) return false;
  return group.expanded === true;
}

/**
 * Strict `=== true` read for group selection. Sister to
 * `isFCurveSelected` from fcurveChannelSelect.js.
 *
 * @param {FCurveGroup|null|undefined} group
 * @returns {boolean}
 */
export function isFCurveGroupSelected(group) {
  return !!(group && group.selected === true);
}

// ── Effective-state cascade (eval + sidebar) ───────────────────────────

/**
 * True when the fcurve's per-curve mute OR its parent group's mute is
 * set. Mirrors Blender's `is_fcurve_evaluatable` short-circuit at
 * `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:347-352`
 * — full Blender check is `fcu->flag & (FCURVE_MUTED | FCURVE_DISABLED)`
 * (line 347) OR `fcu->grp && (fcu->grp->flag & AGRP_MUTED)` (line 350).
 * SS omits the `FCURVE_DISABLED` branch by design (no concept of a
 * "broken" fcurve in the SS data model — see `fcurveMute.js` header).
 *
 * Caller passes the action so the group lookup can resolve `fc.groupId`.
 * When `fc.groupId` is undefined / unknown / absent, only the per-fcurve
 * mute applies (ungrouped fcurves never inherit a group mute by
 * construction).
 *
 * @param {FCurveLike|null|undefined} fcurve
 * @param {ActionLike|null|undefined} action
 * @returns {boolean}
 */
export function isFCurveEffectivelyMuted(fcurve, action) {
  if (!fcurve) return false;
  if (fcurve.mute === true) return true;
  if (!fcurve.groupId) return false;
  return isFCurveGroupMuted(getFCurveGroupById(action, fcurve.groupId));
}

/**
 * True when the fcurve's per-curve hide OR its parent group's hide is
 * set. Sister to [[isFCurveEffectivelyMuted]] for the sidebar +
 * plot-decode visibility cascade. Mirrors Blender's
 * `acf_group_setting_flag(ACHANNEL_SETTING_VISIBLE)` at
 * `reference/blender/source/blender/editors/animation/anim_channels_defines.cc:937-940`
 * — `AGRP_NOTVISIBLE` is the negative bit (SS uses `hide:true` for
 * the same positive semantic).
 *
 * @param {FCurveLike|null|undefined} fcurve
 * @param {ActionLike|null|undefined} action
 * @returns {boolean}
 */
export function isFCurveEffectivelyHidden(fcurve, action) {
  if (!fcurve) return false;
  if (fcurve.hide === true) return true;
  if (!fcurve.groupId) return false;
  return isFCurveGroupHidden(getFCurveGroupById(action, fcurve.groupId));
}

// ── Write helpers (preflight + mutator pairs, Slice 5.M pattern) ──────

/**
 * Preflight read for {@link applyToggleFCurveGroupMute}. Returns true
 * iff the group exists — toggles are always non-idempotent (a
 * "would-toggle-flip" predicate would always be true for an existing
 * group regardless of current flag state), so this preflight reduces
 * to "does the target exist?". Audit-fix L1 (Slice 5.V dual-audit):
 * docstring previously said "would change state" which was misread-
 * able as "would result in a specific state".
 *
 * @param {ActionLike|null|undefined} action
 * @param {string|null|undefined} groupId
 * @returns {boolean}
 */
export function wouldToggleFCurveGroupMuteChange(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  return g !== null;
}

/**
 * Toggle the group's mute bit in-place. Returns the post-toggle value
 * (`true` when newly muted, `false` when newly unmuted). Returns `null`
 * when the group doesn't exist. Sparse-write convention: setting `false`
 * DELETES the field rather than writing the literal `false`.
 *
 * @param {ActionLike} action
 * @param {string} groupId
 * @returns {boolean|null}
 */
export function applyToggleFCurveGroupMute(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  if (!g) return null;
  const next = !isFCurveGroupMuted(g);
  if (next) g.mute = true;
  else delete g.mute;
  return next;
}

/**
 * Sister to [[wouldToggleFCurveGroupMuteChange]] for hide.
 *
 * @param {ActionLike|null|undefined} action
 * @param {string|null|undefined} groupId
 * @returns {boolean}
 */
export function wouldToggleFCurveGroupHiddenChange(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  return g !== null;
}

/**
 * Sister to [[applyToggleFCurveGroupMute]] for hide.
 *
 * @param {ActionLike} action
 * @param {string} groupId
 * @returns {boolean|null}
 */
export function applyToggleFCurveGroupHidden(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  if (!g) return null;
  const next = !isFCurveGroupHidden(g);
  if (next) g.hide = true;
  else delete g.hide;
  return next;
}

/**
 * Sister to [[wouldToggleFCurveGroupMuteChange]] for expanded. Always
 * returns `true` when the group exists (toggling expanded is a UI op
 * that should always commit) — `expanded` defaults to true so the
 * first toggle writes `false`, the second deletes the field.
 *
 * @param {ActionLike|null|undefined} action
 * @param {string|null|undefined} groupId
 * @returns {boolean}
 */
export function wouldToggleFCurveGroupExpandedChange(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  return g !== null;
}

/**
 * Sister to [[applyToggleFCurveGroupMute]] for expanded. Default-false
 * sparseness (matches Blender — see [[isFCurveGroupExpanded]] note):
 * first toggle writes `expanded: true` (explicit expanded); second
 * toggle deletes the field (back to default-false collapsed).
 *
 * @param {ActionLike} action
 * @param {string} groupId
 * @returns {boolean|null}
 */
export function applyToggleFCurveGroupExpanded(action, groupId) {
  const g = getFCurveGroupById(action, groupId);
  if (!g) return null;
  const next = !isFCurveGroupExpanded(g);
  if (next) g.expanded = true;     // explicit expanded
  else delete g.expanded;          // default-false → drop the field
  return next;
}

// ── Auto-population from fcurve targets ────────────────────────────────

/**
 * Build the auto-grouping plan for an action: derive `action.groups[]`
 * entries from the existing fcurves' targets and assign each fcurve's
 * `groupId` accordingly.
 *
 * Auto-grouping rules:
 *   - Node-targeting fcurves (`decodeFCurveTarget` returns kind:'node')
 *     are grouped by `nodeId`. The group id is `g_node_${nodeId}` (stable
 *     across reload). The display name comes from `nameFromNodeId(nodeId)`
 *     — caller-supplied function so this module stays project-state-free.
 *   - Param-targeting fcurves stay ungrouped (no `groupId` write).
 *   - FCurves whose target cannot be decoded (null target) stay ungrouped.
 *
 * Preserves any EXISTING `action.groups[]` entries that aren't auto-
 * regenerated this pass — user-renamed groups, manual groups, and
 * groups whose source fcurves were deleted all survive (the latter
 * become empty groups, harmless until cleaned up by a future "compact
 * groups" op). This keeps the function safe to re-run after every
 * fcurve mutation without losing user edits.
 *
 * Mutates `action` in place. Returns the count of fcurves whose
 * `groupId` was assigned/changed this pass (useful for migration
 * reporting + test assertions).
 *
 * @param {ActionLike} action
 * @param {(nodeId: string) => string} nameFromNodeId
 * @returns {number}
 */
export function groupFCurvesByTarget(action, nameFromNodeId) {
  if (!action || !Array.isArray(action.fcurves)) return 0;
  if (!Array.isArray(action.groups)) action.groups = [];

  // Index existing groups by id for fast lookup + reuse
  /** @type {Map<string, FCurveGroup>} */
  const byId = new Map();
  for (const g of action.groups) {
    if (g && typeof g.id === 'string') byId.set(g.id, g);
  }

  let touched = 0;
  for (const fc of action.fcurves) {
    if (!fc) continue;
    // decodeFCurveTarget only reads `fcurve.rnaPath`; safe cast.
    const target = decodeFCurveTarget(/** @type {any} */ (fc));
    if (!target || target.kind !== 'node') {
      // Param targets + null targets: stay ungrouped.
      if (fc.groupId !== undefined) {
        delete fc.groupId;
        touched++;
      }
      continue;
    }
    const gid = `g_node_${target.nodeId}`;
    if (!byId.has(gid)) {
      const fresh = {
        id: gid,
        name: typeof nameFromNodeId === 'function' ? nameFromNodeId(target.nodeId) : target.nodeId,
        // Audit-fix Slice 5.V FAB-2: auto-created groups carry
        // expanded:true explicitly so the user's existing fcurves
        // stay visible after migration. The default-false semantic
        // matches Blender's `Channelbag::channel_group_create` (which
        // sets `flag = AGRP_SELECTED` only), so user-created groups
        // (when SS gains that UI) will open collapsed per Blender.
        expanded: true,
      };
      byId.set(gid, fresh);
      action.groups.push(fresh);
    }
    if (fc.groupId !== gid) {
      fc.groupId = gid;
      touched++;
    }
  }
  return touched;
}
