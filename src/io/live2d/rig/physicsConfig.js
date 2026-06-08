// @ts-check

/**
 * Per-node physics modifier configuration.
 *
 * Pre-v50: `project.physicsRules[]` was a global flat list. The seed
 * wrote to that single field; runtime, depgraph, and export all read
 * from it. UI had no per-layer toggle/delete because the data wasn't
 * keyed by node.
 *
 * Post-v50 (2026-06-08, RULE №4 Blender parity directive): each rule
 * lives as a `physicsModifier` entry on its semantic owner node
 * (`node.modifiers[]`). One modifier per RESOLVED output. Multi-output
 * rules (Arm Sway → left + right elbow) SPLIT into per-bone modifiers.
 *
 * Two surfaces:
 *
 *   - `gatherPhysicsRules(project, opts?)` — read side. Walks
 *     `project.nodes[*].modifiers[]`, filters to enabled physicsModifier
 *     entries (per Blender `isModifierEnabled` semantic), groups by
 *     `ruleId`, and re-merges sibling modifiers (same ruleId + same
 *     inputs/vertices/normalization signature) back into the legacy
 *     resolved-rule shape with flat `outputs[]`. Runtime, depgraph,
 *     and exporter all consume this shape. The merge preserves the
 *     shared-pendulum semantic when an arm-sway-style rule was split
 *     across two bones.
 *
 *   - `seedPhysicsModifiers(project, mode)` — write side. Walks the
 *     7 default `PHYSICS_RULES`, resolves boneOutputs / tag owners
 *     against the project, and pushes a `physicsModifier` onto each
 *     owner node. Subsystem opt-outs (`autoRigConfig.subsystems`) skip
 *     seeding for matching categories. Merge mode preserves any prior
 *     user-authored modifier (the modifier itself carries `_userAuthored`).
 *
 * Crutches retired by this rewrite:
 *   - `resolvePhysicsRules` (read side) — replaced by `gatherPhysicsRules`
 *   - `seedPhysicsRules` (write side) — replaced by `seedPhysicsModifiers`
 *   - `ruleIsDisabled` duplicate of `physicsRuleSubsystem` — gone
 *   - Name-prefix mismatch (`startsWith('hair-')` vs baseline "Hair Front")
 *     that silently no-op'd the subsystem filter at seed time — gone;
 *     subsystem opt-out now matches by `rule.category`, not name.
 *
 * @module io/live2d/rig/physicsConfig
 */

import { PHYSICS_RULES } from '../cmo3/physics.js';
import { sanitisePartName } from '../../../lib/partId.js';
import { mergeAuthoredByStage } from './userAuthorMarkers.js';
import { getBoneRole } from '../../../store/objectDataAccess.js';
import { matchTag } from '../../armatureOrganizer.js';
import { isModifierEnabled, MODIFIER_MODE_REALTIME } from '../../../anim/modifierTypeInfo.js';

/**
 * Re-export of the baseline rules. Stored as the seed source. New rules
 * can be added here (and they'll appear in fresh seeds), or appended to
 * a node's modifier stack directly via UI.
 */
export const DEFAULT_PHYSICS_RULES = PHYSICS_RULES;

/**
 * Category → owning Init-Rig subsystem.
 *
 * Subsystem opt-out semantic post-v50: at SEED time, rules belonging to
 * an opted-out subsystem are skipped (not seeded as modifiers). User can
 * still manually re-Init with the subsystem on, or add a physicsModifier
 * by hand via UI. Pre-v50 the seeder gated by `name.startsWith('hair-')`
 * vs the baseline name "Hair Front" — silently no-op. v50 gates by the
 * structured `rule.category` field which IS set on every baseline rule.
 *
 * @type {Record<string, string>}
 */
const CATEGORY_TO_SUBSYSTEM = {
  hair: 'hairRig',
  clothing: 'clothingRig',
  bust: 'clothingRig',   // bust physics rides on the topwear/bust complex
  arms: 'armPhysics',
};

const DEFAULT_MIGRATED_MODE = 7;  // REALTIME | RENDER | EDITMODE — same as v21

/**
 * Resolve `rule.boneOutputs` (lookups by `boneRole` against project groups)
 * into concrete output entries with `paramId = ParamRotation_<sanitizedGroupName>`.
 *
 * Mirrors the logic that lived in cmo3/physics.js:ruleOutputs and
 * physics3json.js:resolveRuleOutputs. Centralised here.
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
      const role = getBoneRole(g);
      if (role) byRole.set(role, g);
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
 * Build resolved physics rules from the project's default seed list.
 * Used internally by `seedPhysicsModifiers` and exposed for tests.
 *
 * @param {object} project
 * @returns {Array<object>} resolved rule list (each with flat outputs[])
 */
