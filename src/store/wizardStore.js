// @ts-check

/**
 * v3 GAP-001 — PSD import wizard state.
 *
 * The PSD import wizard is multi-modal chrome over the canvas:
 *
 *   - `review` step       — full-screen modal listing layer→tag mappings
 *   - `reorder` step      — top banner over the canvas; user reorders in
 *                            the Outliner while the wizard watches
 *   - `adjust` step       — top banner; user drags skeleton joints visible
 *                            on the canvas
 *   - `dwpose` step       — full-screen modal during ONNX model load /
 *                            inference
 *
 * The wizard previously lived inside CanvasViewport with local React
 * state, which forced the canvas component to know about wizard
 * lifecycle, snapshot/rollback, and ML session caching. This store
 * lifts that state out so the wizard can be mounted at AppShell level
 * and the canvas only owns its WebGL concerns.
 *
 * Side-effect imperatives that the wizard triggers (mutating
 * project.nodes from PSD layers, auto-meshing every part) live on
 * CanvasViewport because they're tied to the WebGL context and
 * texture upload. The wizard reaches them through `captureStore`'s
 * registered callbacks — the same bridge SaveModal / Properties tabs
 * already use for viewport-owned actions.
 *
 * @module store/wizardStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} PendingPsd
 * @property {number} psdW
 * @property {number} psdH
 * @property {any[]} layers
 * @property {string[]} partIds
 *
 * @typedef {('review'|'reorder'|'adjust'|'dwpose')} WizardStep
 */

export const useWizardStore = create((set) => ({
  /** Parsed PSD payload, or null when no wizard run is in flight. */
  /** @type {PendingPsd|null} */
  pendingPsd: null,

  /** Active wizard step, or null when the wizard isn't open. */
  /** @type {WizardStep|null} */
  step: null,

  /** Project JSON snapshot taken at first finalize, used by the
   *  wizard's "Back" button to roll back from `adjust` → `review`.
   *  Null until a finalize has happened (or after rollback). */
  /** @type {string|null} */
  preImportSnapshot: null,

  /** "Mesh every part automatically on wizard finish" flag, set by
   *  the wizard's review step and consumed by `complete` / `skip`. */
  meshAllParts: true,

  setPendingPsd: (pendingPsd) => set({ pendingPsd }),
  setStep:       (step)       => set({ step }),
  setPreImportSnapshot: (snapshot) => set({ preImportSnapshot: snapshot }),
  setMeshAllParts: (v) => set({ meshAllParts: !!v }),

  /** Patch fields on the existing pendingPsd (used by split-merged-parts
   *  and auto-rearrange paths that update layers/partIds in place). */
  patchPendingPsd: (patch) => set((state) => ({
    pendingPsd: state.pendingPsd ? { ...state.pendingPsd, ...patch } : state.pendingPsd,
  })),

  /** Tear everything down. Called on cancel / complete / skip. */
  reset: () => set({
    pendingPsd: null,
    step: null,
    preImportSnapshot: null,
    meshAllParts: true,
  }),
}));
