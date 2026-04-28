/**
 * v3 Phase 0B — PersistenceService (Pillar F + Pillar Q).
 *
 * Thin façade over `projectFile.js` (.stretch ZIP I/O) +
 * `projectDb.js` (IndexedDB record store).
 *
 * Pillar Q ("pure serializer"): the underlying writers must not
 * mutate the project they're handed.  The service treats the input
 * as immutable and returns a `Blob` / `string` / `record` instead.
 * Tests for that contract land alongside the service.
 *
 * @module services/PersistenceService
 */

import {
  saveProject as saveProjectToZip,
  loadProject as loadProjectFromFile,
} from '../io/projectFile.js';
import {
  saveToDb,
  loadFromDb,
  listProjects,
  deleteProject as deleteFromDb,
  duplicateProject as duplicateInDb,
  updateProjectName as renameInDb,
} from '../io/projectDb.js';

/**
 * @typedef {Object} ProjectRecord
 * @property {string} id
 * @property {string} name
 * @property {Blob} blob
 * @property {string} thumbnail
 * @property {number} updatedAt
 */

/**
 * Serialize a project to a `.stretch` ZIP blob. Does NOT mutate the
 * input project. (The underlying writer's "no mutation" guarantee is
 * verified by the test fixture.)
 *
 * @param {object} project
 * @returns {Promise<Blob>}
 */
export function serializeProject(project) {
  return saveProjectToZip(project);
}

/**
 * Parse a `.stretch` ZIP back into a project object. Runs schema
 * migrations to bring older saves up to current schema version.
 *
 * @param {Blob|File} fileOrBlob
 * @returns {Promise<object>}
 */
export function deserializeProject(fileOrBlob) {
  return loadProjectFromFile(fileOrBlob);
}

// ── IndexedDB-backed project library ─────────────────────────────────

/**
 * @returns {Promise<ProjectRecord[]>}  most-recent first
 */
export function listSavedProjects() {
  return listProjects();
}

/**
 * @param {string|null} id        — null/undefined → create new
 * @param {string} name
 * @param {Blob} blob             — typically from `serializeProject`
 * @param {string} thumbnail      — data URL preview
 * @returns {Promise<string>}     — the saved record id
 */
export function saveProjectRecord(id, name, blob, thumbnail) {
  return saveToDb(id, name, blob, thumbnail);
}

/**
 * @param {string} id
 * @returns {Promise<ProjectRecord|undefined>}
 */
export function loadProjectRecord(id) {
  return loadFromDb(id);
}

/** @param {string} id */
export function deleteProjectRecord(id) {
  return deleteFromDb(id);
}

/** @param {string} id */
export function duplicateProjectRecord(id) {
  return duplicateInDb(id);
}

/** @param {string} id @param {string} newName */
export function renameProjectRecord(id, newName) {
  return renameInDb(id, newName);
}