export function buildPhysicsRulesFromProject(project) {
  const groups = (project.nodes ?? []).filter((n) => n && n.type === 'group');
  return DEFAULT_PHYSICS_RULES.map((rule) => ({
    id: rule.id,
    name: rule.name,
    category: rule.category,
    requireTag: rule.requireTag ?? null,
    requireAnyTag: rule.requireAnyTag ?? null,
    inputs: rule.inputs.map((i) => ({ ...i })),
    vertices: rule.vertices.map((v) => ({ ...v })),
    normalization: { ...rule.normalization },
    outputs: resolveRuleOutputs(rule, groups),
  }));
}

/**
 * Pick the owner node for a single resolved output.
 *
 *   1. `ParamRotation_<sanitized>` → bone group whose `sanitisePartName(name)`
 *      matches `<sanitized>`.
 *   2. Else use `rule.requireTag` / `requireAnyTag` to find a matching
 *      node via `matchTag(node.name)` (group preferred, then part).
 *   3. Else fall back to the first top-level group.
 *
 * @param {object} project
 * @param {object} rule
 * @param {{paramId:string}} output
 * @returns {object|null}
 */
function pickOwnerForOutput(project, rule, output) {
  const groups = project.nodes.filter((n) => n && n.type === 'group');
  const parts  = project.nodes.filter((n) => n && n.type === 'part');

  const rotMatch = typeof output.paramId === 'string'
    ? output.paramId.match(/^ParamRotation_(.+)$/)
    : null;
  if (rotMatch) {
    const sanitised = rotMatch[1];
    for (const g of groups) {
      if (!getBoneRole(g)) continue;
      if (sanitisePartName(g.name || g.id) === sanitised) return g;
    }
  }
  const tags = [];
  if (typeof rule.requireTag === 'string' && rule.requireTag.length > 0) {
    tags.push(rule.requireTag);
  } else if (Array.isArray(rule.requireAnyTag)) {
    tags.push(...rule.requireAnyTag);
  }
  if (tags.length > 0) {
    for (const tag of tags) {
      for (const g of groups) {
        if (matchTag(g.name ?? '') === tag) return g;
      }
      for (const p of parts) {
        if (matchTag(p.name ?? '') === tag) return p;
      }
    }
  }
  return groups.find((g) => !g.parent) ?? groups[0] ?? null;
}

/**
 * Read side: walk `project.nodes[*].modifiers[]`, collect enabled
 * physicsModifier entries, regroup by `ruleId`, and reconstruct the
 * legacy resolved-rule shape (flat `outputs[]`) for downstream
 * consumers (runtime, depgraph, exporter).
 *
 * Merging by ruleId preserves the shared-pendulum semantic when the
 * v50 migration / seeder split a multi-output rule into per-owner
 * modifiers. If two modifiers share a ruleId but diverge on inputs /
 * vertices / normalization (user manually edited one), we still merge
 * — the LAST modifier's pendulum spec wins; this is the trade for the
 * single-pendulum-per-ruleId invariant the runtime expects. UI surfacing
 * the ruleId conflict is a follow-up if a real workflow needs it.
 *
 * @param {object} project
 * @param {{ requiredMode?: number }} [opts]
 * @returns {Array<object>}
 */
export function gatherPhysicsRules(project, opts = {}) {
  if (!project || !Array.isArray(project.nodes)) return [];
  const requiredMode = opts.requiredMode ?? MODIFIER_MODE_REALTIME;

  /** @type {Map<string, {rule: object, outputs: Array<object>}>} */
  const byRuleId = new Map();
  for (const node of project.nodes) {
    if (!node || !Array.isArray(node.modifiers)) continue;
    for (const mod of node.modifiers) {
      if (!mod || mod.type !== 'physicsModifier') continue;
      if (!isModifierEnabled(mod, requiredMode)) continue;
      if (typeof mod.ruleId !== 'string') continue;
      const out = mod.output;
      if (!out || typeof out.paramId !== 'string') continue;

      let bucket = byRuleId.get(mod.ruleId);
      if (!bucket) {
        bucket = {
          rule: {
            id: mod.ruleId,
            name: mod.name,
            category: mod.category,
            inputs: (mod.inputs ?? []).map((i) => ({ ...i })),
            vertices: (mod.vertices ?? []).map((v) => ({ ...v })),
            normalization: { ...(mod.normalization ?? {}) },
          },
          outputs: [],
        };
        byRuleId.set(mod.ruleId, bucket);
      }
      bucket.outputs.push({
        paramId: out.paramId,
        vertexIndex: out.vertexIndex,
        scale: out.scale,
        isReverse: !!out.isReverse,
      });
    }
  }

  return [...byRuleId.values()].map((b) => ({
    ...b.rule,
    outputs: b.outputs,
  }));
}

