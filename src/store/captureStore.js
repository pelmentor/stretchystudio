// @ts-check

/**
 * v3 Phase 5 — Shared canvas capture store.
 *
 * The `CanvasViewport` instance lives inside `<CanvasArea>` (deep in
 * the area tree). The Save modal lives at the AppShell level. They
 * share zero render context, so a ref-based handoff would mean
 * threading props through five components.
 *
 * Instead CanvasArea publishes its capture function here on mount
 * and the SaveModal pulls it via `useCaptureStore.getState()` when the
 * user hits Save. CanvasArea clears it on unmount so a stale closure
 * over a destroyed canvas never gets called.
 *
 * @module store/captureStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} CaptureStore
 * @property {(() => string|null)|null} captureThumbnail
 *   Returns a data URL (typically image/webp) sized for the gallery
 *   card. Null when no viewport is mounted yet.
 * @property {(fn: (() => string|null)|null) => void} setCaptureThumbnail
 *
 * @property {((partId:string, opts?:any) => void)|null} remeshPart
 *   Re-runs the mesh worker for the given part using `opts` (defaults
 *   to the per-node `meshDensity`).  Published by the active viewport
 *   so non-viewport editors (Properties → MeshTab) can drive
 *   regeneration without prop-drilling.
 * @property {(fn: ((partId:string, opts?:any) => void)|null) => void} setRemeshPart
 *
 * @property {((psdW:number, psdH:number, layers:any[], partIds:string[],
 *             groupDefs:any[], assignments:Map<number,any>|null) => void)|null} finalizePsdImport
 *   GAP-001 — Wizard-side bridge. Mutates project.nodes from the parsed
 *   PSD payload, uploads textures + alpha-data to the WebGL scene, and
 *   centres the viewport on the imported character. Lives in
 *   CanvasViewport because it touches WebGL refs + imageDataMap; the
 *   wizard (mounted at AppShell level) calls it through this bridge.
 * @property {(fn: any|null) => void} setFinalizePsdImport
 *
 * @property {(() => void)|null} autoMeshAllParts
 *   GAP-001 — Wizard-side bridge. Triggers async mesh-worker generation
 *   for every meshless part. Same separation reason as
 *   `finalizePsdImport`: depends on workersRef/sceneRef inside
 *   CanvasViewport, can't move to a service.
 * @property {(fn: (() => void)|null) => void} setAutoMeshAllParts
 *
 * @property {((opts: {
 *     animId: string,
 *     timeMs: number,
 *     bgEnabled?: boolean,
 *     bgColor?: string,
 *     exportWidth?: number,
 *     exportHeight?: number,
 *     format?: 'png'|'webp'|'jpg',
 *     quality?: number,
 *     cropOffset?: {x:number, y:number}|null,
 *   }) => string|null)|null} captureExportFrame
 *   2026-05-05 — frame-export bridge. CanvasViewport renders the rig
 *   at (animId, timeMs) into an offscreen canvas sized to
 *   (exportWidth, exportHeight) with the requested bg + crop offset
 *   and returns a data URL of the chosen format. The ExportModal
 *   calls this once per frame spec when running a PNG sequence /
 *   single-frame export. Mirrors the `captureThumbnail` pattern.
 * @property {(fn: any|null) => void} setCaptureExportFrame
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<CaptureStore>>} */
export const useCaptureStore = create((set) => ({
  captureThumbnail: null,
  setCaptureThumbnail: (fn) => set({ captureThumbnail: fn }),
  remeshPart: null,
  setRemeshPart: (fn) => set({ remeshPart: fn }),
  finalizePsdImport: null,
  setFinalizePsdImport: (fn) => set({ finalizePsdImport: fn }),
  autoMeshAllParts: null,
  setAutoMeshAllParts: (fn) => set({ autoMeshAllParts: fn }),
  captureExportFrame: null,
  setCaptureExportFrame: (fn) => set({ captureExportFrame: fn }),
}));
