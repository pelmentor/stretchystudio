import { create } from 'zustand';

/**
 * Runtime parameter values — NOT persisted to the project file.
 * Separated from projectStore so slider drags don't flood the undo stack.
 *
 * Values map: { [paramId]: number }
 * If a parameter has no entry, the default from project.parameters[i].default is used.
 */
export const useParameterStore = create((set) => ({
  values: {},

  setParameterValue: (id, value) =>
    set(s => ({ values: { ...s.values, [id]: value } })),

  /** Reset all values to a parameter's default. Call after project load. */
  resetToDefaults: (parameters) => {
    const values = {};
    for (const p of (parameters ?? [])) {
      values[p.id] = p.default ?? 0;
    }
    set({ values });
  },

  clearAll: () => set({ values: {} }),
}));