/**
 * Write side: seed default physics modifiers onto owner nodes. Walks
 * the 7 baseline rules, splits each by resolved output, attaches one
 * physicsModifier per output to the owner node picked by
 * `pickOwnerForOutput`.
 *
 * **Subsystem opt-out (post-v50):** rules whose `category` maps via
 * `CATEGORY_TO_SUBSYSTEM` to an opted-out subsystem are skipped at
 * seed time. Pre-v50 the gate was a no-op due to a name-prefix
 * mismatch; v50 fixes it via structured `rule.category`.
 *
 * **Mode semantics:**
 *   - `'replace'` (default): destructive — wipes every existing
 *     physicsModifier (except `_userAuthored: true`) from every node,
 *     then seeds defaults.
 *   - `'merge'`: preserves any `_userAuthored: true` modifier (imports
 *     from `.physics3.json` via PhysicsTab) and reseeds the rest.
 *
 * @param {object} project - mutated
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {Array<object>} the gathered legacy-shape rule list after seed
 */
export function seedPhysicsModifiers(project, mode = 'replace') {
  if (!project || !Array.isArray(project.nodes)) return [];

  // Step 1: clear prior non-user-authored physics modifiers across all nodes.
  for (const node of project.nodes) {
    if (!node || !Array.isArray(node.modifiers)) continue;
    const kept = [];
    for (const mod of node.modifiers) {
      if (mod && mod.type === 'physicsModifier') {
        if (mode === 'merge' && mod._userAuthored === true) {
          kept.push(mod);
        }
        continue;
      }
      kept.push(mod);
    }
    if (kept.length !== node.modifiers.length) {
      if (kept.length === 0) delete node.modifiers;
      else node.modifiers = kept;
    }
  }

  // Step 2: build the resolved defaults + subsystem filter.
  const defaults = buildPhysicsRulesFromProject(project);
  const subs = project?.autoRigConfig?.subsystems ?? null;
  const filtered = subs
    ? defaults.filter((rule) => {
        const owning = CATEGORY_TO_SUBSYSTEM[rule.category] ?? null;
        return owning ? subs[owning] !== false : true;
      })
    : defaults;

  // Step 3: pre-v50 mergeAuthoredByStage operated on the legacy-rule
  // shape (flat `outputs[]`). The author-marker pipeline still groups
  // by rule id, so let it merge here BEFORE we split into per-owner
  // modifiers. Prior-state input: the legacy shape we GATHER from the
  // existing user-authored modifiers.
  const priorAuthored = mode === 'merge'
    ? gatherUserAuthoredRules(project)
    : null;
  const merged = mode === 'merge'
    ? mergeAuthoredByStage('physicsRules', filtered, priorAuthored ?? [])
    : filtered;

  // Step 4: split each resolved rule into per-output modifiers, attach
  // each to its owner.
  for (const rule of merged) {
    const outputs = Array.isArray(rule.outputs) ? rule.outputs : [];
    if (outputs.length === 0) continue;
    for (const output of outputs) {
      const owner = pickOwnerForOutput(project, rule, output);
      if (!owner) continue;
      if (!Array.isArray(owner.modifiers)) owner.modifiers = [];
      // Idempotence guard — in merge mode the prior_userAuthored modifier
      // is already on the owner; skip duplicate. Same ruleId AND output
      // paramId match → skip.
      const already = owner.modifiers.some((m) => (
        m && m.type === 'physicsModifier'
          && m.ruleId === rule.id
          && m.output?.paramId === output.paramId
      ));
      if (already) continue;
      owner.modifiers.push({
        type: 'physicsModifier',
        ruleId: rule.id,
        name: rule.name,
        category: rule.category,
        inputs: (rule.inputs ?? []).map((i) => ({ ...i })),
        vertices: (rule.vertices ?? []).map((v) => ({ ...v })),
        normalization: { ...(rule.normalization ?? {}) },
        output: {
          paramId: output.paramId,
          vertexIndex: output.vertexIndex,
          scale: output.scale,
          isReverse: !!output.isReverse,
        },
        enabled: true,
        mode: DEFAULT_MIGRATED_MODE,
        showInEditor: true,
        _userAuthored: rule._userAuthored === true,
      });
    }
  }

  return gatherPhysicsRules(project, { requiredMode: MODIFIER_MODE_REALTIME });
}

