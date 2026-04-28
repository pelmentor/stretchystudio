// @ts-check

/**
 * v3 Phase 0B - ExportService (Pillar F).
 *
 * Façade for shipping the project to external formats. Wraps the
 * existing exporters (cmo3 / moc3 / cdi3 / motion3 / physics3 / Spine)
 * behind one entrypoint that:
 *
 *   - validates pre-flight conditions (project loaded, format
 *     supported, required deps present);
 *   - emits progress events that Phase 1 UI can subscribe to (toast
 *     + progress bar) without poking inside the writer;
 *   - normalises errors (every export reports `{ok, blob, error?}`).
 *
 * The progress-event mechanism is a minimal pub/sub scoped to one
 * export call - no global event bus.
 *
 * @module services/ExportService
 */

import { useProjectStore } from '../store/projectStore.js';
import {
  exportLive2D,
  exportLive2DProject,
} from '../io/live2d/exporter.js';

/**
 * @typedef {('cmo3'|'live2d-runtime'|'live2d-full')} ExportFormat
 *
 * @typedef {Object} ExportProgress
 * @property {number} pct           - 0..1
 * @property {string} message       - human-readable stage label
 *
 * @typedef {Object} ExportResult
 * @property {boolean} ok
 * @property {Blob} [blob]
 * @property {string} [filename]
 * @property {string} [error]
 *
 * @typedef {Object} ExportOptions
 * @property {ExportFormat} format
 * @property {Map<string, HTMLImageElement>} [images]
 * @property {(ev: ExportProgress) => void} [onProgress]
 * @property {Object} [extra]                    - passed through to the writer
 */

/**
 * Pure pre-flight: can this project export to this format? Pulled
 * out so unit tests can call it without spinning up the project
 * store import graph.
 *
 * @param {object|null|undefined} project
 * @param {ExportFormat} format
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function preflightExportFor(project, format) {
  const reasons = [];
  if (!project) reasons.push('no project loaded');
  else {
    const partCount = (project.nodes ?? []).filter((n) => n?.type === 'part').length;
    if (partCount === 0) reasons.push('project has no part nodes');
  }
  if (!isSupportedFormat(format)) {
    reasons.push(`unsupported format: ${format}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Cheap pre-flight before kicking off an export. Same shape as
 * RigService.preflightBuildRig - returns reasons rather than
 * throwing so the UI can list them.
 *
 * @param {ExportFormat} format
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function preflightExport(format) {
  return preflightExportFor(useProjectStore.getState().project, format);
}

/** @param {string} f */
function isSupportedFormat(f) {
  return f === 'cmo3' || f === 'live2d-runtime' || f === 'live2d-full';
}

/**
 * Run the export. Resolves with `{ok, blob?, error?}` - does not throw.
 *
 * @param {ExportOptions} opts
 * @returns {Promise<ExportResult>}
 */
export async function runExport(opts) {
  const { format, images = new Map(), onProgress, extra = {} } = opts ?? {};
  const pre = preflightExport(format);
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; ') };
  }

  const project = useProjectStore.getState().project;
  const emit = (pct, message) => {
    if (typeof onProgress === 'function') onProgress({ pct, message });
  };

  emit(0, `starting ${format} export`);
  // Existing exporters call onProgress(message) with a string only;
  // we wrap to translate that into our `{pct, message}` shape with
  // pct=undefined (meaning indeterminate). When the exporters are
  // upgraded to emit pct (a Phase 1 todo), they'll pass through.
  const wrapProgress = (msg) => emit(undefined, typeof msg === 'string' ? msg : 'progress');
  try {
    /** @type {Blob|undefined} */
    let blob;
    if (format === 'cmo3') {
      blob = await exportLive2D(project, images, { ...extra, onProgress: wrapProgress });
    } else if (format === 'live2d-runtime' || format === 'live2d-full') {
      blob = await exportLive2DProject(project, images, {
        ...extra,
        generateRig: format === 'live2d-full',
        onProgress: wrapProgress,
      });
    }
    emit(1, 'export complete');
    if (!blob) {
      return { ok: false, error: 'export returned no blob' };
    }
    return { ok: true, blob };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
