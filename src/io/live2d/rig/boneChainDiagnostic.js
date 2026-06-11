// @ts-check

/**
 * Bone-to-mesh chain end-to-end diagnostic.
 *
 * # Why this exists
 *
 * 2026-06-11, fourth report of "bones don't move the mesh after Init Rig."
 * Three fix-attempts (15a49c4 force-LBS, cbce63f param/mirror, 0313ae1
 * revert) failed to close the bug because none of them surfaced the
 * ACTUAL failure layer on the user's project. Per [[invariant-checks-
 * over-user-repro]] and user directive 2026-06-11 ("stop guessing"),
 * the next round is instrumentation, not another speculative fix.
 *
 * # What it dumps
 *
 * One log line per bone with the COMPLETE chain state needed to
 * pinpoint the failure layer:
 *
 *   bone="rightArm" id="g_a1b2…" | LBS=3 overlay=5 | ParamRotation_rightArm:PRESENT | mirror:PRESENT | armatureMods=3/3
 *
 * Decoded:
 *   - `bone` / `id` — the bone-group node.
 *   - `LBS=N overlay=M` — how many parts FOLLOW this bone via each path.
 *     LBS = parts with `mesh.jointBoneId === bone.id` + armature modifier
 *     in stack + boneWeights non-empty. Overlay = parts with no LBS path
 *     and this bone in their `node.parent` chain (`findNearestBoneAncestorId`).
 *   - `ParamRotation_<name>` — does the param exist in `project.parameters`?
 *     (If MISSING: paramSpec second pass dropped this bone — registry
 *     can't wire up, slider can't drive, gesture can't mirror visually.)
 *   - `mirror` — does the bone-mirror registry have an entry for this
 *     bone? (If MISSING: `_buildBoneMirrorEntries` couldn't match the
 *     bone name to a param. Naming mismatch — `sanitisePartName` problem.)
 *   - `armatureMods=K/N` — for the N LBS parts, how many actually have
 *     an Armature modifier in their `modifiers[]`. (If K < N:
 *     `synthesizeModifierStacks` failed for some parts — `pickBonePostChainComposition`
 *     returns `'overlay'` instead of `'lbs'`, the overlay path applies
 *     uniformly which is WRONG for per-vertex-weighted limb parts.)
 *
 * # Anomaly flags
 *
 * Every anomaly is logged as `logger.warn` with the bone id inlined in
 * the message string (per [[inline-diagnostic-fields]] — user console
 * paste collapses Object payload to `[object Object]`).
 *
 *   - STRANDED  — bone has 0 LBS + 0 overlay parts. Rotating it can't
 *     deform anything. Either the wizard didn't parent any part to it,
 *     or all child parts opted out via subsystem filter.
 *   - MISSING_PARAM — `ParamRotation_<sanitisedName>` not in
 *     `project.parameters`. Bone-mirror registry empty for this bone.
 *     paramSpec didn't emit. SKIP_ROTATION_ROLES list or subsystem
 *     opt-out swallowed it.
 *   - MISSING_MIRROR — param exists but `boneMirror.byBone` has no
 *     entry. Name-match mismatch between `sanitisePartName(bone.name)`
 *     and the param id suffix.
 *   - INCOMPLETE_ARM_MODS — some LBS parts lack Armature modifier.
 *     `synthesizeModifierStacks` didn't fire for them OR ran before
 *     `assignRigidSkinningToPart` wrote the weights.
 *   - ALL_NONE  — every part following this bone has composition
 *     `'none'` (post-Apply state, all weights stripped). Bone rotates
 *     a bunch of inert weighted geometry.
 *
 * # When to run
 *
 * Once per Init Rig, AFTER `runRigInvariantChecks`. Single-shot — re-Init-Rig
 * to re-fire. Surfaces from the Logs panel without requiring the user to
 * click parts or read pivot values.
 *
 * @module io/live2d/rig/boneChainDiagnostic
 */

import { logger } from '../../../lib/logger.js';
import { isBoneGroup, getMesh } from '../../../store/objectDataAccess.js';
import { sanitisePartName } from '../../../lib/partId.js';

/**
 * Modifier mode bitmask — REALTIME bit (per `DNA_modifier_types.h:131-144`).
 */
const MODE_REALTIME_BIT = 1;

/**
 * Mirror of `pickBonePostChainComposition`'s armature-modifier predicate
 * without importing the renderer module (keep this file boot-light).
 *
 * @param {object|null|undefined} node
 * @returns {{ id: string, jointBoneId: string|null } | null}
 */
