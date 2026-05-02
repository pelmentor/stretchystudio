// @ts-check

/**
 * v3 GAP-001 — DWPose ONNX session singleton.
 *
 * The PSD wizard's "AI auto-rig" path runs DWPose pose estimation
 * (~50 MB ONNX model). Loading the model is expensive (download +
 * compile) so it's cached across imports. Previously the cache lived
 * as a useRef in CanvasViewport (`onnxSessionRef`); lifting that into
 * a module-level singleton lets the wizard run independently of any
 * particular React tree.
 *
 * The actual `loadDWPoseSession` and `runDWPose` implementations stay
 * in `armatureOrganizer.js` — this service just owns the cache. This
 * lets the existing call sites continue to work as the GAP-001
 * refactor moves the wizard mount up to AppShell level.
 *
 * @module services/dwposeService
 */

import {
  loadDWPoseSession as _loadDWPoseSession,
  clearDWPoseSession as _clearDWPoseSession,
} from '../io/armatureOrganizer.js';

/** @type {any|null} */
let _session = null;

/**
 * Get the currently cached DWPose session, or null if it hasn't been
 * loaded yet. Synchronous read; pair with `loadSession(payload)` when
 * you need a guaranteed-loaded session.
 */
export function getSession() {
  return _session;
}

/**
 * Lazily load (or return cached) DWPose ONNX session.
 *
 * @param {ArrayBuffer|Uint8Array|null|undefined} payload - optional
 *   model bytes (when the user uploads a local file); falls through
 *   to remote download via `loadDWPoseSession` when absent.
 * @returns {Promise<any>}
 */
export async function loadSession(payload) {
  if (_session) return _session;
  _session = await _loadDWPoseSession(payload);
  return _session;
}

/**
 * Drop the cached session. Called when load fails so a retry triggers
 * a fresh download instead of returning a broken session, and on
 * out-of-memory disposal in the future.
 */
export function clearSession() {
  _session = null;
  _clearDWPoseSession();
}

/** True if a session is currently loaded. Used by the wizard to label
 *  the "Load DWPose model" button as already-loaded. */
export function isSessionLoaded() {
  return _session != null;
}
