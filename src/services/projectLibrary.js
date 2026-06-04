// @ts-check

/**
 * Project library load helpers — small adapter sitting between
 * `PersistenceService` (IndexedDB CRUD on `.stretch` records) and the
 * `projectStore` (in-memory document). Lifted out of LoadModal +
 * FileMenu's inline duplication 2026-05-16 (UI sweep ROUND 3 audit-fix
 * sweep, ARCH-3).
 *
 * Two flows:
 *   - `loadFromLibrary(id)` — gallery cards + Open Recent submenu.
 *     Re-anchors `currentLibraryId` so a subsequent Ctrl+S overwrites
 *     the same record.
 *   - `loadFromBlob(blob)`  — disk-imported `.stretch` files. Leaves
 *     `currentLibraryId` cleared (which `loadProject` already does)
 *     so the project starts unlinked until the user explicitly Saves
 *     to Library.
 *
 * Both surfaces' inline implementations carried a "must stay in sync"
 * comment — the canonical Rule №1 cue to extract.
 *
 * @module services/projectLibrary
 */

import { useProjectStore } from '../store/projectStore.js';
import { useCaptureStore } from '../store/captureStore.js';
import {
  deserializeProject,
  loadProjectRecord,
  saveProjectRecord,
  serializeProject,
} from './PersistenceService.js';
import { logger } from '../lib/logger.js';
import { getMesh } from '../store/objectDataAccess.js';

/**
 * Load a library record into the project store and re-anchor the
 * current-library link so subsequent saves overwrite it.
 *
 * @param {string} id  Library record id (from `listSavedProjects()`).
 * @returns {Promise<void>}
 * @throws if the record is missing, its blob is empty, or deserialization fails.
 */
export async function loadFromLibrary(id) {
  const full = await loadProjectRecord(id);
  if (!full?.blob) throw new Error(`Library record ${id} has no blob`);
  const { project } = await deserializeProject(full.blob);
  await useProjectStore.getState().loadProject(project);
  useProjectStore.setState({ currentLibraryId: id });
}

/**
 * Load a `.stretch` file from disk. `loadProject` clears
 * `currentLibraryId` itself; we intentionally don't re-anchor —
 * disk-loaded projects start unlinked until an explicit Save.
 *
 * @param {Blob|File} blob
 * @returns {Promise<void>}
 */
export async function loadFromBlob(blob) {
  const { project } = await deserializeProject(blob);
  await useProjectStore.getState().loadProject(project);
}

/**
 * Capture the current viewport thumbnail (data URL). Used by both the
 * SaveModal's library-save branch and `quickSaveLinked()`. The capture
 * comes from `captureStore`, which the active CanvasArea publishes on
 * mount — if no canvas is mounted (fresh session), returns ''.
 *
 * Defensive try/catch — captureThumbnail's WebGL readback can throw
 * (e.g. canvas context lost) and a save must not fail because the
 * thumbnail can't be grabbed.
 */
function captureThumbnail() {
  try {
    return useCaptureStore.getState().captureThumbnail?.() ?? '';
  } catch (err) {
    if (typeof console !== 'undefined') console.error('[projectLibrary] thumbnail capture failed:', err);
    return '';
  }
}

/**
 * Serialize + save the current project to a library record. Mirrors
 * the per-mode logging shape SaveModal emits — every save path goes
 * through the same `projectSave` timer so the Logs panel can
 * correlate cross-session save patterns.
 *
 * @param {string|null} idToUse  Existing record id (overwrite) or null (create).
 * @param {string} nameToUse     Display name for the record.
 * @returns {Promise<string>}    The saved record id (passed back for currentLibraryId anchor).
 */
export async function saveLibraryRecord(idToUse, nameToUse) {
  const project = useProjectStore.getState().project;
  const mode = 'library';
  logger.time('projectSave', mode);
  // Structural shape mirrors `loadProject`'s log so any post-load
  // issue can be cross-referenced against the saved state
  // (BUG-NECK_NULL_BBOX, BUG-ARMS-PHYS, etc.).
  const _nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const partsArr = _nodes.filter((n) => n?.type === 'part');
  const deformersArr = _nodes.filter((n) => n?.type === 'deformer');
  // v18: route through getMesh so post-split parts (geometry on the
  // sibling meshData node) are counted. Pre-fix this telemetry showed
  // 0 / 0 for every loaded project past schemaVersion 18 even when the
  // rig was healthy — the post-save sanity check was a silent lie.
  const partsWithRuntime = partsArr.filter((p) => {
    const m = getMesh(p, project);
    return m?.runtime && Array.isArray(m.runtime.keyforms);
  });
  const partsWithBakedKeyforms = partsArr.filter((p) => {
    const kfs = getMesh(p, project)?.runtime?.keyforms;
    return Array.isArray(kfs) && kfs.length > 1;
  });
  try {
    const blob = await serializeProject(project);
    const thumbnail = captureThumbnail();
    const savedId = await saveProjectRecord(idToUse, nameToUse.trim(), blob, thumbnail);
    useProjectStore.setState({ hasUnsavedChanges: false, currentLibraryId: savedId });
    logger.timeEnd(
      'projectSave', mode,
      {
        mode,
        name: nameToUse?.trim?.() ?? nameToUse,
        schemaVersion: project?.schemaVersion ?? null,
        parts: partsArr.length,
        deformers: deformersArr.length,
        params: project?.parameters?.length ?? 0,
        lastInitRigCompletedAt: project?.lastInitRigCompletedAt ?? null,
        partsWithRuntimeData: partsWithRuntime.length,
        partsWithBakedKeyforms: partsWithBakedKeyforms.length,
        blobSizeBytes: blob.size,
      },
      `${mode} OK: ${partsArr.length}p / ${deformersArr.length}d / ${project?.parameters?.length ?? 0}params, ${partsWithRuntime.length}/${partsArr.length} runtime-rig'd`,
    );
    return savedId;
  } catch (err) {
    const ms = logger.timeEnd('projectSave', mode, {
      mode,
      name: nameToUse?.trim?.() ?? nameToUse,
      schemaVersion: project?.schemaVersion ?? null,
      parts: partsArr.length,
      deformers: deformersArr.length,
    });
    logger.warn(
      'projectSave',
      `${mode} FAILED after ${ms ?? '?'}ms: ${err instanceof Error ? err.message : String(err)}`,
      {
        mode,
        name: nameToUse?.trim?.() ?? nameToUse,
        schemaVersion: project?.schemaVersion ?? null,
        parts: partsArr.length,
        deformers: deformersArr.length,
      },
    );
    throw err;
  }
}

/**
 * Audit-fix sweep (FID-A.6) — silent Ctrl+S overwrite when the
 * project is anchored to an existing library record. Mirrors Blender's
 * `wm.save_mainfile` "EXEC_AREA when file is saved" branch
 * (`wm_files.cc:5007-5066`); the modal only pops for a never-saved
 * project. Returns false when there's no linked record (caller should
 * open the modal instead); true on success; throws on failure.
 *
 * @returns {Promise<boolean>} true if a silent save ran, false if no link.
 */
export async function quickSaveLinked() {
  const linkedId = useProjectStore.getState().currentLibraryId;
  if (!linkedId) return false;
  const rec = await loadProjectRecord(linkedId);
  // Record may have been deleted out-from-under us by another tab; the
  // caller falls back to the modal in that case so the user can
  // re-save under a new name.
  if (!rec) return false;
  await saveLibraryRecord(linkedId, rec.name ?? 'Untitled');
  return true;
}
