// @ts-check

/**
 * Toolset Plan Phase 7.C.5 — Select Mirror + Mirror Pose operators.
 *
 * Two operators share this module:
 *
 *   1. `pose.selectMirror` (`Ctrl+Shift+M`) — extends the current bone
 *      selection to include the mirror partner of each selected bone.
 *      Mirror of `POSE_OT_select_mirror` (`reference/blender/source/
 *      blender/editors/armature/pose_select.cc:1080-1132`, exec at
 *      `:1011-1078`). Per Blender's keymap (`blender_default.py`
 *      reserved range; the pose-select mirror chord is `Ctrl+Shift+M`
 *      in the default keyconfig — bound at the canonical pose-mode
 *      block alongside `Shift+L` select-linked-bones).
 *
 *   2. `pose.mirrorPose` (`Ctrl+Shift+V`) — pastes a previously-copied
 *      pose with X-axis flip. Mirror of `POSE_OT_paste(flipped=True)`
 *      (`pose_transform.cc:805-859` exec body, RNA flag at `:899`).
 *      The Blender single-step `pose.copy()` + `pose.paste(flipped=True)`
 *      composition is what the user gets via Ctrl+C → Ctrl+Shift+V.
 *
 * # Mirror semantics (X axis only — 2D rig, no Y/Z)
 *
 * Per plan §7.C.5:
 *   - `pose.x` → `-pose.x`
 *   - `pose.rotation` → `-pose.rotation`
 *   - `pose.scaleX` / `pose.scaleY` unchanged
 *
 * Blender's `flip_pose_data` (`pose_transform.cc:660-803`) does the
 * same X-flip for translation + rotation; SS skips Blender's quaternion
 * Y/Z flips because the 2D rig has no Y/Z axes. Scale stays untouched
 * because mirroring across X doesn't reflect the magnitude — only the
 * sign of position + rotation.
 *
 * # Role-based partner detection (audit-narrowed)
 *
 * Per plan §7.C.5 (audit-narrowed): `left*` / `right*` camelCase prefix
 * ONLY. Matches 100% of current SS auto-rig roles per
 * `src/io/armatureOrganizer.js:494-545` (`leftElbow ↔ rightElbow`,
 * `leftArm ↔ rightArm`, `leftLeg ↔ rightLeg`, `leftKnee ↔ rightKnee`).
 *
 * Suffix-based `*.L` / `*.R` is deliberately deferred to a follow-up
 * plan with a real spec — see audit fix in plan §7.C.5 close note.
 *
 * If a bone has no mirror partner, it's silently skipped from the
 * batch; the operator surfaces a toast naming the affected role.
 *
 * @module v3/operators/pose/mirror
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { usePoseClipboardStore } from '../../../store/poseClipboardStore.js';
import {
  isBoneGroup,
  getBonePose,
  getBoneRole,
  getBoneByRole,
  getBonesIn,
} from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import { eligibleBones, IDENTITY_POSE } from './clearTransform.js';

/**
 * Compute the mirror role for a given role string. Returns null when no
 * mirror exists.
 *
 * Audit-narrowed to camelCase `left*` / `right*` prefix only — this is
 * the exact pattern produced by `armatureOrganizer.js`. A role of
 * `'leftElbow'` mirrors to `'rightElbow'`, `'rightLeg'` to `'leftLeg'`,
 * etc. Roles not starting with `left`/`right` (e.g. `'torso'`, `'head'`,
 * `'root'`) have no mirror and return null.
 *
 * Why prefix-only: Blender's `BLI_string_flip_side_name` ports a 3-pass
 * detector (suffix single-char, prefix single-char, word-at-start-or-end)
 * for general bone names. SS auto-rig produces a closed set of role
 * strings that all use the camelCase-prefix pattern — porting the full
 * 3-pass detector would handle no SS-existing bone names. When manual
 * bone-naming UX lands and users author bones with `arm.L`-style names,
 * a follow-up plan can swap this for the `flipSideName` helper that
 * already exists in `src/v3/operators/weightPaint/mirror.js`.
 *
 * @param {string|null|undefined} role
 * @returns {string|null}
 */
export function mirrorRole(role) {
  if (typeof role !== 'string' || role.length < 5) return null;
  if (role.startsWith('left')) {
    const rest = role.slice(4);
    // Guard: next char (if any) must be uppercase to keep the camelCase
    // contract. `'leftElbow'` → `'rightElbow'` good; `'leftover'` (8
    // chars, lowercase 'o') wouldn't match SS roles but we still gate
    // it out so we don't accidentally create `'rightover'` for some
    // future user-named bone.
    if (rest.length === 0) return null;
    if (rest[0] !== rest[0].toUpperCase()) return null;
    return 'right' + rest;
  }
  if (role.startsWith('right')) {
    const rest = role.slice(5);
    if (rest.length === 0) return null;
    if (rest[0] !== rest[0].toUpperCase()) return null;
    return 'left' + rest;
  }
  return null;
}

