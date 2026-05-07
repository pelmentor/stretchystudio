// @ts-check

/**
 * v25 — Blender Armature Alignment Phase 2 migration.
 *
 * Renames the editMode slot value `'mesh'` to `'edit'` to match
 * Blender's universal `OB_MODE_EDIT` taxonomy. Pre-v25, SS used
 * `'mesh'` as the slot value because meshes were the only data kind
 * supporting Edit Mode; post-v25, both meshes and armatures (and
 * future curves / etc) share the single `'edit'` value with editor
 * behaviour dispatched by the active object's dataKind.
 *
 * Persistence sites that may carry the legacy value:
 *   - `node.mode` (Phase 2b per-object mode storage on every Object).
 *
 * `editorStore.editMode` itself is in-memory only; its persistence
 * lives in localStorage via `usePreferencesStore.lastToolByMode`,
 * which uses the mode value as a key. The keys there are migrated
 * by code in `preferencesStore.js` (the loadJson reader normalises
 * any legacy `'mesh'` key into `'edit'` on read).
 *
 * Idempotent: re-running the migration on already-migrated data is a
 * no-op (no `'mesh'` mode values left to rewrite).
 *
 * @module store/migrations/v25_editmode_slot_rename
 */

/**
 * @param {object} project
 */
export function migrateEditModeSlotRename(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  for (const node of project.nodes) {
    if (!node) continue;
    if (node.mode === 'mesh') {
      node.mode = 'edit';
    }
  }
}
