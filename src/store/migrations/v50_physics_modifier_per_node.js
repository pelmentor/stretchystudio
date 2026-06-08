// @ts-check

/**
 * v50 — per-node physicsModifier port (Blender per-object physics parity).
 *
 * # Why this exists
 *
 * Pre-v50 physics rules lived in a global flat list
 * `project.physicsRules[]` and the UI had no per-layer toggle/delete.
 * The user (2026-06-08, RULE №4 directive): "it's like in Blender —
 * there's a separate Physics tab AND a physics modifier on the layer
 * itself in the stack, that you can click or delete and then all
 * physics goes away."
 *
 * Per-node physicsModifier is the Blender model: each modifier lives on
 * the OBJECT it pertains to, and the user manages it via that object's
 * modifier stack. Delete the modifier → physics gone for that node.
 * Toggle the eye icon → physics paused without losing the spec.
 *
 * # Owner resolution (one modifier per RESOLVED output)
 *
 * The pre-v50 rule shape is the resolved form (`outputs[]` already
 * flattened by `physicsConfig.buildPhysicsRulesFromProject`). For each
 * output we attach a fresh modifier to its semantic owner:
 *
 *   1. `paramId` matches `ParamRotation_<sanitized>` → owner = the bone
 *      group whose `sanitisePartName(name)` matches `<sanitized>`. The
 *      pendulum runs on the bone it drives. Multi-bone rules (Arm Sway
 *      → left + right elbow) SPLIT into per-bone modifiers — each bone
 *      owns its own pendulum, mirroring Blender's "physics per object"
 *      model. Slight runtime delta vs. shared-pendulum (one sim runs
 *      per bone instead of one shared) but the inputs are identical so
 *      behaviour matches in steady state.
 *
 *   2. Else use `rule.requireTag` / `requireAnyTag` to find a matching
 *      part via `matchTag(node.name)`. Owner = the first matched part.
 *      Sway-warp rules (Hair Front, Skirt, Shirt, Pants, Bust) take
 *      this path — the output ParamHairFront/etc. drives a warp binding
 *      shared across all parts with that tag, so a single owner suffices.
 *
 *   3. Fallback owner = the first top-level group (rig root).
 *
 * # Field shape (the modifier itself)
 *
 *     {
 *       type: 'physicsModifier',
 *       ruleId: 'PhysicsSetting1',
 *       name: 'Hair Front',
 *       category: 'hair',
 *       inputs: [...],
 *       vertices: [...],
 *       normalization: {...},
 *       output: {paramId, vertexIndex, scale, isReverse},  // SINGLE output
 *       enabled: true,
 *       mode: 7,
 *       showInEditor: true,
 *       _userAuthored: true|false,   // preserved from rule._userAuthored
 *     }
 *
 * Note `output` (singular) rather than `outputs[]` — Blender per-object
 * physics has one channel per modifier. The export gather step re-merges
 * sibling modifiers sharing the same `ruleId` back into a single
 * physics setting with a flat `outputs[]` for cmo3/physics3.json fidelity.
 *
 * # Crutches removed by this migration
 *
 *   - `project.physicsRules[]` field — retired (global list dead).
 *   - `project.physics_groups[]` field — dead since BFA-006; RULE №2.
 *
 * # Idempotence
 *
 * Re-running is safe: the migration checks for any existing
 * `physicsModifier` on each node by `ruleId` and skips duplicates.
 * `project.physicsRules` is deleted unconditionally if present (handles
 * a partial prior run that wrote modifiers but didn't clean the field).
 *
 * @module store/migrations/v50_physics_modifier_per_node
 */

import { sanitisePartName } from '../../lib/partId.js';
import { matchTag } from '../../io/armatureOrganizer.js';
import { getBoneRole } from '../objectDataAccess.js';

const MODE_REALTIME_RENDER_EDITMODE = 7; // matches DEFAULT_MIGRATED_MODE pattern

/**
 * @param {object} project
 * @returns {object}
 */
export function migratePhysicsModifierPerNode(project) {
  if (!project || !Array.isArray(project.nodes)) {
    return project;
  }

  // Always sweep the dead physics_groups field — pre-BFA-006 holdover
  // initialised to [] everywhere but never read (RULE №2 baggage).
  if (Object.prototype.hasOwnProperty.call(project, 'physics_groups')) {
    delete project.physics_groups;
  }

  const rules = Array.isArray(project.physicsRules) ? project.physicsRules : [];
  if (rules.length === 0) {
    // Strip the field even when empty so post-v50 saves don't carry it.
    if (Object.prototype.hasOwnProperty.call(project, 'physicsRules')) {
      delete project.physicsRules;
    }
    return project;
  }

  // Index nodes for owner lookup.
  const groups = project.nodes.filter((n) => n && n.type === 'group');
  const parts  = project.nodes.filter((n) => n && n.type === 'part');

  // sanitisedBoneName → group node
  const bonesBySanitisedName = new Map();
  for (const g of groups) {
    if (!getBoneRole(g)) continue;
    const key = sanitisePartName(g.name || g.id);
    if (!bonesBySanitisedName.has(key)) bonesBySanitisedName.set(key, g);
  }

  // tag → first matching node (group preferred, then part)
  const nodeByTag = new Map();
  for (const g of groups) {
    const tag = matchTag(g.name ?? '');
    if (tag && !nodeByTag.has(tag)) nodeByTag.set(tag, g);
  }
  for (const p of parts) {
    const tag = matchTag(p.name ?? '');
    if (tag && !nodeByTag.has(tag)) nodeByTag.set(tag, p);
  }

  // Fallback owner = first top-level group (the rig root).
  const rootGroup = groups.find((g) => !g.parent || g.parent === null) ?? groups[0] ?? null;

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const outputs = Array.isArray(rule.outputs) ? rule.outputs : [];
    if (outputs.length === 0) {
      // No outputs — rule is non-functional. Drop silently; the seed
      // produced an empty rule. Pre-v50 these would have been a no-op
      // at runtime too.
      continue;
    }
    for (const output of outputs) {
      if (!output || typeof output.paramId !== 'string') continue;

      // Owner pick: ParamRotation_<bone> → bone owner. Else tag-based.
      let owner = null;
      const rotMatch = output.paramId.match(/^ParamRotation_(.+)$/);
      if (rotMatch) {
        owner = bonesBySanitisedName.get(rotMatch[1]) ?? null;
      }
      if (!owner) {
        if (typeof rule.requireTag === 'string' && rule.requireTag.length > 0) {
          owner = nodeByTag.get(rule.requireTag) ?? null;
        } else if (Array.isArray(rule.requireAnyTag)) {
          for (const tag of rule.requireAnyTag) {
            const node = nodeByTag.get(tag);
            if (node) { owner = node; break; }
          }
        }
      }
      if (!owner) owner = rootGroup;
      if (!owner) continue;   // no nodes at all — pathological save

      if (!Array.isArray(owner.modifiers)) owner.modifiers = [];

      // Idempotence: skip if a physicsModifier with the same ruleId AND
      // same output paramId is already attached.
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
        mode: MODE_REALTIME_RENDER_EDITMODE,
        showInEditor: true,
        _userAuthored: rule._userAuthored === true,
      });
    }
  }

  // Retire the global field — per-node modifiers are the sole source
  // of truth post-v50. Any consumer still reading `project.physicsRules`
  // will see undefined and surface its bug fast.
  delete project.physicsRules;
  return project;
}