function findArmatureModifier(node) {
  if (!node || !Array.isArray(node.modifiers)) return null;
  for (const m of node.modifiers) {
    if (!m || m.type !== 'armature') continue;
    if (m.enabled === false) continue;
    const mode = typeof m.mode === 'number' ? m.mode : (MODE_REALTIME_BIT | 2);
    if ((mode & MODE_REALTIME_BIT) === 0) continue;
    return {
      id: typeof m.deformerId === 'string' ? m.deformerId : '',
      jointBoneId: m.data?.jointBoneId ?? null,
    };
  }
  return null;
}

/**
 * Walk `node.parent` until the first `isBoneGroup`. Returns the bone
 * group's id or null.
 *
 * @param {object|null|undefined} part
 * @param {Map<string, any>} byId
 * @returns {string|null}
 */
function nearestBoneAncestor(part, byId) {
  let cur = part?.parent ? byId.get(part.parent) : null;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (isBoneGroup(cur)) return cur.id ?? null;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return null;
}

/**
 * Run the bone-to-mesh chain diagnostic. Logs once per bone + a
 * summary. Safe to call with malformed inputs.
 *
 * @param {object|null|undefined} project
 * @param {object|null|undefined} boneMirror  Output from
 *   `_buildBoneMirrorEntries` (or `paramValuesStore.boneMirror`).
 *   When null, the mirror column reports "UNCHECKED".
 * @returns {{
 *   boneCount: number,
 *   anomalyCount: number,
 *   strandedBones: string[],
 *   missingParam: string[],
 *   missingMirror: string[],
 *   incompleteArmMods: string[],
 *   allNone: string[],
 * }}
 */
