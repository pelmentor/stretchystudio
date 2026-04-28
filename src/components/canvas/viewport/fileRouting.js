// @ts-check

/**
 * v3 Phase 0F.5 - Single-place file → importer dispatch.
 *
 * Both the drag-drop handler and the file-input handler in
 * CanvasViewport routed files by extension via the same five lines
 * of nested `if/else`. Now there's one place: the routing logic
 * lives here, the React handlers just call it.
 *
 * Mirrors `ImportService.detectImportFormat` in spirit but returns
 * imperative callbacks rather than a discriminated union, because
 * the existing v2 import callbacks come from useCallback closures
 * that the caller already owns. The v3 ImportService will be the
 * single entrypoint once Phase 1 wires editors to it.
 *
 * @module components/canvas/viewport/fileRouting
 */

/**
 * @typedef {Object} ImportHandlers
 * @property {(file: File) => void} importStretch
 * @property {(file: File) => void} importPsd
 * @property {(file: File) => void} importPng
 */

/**
 * Route a file to the right importer by extension / mime.
 * Unknown formats are silently dropped (caller's responsibility to
 * surface a user-visible error if that matters).
 *
 * @param {File|null|undefined} file
 * @param {ImportHandlers} handlers
 * @returns {boolean} true when a handler was invoked
 */
export function routeImport(file, handlers) {
  if (!file) return false;
  const name = file.name?.toLowerCase() ?? '';
  if (name.endsWith('.stretch')) {
    handlers.importStretch(file);
    return true;
  }
  if (name.endsWith('.psd')) {
    handlers.importPsd(file);
    return true;
  }
  if (file.type?.startsWith?.('image/')) {
    handlers.importPng(file);
    return true;
  }
  return false;
}
