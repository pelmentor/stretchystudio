// @ts-check

/**
 * Schema v33 — `project.cursor: {x:number, y:number}` (canvas-space
 * 3D-cursor analog).
 *
 * # Why this migration exists
 *
 * Toolset Plan Phase 7.A.1 — `Shift+S` Snap menu (Blender's
 * `VIEW3D_MT_snap_pie`). Half its operators ("Selection to Cursor",
 * "Cursor to Selected", "Cursor to World Origin", "Cursor to Active",
 * "Cursor to Grid") read or write a project-persistent cursor position.
 * Blender stores it on `Scene.cursor.location` (`DNA_scene_types.h:2300`).
 * SS persists it on `project.cursor` so it survives save+load — same as
 * Blender's per-scene persistence.
 *
 * Default position: canvas centre. Pre-v33 projects open with a cursor
 * at `(canvas.width/2, canvas.height/2)`; the user can move it via the
 * Snap menu thereafter.
 *
 * # Why not editorStore
 *
 * The cursor is per-document, not per-session — Blender persists it in
 * the .blend file. Editor-state slots (selection, view zoom) are
 * per-session and rebuild on load. The Snap menu would be much less
 * useful if pressing `Shift+S → "Cursor to Selected"`, then save+load,
 * dropped the cursor back to centre.
 *
 * # Field shape
 *
 * `{x:number, y:number}` in canvas-space pixels (same coordinate space
 * as `node.transform.x/y` for a top-level Object). Top-left origin
 * matches the rest of the project's coord conventions.
 *
 * # Cross-references
 *
 * - `docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md` §7.A.1 — Snap menu spec
 * - `reference/blender/source/blender/makesdna/DNA_scene_types.h:2300` —
 *   Blender's `Scene.cursor.location`
 * - `src/v3/operators/object/snap.js` — operators that read/write it
 *
 * @module store/migrations/v33_project_cursor
 */

/**
 * Add `project.cursor` if missing. Defaults to canvas centre.
 *
 * @param {object} project — mutated in place
 * @returns {{ added: boolean }}
 */
export function migrateProjectCursor(project) {
  if (!project || typeof project !== 'object') return { added: false };
  if (project.cursor && typeof project.cursor === 'object'
      && typeof project.cursor.x === 'number'
      && typeof project.cursor.y === 'number') {
    return { added: false };
  }
  const cw = (project.canvas && typeof project.canvas.width === 'number')
    ? project.canvas.width : 800;
  const ch = (project.canvas && typeof project.canvas.height === 'number')
    ? project.canvas.height : 600;
  project.cursor = { x: cw / 2, y: ch / 2 };
  return { added: true };
}