/**
 * Apply the X-axis pose mirror to a pose-delta record. Returns a fresh
 * object — does NOT mutate the input.
 *
 * @param {{rotation:number, x:number, y:number, scaleX:number, scaleY:number}} pose
 * @returns {{rotation:number, x:number, y:number, scaleX:number, scaleY:number}}
 */
export function flipPoseX(pose) {
  return {
    rotation: -pose.rotation,
    x:        -pose.x,
    y:         pose.y,
    scaleX:    pose.scaleX,
    scaleY:    pose.scaleY,
  };
}

/**
 * Phase 7.C.5 (Select Mirror) — extends bone selection to include each
 * selected bone's mirror partner.
 *
 * Returns the count of newly-added bones. Bones whose mirror is already
 * selected (or has no mirror) are skipped.
 *
 * @returns {{added: number, missing: string[], skipped: boolean}}
 */
export function poseSelectMirror() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return { added: 0, missing: [], skipped: true };
  const project = useProjectStore.getState().project;
  if (!project) return { added: 0, missing: [], skipped: true };
  const selStore = useSelectionStore.getState();
  const currentIds = new Set(boneIds);
  /** @type {Array<{type:'group', id:string}>} */
  const toAdd = [];
  /** @type {string[]} */
  const missing = [];
  for (const id of boneIds) {
    const node = project.nodes.find((n) => n?.id === id);
    if (!node) continue;
    const role = getBoneRole(node);
    if (!role) continue;
    const partnerRole = mirrorRole(role);
    if (!partnerRole) {
      missing.push(role);
      continue;
    }
    const partner = getBoneByRole(project, partnerRole);
    if (!partner) {
      missing.push(partnerRole);
      continue;
    }
    if (currentIds.has(partner.id)) continue;
    currentIds.add(partner.id);
    toAdd.push({ type: 'group', id: partner.id });
  }
  if (toAdd.length === 0) {
    return { added: 0, missing, skipped: false };
  }
  selStore.select(toAdd, 'add');
  return { added: toAdd.length, missing, skipped: false };
}

/**
 * Phase 7.C.6 helpers — Copy: snapshot every selected bone's pose into
 * the in-memory clipboard, keyed by role.
 *
 * Selected bones are guaranteed to carry a `boneRole` because
 * `eligibleBones` runs them through `isBoneGroup` (which requires the
 * role). A bone without a role isn't a bone in SS today — it's a plain
 * organisational group, filtered out before we get here.
 *
 * @returns {{copied: number}}
 */
export function poseCopy() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) {
    usePoseClipboardStore.getState().clear();
    return { copied: 0 };
  }
  const project = useProjectStore.getState().project;
  /** @type {Array<{role: string, pose: {rotation:number,x:number,y:number,scaleX:number,scaleY:number}}>} */
  const entries = [];
  for (const id of boneIds) {
    const node = project?.nodes?.find((n) => n?.id === id);
    if (!node) continue;
    const role = getBoneRole(node);
    if (!role) continue;
    const pose = getBonePose(node) ?? { ...IDENTITY_POSE };
    entries.push({ role, pose });
  }
  usePoseClipboardStore.getState().setEntries(entries);
  return { copied: entries.length };
}

/**
 * Phase 7.C.6 — Paste: for every selected bone with a role, look up the
 * matching clipboard entry by role and apply. If `flipped` is true, the
 * X-axis mirror semantic is applied AND the role lookup is mirrored
 * (selected `leftElbow` reads `rightElbow` from the clipboard, then
 * X-flips). Matches Blender's `pose.paste(flipped=True)` macro.
 *
 * Bones with no clipboard match are skipped silently and listed in the
 * returned `unmatchedRoles` array; the registry caller surfaces a toast
 * if the count is non-zero.
 *
 * Single undo entry per call.
 *
 * @param {{flipped: boolean}} [opts]
 * @returns {{pasted: number, unmatchedRoles: string[], skipped: boolean}}
 */