export function runBoneChainDiagnostic(project, boneMirror) {
  const out = {
    boneCount: 0,
    anomalyCount: 0,
    /** @type {string[]} */ strandedBones: [],
    /** @type {string[]} */ missingParam: [],
    /** @type {string[]} */ missingMirror: [],
    /** @type {string[]} */ incompleteArmMods: [],
    /** @type {string[]} */ allNone: [],
  };
  if (!project || !Array.isArray(project.nodes)) return out;
  const nodes = project.nodes;

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const n of nodes) if (n?.id) byId.set(n.id, n);

  /** @type {Set<string>} */
  const paramIds = new Set();
  for (const p of project.parameters ?? []) {
    if (typeof p?.id === 'string') paramIds.add(p.id);
  }

  /** @type {Set<string>} bones with a registry entry */
  const mirrorByBone = new Set();
  // Accept several shapes — paramValuesStore.boneMirror has byBone,
  // _buildBoneMirrorEntries returns Array<{paramId, boneId}>.
  if (boneMirror) {
    if (boneMirror instanceof Map) {
      for (const k of boneMirror.keys()) mirrorByBone.add(k);
    } else if (Array.isArray(boneMirror)) {
      for (const e of boneMirror) if (e?.boneId) mirrorByBone.add(e.boneId);
    } else if (boneMirror.byBone instanceof Map) {
      for (const k of boneMirror.byBone.keys()) mirrorByBone.add(k);
    }
  }

  // Pre-index parts by their LBS target and by their nearest bone ancestor.
  /** @type {Map<string, string[]>} boneId → partIds following via LBS */
  const lbsByBone = new Map();
  /** @type {Map<string, string[]>} boneId → partIds following via overlay */
  const overlayByBone = new Map();
  /** @type {Map<string, string[]>} boneId → partIds with composition='none' */
  const noneByBone = new Map();
  /** @type {Map<string, number>} partId → did it find an armature modifier? */
  const armatureModByPart = new Map();

  for (const part of nodes) {
    if (!part || part.type !== 'part') continue;
    const mesh = getMesh(part, project);
    const jointBoneId = typeof mesh?.jointBoneId === 'string' && mesh.jointBoneId.length > 0
      ? mesh.jointBoneId : null;
    const hasWeights = Array.isArray(mesh?.boneWeights) && mesh.boneWeights.length > 0;
    const armMod = findArmatureModifier(part);
    if (armMod) armatureModByPart.set(part.id, 1);

    if (jointBoneId && hasWeights && armMod) {
      // LBS — mirror of pickBonePostChainComposition's 'lbs' branch.
      const arr = lbsByBone.get(jointBoneId) ?? [];
      arr.push(part.id);
      lbsByBone.set(jointBoneId, arr);
      continue;
    }
    if (jointBoneId && hasWeights && !armMod) {
      // 'applied' state — weights present, modifier removed. Logged.
      const arr = noneByBone.get(jointBoneId) ?? [];
      arr.push(part.id);
      noneByBone.set(jointBoneId, arr);
      continue;
    }
    // No LBS path → overlay candidacy. Walk parent chain.
    const ancestorId = nearestBoneAncestor(part, byId);
    if (ancestorId) {
      const arr = overlayByBone.get(ancestorId) ?? [];
      arr.push(part.id);
      overlayByBone.set(ancestorId, arr);
    }
  }

  // Per-bone log line.
  for (const bone of nodes) {
    if (!isBoneGroup(bone)) continue;
    out.boneCount++;

    const lbsParts = lbsByBone.get(bone.id) ?? [];
    const overlayParts = overlayByBone.get(bone.id) ?? [];
    const noneParts = noneByBone.get(bone.id) ?? [];

    const sanitised = sanitisePartName(bone.name || bone.id);
    const expectedParamId = `ParamRotation_${sanitised}`;
    const paramPresent = paramIds.has(expectedParamId);
    const mirrorPresent = mirrorByBone.has(bone.id);

    // Anomaly checks
    /** @type {string[]} */
    const flags = [];
    if (lbsParts.length === 0 && overlayParts.length === 0 && noneParts.length === 0) {
      flags.push('STRANDED');
      out.strandedBones.push(`${bone.name || bone.id}`);
      out.anomalyCount++;
    }
    if (!paramPresent) {
      flags.push('MISSING_PARAM');
      out.missingParam.push(`${bone.name || bone.id}`);
      out.anomalyCount++;
    }
    if (paramPresent && !mirrorPresent && boneMirror) {
      flags.push('MISSING_MIRROR');
      out.missingMirror.push(`${bone.name || bone.id}`);
      out.anomalyCount++;
    }
    // LBS parts should ALL have armature modifier. If lbsParts.length > 0
    // but we found some that DON'T have one in `armatureModByPart`, that's
    // INCOMPLETE_ARM_MODS. (lbsByBone above ONLY counts parts WITH armMod,
    // so this checks parts intended to be LBS but stuck in the noneByBone
    // bucket.)
    if (noneParts.length > 0 && lbsParts.length > 0) {
      flags.push('INCOMPLETE_ARM_MODS');
      out.incompleteArmMods.push(`${bone.name || bone.id}`);
      out.anomalyCount++;
    }
    if (noneParts.length > 0 && lbsParts.length === 0 && overlayParts.length === 0) {
      flags.push('ALL_NONE');
      out.allNone.push(`${bone.name || bone.id}`);
      out.anomalyCount++;
    }

    const flagsStr = flags.length > 0 ? ` ⚠ ${flags.join(' ')}` : '';
    const mirrorStr = !boneMirror
      ? 'UNCHECKED'
      : mirrorPresent ? 'PRESENT' : 'MISSING';
    const paramStr = paramPresent ? 'PRESENT' : 'MISSING';
    const armModStr = lbsParts.length > 0
      ? `${lbsParts.length}/${lbsParts.length + noneParts.length}`
      : '0/0';

    logger.info('boneChainDiag',
      `bone="${bone.name ?? bone.id}" id="${bone.id}" | LBS=${lbsParts.length} overlay=${overlayParts.length} none=${noneParts.length} | ${expectedParamId}:${paramStr} | mirror:${mirrorStr} | armatureMods=${armModStr}${flagsStr}`,
      {
        boneId: bone.id,
        boneName: bone.name,
        lbsPartIds: lbsParts.slice(0, 8),
        overlayPartIds: overlayParts.slice(0, 8),
        nonePartIds: noneParts.slice(0, 8),
        expectedParamId,
        paramPresent,
        mirrorPresent,
        flags,
      });
  }

  // Summary
  if (out.anomalyCount === 0) {
    logger.info('boneChainDiag',
      `bone-chain OK — ${out.boneCount} bones, all wired (LBS/overlay paths present, params + mirror entries present).`,
      { boneCount: out.boneCount });
  } else {
    logger.warn('boneChainDiag',
      `bone-chain ANOMALIES: ${out.anomalyCount} flag(s) across ${out.boneCount} bone(s). stranded=${out.strandedBones.length}, missing-param=${out.missingParam.length}, missing-mirror=${out.missingMirror.length}, incomplete-arm-mods=${out.incompleteArmMods.length}, all-none=${out.allNone.length}.`,
      out);
  }

  return out;
}
