/**
 * v3 Phase 0A — Operator runtime state.
 *
 * Plan §6: every action user can take goes through an "operator", which
 * is a {definition + modal state machine + undo step} bundle. The
 * registry lives in `src/v3/operators/registry.js`; this store holds
 * the runtime state of whichever operator is currently mid-execution
 * (e.g. a vertex-drag op's progress, a transform gizmo's accumulator).
 *
 * Most operators run synchronously — they fire from a click handler,
 * mutate stores via undo middleware, return. Modal operators (drag,
 * lasso, knife cut) suspend in a state machine and wait for further
 * pointer / keyboard events; that suspension lives here.
 *
 * Phase 0A ships only the shape — operators themselves arrive in
 * Phase 0A.4 (registry + dispatcher) and Phase 1+ (concrete ops).
 *
 * @module store/operatorStore
 */

import { create } from 'zustand';

/**
 * @typedef {('idle'|'modal'|'finished'|'cancelled')} OperatorPhase
 *
 * @typedef {Object} ActiveOperator
 * @property {string} id              — operator id from registry
 * @property {OperatorPhase} phase
 * @property {object} state           — operator-specific transient state
 * @property {number} startedAt       — performance.now() at activation
 */

export const useOperatorStore = create((set) => ({
  /** @type {ActiveOperator|null} */
  active: null,

  /**
   * Activate an operator. If one is already running modally, the
   * caller is responsible for cancelling it first — the registry's
   * dispatcher enforces this.
   *
   * @param {string} id
   * @param {object} [initialState={}]
   */
  begin: (id, initialState = {}) =>
    set({
      active: {
        id,
        phase: 'modal',
        state: { ...initialState },
        startedAt: typeof performance !== 'undefined' ? performance.now() : 0,
      },
    }),

  /**
   * Patch the active operator's transient state (e.g. accumulating
   * pointer delta during a drag).
   * @param {object} patch
   */
  updateState: (patch) =>
    set((s) => {
      if (!s.active) return s;
      return { active: { ...s.active, state: { ...s.active.state, ...patch } } };
    }),

  /** Mark the active operator finished and clear it. */
  finish: () => set({ active: null }),

  /** Abort the active operator (caller should also revert any side effects). */
  cancel: () =>
    set((s) => (s.active ? { active: { ...s.active, phase: 'cancelled' } } : s)),
}));