export function posePaste(opts = { flipped: false }) {
  const flipped = !!opts?.flipped;
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return { pasted: 0, unmatchedRoles: [], skipped: true };
  const clipboard = usePoseClipboardStore.getState().entries;
  if (!Array.isArray(clipboard) || clipboard.length === 0) {
    return { pasted: 0, unmatchedRoles: [], skipped: true };
  }
  const project = useProjectStore.getState().project;
  if (!project) return { pasted: 0, unmatchedRoles: [], skipped: true };

  // Build the role → pose lookup once. Last-wins for duplicate roles
  // (matches Blender's behaviour where the clipboard is overwritten on
  // each copy — duplicate-role inserts shouldn't normally happen but
  // we don't crash if they do).
  /** @type {Map<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>} */
  const byRole = new Map();
  for (const e of clipboard) {
    if (e?.role && e.pose) byRole.set(e.role, e.pose);
  }

  /** @type {Array<{id: string, pose: {rotation:number,x:number,y:number,scaleX:number,scaleY:number}}>} */
  const writes = [];
  /** @type {string[]} */
  const unmatchedRoles = [];

  for (const id of boneIds) {
    const node = project.nodes.find((n) => n?.id === id);
    if (!node) continue;
    const role = getBoneRole(node);
    if (!role) continue;
    // For flipped paste, the SOURCE role is the mirror of the destination.
    // E.g. selecting `leftElbow` and pasting flipped reads `rightElbow`
    // from the clipboard, then X-flips. This matches Blender's
    // `pose.paste(flipped=True)` semantics where the user's intent is
    // "paste the mirror image of what I copied onto these bones".
    const sourceRole = flipped ? (mirrorRole(role) ?? role) : role;
    const sourcePose = byRole.get(sourceRole);
    if (!sourcePose) {
      unmatchedRoles.push(sourceRole);
      continue;
    }
    const targetPose = flipped ? flipPoseX(sourcePose) : sourcePose;
    writes.push({ id, pose: targetPose });
  }

  if (writes.length === 0) {
    return { pasted: 0, unmatchedRoles, skipped: false };
  }

  beginBatch(project);
  try {
    useProjectStore.getState().updateProject((proj) => {
      for (const w of writes) {
        const node = proj.nodes.find((n) => n?.id === w.id);
        if (!node || !isBoneGroup(node)) continue;
        if (!node.pose) node.pose = { ...IDENTITY_POSE };
        node.pose.rotation = w.pose.rotation;
        node.pose.x        = w.pose.x;
        node.pose.y        = w.pose.y;
        node.pose.scaleX   = w.pose.scaleX;
        node.pose.scaleY   = w.pose.scaleY;
      }
    });
  } finally {
    endBatch();
  }

  return { pasted: writes.length, unmatchedRoles, skipped: false };
}

/**
 * Convenience for `pose.mirrorPose` (`Ctrl+Shift+V`) — paste flipped.
 *
 * @returns {{pasted: number, unmatchedRoles: string[], skipped: boolean}}
 */
export function poseMirrorPaste() {
  return posePaste({ flipped: true });
}

// ── Eligibility gates ────────────────────────────────────────────────

/**
 * Eligibility for `pose.selectMirror`: at least one selected bone-group
 * with a role string (so a mirror partner CAN be looked up).
 *
 * @returns {boolean}
 */
export function eligibleForSelectMirror() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return false;
  const project = useProjectStore.getState().project;
  if (!project?.nodes) return false;
  for (const id of boneIds) {
    const node = project.nodes.find((n) => n?.id === id);
    if (!node) continue;
    const role = getBoneRole(node);
    if (mirrorRole(role)) return true;
  }
  return false;
}

/**
 * Eligibility for `pose.copy`: at least one selected bone-group.
 * Roles can be missing (we just copy fewer entries) — the affordance is
 * still legal as long as something is selected.
 *
 * @returns {boolean}
 */
export function eligibleForCopy() {
  return eligibleBones().boneIds.length > 0;
}

/**
 * Eligibility for `pose.paste` / `pose.mirrorPose`: at least one
 * selected bone AND a non-empty clipboard. Mirror-paste additionally
 * requires that at least one selected bone has a mirrorable role.
 *
 * @param {{flipped: boolean}} [opts]
 * @returns {boolean}
 */
export function eligibleForPaste(opts = { flipped: false }) {
  const flipped = !!opts?.flipped;
  const clipboard = usePoseClipboardStore.getState().entries;
  if (!Array.isArray(clipboard) || clipboard.length === 0) return false;
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return false;
  if (!flipped) return true;
  // For flipped paste, demand at least one selected bone whose role has
  // a mirror — otherwise the operator would no-op on every entry.
  const project = useProjectStore.getState().project;
  if (!project?.nodes) return false;
  for (const id of boneIds) {
    const node = project.nodes.find((n) => n?.id === id);
    if (!node) continue;
    if (mirrorRole(getBoneRole(node))) return true;
  }
  return false;
}

/**
 * Diagnostic — list every bone with a mirror partner. Used by tests +
 * potential N-panel "Select Mirrorable" affordance.
 *
 * @returns {Array<{id: string, role: string, mirrorRole: string}>}
 */
export function listMirrorablePairs() {
  const project = useProjectStore.getState().project;
  /** @type {Array<{id:string, role:string, mirrorRole:string}>} */
  const out = [];
  for (const n of getBonesIn(project)) {
    const role = getBoneRole(n);
    const mr = mirrorRole(role);
    if (!mr) continue;
    out.push({ id: n.id, role: role ?? '', mirrorRole: mr });
  }
  return out;
}
