/**
 * Physics rules configuration — Stage 6 of the native rig refactor.
 *
 * `cmo3/physics.js` and `physics3json.js` previously each iterated the
 * hardcoded `PHYSICS_RULES` constant and applied identical gating logic
 * (requireTag / requireAnyTag / param-existence check). Both also
 * duplicated boneOutputs resolution against the project's groups.
 *
 * This module hosts:
 *   - `DEFAULT_PHYSICS_RULES` — the 7 baseline rules (re-export from cmo3/physics).
 *   - `buildPhysicsRulesFromProject(project)` — resolves boneOutputs against
 *     project groups, returning a flat list with concrete `outputs[]`. No tag
 *     or param gating here — that stays in the writers (depends on export-time
 *     state).
 *   - `resolvePhysicsRules(project)` — populated → use as-is, else build from
 *     defaults.
 *   - `seedPhysicsRules(project)` — destructive write to `project.physicsRules`.
 *
 * After seeding, project.physicsRules is the source of truth. Writers
 * iterate it instead of PHYSICS_RULES. Custom rules added by future UI
 * appear here too.
 *
 * See `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 6.
 */

import { PHYSICS_RULES } from '../cmo3/physics.js';
import { sanitisePartName } from '../../../lib/partId.js';
import { mergeAuthoredByStage } from './userAuthorMarkers.js';

/**
 * Re-export of the baseline rules. Stored as the seed source. New rules
 * can be added here (and they'll appear in fresh seeds), or appended to
 * project.physicsRules directly via UI.
 */
export const DEFAULT_PHYSICS_RULES = PHYSICS_RULES;

/**
 * Resolve `rule.boneOutputs` (lookups by `boneRole` against project groups)
 * into concrete output entries with `paramId = ParamRotation_<sanitizedGroupName>`.
 *
 * Mirrors the logic that lived in cmo3/physics.js:ruleOutputs and
 * physics3json.js:resolveRuleOutputs. Now centralised — once resolved at
 * seed time, neither writer needs to know about boneOutputs anymore.
 *
 * @param {object} rule
 * @param {Array<{id:string, name?:string, boneRole?:string}>} groups
 * @returns {Array<{paramId:string, vertexIndex:number, scale:number, isReverse:boolean}>}
 */
function resolveRuleOutputs(rule, groups) {
  const out = [];
  if (rule.outputs && rule.outputs.length > 0) {
    for (const o of rule.outputs) {
      out.push({
        paramId: o.paramId,
        vertexIndex: o.vertexIndex,
        scale: o.scale,
        isReverse: !!o.isReverse,
      });
    }
  } else if (rule.outputParamId) {
    out.push({
      paramId: rule.outputParamId,
      vertexIndex: rule.vertices.length - 1,
      scale: rule.outputScale,
      isReverse: false,
    });
  }
  if (rule.boneOutputs && rule.boneOutputs.length > 0 && Array.isArray(groups)) {
    const byRole = new Map();
    for (const g of groups) {
      if (g && g.boneRole) byRole.set(g.boneRole, g);
    }
    for (const b of rule.boneOutputs) {
      const g = byRole.get(b.boneRole);
      if (!g) continue;
      const sanitized = sanitisePartName(g.name || g.id);
      out.push({
        paramId: `ParamRotation_${sanitized}`,
        vertexIndex: b.vertexIndex,
        scale: b.scale,
        isReverse: !!b.isReverse,
      });
    }
  }
  return out;
}

/**
 * Build resolved physics rules from the project state. Each rule has its
 * `boneOutputs` flattened into `outputs[]`, so writers don't need access
 * to project groups.
 *
 * **Does not gate** rules by tag/param presence — that stays in the
 * writers because it depends on export-time tagsPresent / paramDefs which
 * the resolver doesn't see.
 *
 * @param {object} project
 * @returns {Array<object>} resolved rule list
 */
export function buildPhysicsRulesFromProject(project) {
  const groups = (project.nodes ?? []).filter((n) => n && n.type === 'group');
  return DEFAULT_PHYSICS_RULES.map((rule) => {
    const resolved = {
      id: rule.id,
      name: rule.name,
      category: rule.category,
      requireTag: rule.requireTag ?? null,
      requireAnyTag: rule.requireAnyTag ?? null,
      inputs: rule.inputs.map((i) => ({ ...i })),
      vertices: rule.vertices.map((v) => ({ ...v })),
      normalization: { ...rule.normalization },
      outputs: resolveRuleOutputs(rule, groups),
    };
    return resolved;
  });
}

/**
 * Resolve the physics rules the writers should use:
 *   - If `project.physicsRules` is populated (seeded), return it.
 *   - Otherwise, build from defaults via `buildPhysicsRulesFromProject`.
 *
 * @param {object} project
 * @returns {Array<object>}
 */
export function resolvePhysicsRules(project) {
  if (Array.isArray(project.physicsRules) && project.physicsRules.length > 0) {
    return project.physicsRules;
  }
  return buildPhysicsRulesFromProject(project);
}

/**
 * Seed `project.physicsRules` from the auto-rig defaults.
 *
 * **Mode semantics (V3 Re-Rig Phase 0):**
 *   - `'replace'` (default, back-compat): destructive — overwrites
 *     existing rules entirely. What PhysicsTab "Reset" + full Re-Init Rig
 *     still expect.
 *   - `'merge'`: preserves any existing rule with `_userAuthored: true`
 *     (e.g. imported via PhysicsTab → "Import .physics3.json"); reseeds
 *     the rest. Used by per-stage "Refit" UI in Phase 1.
 *
 * After this runs, the writers read from `project.physicsRules` directly
 * — no more boneOutputs resolution at export time, and the user can edit
 * the stored rules to tune per-character physics.
 *
 * @param {object} project - mutated
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {Array<object>} the seeded list
 */
export function seedPhysicsRules(project, mode = 'replace') {
  const autoSeeded = buildPhysicsRulesFromProject(project);
  // GAP-008 — drop rules belonging to opted-out subsystems (hairRig,
  // clothingRig, armPhysics, bodyWarps→breath). Subsystem ownership is
  // resolved by rule-name prefix in initRig.physicsRuleSubsystem; keep
  // this in sync if rule names change.
  const subs = project?.autoRigConfig?.subsystems ?? null;
  const filtered = subs ? autoSeeded.filter((rule) => !ruleIsDisabled(rule, subs)) : autoSeeded;
  const next = mode === 'merge'
    ? mergeAuthoredByStage('physicsRules', filtered, project.physicsRules)
    : filtered;
  project.physicsRules = next;
  return next;
}

/** GAP-008 helper — kept here (not imported from initRig) to avoid a
 * cycle: physicsConfig is imported by initRig, not the reverse. Same
 * logic as initRig.physicsRuleSubsystem. */
function ruleIsDisabled(rule, subs) {
  const name = rule?.name;
  if (typeof name !== 'string') return false;
  if (subs.hairRig === false && name.startsWith('hair-')) return true;
  if (subs.clothingRig === false && (
    name.startsWith('clothing-') || name.startsWith('skirt-') ||
    name.startsWith('shirt-') || name.startsWith('pants-')
  )) return true;
  if (subs.armPhysics === false && (name.startsWith('arm-') || name.includes('elbow'))) return true;
  if (subs.bodyWarps === false && name.startsWith('breath')) return true;
  return false;
}
