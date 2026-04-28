// @ts-check
import { create } from 'zustand';

/**
 * R0 (Native rig render v2) — live parameter values driving in-editor evaluation.
 *
 * Distinct from `project.parameters` (the persisted *spec* — id, range,
 * default) and from animation keyframes (which write into `draftPose` /
 * keyframe channels). This store is the *current dial position* of every
 * runnable param, edited via Parameters panel sliders and read by the
 * CanvasViewport tick to feed the rig evaluator.
 *
 * Plain object (not Map) — Zustand needs a fresh reference for each update,
 * so consumers re-run effects on `{...values, [id]: v}`.
 */
export const useParamValuesStore = create((set) => ({
  values: {},

  setParamValue: (id, value) =>
    set(state => ({ values: { ...state.values, [id]: value } })),

  setMany: (updates) =>
    set(state => ({ values: { ...state.values, ...updates } })),

  resetToDefaults: (parameters) => {
    const next = {};
    for (const p of parameters ?? []) {
      next[p.id] = p.default ?? 0;
    }
    set({ values: next });
  },

  reset: () => set({ values: {} }),
}));