/**
 * PhysicsTab "Import .physics3.json" path. Wipes every existing
 * physicsModifier from every node and re-attaches one modifier per
 * imported rule output, marked `_userAuthored: true` so subsequent
 * Refit (`mode: 'merge'`) preserves them.
 *
 * Imported rules carry no `requireTag` (the gating field doesn't
 * survive physics3.json round-trip — it's an authoring concept). The
 * owner picker therefore falls through to the rotation-paramId match
 * or the root-group fallback.
 *
 * @param {object} project - mutated
 * @param {Array<object>} rules - legacy resolved-rule shape (from parsePhysics3Json)
 * @returns {number} count of modifiers installed
 */
export function installImportedPhysicsRules(project, rules) {
  if (!project || !Array.isArray(project.nodes)) return 0;
  if (!Array.isArray(rules)) return 0;

  for (const node of project.nodes) {
    if (!node || !Array.isArray(node.modifiers)) continue;
    const kept = node.modifiers.filter((m) => !(m && m.type === 'physicsModifier'));
    if (kept.length !== node.modifiers.length) {
      if (kept.length === 0) delete node.modifiers;
      else node.modifiers = kept;
    }
  }

  let installed = 0;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const outputs = Array.isArray(rule.outputs) ? rule.outputs : [];
    if (outputs.length === 0) continue;
    for (const output of outputs) {
      const owner = pickOwnerForOutput(project, rule, output);
      if (!owner) continue;
      if (!Array.isArray(owner.modifiers)) owner.modifiers = [];
      owner.modifiers.push({
        type: 'physicsModifier',
        ruleId: rule.id,
        name: rule.name,
        category: rule.category ?? 'imported',
        inputs: (rule.inputs ?? []).map((i) => ({ ...i })),
        vertices: (rule.vertices ?? []).map((v) => ({ ...v })),
        normalization: { ...(rule.normalization ?? {}) },
        output: {
          paramId: output.paramId,
          vertexIndex: output.vertexIndex,
          scale: output.scale,
          isReverse: !!output.isReverse,
        },
        enabled: true,
        mode: DEFAULT_MIGRATED_MODE,
        showInEditor: true,
        _userAuthored: true,
      });
      installed += 1;
    }
  }
  return installed;
}

/**
 * Helper for `seedPhysicsModifiers` merge mode: collect the existing
 * user-authored modifiers and reconstruct the legacy rule shape so
 * `mergeAuthoredByStage` can do its per-ruleId preservation.
 *
 * @param {object} project
 * @returns {Array<object>}
 */
function gatherUserAuthoredRules(project) {
  /** @type {Map<string, {rule: object, outputs: Array<object>}>} */
  const byRuleId = new Map();
  for (const node of project.nodes) {
    if (!node || !Array.isArray(node.modifiers)) continue;
    for (const mod of node.modifiers) {
      if (!mod || mod.type !== 'physicsModifier') continue;
      if (mod._userAuthored !== true) continue;
      let bucket = byRuleId.get(mod.ruleId);
      if (!bucket) {
        bucket = {
          rule: {
            id: mod.ruleId,
            name: mod.name,
            category: mod.category,
            inputs: (mod.inputs ?? []).map((i) => ({ ...i })),
            vertices: (mod.vertices ?? []).map((v) => ({ ...v })),
            normalization: { ...(mod.normalization ?? {}) },
            _userAuthored: true,
          },
          outputs: [],
        };
        byRuleId.set(mod.ruleId, bucket);
      }
      if (mod.output) {
        bucket.outputs.push({
          paramId: mod.output.paramId,
          vertexIndex: mod.output.vertexIndex,
          scale: mod.output.scale,
          isReverse: !!mod.output.isReverse,
        });
      }
    }
  }
  return [...byRuleId.values()].map((b) => ({ ...b.rule, outputs: b.outputs }));
}
