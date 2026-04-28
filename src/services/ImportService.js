/**
 * v3 Phase 0B — ImportService (Pillar F).
 *
 * Façade for ingesting external file formats into a project. Phase 0
 * ships only the .stretch project loader (delegated to
 * PersistenceService); Phase 1 adds:
 *
 *   - PSD ingestion (currently coupled to CanvasViewport)
 *   - .cmo3 import (round-tripping our own export)
 *   - .exp3.json expression import
 *
 * The service is the single entrypoint editors use; format detection
 * happens here so callers don't sniff MIME / extensions themselves.
 *
 * @module services/ImportService
 */

import { deserializeProject } from './PersistenceService.js';

/**
 * @typedef {('stretch'|'psd'|'cmo3'|'unknown')} ImportFormat
 *
 * @typedef {Object} ImportResult
 * @property {boolean} ok
 * @property {ImportFormat} format
 * @property {object} [project]            — when format='stretch'
 * @property {object} [psdPayload]         — when format='psd' (Phase 1)
 * @property {string} [error]
 */

/**
 * Cheap format detection by file extension. Future versions sniff
 * the bytes when the extension lies (e.g. PSDs renamed to .png).
 * @param {File|Blob} file
 * @returns {ImportFormat}
 */
export function detectImportFormat(file) {
  // Blobs without a name (synthesised in tests) are unknown.
  const name = (file && 'name' in file && typeof file.name === 'string')
    ? file.name.toLowerCase()
    : '';
  if (name.endsWith('.stretch')) return 'stretch';
  if (name.endsWith('.psd')) return 'psd';
  if (name.endsWith('.cmo3')) return 'cmo3';
  return 'unknown';
}

/**
 * Import a file. Resolves with a discriminated union — caller switches
 * on `result.format` to find which payload field was filled.
 *
 * Phase 0 supports only `.stretch`; the others return `ok:false` with
 * a helpful message until Phase 1 wires them in.
 *
 * @param {File|Blob} file
 * @returns {Promise<ImportResult>}
 */
export async function importFile(file) {
  const format = detectImportFormat(file);
  if (format === 'stretch') {
    try {
      const project = await deserializeProject(file);
      return { ok: true, format, project };
    } catch (err) {
      return { ok: false, format, error: err?.message ?? String(err) };
    }
  }
  if (format === 'psd' || format === 'cmo3') {
    return {
      ok: false,
      format,
      error: `${format} import is wired up in Phase 1 of the V3 refactor`,
    };
  }
  return { ok: false, format: 'unknown', error: 'unrecognised file type' };
}
