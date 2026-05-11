// @ts-check

/**
 * Scene-action selector — Animation Phase 1 Stage 1.D.
 *
 * # What this module is
 *
 * Pure-function selectors over the v37 `__scene__` pseudo-Object node.
 * The scene node carries the project-wide animation binding via
 * `node.animData.actionId`; consumers reach the active action through
 * `getActiveSceneAction(project, fallbackActionId)` which prefers the
 * scene's bound action and falls back to the UI store's pointer when
 * no scene binding exists.
 *
 * # Why a separate module
 *
 * `actionRegistry.js` covers the lifecycle ops (assign / unassign /
 * clone / delete / getActionUsers). The scene-action selector is a
 * READ-ONLY composition that touches both `project.actions[]` AND the
 * `__scene__` node's `animData` slot — separate concern from lifecycle.
 * Splitting also keeps actionRegistry's surface tight (5 helpers
 * mirroring Blender's API) without growing it for a SS-specific scene
 * abstraction.
 *
 * # Blender mirror
 *
 * In Blender, the Scene datablock owns AnimData via `Scene.adt`
 * (`reference/blender/source/blender/makesdna/DNA_scene_types.h:2813`).
 * The "what AnimData does this ID have?" lookup is
 * `BKE_animdata_from_id` (`anim_data.cc:91`); callers then read
 * `adt->action` directly. SS's `getSceneAction` does the equivalent in
 * one step: walk to the `__scene__` node, read `animData.actionId`,
 * resolve in `project.actions[]`. There is no `BKE_animdata_id_action`
 * function in Blender — only `BKE_animdata_from_id` plus the inline
 * `adt->action` follow-up at every call site.
 *
 * The UI-store fallback (`useAnimationStore.activeActionId`) is the SS
 * analog of Blender's "Action Editor active slot" UI state. Blender
 * keeps that UI state separate from the scene's data binding (the
 * Action Editor can show / let you scrub an action that is not bound to
 * any datablock); SS does the same — UI state vs project data are
 * deliberately separate slots, and this selector composes them.
 *
 * **SS-specific composition (Audit-fix D-10 deviation):** Blender does
 * NOT auto-resolve "scene's action OR editor's action." Each consumer
 * reads what it needs — exporter reads `adt->action`, Action Editor
 * reads its own pinned-slot pointer. The composition is a SS
 * convenience to bridge legacy UI behaviour (pre-Stage-1.E consumers
 * that read `useAnimationStore.activeActionId`); Stage 1.E callers
 * should consume `getSceneAction` directly (no fallback) once they
 * own the bound-action UX surface, and reserve `getActiveSceneAction`
 * for shared transport widgets that legitimately want either.
 *
 * # Cross-references
 *
 * - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1.D
 * - `src/store/migrations/v37_scene_anim_data.js` — the migration that
 *   introduces the `__scene__` node
 * - `src/anim/actionRegistry.js` — the lifecycle helpers; assigning
 *   the scene's action goes through `assignAction(project, '__scene__',
 *   actionId)`.
 *
 * @module anim/sceneAction
 */

import { isSceneNode } from '../store/migrations/v37_scene_anim_data.js';

/**
 * Look up the `__scene__` node, if present.
 *
 * Returns null when the project predates v37 OR has no scene node for
 * any reason (defensively defensive — v37 migration guarantees the
 * node exists on every loaded project, but in-memory mid-mutation
 * states might violate this transiently).
 *
 * @param {object|null|undefined} project
 * @returns {object|null}
 */
export function getSceneNode(project) {
  if (!project || typeof project !== 'object') return null;
  const nodes = Array.isArray(project.nodes) ? project.nodes : null;
  if (!nodes) return null;
  for (const node of nodes) {
    if (isSceneNode(node)) return node;
  }
  return null;
}

/**
 * Get the action object the scene is currently bound to, or null when
 * the scene has no binding (or no scene node exists).
 *
 * Reads `__scene__`'s `animData.actionId` and resolves it against
 * `project.actions[]`. Returns null when:
 *   - no `__scene__` node exists (pre-v37 project mid-load)
 *   - the scene's `animData.actionId` is null (no binding)
 *   - the bound id does not resolve in `project.actions[]` (orphan
 *     pointer — should never happen post-Stage-1.C cascade, but kept
 *     defensive)
 *
 * @param {object|null|undefined} project
 * @returns {object|null}
 */
export function getSceneAction(project) {
  const scene = getSceneNode(project);
  if (!scene) return null;
  const ad = scene.animData;
  if (!ad || typeof ad !== 'object') return null;
  if (typeof ad.actionId !== 'string' || ad.actionId.length === 0) return null;
  const actions = Array.isArray(project?.actions) ? project.actions : [];
  return actions.find((a) => a && a.id === ad.actionId) ?? null;
}

/**
 * Get the action a consumer should treat as "active right now," with
 * the scene's bound action winning over the UI store's last-selected
 * pointer.
 *
 * Resolution order:
 *   1. `__scene__`'s `animData.actionId` (the project-data binding —
 *      survives save/load, exporter reads this, motion3.json reflects
 *      this).
 *   2. `fallbackActionId` (typically `useAnimationStore.activeActionId`
 *      — the UI state for "what is the user editing right now",
 *      meaningful only at the editor level, NOT persisted).
 *   3. null (no action selected by either source).
 *
 * Stage 1.E will route Timeline / FCurve editor / Dopesheet through
 * this selector so the project's bound action takes priority. The
 * fallback exists for the (common) case where the user hasn't yet
 * bound an action to the scene but is editing one through the UI.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} fallbackActionId
 * @returns {object|null}
 */
export function getActiveSceneAction(project, fallbackActionId) {
  const bound = getSceneAction(project);
  if (bound) return bound;
  if (typeof fallbackActionId !== 'string' || fallbackActionId.length === 0) return null;
  const actions = Array.isArray(project?.actions) ? project.actions : [];
  return actions.find((a) => a && a.id === fallbackActionId) ?? null;
}
